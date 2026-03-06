// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { arrayBufferToHex } from '../src/fingerprint/utils.js'

// ─── arrayBufferToHex ─────────────────────────────────────────────────────────

describe('arrayBufferToHex', () => {
  it('returns an empty string for an empty ArrayBuffer', () => {
    const buffer = new ArrayBuffer(0)
    expect(arrayBufferToHex(buffer)).toBe('')
  })

  it('converts known bytes to known hex — [0xde, 0xad] → "dead"', () => {
    const buffer = new Uint8Array([0xde, 0xad]).buffer
    expect(arrayBufferToHex(buffer)).toBe('dead')
  })

  it('converts [0xbe, 0xef] → "beef"', () => {
    const buffer = new Uint8Array([0xbe, 0xef]).buffer
    expect(arrayBufferToHex(buffer)).toBe('beef')
  })

  it('pads single-digit hex values with a leading zero', () => {
    // byte 0x0f → "0f", not "f"
    const buffer = new Uint8Array([0x0f]).buffer
    expect(arrayBufferToHex(buffer)).toBe('0f')
  })

  it('converts [0x00] → "00"', () => {
    const buffer = new Uint8Array([0x00]).buffer
    expect(arrayBufferToHex(buffer)).toBe('00')
  })

  it('converts [0xff] → "ff"', () => {
    const buffer = new Uint8Array([0xff]).buffer
    expect(arrayBufferToHex(buffer)).toBe('ff')
  })

  it('converts a 4-byte buffer correctly — [0x01, 0x02, 0x03, 0x04] → "01020304"', () => {
    const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer
    expect(arrayBufferToHex(buffer)).toBe('01020304')
  })

  it('produces a 64-character hex string for a 32-byte SHA-256 output', () => {
    // SHA-256 outputs 32 bytes → 64 hex chars
    const buffer = new Uint8Array(32).fill(0xab).buffer
    const hex = arrayBufferToHex(buffer)
    expect(hex).toHaveLength(64)
    expect(hex).toBe('ab'.repeat(32))
  })

  it('returns a lowercase hex string', () => {
    const buffer = new Uint8Array([0xab, 0xcd, 0xef]).buffer
    const hex = arrayBufferToHex(buffer)
    expect(hex).toBe(hex.toLowerCase())
  })

  it('handles all 256 byte values', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    const hex = arrayBufferToHex(bytes.buffer)
    // Should be 512 characters
    expect(hex).toHaveLength(512)
    // First two chars should be '00', last two 'ff'
    expect(hex.slice(0, 2)).toBe('00')
    expect(hex.slice(-2)).toBe('ff')
  })
})

// ─── SHA-256 output shape via crypto.subtle (Node.js 18+ has webcrypto globally) ──

describe('SHA-256 output shape via arrayBufferToHex', () => {
  it('produces a 64-character hex string from SHA-256 digest', async () => {
    // Arrange: encode a known string
    const encoded = new TextEncoder().encode('hello')

    // Act: SHA-256 via Node.js webcrypto
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    const hex = arrayBufferToHex(hashBuffer)

    // Assert: SHA-256 is always 256 bits = 32 bytes = 64 hex chars
    expect(hex).toHaveLength(64)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('SHA-256 of "hello" produces the known hash', async () => {
    const encoded = new TextEncoder().encode('hello')
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    const hex = arrayBufferToHex(hashBuffer)
    // Known SHA-256 of "hello"
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})
