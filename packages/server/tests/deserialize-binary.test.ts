/**
 * Tests for deserializeBinary via decryptTokenDev.
 *
 * The deserializeBinary function is internal to decrypt.ts. We test it through
 * decryptTokenDev which calls it when the first byte of the decoded buffer is 0x01.
 *
 * We construct binary payloads using the same BinaryWriter / format that the client
 * serializer uses (packages/client/src/transport/serializer.ts).
 */
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { decryptTokenDev } from '../src/index.js'

// ─── BinaryWriter (mirrors packages/client/src/transport/serializer.ts) ──────

const textEncoder = new TextEncoder()

class BinaryWriter {
  private _buf: ArrayBuffer
  private _view: DataView
  private _offset = 0

  constructor(initialCapacity = 512) {
    this._buf = new ArrayBuffer(initialCapacity)
    this._view = new DataView(this._buf)
  }

  writeU8(value: number): void {
    this._ensureCapacity(1)
    this._view.setUint8(this._offset, value)
    this._offset += 1
  }

  writeU16(value: number): void {
    this._ensureCapacity(2)
    this._view.setUint16(this._offset, value, false)
    this._offset += 2
  }

  writeU32(value: number): void {
    this._ensureCapacity(4)
    this._view.setUint32(this._offset, value, false)
    this._offset += 4
  }

  writeStr(value: string): void {
    const encoded = textEncoder.encode(value)
    this.writeU16(encoded.length)
    this._ensureCapacity(encoded.length)
    new Uint8Array(this._buf, this._offset, encoded.length).set(encoded)
    this._offset += encoded.length
  }

  finish(): Uint8Array {
    return new Uint8Array(this._buf, 0, this._offset)
  }

