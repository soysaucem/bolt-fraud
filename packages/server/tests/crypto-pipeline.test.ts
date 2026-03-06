/**
 * End-to-end crypto pipeline integration tests.
 *
 * Verifies the full encrypt-on-client → decrypt-on-server flow using matching RSA keys.
 *
 * Pipeline:
 *   Token → serializeForServer() → encrypt() → base64url bundle
 *     → decryptToken() → Token (deserialized)
 *
 * The server runs in Node.js. The client encrypt() uses SubtleCrypto (Web Crypto API),
 * which is available as globalThis.crypto.subtle in Node 18+ via node:crypto webcrypto.
 *
 * The binary format used by both the client serializer and server deserializer:
 * (both now include platform/vendor/doNotTrack and collectedAt fields)
 *   u8     version (0x01)
 *   u32+u32 timestamp (high, low)
 *   str    nonce
 *   str    sdkVersion
 *   str    canvas.hash
 *   str    webgl.hash
 *   str    audio.hash
 *   str    webgl.renderer
 *   str    webgl.vendor
 *   str    webgl.version
 *   str    webgl.shadingLanguageVersion
 *   u16    webgl.extensions.length
 *   str[]  webgl.extensions
 *   str    navigator.userAgent
 *   str    navigator.language
 *   u16    navigator.hardwareConcurrency
 *   u16    navigator.maxTouchPoints
 *   u16    navigator.pluginCount
 *   u8     navigator.deviceMemory (0=null)
 *   u8     navigator.cookieEnabled
 *   u16    navigator.languages.length
 *   str[]  navigator.languages
 *   str    navigator.platform
 *   str    navigator.vendor
 *   str    navigator.doNotTrack  (empty = null)
 *   u16    screen.width
 *   u16    screen.height
 *   u16    screen.availWidth
 *   u16    screen.availHeight
 *   u8     screen.colorDepth
 *   u8     screen.pixelDepth
 *   u16    screen.devicePixelRatio * 100
 *   u32+u32 collectedAt (high, low)
 *   u8     detection.isAutomated
 *   u16    signals.length
 *   per signal: str name, u8 detected
 *   u8     integrity.isValid
 *   u16    violations.length
 *   per violation: str name
 *   u16    mouse.length
 *   per mouse: str type, u16 x, u16 y, u32 t, u8 buttons
 *   u16    keyboard.length
 *   per keyboard: str type, str code, u32 t
 *   u16    scroll.length
 *   per scroll: u16 x, u16 y, u32 t
 *   u32    totalMouseEvents
 *   u32    totalKeyboardEvents
 *   u32    totalScrollEvents
 *   u32+u32 snapshotAt (high, low)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { generateKeyPairSync, KeyManager } from '../src/crypto/keys.js'
import { decryptToken } from '../src/crypto/decrypt.js'
import { encrypt } from '../../client/src/transport/crypto.js'
import { BinaryWriter } from '../../client/src/transport/serializer.js'
import type { KeyPair } from '../src/crypto/keys.js'
import type { Token } from '../src/model/types.js'

// Wire up Web Crypto API for Node.js — required by the client's encrypt() which uses
// globalThis.crypto.subtle. Available natively in Node 18+ via node:crypto.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  })
}

// ─── Server-format serializer ─────────────────────────────────────────────────

/**
 * Serialize a Token into the binary format matching the server's deserializeBinary().
 * Includes all v2 fields: platform, vendor, doNotTrack, collectedAt.
 */
