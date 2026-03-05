// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { BinaryWriter, serialize, deserialize } from '../src/transport/serializer.js'
import { createMockTokenPayload, createMockFingerprint, createMockBehavior } from './helpers.js'

// ─── BinaryWriter ─────────────────────────────────────────────────────────────

describe('BinaryWriter', () => {
  describe('writeU8', () => {
    it('writes a single byte at offset 0', () => {
      // Arrange
      const writer = new BinaryWriter()

      // Act
      writer.writeU8(42)

      // Assert
      const result = writer.finish()
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(42)
    })

    it('writes the maximum u8 value (255)', () => {
      const writer = new BinaryWriter()
      writer.writeU8(255)
      expect(writer.finish()[0]).toBe(255)
    })

    it('writes zero', () => {
      const writer = new BinaryWriter()
      writer.writeU8(0)
      expect(writer.finish()[0]).toBe(0)
    })

    it('writes multiple bytes sequentially', () => {
      const writer = new BinaryWriter()
      writer.writeU8(1)
      writer.writeU8(2)
      writer.writeU8(3)
      const result = writer.finish()
      expect(Array.from(result)).toEqual([1, 2, 3])
    })
  })

  describe('writeU16', () => {
    it('writes big-endian uint16 for value 0x0102', () => {
      // Arrange
      const writer = new BinaryWriter()

      // Act
      writer.writeU16(0x0102)

      // Assert: big-endian means high byte first
      const result = writer.finish()
      expect(result).toHaveLength(2)
      expect(result[0]).toBe(0x01)
      expect(result[1]).toBe(0x02)
    })

    it('writes big-endian uint16 for value 256 (0x0100)', () => {
      const writer = new BinaryWriter()
      writer.writeU16(256)
      const result = writer.finish()
      expect(result[0]).toBe(0x01)
      expect(result[1]).toBe(0x00)
    })

    it('writes max uint16 (65535 = 0xFFFF)', () => {
      const writer = new BinaryWriter()
      writer.writeU16(65535)
      const result = writer.finish()
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xff)
    })

    it('writes zero as two zero bytes', () => {
      const writer = new BinaryWriter()
      writer.writeU16(0)
      const result = writer.finish()
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(0)
    })
  })

  describe('writeU32', () => {
    it('writes big-endian uint32 for value 0x01020304', () => {
      // Arrange
      const writer = new BinaryWriter()

      // Act
      writer.writeU32(0x01020304)

      // Assert: big-endian — most significant byte first
      const result = writer.finish()
      expect(result).toHaveLength(4)
      expect(result[0]).toBe(0x01)
      expect(result[1]).toBe(0x02)
      expect(result[2]).toBe(0x03)
      expect(result[3]).toBe(0x04)
    })

    it('writes big-endian uint32 for value 0 as four zero bytes', () => {
      const writer = new BinaryWriter()
      writer.writeU32(0)
      expect(Array.from(writer.finish())).toEqual([0, 0, 0, 0])
    })

    it('writes max safe integer value correctly', () => {
      const writer = new BinaryWriter()
      // Use a value that fits in u32: 0xFFFFFFFF
      writer.writeU32(0xffffffff >>> 0)
      const result = writer.finish()
      expect(Array.from(result)).toEqual([0xff, 0xff, 0xff, 0xff])
    })
  })

  describe('writeStr', () => {
    it('writes a length-prefixed UTF-8 string', () => {
      // Arrange
      const writer = new BinaryWriter()

      // Act
      writer.writeStr('hi')

      // Assert: [0x00, 0x02, 'h', 'i']
      const result = writer.finish()
      expect(result).toHaveLength(4)
      expect(result[0]).toBe(0x00) // length high byte
      expect(result[1]).toBe(0x02) // length low byte
      expect(result[2]).toBe(0x68) // 'h'
      expect(result[3]).toBe(0x69) // 'i'
    })

    it('writes an empty string as length prefix 0 with no content bytes', () => {
      const writer = new BinaryWriter()
      writer.writeStr('')
      const result = writer.finish()
      expect(result).toHaveLength(2) // only the u16 length
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(0)
    })

    it('writes a multi-byte UTF-8 string (emoji)', () => {
      const writer = new BinaryWriter()
      // "A" is 1 byte, emoji varies; use a simple known multi-byte
      writer.writeStr('é') // é is 2 bytes in UTF-8: 0xC3, 0xA9
      const result = writer.finish()
      // length prefix = 2, then 2 content bytes
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(2)
      expect(result[2]).toBe(0xc3)
      expect(result[3]).toBe(0xa9)
    })

    it('correctly encodes a typical hash string', () => {
      const writer = new BinaryWriter()
      const hash = 'abc123'
      writer.writeStr(hash)
      const result = writer.finish()
      // 2-byte length prefix + 6 content bytes
      expect(result).toHaveLength(8)
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(6) // length
    })
  })

  describe('writeBytes', () => {
    it('writes length-prefixed bytes with a u32 length prefix', () => {
      // Arrange
      const writer = new BinaryWriter()
      const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

      // Act
      writer.writeBytes(data)

      // Assert: [0x00, 0x00, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef]
      const result = writer.finish()
      expect(result).toHaveLength(8)
      // u32 big-endian length = 4
      expect(result[0]).toBe(0x00)
      expect(result[1]).toBe(0x00)
      expect(result[2]).toBe(0x00)
      expect(result[3]).toBe(0x04)
      // content
      expect(result[4]).toBe(0xde)
      expect(result[5]).toBe(0xad)
      expect(result[6]).toBe(0xbe)
      expect(result[7]).toBe(0xef)
    })

    it('writes empty byte array with zero-length prefix', () => {
      const writer = new BinaryWriter()
      writer.writeBytes(new Uint8Array(0))
      const result = writer.finish()
      expect(result).toHaveLength(4)
      expect(Array.from(result)).toEqual([0, 0, 0, 0])
    })
  })

  describe('auto-grow buffer', () => {
    it('grows when writes exceed initial capacity', () => {
      // Arrange: tiny initial capacity
      const writer = new BinaryWriter(4)

      // Act: write more than 4 bytes
      for (let i = 0; i < 10; i++) {
        writer.writeU8(i)
      }

      // Assert: no error and all bytes are present
      const result = writer.finish()
      expect(result).toHaveLength(10)
      for (let i = 0; i < 10; i++) {
        expect(result[i]).toBe(i)
      }
    })

    it('grows multiple times when writes are much larger than initial capacity', () => {
      const writer = new BinaryWriter(2)

      // Write a 100-byte string (plus 2-byte length prefix = 102 bytes total)
      writer.writeStr('a'.repeat(100))

      const result = writer.finish()
      expect(result).toHaveLength(102)
    })
  })

  describe('finish', () => {
    it('returns only the bytes written, not the full buffer', () => {
      // Arrange: large initial capacity
      const writer = new BinaryWriter(1024)

      // Act: write only 3 bytes
      writer.writeU8(10)
      writer.writeU8(20)
      writer.writeU8(30)

      // Assert: finish returns exactly 3 bytes
      const result = writer.finish()
      expect(result).toHaveLength(3)
      expect(Array.from(result)).toEqual([10, 20, 30])
    })

    it('returns empty Uint8Array when nothing has been written', () => {
      const writer = new BinaryWriter()
      const result = writer.finish()
      expect(result).toHaveLength(0)
    })
  })
})