  private _ensureCapacity(needed: number): void {
    const required = this._offset + needed
    if (required <= this._buf.byteLength) return
    let newSize = this._buf.byteLength * 2
    while (newSize < required) newSize *= 2
    const newBuf = new ArrayBuffer(newSize)
    new Uint8Array(newBuf).set(new Uint8Array(this._buf))
    this._buf = newBuf
    this._view = new DataView(this._buf)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Build a minimal but complete v1 binary token payload.
 * Mirrors the exact field ordering in packages/client/src/transport/serializer.ts.
 */
function buildBinaryToken(overrides?: {
  canvasHash?: string
  webglHash?: string
  audioHash?: string
  nonce?: string
  sdkVersion?: string
  timestamp?: number
  userAgent?: string
  language?: string
  hardwareConcurrency?: number
  maxTouchPoints?: number
  pluginCount?: number
  deviceMemory?: number // 0 = null
  cookieEnabled?: boolean
  languages?: string[]
  screenWidth?: number
  screenHeight?: number
  screenAvailWidth?: number
  screenAvailHeight?: number
  colorDepth?: number
  pixelDepth?: number
  devicePixelRatio?: number // stored as DPR * 100 (u16)
  isAutomated?: boolean
  totalMouseEvents?: number
  totalKeyboardEvents?: number
  totalScrollEvents?: number
  snapshotAt?: number
}): Uint8Array {
  const w = new BinaryWriter()
  const now = overrides?.timestamp ?? Date.now()

  // version
  w.writeU8(1)

  // timestamp (high u32 + low u32)
  w.writeU32(Math.floor(now / 0x100000000))
  w.writeU32(now >>> 0)

  // nonce + sdkVersion
  w.writeStr(overrides?.nonce ?? 'test-nonce-12345678')
  w.writeStr(overrides?.sdkVersion ?? '0.1.0')

  // Fingerprint
  w.writeStr(overrides?.canvasHash ?? 'abc123canvashash')
  w.writeStr(overrides?.webglHash ?? 'def456webglhash')
  w.writeStr(overrides?.audioHash ?? 'ghi789audiohash')

  // WebGL details
  w.writeStr('ANGLE (Intel, Mesa)')
  w.writeStr('Google Inc.')
  w.writeStr('WebGL 2.0')
  w.writeStr('WebGL GLSL ES 3.00')
  // extensions array: 1 entry
  w.writeU16(1)
  w.writeStr('OES_texture_float')

  // Navigator
  w.writeStr(overrides?.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
  w.writeStr(overrides?.language ?? 'en-US')
  w.writeU16(overrides?.hardwareConcurrency ?? 8)
  w.writeU16(overrides?.maxTouchPoints ?? 0)
  w.writeU16(overrides?.pluginCount ?? 3)
  w.writeU8(overrides?.deviceMemory ?? 8)
  w.writeU8(overrides?.cookieEnabled === false ? 0 : 1)
  // languages array
  const langs = overrides?.languages ?? ['en-US', 'en']
  w.writeU16(langs.length)
  for (const l of langs) w.writeStr(l)

  // Screen
  w.writeU16(overrides?.screenWidth ?? 1920)
  w.writeU16(overrides?.screenHeight ?? 1080)
  w.writeU16(overrides?.screenAvailWidth ?? 1920)
  w.writeU16(overrides?.screenAvailHeight ?? 1080)
  w.writeU8(overrides?.colorDepth ?? 24)
  w.writeU8(overrides?.pixelDepth ?? 24)
  w.writeU16(Math.round((overrides?.devicePixelRatio ?? 2) * 100))

  // DetectionData
  w.writeU8(overrides?.isAutomated === true ? 1 : 0)
  // signals: none
  w.writeU16(0)
  // integrity: valid, no violations
  w.writeU8(1)
  w.writeU16(0)

  // BehaviorData
  // mouse events: 1 entry (type, x, y, t, buttons)
  w.writeU16(1)
  w.writeStr('move')
  w.writeU16(100)
  w.writeU16(200)
  w.writeU32(1000)
  w.writeU8(0)

  // keyboard events: 1 entry (type, code, t)
  w.writeU16(1)
  w.writeStr('keydown')
  w.writeStr('KeyA')
  w.writeU32(2000)

  // scroll events: none
  w.writeU16(0)

  // totals + snapshotAt (snapshotAt written as two u32s: high then low, matching u64 format)
  w.writeU32(overrides?.totalMouseEvents ?? 1)
  w.writeU32(overrides?.totalKeyboardEvents ?? 1)
  w.writeU32(overrides?.totalScrollEvents ?? 0)
  const snapshotAtVal = overrides?.snapshotAt ?? 5000
  w.writeU32(Math.floor(snapshotAtVal / 0x100000000))
  w.writeU32(snapshotAtVal >>> 0)

  return w.finish()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deserializeBinary via decryptTokenDev', () => {
  describe('round-trip: binary serialize → base64url → decryptTokenDev', () => {
    it('correctly deserializes all top-level token fields', () => {
      // Arrange
      const timestamp = 1700000000000
      const binary = buildBinaryToken({ timestamp, nonce: 'my-nonce-xyz', sdkVersion: '1.2.3' })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert: top-level fields
      expect(token.timestamp).toBe(timestamp)
      expect(token.nonce).toBe('my-nonce-xyz')
      expect(token.sdkVersion).toBe('1.2.3')
    })

    it('correctly deserializes fingerprint hashes', () => {
      // Arrange
      const binary = buildBinaryToken({
        canvasHash: 'canvas-hash-aaa',
        webglHash: 'webgl-hash-bbb',
        audioHash: 'audio-hash-ccc',
      })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      expect(token.fingerprint.canvas.hash).toBe('canvas-hash-aaa')
      expect(token.fingerprint.webgl.hash).toBe('webgl-hash-bbb')
      expect(token.fingerprint.audio.hash).toBe('audio-hash-ccc')
    })

    it('correctly deserializes navigator fields', () => {
      // Arrange
      const binary = buildBinaryToken({
        userAgent: 'TestAgent/1.0',
        language: 'fr-FR',
        languages: ['fr-FR', 'fr', 'en'],
        hardwareConcurrency: 4,
        maxTouchPoints: 5,
        pluginCount: 2,
        deviceMemory: 4,
        cookieEnabled: false,
      })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      const nav = token.fingerprint.navigator
      expect(nav.userAgent).toBe('TestAgent/1.0')
      expect(nav.language).toBe('fr-FR')
      expect(nav.languages).toEqual(['fr-FR', 'fr', 'en'])
      expect(nav.hardwareConcurrency).toBe(4)
      expect(nav.maxTouchPoints).toBe(5)
      expect(nav.pluginCount).toBe(2)
      expect(nav.deviceMemory).toBe(4)
      expect(nav.cookieEnabled).toBe(false)
    })

    it('deserializes deviceMemory of 0 as null', () => {
      // Arrange: deviceMemory raw value 0 means null in the protocol
      const binary = buildBinaryToken({ deviceMemory: 0 })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      expect(token.fingerprint.navigator.deviceMemory).toBeNull()
    })

    it('correctly deserializes screen fields and devicePixelRatio', () => {
      // Arrange: DPR stored as DPR * 100, so 1.5 → 150
      const binary = buildBinaryToken({
        screenWidth: 2560,
        screenHeight: 1440,
        screenAvailWidth: 2560,
        screenAvailHeight: 1400,
        colorDepth: 30,
        pixelDepth: 30,
        devicePixelRatio: 1.5,
      })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      const screen = token.fingerprint.screen
      expect(screen.width).toBe(2560)
      expect(screen.height).toBe(1440)
      expect(screen.availWidth).toBe(2560)
      expect(screen.availHeight).toBe(1400)
      expect(screen.colorDepth).toBe(30)
      expect(screen.pixelDepth).toBe(30)
      expect(screen.devicePixelRatio).toBeCloseTo(1.5, 1)
    })

    it('correctly deserializes detection.isAutomated flag', () => {
      // Arrange: isAutomated=true
      const binary = buildBinaryToken({ isAutomated: true })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      expect(token.detection.isAutomated).toBe(true)
    })

    it('correctly deserializes behavior totals', () => {
      // Arrange
      const binary = buildBinaryToken({
        totalMouseEvents: 42,
        totalKeyboardEvents: 17,
        totalScrollEvents: 5,
        snapshotAt: 9999,
      })
      const encoded = base64urlEncode(binary)

      // Act
      const token = decryptTokenDev(encoded)

      // Assert
      expect(token.behavior.totalMouseEvents).toBe(42)
      expect(token.behavior.totalKeyboardEvents).toBe(17)
      expect(token.behavior.totalScrollEvents).toBe(5)
      expect(token.behavior.snapshotAt).toBe(9999)
    })
  })

  describe('version byte validation', () => {
    it('throws when binary starts with version byte 0x02', () => {
      // Arrange: build a valid token then overwrite the version byte with 0x02
      const binary = buildBinaryToken()
      const corrupted = new Uint8Array(binary)
      corrupted[0] = 0x02
      const encoded = base64urlEncode(corrupted)

      // Act + Assert
      expect(() => decryptTokenDev(encoded)).toThrow()
    })

    it('throws when binary starts with version byte 0x00', () => {
      // Arrange
      const binary = buildBinaryToken()
      const corrupted = new Uint8Array(binary)
      corrupted[0] = 0x00
      const encoded = base64urlEncode(corrupted)

      // Act + Assert
      // Version 0x00 is not valid (expected 0x01) — tryDecompress won't recognize it
      // and decryptTokenDev will fall through to JSON.parse which will throw
      expect(() => decryptTokenDev(encoded)).toThrow()
    })
  })

  describe('truncated binary', () => {
    it('throws when binary is too short to be a valid token', () => {
      // Arrange: only 5 bytes — not enough to hold any meaningful token data
      const truncated = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x01])
      const encoded = base64urlEncode(truncated)

      // Act + Assert: should throw when trying to read beyond buffer bounds
      expect(() => decryptTokenDev(encoded)).toThrow()
    })

    it('throws when binary is a single version byte only', () => {
      // Arrange: version byte present but no timestamp follows
      const onlyVersion = new Uint8Array([0x01])
      const encoded = base64urlEncode(onlyVersion)

      // Act + Assert
      expect(() => decryptTokenDev(encoded)).toThrow()
    })
  })
})