function serializeForServer(token: Token): Uint8Array {
  const w = new BinaryWriter()

  // Format version
  w.writeU8(1)

  // Timestamp as two u32s (high/low)
  w.writeU32(Math.floor(token.timestamp / 0x1_0000_0000))
  w.writeU32(token.timestamp >>> 0)

  w.writeStr(token.nonce)
  w.writeStr(token.sdkVersion)

  // Fingerprint
  const fp = token.fingerprint
  w.writeStr(fp.canvas.hash)
  w.writeStr(fp.webgl.hash)
  w.writeStr(fp.audio.hash)           // audio before webgl details (matches server)
  w.writeStr(fp.webgl.renderer)
  w.writeStr(fp.webgl.vendor)
  w.writeStr(fp.webgl.version)
  w.writeStr(fp.webgl.shadingLanguageVersion)

  w.writeU16(fp.webgl.extensions.length)
  for (const ext of fp.webgl.extensions) {
    w.writeStr(ext)
  }

  w.writeStr(fp.navigator.userAgent)
  w.writeStr(fp.navigator.language)
  w.writeU16(fp.navigator.hardwareConcurrency)
  w.writeU16(fp.navigator.maxTouchPoints)
  w.writeU16(fp.navigator.pluginCount)
  w.writeU8(fp.navigator.deviceMemory === null ? 0 : fp.navigator.deviceMemory)
  w.writeU8(fp.navigator.cookieEnabled ? 1 : 0)

  w.writeU16(fp.navigator.languages.length)
  for (const lang of fp.navigator.languages) {
    w.writeStr(lang)
  }

  // v2 fields: platform, vendor, doNotTrack
  w.writeStr(fp.navigator.platform)
  w.writeStr(fp.navigator.vendor)
  w.writeStr(fp.navigator.doNotTrack ?? '')

  // Screen
  w.writeU16(fp.screen.width)
  w.writeU16(fp.screen.height)
  w.writeU16(fp.screen.availWidth)
  w.writeU16(fp.screen.availHeight)
  w.writeU8(fp.screen.colorDepth)
  w.writeU8(fp.screen.pixelDepth)
  w.writeU16(Math.round(fp.screen.devicePixelRatio * 100))

  // collectedAt as two u32s
  const collectedAt = Math.round(fp.collectedAt)
  w.writeU32(Math.floor(collectedAt / 0x1_0000_0000))
  w.writeU32(collectedAt >>> 0)

  // Detection
  const det = token.detection
  w.writeU8(det.isAutomated ? 1 : 0)

  w.writeU16(det.signals.length)
  for (const sig of det.signals) {
    w.writeStr(sig.name)
    w.writeU8(sig.detected ? 1 : 0)
  }

  w.writeU8(det.integrity.isValid ? 1 : 0)
  w.writeU16(det.integrity.violations.length)
  for (const v of det.integrity.violations) {
    w.writeStr(v.name)
  }

  // Behavior
  const beh = token.behavior
  w.writeU16(beh.mouse.length)
  for (const ev of beh.mouse) {
    w.writeStr(ev.type)
    w.writeU16(ev.x)
    w.writeU16(ev.y)
    w.writeU32(Math.round(ev.t))
    w.writeU8(ev.buttons)
  }

  w.writeU16(beh.keyboard.length)
  for (const ev of beh.keyboard) {
    w.writeStr(ev.type)
    w.writeStr(ev.code)
    w.writeU32(Math.round(ev.t))
  }

  w.writeU16(beh.scroll.length)
  for (const ev of beh.scroll) {
    w.writeU16(ev.x)
    w.writeU16(ev.y)
    w.writeU32(Math.round(ev.t))
  }

  w.writeU32(beh.totalMouseEvents)
  w.writeU32(beh.totalKeyboardEvents)
  w.writeU32(beh.totalScrollEvents)

  const snap = Math.round(beh.snapshotAt)
  w.writeU32(Math.floor(snap / 0x1_0000_0000))
  w.writeU32(snap >>> 0)

  return w.finish()
}

// ─── Test fixture factory ─────────────────────────────────────────────────────