// ─── serialize/deserialize round-trip ────────────────────────────────────────

describe('serialize / deserialize round-trip', () => {
  it('round-trips a complete TokenPayload with full behavior arrays', () => {
    // Arrange
    const payload = createMockTokenPayload()

    // Act
    const bytes = serialize(payload)
    const restored = deserialize(bytes)

    // Assert: key fields survive the round-trip
    expect(restored.nonce).toBe(payload.nonce)
    expect(restored.sdkVersion).toBe(payload.sdkVersion)
    expect(restored.timestamp).toBe(payload.timestamp)
    expect(restored.fingerprint.canvas.hash).toBe(payload.fingerprint.canvas.hash)
    expect(restored.fingerprint.webgl.hash).toBe(payload.fingerprint.webgl.hash)
    expect(restored.fingerprint.audio.hash).toBe(payload.fingerprint.audio.hash)
    expect(restored.fingerprint.webgl.renderer).toBe(payload.fingerprint.webgl.renderer)
    expect(restored.fingerprint.webgl.vendor).toBe(payload.fingerprint.webgl.vendor)
    expect(restored.fingerprint.webgl.extensions).toEqual(
      payload.fingerprint.webgl.extensions,
    )
    expect(restored.fingerprint.navigator.userAgent).toBe(
      payload.fingerprint.navigator.userAgent,
    )
    expect(restored.fingerprint.navigator.hardwareConcurrency).toBe(
      payload.fingerprint.navigator.hardwareConcurrency,
    )
    expect(restored.fingerprint.navigator.cookieEnabled).toBe(
      payload.fingerprint.navigator.cookieEnabled,
    )
    expect(restored.fingerprint.navigator.languages).toEqual(
      payload.fingerprint.navigator.languages,
    )
    expect(restored.fingerprint.screen.width).toBe(payload.fingerprint.screen.width)
    expect(restored.fingerprint.screen.height).toBe(payload.fingerprint.screen.height)
    expect(restored.fingerprint.screen.devicePixelRatio).toBeCloseTo(
      payload.fingerprint.screen.devicePixelRatio,
      1,
    )
  })

  it('round-trips detection signals and integrity violations', () => {
    // Arrange
    const payload = createMockTokenPayload({
      detection: {
        isAutomated: true,
        signals: [
          { name: 'webdriver_present', detected: true },
          { name: 'user_agent_headless', detected: false },
        ],
        integrity: {
          isValid: false,
          violations: [{ name: 'fetch_native_overridden' }],
        },
      },
    })

    // Act
    const restored = deserialize(serialize(payload))

    // Assert
    expect(restored.detection.isAutomated).toBe(true)
    expect(restored.detection.signals).toHaveLength(2)
    expect(restored.detection.signals[0]?.name).toBe('webdriver_present')
    expect(restored.detection.signals[0]?.detected).toBe(true)
    expect(restored.detection.integrity.isValid).toBe(false)
    expect(restored.detection.integrity.violations).toHaveLength(1)
    expect(restored.detection.integrity.violations[0]?.name).toBe('fetch_native_overridden')
  })

  it('round-trips with empty behavior arrays', () => {
    // Arrange
    const payload = createMockTokenPayload({
      behavior: createMockBehavior({
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
      }),
    })

    // Act
    const restored = deserialize(serialize(payload))

    // Assert
    expect(restored.behavior.mouse).toHaveLength(0)
    expect(restored.behavior.keyboard).toHaveLength(0)
    expect(restored.behavior.scroll).toHaveLength(0)
    expect(restored.behavior.totalMouseEvents).toBe(0)
    expect(restored.behavior.totalKeyboardEvents).toBe(0)
    expect(restored.behavior.totalScrollEvents).toBe(0)
  })

  it('round-trips with full behavior arrays including multiple event types', () => {
    // Arrange
    const payload = createMockTokenPayload({
      behavior: createMockBehavior({
        mouse: [
          { type: 'move', x: 10, y: 20, t: 100, buttons: 0 },
          { type: 'down', x: 50, y: 60, t: 200, buttons: 1 },
          { type: 'up', x: 50, y: 60, t: 300, buttons: 0 },
          { type: 'click', x: 50, y: 60, t: 300, buttons: 0 },
        ],
        keyboard: [
          { type: 'keydown', code: 'KeyA', t: 1000 },
          { type: 'keyup', code: 'KeyA', t: 1050 },
          { type: 'keydown', code: 'Enter', t: 1100 },
        ],
        scroll: [
          { x: 0, y: 100, t: 2000 },
          { x: 0, y: 200, t: 2500 },
        ],
        totalMouseEvents: 10,
        totalKeyboardEvents: 6,
        totalScrollEvents: 4,
        snapshotAt: 9999,
      }),
    })

    // Act
    const restored = deserialize(serialize(payload))

    // Assert behavior events
    expect(restored.behavior.mouse).toHaveLength(4)
    expect(restored.behavior.mouse[0]?.type).toBe('move')
    expect(restored.behavior.mouse[1]?.type).toBe('down')
    expect(restored.behavior.keyboard).toHaveLength(3)
    expect(restored.behavior.keyboard[0]?.code).toBe('KeyA')
    expect(restored.behavior.keyboard[2]?.code).toBe('Enter')
    expect(restored.behavior.scroll).toHaveLength(2)
    expect(restored.behavior.scroll[1]?.y).toBe(200)
    expect(restored.behavior.totalMouseEvents).toBe(10)
    expect(restored.behavior.totalKeyboardEvents).toBe(6)
    expect(restored.behavior.totalScrollEvents).toBe(4)
    expect(restored.behavior.snapshotAt).toBe(9999)
  })

  it('round-trips special characters in string fields', () => {
    // Arrange
    const payload = createMockTokenPayload({
      fingerprint: createMockFingerprint({
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          language: 'zh-TW',
          languages: ['zh-TW', 'zh', 'en-US'],
          platform: 'Win32',
          hardwareConcurrency: 4,
          deviceMemory: null,
          maxTouchPoints: 10,
          cookieEnabled: false,
          doNotTrack: '1',
          vendor: '',
          pluginCount: 0,
        },
      }),
    })

    // Act
    const restored = deserialize(serialize(payload))

    // Assert
    expect(restored.fingerprint.navigator.language).toBe('zh-TW')
    expect(restored.fingerprint.navigator.languages).toEqual(['zh-TW', 'zh', 'en-US'])
    // deviceMemory 0 byte maps back to null
    expect(restored.fingerprint.navigator.deviceMemory).toBeNull()
    expect(restored.fingerprint.navigator.cookieEnabled).toBe(false)
  })

  it('round-trips with empty WebGL extensions array', () => {
    // Arrange
    const payload = createMockTokenPayload({
      fingerprint: createMockFingerprint({
        webgl: {
          hash: 'webglhash',
          renderer: '',
          vendor: '',
          version: '',
          shadingLanguageVersion: '',
          extensions: [],
        },
      }),
    })

    // Act
    const restored = deserialize(serialize(payload))

    // Assert
    expect(restored.fingerprint.webgl.extensions).toEqual([])
  })
})

// ─── deserialize version validation ───────────────────────────────────────────

describe('deserialize version validation', () => {
  it('throws when binary data starts with unsupported version byte 0x02', () => {
    // Arrange: craft a minimal byte array where the first byte (version) is 0x02
    const invalidVersionBytes = new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00])

    // Act + Assert
    expect(() => deserialize(invalidVersionBytes)).toThrow(
      'Unsupported binary format version: 2',
    )
  })

  it('throws when binary data starts with version byte 0x00', () => {
    // Arrange: version 0 is also unsupported
    const invalidVersionBytes = new Uint8Array([0x00, 0x00])

    // Act + Assert
    expect(() => deserialize(invalidVersionBytes)).toThrow(
      'Unsupported binary format version: 0',
    )
  })

  it('does not throw for a valid serialized payload (version 0x01)', () => {
    // Arrange: a properly serialized payload starts with version byte 0x01
    const payload = createMockTokenPayload()
    const bytes = serialize(payload)

    // Assert: first byte is 0x01
    expect(bytes[0]).toBe(0x01)

    // Act + Assert: no throw
    expect(() => deserialize(bytes)).not.toThrow()
  })
})