describe('decryptTokenDev token size limit', () => {
  it('throws when base64url string decodes to more than 65536 bytes', () => {
    // Arrange: create a buffer > 65536 bytes and base64url-encode it
    // The content does not matter — the size check happens before deserialization
    const oversized = Buffer.alloc(65_537, 0x41) // 65537 'A' bytes
    const encoded = oversized
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Act + Assert
    expect(() => decryptTokenDev(encoded)).toThrow(
      /token exceeds max size/,
    )
  })

  it('does not throw when base64url string decodes to exactly 65536 bytes (boundary)', () => {
    // Arrange: JSON token padded to exactly 65536 bytes
    // Use a JSON payload that is valid enough to not throw on deserialization path
    // but we only care that the size check passes. Actually decoding may still throw
    // for invalid content — but the size error must NOT be thrown.
    const target = 65_536
    // Build a JSON token that fits within the limit
    const json = JSON.stringify({
      fingerprint: {
        canvas: { hash: 'x' },
        webgl: { hash: 'x', renderer: 'x', vendor: 'x', version: 'x', shadingLanguageVersion: 'x', extensions: [] },
        audio: { hash: 'x' },
        navigator: { userAgent: 'x', language: 'x', languages: [], platform: 'x', hardwareConcurrency: 1, deviceMemory: null, maxTouchPoints: 0, cookieEnabled: true, doNotTrack: null, vendor: 'x', pluginCount: 0 },
        screen: { width: 100, height: 100, availWidth: 100, availHeight: 100, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1 },
        collectedAt: 1700000000000,
      },
      detection: { isAutomated: false, signals: [], integrity: { isValid: true, violations: [] } },
      behavior: { mouse: [], keyboard: [], scroll: [], totalMouseEvents: 1, totalKeyboardEvents: 1, totalScrollEvents: 0, snapshotAt: 1000 },
      timestamp: 1700000000000,
      nonce: 'abc',
      sdkVersion: '0.1.0',
    })
    // Pad with whitespace to reach exactly the target decoded byte count
    const rawBuf = Buffer.from(json, 'utf-8')
    const paddingNeeded = target - rawBuf.length
    const paddedBuf = paddingNeeded > 0
      ? Buffer.concat([rawBuf, Buffer.alloc(paddingNeeded, 0x20)]) // space-pad
      : rawBuf.subarray(0, target)

    const encoded = paddedBuf
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // The token content itself is malformed (extra spaces), so it will throw —
    // but it must NOT throw with the "exceeds max size" message.
    try {
      decryptTokenDev(encoded)
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).not.toMatch(/exceeds max size/)
      }
    }
  })
})

describe('decryptTokenDev decompression bomb protection', () => {
  it('throws when decompressed data exceeds 1MB', () => {
    // Arrange: create a payload that compresses to <64KB but decompresses to >1MB
    // A long run of repeated bytes compresses extremely well (e.g. 1.5MB of zeros)
    const largeData = Buffer.alloc(1_100_000, 0x00) // 1.1MB of zeros
    const compressed = deflateRawSync(largeData)

    // Sanity: the compressed form should be well within the 65536 token size limit
    expect(compressed.length).toBeLessThan(65_536)

    const encoded = compressed
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Act + Assert: tryDecompress should detect the size violation and throw
    expect(() => decryptTokenDev(encoded)).toThrow(/decompressed size/)
  })
})
