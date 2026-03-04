// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { base64urlEncode, base64urlDecode } from '../src/transport/crypto.js'

// ─── base64url encoding ───────────────────────────────────────────────────────

describe('base64urlEncode', () => {
  it('encodes an empty array to an empty string', () => {
    // Arrange
    const input = new Uint8Array(0)

    // Act
    const encoded = base64urlEncode(input)

    // Assert
    expect(encoded).toBe('')
  })

  it('encodes known bytes [0, 1, 2, 3] to a known base64url string', () => {
    // Arrange
    const input = new Uint8Array([0, 1, 2, 3])

    // Act
    const encoded = base64urlEncode(input)

    // Assert: standard base64 of [0,1,2,3] is 'AAECAw==' → url-safe no-padding: 'AAECAw'
    expect(encoded).toBe('AAECAw')
  })

  it('produces no "+" characters', () => {
    // Use bytes that produce '+' in standard base64: byte 0xfb = 0b11111011
    // Base64 of [0xfb] is '+w==' standard, '-w' url-safe
    const input = new Uint8Array([0xfb])
    const encoded = base64urlEncode(input)
    expect(encoded).not.toContain('+')
  })

  it('produces no "/" characters', () => {
    // Standard base64 of [0xff] is '/w==' → '_w' url-safe
    const input = new Uint8Array([0xff])
    const encoded = base64urlEncode(input)
    expect(encoded).not.toContain('/')
  })

  it('produces no "=" padding characters', () => {
    // Any encoding with padding-requiring byte count
    const input = new Uint8Array([1, 2])
    const encoded = base64urlEncode(input)
    expect(encoded).not.toContain('=')
  })

  it('encodes a 32-byte array to a 43-character string (SHA-256 hash size)', () => {
    // SHA-256 produces 32 bytes → ceil(32 * 4/3) = 43 base64url chars (no padding)
    const input = new Uint8Array(32).fill(0x42)
    const encoded = base64urlEncode(input)
    expect(encoded).toHaveLength(43)
  })

  it('only contains URL-safe characters [A-Za-z0-9_-]', () => {
    const input = new Uint8Array(256)
    for (let i = 0; i < 256; i++) input[i] = i
    const encoded = base64urlEncode(input)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/)
  })
})

// ─── base64urlDecode ──────────────────────────────────────────────────────────

describe('base64urlDecode', () => {
  it('decodes an empty string to an empty Uint8Array', () => {
    const decoded = base64urlDecode('')
    expect(decoded).toHaveLength(0)
    expect(decoded).toBeInstanceOf(Uint8Array)
  })

  it('decodes "AAECAw" back to [0, 1, 2, 3]', () => {
    const decoded = base64urlDecode('AAECAw')
    expect(Array.from(decoded)).toEqual([0, 1, 2, 3])
  })

  it('decodes url-safe "-w" (was "+w==") back to [0xfb]', () => {
    const decoded = base64urlDecode('-w')
    expect(Array.from(decoded)).toEqual([0xfb])
  })

  it('decodes url-safe "_w" (was "/w==") back to [0xff]', () => {
    const decoded = base64urlDecode('_w')
    expect(Array.from(decoded)).toEqual([0xff])
  })
})

// ─── round-trip ───────────────────────────────────────────────────────────────

describe('base64urlEncode + base64urlDecode round-trip', () => {
  it('round-trips an empty array', () => {
    const original = new Uint8Array(0)
    expect(Array.from(base64urlDecode(base64urlEncode(original)))).toEqual(
      Array.from(original),
    )
  })

  it('round-trips [0, 1, 2, 3]', () => {
    const original = new Uint8Array([0, 1, 2, 3])
    expect(Array.from(base64urlDecode(base64urlEncode(original)))).toEqual(
      Array.from(original),
    )
  })

  it('round-trips a large 256-byte array (all byte values)', () => {
    const original = new Uint8Array(256)
    for (let i = 0; i < 256; i++) original[i] = i
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  it('round-trips a 1-byte array (edge: requires padding in standard base64)', () => {
    const original = new Uint8Array([0xab])
    expect(Array.from(base64urlDecode(base64urlEncode(original)))).toEqual(
      Array.from(original),
    )
  })

  it('round-trips a 2-byte array (edge: requires one padding char in standard base64)', () => {
    const original = new Uint8Array([0xab, 0xcd])
    expect(Array.from(base64urlDecode(base64urlEncode(original)))).toEqual(
      Array.from(original),
    )
  })

  it('round-trips a 3-byte array (no padding in standard base64)', () => {
    const original = new Uint8Array([0xab, 0xcd, 0xef])
    expect(Array.from(base64urlDecode(base64urlEncode(original)))).toEqual(
      Array.from(original),
    )
  })
})