function buildToken(overrides?: Partial<Token>): Token {
  return {
    timestamp: 1700000000000,
    nonce: 'test-nonce-abc123',
    sdkVersion: '0.1.0',
    fingerprint: {
      canvas: { hash: 'abc123canvashash' },
      webgl: {
        hash: 'def456webglhash',
        renderer: 'ANGLE (Intel, Mesa)',
        vendor: 'Google Inc.',
        version: 'WebGL 2.0',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00',
        extensions: ['OES_texture_float', 'EXT_color_buffer_float'],
      },
      audio: { hash: 'ghi789audiohash' },
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        language: 'en-US',
        languages: ['en-US', 'en'],
        platform: 'MacIntel',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        cookieEnabled: true,
        doNotTrack: null,
        vendor: 'Apple Computer, Inc.',
        pluginCount: 3,
      },
      screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1040,
        colorDepth: 24,
        pixelDepth: 24,
        devicePixelRatio: 2,
      },
      collectedAt: 1700000000000,
    },
    detection: {
      isAutomated: false,
      signals: [
        { name: 'webdriver_present', detected: false },
        { name: 'puppeteer_runtime', detected: false },
      ],
      integrity: {
        isValid: true,
        violations: [],
      },
    },
    behavior: {
      mouse: [
        { type: 'move', x: 100, y: 200, t: 1000, buttons: 0 },
        { type: 'move', x: 150, y: 220, t: 1016, buttons: 0 },
        { type: 'click', x: 200, y: 300, t: 1064, buttons: 1 },
      ],
      keyboard: [
        { type: 'keydown', code: 'KeyA', t: 2000 },
        { type: 'keyup', code: 'KeyA', t: 2100 },
      ],
      scroll: [
        { x: 0, y: 100, t: 3000 },
      ],
      totalMouseEvents: 3,
      totalKeyboardEvents: 2,
      totalScrollEvents: 1,
      snapshotAt: 5000,
    },
    ...overrides,
  }
}

/**
 * Full client-side pipeline: serialize (server format) → encrypt → base64url bundle.
 */
async function clientEncrypt(token: Token, publicKeyPem: string, keyId = 0): Promise<string> {
  const serialized = serializeForServer(token)
  return encrypt(serialized, publicKeyPem, keyId)
}

// ─── Test setup ──────────────────────────────────────────────────────────────

// RSA key generation is expensive (~200ms). Generate once for the whole suite.
let keyPair: KeyPair
let keyManager: KeyManager

