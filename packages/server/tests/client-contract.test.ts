/**
 * Contract test: the REAL client serializer + encrypt() feed the REAL server decryptToken().
 *
 * Unlike crypto-pipeline.test.ts (which hand-writes the 0.3.x layout), this proves the
 * 0.4.0 wire format end to end: empty retired audio/code slots, trailing timezone,
 * and the 32-events-per-ring cap.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { generateKeyPairSync, KeyManager } from '../src/crypto/keys.js'
import { decryptToken } from '../src/crypto/decrypt.js'
import { RiskEngine } from '../src/scoring/engine.js'
import { serialize } from '../../client/src/transport/serializer.js'
import { encrypt } from '../../client/src/transport/crypto.js'
import type { TokenPayload } from '../../client/src/types.js'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true, configurable: true })
}

function buildPayload(): TokenPayload {
  const mouse = Array.from({ length: 128 }, (_, i) => ({
    type: 'move' as const,
    x: 100 + i * 3,
    y: 200 + ((i * 7) % 90),
    t: 1000 + i * 16,
    buttons: 0,
  }))
  const keyboard = Array.from({ length: 128 }, (_, i) => ({
    type: (i % 2 === 0 ? 'keydown' : 'keyup') as 'keydown' | 'keyup',
    t: 5000 + i * 37,
  }))
  const scroll = Array.from({ length: 128 }, (_, i) => ({ x: 0, y: i * 10, t: 9000 + i * 20 }))
  return {
    timestamp: Date.now(),
    nonce: 'contract-nonce-0123456789',
    sdkVersion: '0.4.0',
    fingerprint: {
      canvas: { hash: 'canvashash0123456789abcdef' },
      webgl: {
        hash: 'webglhash0123456789abcdef',
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
        vendor: 'Google Inc. (Apple)',
        version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)',
        extensions: ['OES_texture_float', 'EXT_color_buffer_float'],
      },
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        language: 'en-US',
        languages: ['en-US', 'en'],
        platform: 'MacIntel',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        cookieEnabled: true,
        doNotTrack: null,
        vendor: 'Google Inc.',
        pluginCount: 5,
      },
      screen: {
        width: 1512,
        height: 982,
        availWidth: 1512,
        availHeight: 944,
        colorDepth: 30,
        pixelDepth: 30,
        devicePixelRatio: 2,
      },
      timezone: 'Asia/Ho_Chi_Minh',
      collectedAt: Date.now(),
    },
    detection: {
      isAutomated: false,
      signals: [{ name: 'webdriver_present', detected: false }],
      integrity: { isValid: true, violations: [] },
    },
    behavior: {
      mouse,
      keyboard,
      scroll,
      totalMouseEvents: 400,
      totalKeyboardEvents: 300,
      totalScrollEvents: 200,
      snapshotAt: Date.now(),
    },
  }
}

let keyManager: KeyManager
let publicKey: string

beforeAll(() => {
  const pair = generateKeyPairSync(2048)
  publicKey = pair.publicKey
  keyManager = new KeyManager()
  keyManager.addKeyPair(0, pair.publicKey, pair.privateKey)
}, 30_000)

describe('client serialize() + encrypt() → server decryptToken()', () => {
  it('decodes every field the server reads, including the trailing timezone', async () => {
    const payload = buildPayload()
    const bundle = await encrypt(serialize(payload), publicKey, 0)

    const token = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(token.nonce).toBe(payload.nonce)
    expect(token.sdkVersion).toBe('0.4.0')
    expect(token.timestamp).toBe(payload.timestamp)
    expect(token.fingerprint.timezone).toBe('Asia/Ho_Chi_Minh')
    expect(token.fingerprint.canvas.hash).toBe(payload.fingerprint.canvas.hash)
    expect(token.fingerprint.webgl.renderer).toBe(payload.fingerprint.webgl.renderer)
    expect(token.fingerprint.navigator.platform).toBe('MacIntel')
    expect(token.fingerprint.screen.width).toBe(1512)
    expect(token.fingerprint.screen.devicePixelRatio).toBe(2)
  })

  it('writes empty retired audio and keyboard-code slots', async () => {
    const bundle = await encrypt(serialize(buildPayload()), publicKey, 0)

    const token = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(token.fingerprint.audio.hash).toBe('')
    expect(token.behavior.keyboard.length).toBeGreaterThan(0)
    expect(token.behavior.keyboard.every((e) => e.code === '')).toBe(true)
  })

  it('caps each behavior ring at the newest 32 events but keeps the totals', async () => {
    const payload = buildPayload()
    const bundle = await encrypt(serialize(payload), publicKey, 0)

    const token = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    expect(token.behavior.mouse).toHaveLength(32)
    expect(token.behavior.keyboard).toHaveLength(32)
    expect(token.behavior.scroll).toHaveLength(32)
    expect(token.behavior.mouse[31]?.t).toBe(payload.behavior.mouse[127]?.t)
    expect(token.behavior.totalMouseEvents).toBe(400)
  })

  it('scores a clean real-client token as allow with no fingerprint penalty', async () => {
    const bundle = await encrypt(serialize(buildPayload()), publicKey, 0)
    const token = decryptToken(bundle, (id) => keyManager.getPrivateKeyObject(id))

    const decision = await new RiskEngine().score(token)

    expect(decision.decision).toBe('allow')
    expect(decision.reasons).not.toContain('audio_fingerprint_zero_or_empty')
  })
})