beforeAll(() => {
  keyPair = generateKeyPairSync(2048)
  keyManager = new KeyManager()
  keyManager.addKeyPair(0, keyPair.publicKey, keyPair.privateKey)
}, 30_000)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('E2E crypto pipeline: client serialize+encrypt → server decryptToken', () => {
  it('basic round-trip: decrypted token matches all server-readable fields', async () => {
    // Arrange
    const token = buildToken()
    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)

    // Act
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    // Assert — identity fields
    expect(result.nonce).toBe(token.nonce)
    expect(result.sdkVersion).toBe(token.sdkVersion)
    expect(result.timestamp).toBe(token.timestamp)

    // Assert — fingerprint hashes
    expect(result.fingerprint.canvas.hash).toBe(token.fingerprint.canvas.hash)
    expect(result.fingerprint.webgl.hash).toBe(token.fingerprint.webgl.hash)
    expect(result.fingerprint.audio.hash).toBe(token.fingerprint.audio.hash)

    // Assert — WebGL renderer details
    expect(result.fingerprint.webgl.renderer).toBe(token.fingerprint.webgl.renderer)
    expect(result.fingerprint.webgl.vendor).toBe(token.fingerprint.webgl.vendor)
    expect(result.fingerprint.webgl.version).toBe(token.fingerprint.webgl.version)
    expect(result.fingerprint.webgl.shadingLanguageVersion).toBe(
      token.fingerprint.webgl.shadingLanguageVersion,
    )
    expect(result.fingerprint.webgl.extensions).toEqual(token.fingerprint.webgl.extensions)

    // Assert — navigator (fields the server reads from binary)
    expect(result.fingerprint.navigator.userAgent).toBe(token.fingerprint.navigator.userAgent)
    expect(result.fingerprint.navigator.language).toBe(token.fingerprint.navigator.language)
    expect(result.fingerprint.navigator.languages).toEqual(token.fingerprint.navigator.languages)
    expect(result.fingerprint.navigator.hardwareConcurrency).toBe(
      token.fingerprint.navigator.hardwareConcurrency,
    )
    expect(result.fingerprint.navigator.maxTouchPoints).toBe(
      token.fingerprint.navigator.maxTouchPoints,
    )
    expect(result.fingerprint.navigator.pluginCount).toBe(token.fingerprint.navigator.pluginCount)
    expect(result.fingerprint.navigator.deviceMemory).toBe(token.fingerprint.navigator.deviceMemory)
    expect(result.fingerprint.navigator.cookieEnabled).toBe(token.fingerprint.navigator.cookieEnabled)

    // Assert — v2 navigator fields
    expect(result.fingerprint.navigator.platform).toBe(token.fingerprint.navigator.platform)
    expect(result.fingerprint.navigator.vendor).toBe(token.fingerprint.navigator.vendor)
    expect(result.fingerprint.navigator.doNotTrack).toBe(token.fingerprint.navigator.doNotTrack)

    // Assert — collectedAt
    expect(result.fingerprint.collectedAt).toBe(token.fingerprint.collectedAt)

    // Assert — screen
    expect(result.fingerprint.screen.width).toBe(token.fingerprint.screen.width)
    expect(result.fingerprint.screen.height).toBe(token.fingerprint.screen.height)
    expect(result.fingerprint.screen.availWidth).toBe(token.fingerprint.screen.availWidth)
    expect(result.fingerprint.screen.availHeight).toBe(token.fingerprint.screen.availHeight)
    expect(result.fingerprint.screen.colorDepth).toBe(token.fingerprint.screen.colorDepth)
    expect(result.fingerprint.screen.pixelDepth).toBe(token.fingerprint.screen.pixelDepth)
    // DPR stored as u16 (DPR * 100) then divided on decode. 2.0 → 200 → 2.0 exactly.
    expect(result.fingerprint.screen.devicePixelRatio).toBeCloseTo(
      token.fingerprint.screen.devicePixelRatio,
      2,
    )

    // Assert — detection
    expect(result.detection.isAutomated).toBe(token.detection.isAutomated)
    expect(result.detection.signals).toHaveLength(token.detection.signals.length)
    expect(result.detection.signals[0]?.name).toBe(token.detection.signals[0]?.name)
    expect(result.detection.signals[0]?.detected).toBe(token.detection.signals[0]?.detected)
    expect(result.detection.integrity.isValid).toBe(token.detection.integrity.isValid)
    expect(result.detection.integrity.violations).toHaveLength(0)

    // Assert — behavior
    expect(result.behavior.totalMouseEvents).toBe(token.behavior.totalMouseEvents)
    expect(result.behavior.totalKeyboardEvents).toBe(token.behavior.totalKeyboardEvents)
    expect(result.behavior.totalScrollEvents).toBe(token.behavior.totalScrollEvents)
    expect(result.behavior.snapshotAt).toBe(token.behavior.snapshotAt)

    // Mouse events
    expect(result.behavior.mouse).toHaveLength(token.behavior.mouse.length)
    expect(result.behavior.mouse[0]).toMatchObject({ type: 'move', x: 100, y: 200, t: 1000, buttons: 0 })
    expect(result.behavior.mouse[2]).toMatchObject({ type: 'click', x: 200, y: 300, t: 1064, buttons: 1 })

    // Keyboard events
    expect(result.behavior.keyboard).toHaveLength(2)
    expect(result.behavior.keyboard[0]).toMatchObject({ type: 'keydown', code: 'KeyA', t: 2000 })
    expect(result.behavior.keyboard[1]).toMatchObject({ type: 'keyup', code: 'KeyA', t: 2100 })

    // Scroll events
    expect(result.behavior.scroll).toHaveLength(1)
    expect(result.behavior.scroll[0]).toMatchObject({ x: 0, y: 100, t: 3000 })
  })

  it('round-trip with keyId=5: server resolves correct key by id embedded in bundle', async () => {
    // Arrange: register the key under keyId=5
    const km = new KeyManager()
    km.addKeyPair(5, keyPair.publicKey, keyPair.privateKey)

    const token = buildToken({ nonce: 'keyid-5-nonce' })
    const bundle = await clientEncrypt(token, keyPair.publicKey, 5)

    // Act: server reads keyId=5 from the bundle header and resolves the correct key
    const result = decryptToken(bundle, (id) => km.getPrivateKeyObject(id))

    // Assert: correct key was used — token decrypted successfully
    expect(result.nonce).toBe('keyid-5-nonce')
    expect(result.fingerprint.canvas.hash).toBe(token.fingerprint.canvas.hash)
    expect(result.detection.isAutomated).toBe(false)
  })

  it('round-trip with keyId=5 fails if key resolver returns the wrong private key', async () => {
    // Arrange: encrypt with the original key pair under keyId=5, but
    // the server only has a different key pair registered under keyId=5.
    const differentKeyPair = generateKeyPairSync(2048)
    const km = new KeyManager()
    km.addKeyPair(5, differentKeyPair.publicKey, differentKeyPair.privateKey)

    const token = buildToken({ nonce: 'wrong-key-test' })
    // Bundle encrypted with original keyPair's public key, keyId=5
    const bundle = await clientEncrypt(token, keyPair.publicKey, 5)

    // Act + Assert: RSA-OAEP unwrap fails — wrong private key for the wrapped AES key
    expect(() => decryptToken(bundle, (id) => km.getPrivateKeyObject(id))).toThrow()
  })

  it('round-trip with automation detected: signals and violations preserve correctly', async () => {
    // Arrange: a payload representing a detected automation client
    const token = buildToken({
      detection: {
        isAutomated: true,
        signals: [
          { name: 'webdriver_present', detected: true },
          { name: 'puppeteer_runtime', detected: true },
          { name: 'playwright_runtime', detected: false },
        ],
        integrity: {
          isValid: false,
          violations: [
            { name: 'native_function_toString_overridden' },
            { name: 'fetch_native_overridden' },
          ],
        },
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    // Assert — detection faithfully preserved through binary round-trip
    expect(result.detection.isAutomated).toBe(true)
    expect(result.detection.signals).toHaveLength(3)
    expect(result.detection.signals[0]?.name).toBe('webdriver_present')
    expect(result.detection.signals[0]?.detected).toBe(true)
    expect(result.detection.signals[1]?.name).toBe('puppeteer_runtime')
    expect(result.detection.signals[1]?.detected).toBe(true)
    expect(result.detection.signals[2]?.name).toBe('playwright_runtime')
    expect(result.detection.signals[2]?.detected).toBe(false)

    expect(result.detection.integrity.isValid).toBe(false)
    expect(result.detection.integrity.violations).toHaveLength(2)
    expect(result.detection.integrity.violations[0]?.name).toBe('native_function_toString_overridden')
    expect(result.detection.integrity.violations[1]?.name).toBe('fetch_native_overridden')
  })

  it('round-trip with large behavior data: 50 mouse + 30 keyboard + 20 scroll events', async () => {
    // Arrange: large behavior arrays stress binary packing and length-prefix counts
    const mouse = Array.from({ length: 50 }, (_, i) => ({
      type: (i % 2 === 0 ? 'move' : 'click') as 'move' | 'click',
      x: (i * 13) % 1920,
      y: (i * 17) % 1080,
      t: 1000 + i * 16,
      buttons: i % 2 === 0 ? 0 : 1,
    }))

    const keyboard = Array.from({ length: 30 }, (_, i) => ({
      type: (i % 2 === 0 ? 'keydown' : 'keyup') as 'keydown' | 'keyup',
      code: `Key${String.fromCharCode(65 + (i % 26))}`,
      t: 2000 + i * 50,
    }))

    const scroll = Array.from({ length: 20 }, (_, i) => ({
      x: 0,
      y: i * 50,
      t: 3000 + i * 100,
    }))

    const token = buildToken({
      behavior: {
        mouse,
        keyboard,
        scroll,
        totalMouseEvents: 200,
        totalKeyboardEvents: 120,
        totalScrollEvents: 80,
        snapshotAt: 10000,
      },
    })

    // Act
    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    // Assert — array lengths
    expect(result.behavior.mouse).toHaveLength(50)
    expect(result.behavior.keyboard).toHaveLength(30)
    expect(result.behavior.scroll).toHaveLength(20)
    expect(result.behavior.totalMouseEvents).toBe(200)
    expect(result.behavior.totalKeyboardEvents).toBe(120)
    expect(result.behavior.totalScrollEvents).toBe(80)
    expect(result.behavior.snapshotAt).toBe(10000)

    // Spot-check first and last events to catch off-by-one errors
    expect(result.behavior.mouse[0]).toMatchObject({ type: 'move', x: 0, y: 0, t: 1000, buttons: 0 })
    expect(result.behavior.mouse[49]?.type).toBe('click')
    expect(result.behavior.mouse[49]?.t).toBe(1000 + 49 * 16)

    expect(result.behavior.keyboard[0]).toMatchObject({ type: 'keydown', code: 'KeyA', t: 2000 })
    expect(result.behavior.keyboard[29]?.t).toBe(2000 + 29 * 50)

    expect(result.behavior.scroll[0]).toMatchObject({ x: 0, y: 0, t: 3000 })
    expect(result.behavior.scroll[19]).toMatchObject({ x: 0, y: 950, t: 4900 })
  })

  it('round-trip with empty behavior: zero events in all arrays', async () => {
    // Arrange: no user interaction recorded (could be a bot that never moves the mouse)
    const token = buildToken({
      behavior: {
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
        snapshotAt: 0,
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.behavior.mouse).toHaveLength(0)
    expect(result.behavior.keyboard).toHaveLength(0)
    expect(result.behavior.scroll).toHaveLength(0)
    expect(result.behavior.totalMouseEvents).toBe(0)
    expect(result.behavior.snapshotAt).toBe(0)
  })

  it('round-trip with null deviceMemory: 0 sentinel value preserved correctly', async () => {
    // The serializer writes 0 for null deviceMemory; the server reads 0 → null.
    const token = buildToken({
      fingerprint: {
        ...buildToken().fingerprint,
        navigator: {
          ...buildToken().fingerprint.navigator,
          deviceMemory: null,
        },
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.fingerprint.navigator.deviceMemory).toBeNull()
  })

  it('round-trip with many WebGL extensions: u16 length-prefix preserved for 8 extensions', async () => {
    // Arrange: 8 WebGL extension strings
    const extensions = [
      'OES_texture_float',
      'OES_texture_half_float',
      'WEBGL_lose_context',
      'OES_standard_derivatives',
      'OES_vertex_array_object',
      'WEBGL_debug_renderer_info',
      'WEBGL_debug_shaders',
      'EXT_color_buffer_float',
    ]

    const token = buildToken({
      fingerprint: {
        ...buildToken().fingerprint,
        webgl: {
          ...buildToken().fingerprint.webgl,
          extensions,
        },
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.fingerprint.webgl.extensions).toEqual(extensions)
  })

  it('round-trip with fractional devicePixelRatio: quantized to nearest 0.01', async () => {
    // DPR 1.5 is stored as u16(150) and decoded as 1.5. Use toBeCloseTo for float safety.
    const token = buildToken({
      fingerprint: {
        ...buildToken().fingerprint,
        screen: {
          ...buildToken().fingerprint.screen,
          devicePixelRatio: 1.5,
        },
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.fingerprint.screen.devicePixelRatio).toBeCloseTo(1.5, 2)
  })

  it('each encryption produces a unique bundle (random IV + random AES key per call)', async () => {
    // Arrange: same token encrypted twice
    const token = buildToken()

    // Act
    const bundle1 = await clientEncrypt(token, keyPair.publicKey, 0)
    const bundle2 = await clientEncrypt(token, keyPair.publicKey, 0)

    // Assert: bundles differ due to random IV and fresh AES key each time
    expect(bundle1).not.toBe(bundle2)

    // Both must still decrypt to the same logical token
    const result1 = decryptToken(bundle1, (id) => keyManager.getPrivateKeyObject(id))
    const result2 = decryptToken(bundle2, (id) => keyManager.getPrivateKeyObject(id))
    expect(result1.nonce).toBe(result2.nonce)
    expect(result1.fingerprint.canvas.hash).toBe(result2.fingerprint.canvas.hash)
    expect(result1.behavior.totalMouseEvents).toBe(result2.behavior.totalMouseEvents)
  })

  it('decryptToken throws when bundle ciphertext is tampered (AES-GCM auth tag fails)', async () => {
    // Arrange
    const token = buildToken()
    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)

    // Tamper: flip a byte deep in the ciphertext region (skip header + wrappedKey + IV)
    const bytes = Buffer.from(
      bundle.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (bundle.length % 4)) % 4),
      'base64',
    )
    const tamperedPos = Math.floor(bytes.length * 0.8)
    bytes[tamperedPos] = ((bytes[tamperedPos] ?? 0) ^ 0xff)
    const tamperedBundle = bytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Act + Assert: AES-GCM auth tag verification must fail — tampered ciphertext is rejected
    expect(() =>
      decryptToken(tamperedBundle, (id) => keyManager.getPrivateKeyObject(id)),
    ).toThrow()
  })

  it('server throws when bundle keyId does not match any loaded key', async () => {
    // Arrange: bundle encrypted with keyId=0, but km has no key registered under 0
    const km = new KeyManager()
    km.addKeyPair(99, keyPair.publicKey, keyPair.privateKey)

    const token = buildToken()
    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)

    // Act + Assert: key resolver throws for unknown keyId
    expect(() =>
      decryptToken(bundle, (id) => km.getPrivateKeyObject(id)),
    ).toThrow()
  })

  it('round-trip with multiple navigator language variants', async () => {
    // Arrange: many language entries to stress the u16 length-prefixed string array
    const token = buildToken({
      fingerprint: {
        ...buildToken().fingerprint,
        navigator: {
          ...buildToken().fingerprint.navigator,
          language: 'fr-FR',
          languages: ['fr-FR', 'fr', 'en-US', 'en', 'de', 'es'],
        },
      },
    })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.fingerprint.navigator.language).toBe('fr-FR')
    expect(result.fingerprint.navigator.languages).toEqual(['fr-FR', 'fr', 'en-US', 'en', 'de', 'es'])
  })

  it('round-trip preserves timestamp split across two u32s for large values', async () => {
    // Use a timestamp that has a non-zero high word (after year 2106 it would overflow,
    // but current epoch timestamps have high=0; test a synthetic large value instead).
    // 0x1_0000_0001 = 4294967297, which has high=1, low=1
    const largeTimestamp = 0x1_0000_0001
    const token = buildToken({ timestamp: largeTimestamp })

    const bundle = await clientEncrypt(token, keyPair.publicKey, 0)
    const result = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(result.timestamp).toBe(largeTimestamp)
  })
})
