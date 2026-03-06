// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt, base64urlEncode, base64urlDecode } from '../src/transport/crypto.js'

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

// ─── Key rotation wire format ─────────────────────────────────────────────────
//
// Wire format: [u8 keyId][u16 wrappedKeyLen BE][wrappedKey][12-byte IV][ciphertext]
// Offset 0 is the keyId byte. Tests verify the keyId is embedded and extracted
// correctly for the full encrypt/decrypt cycle.
//
// Node 18+ exposes globalThis.crypto (Web Crypto API) natively — SubtleCrypto
// is available without any polyfill. RSA key generation is expensive (~200ms),
// so it runs once in beforeAll and is shared across the describe block.

/** Export a CryptoKey to PEM string. */
async function exportPublicKeyPem(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)))
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`
}

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)))
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`
}

describe('encrypt / decrypt — key rotation wire format', () => {
  let publicKeyPem: string
  let privateKeyPem: string

  beforeAll(async () => {
    // Generate a real RSA-OAEP key pair once for the entire suite.
    // 2048-bit is the minimum required by the SubtleCrypto wrapKey algorithm.
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['wrapKey', 'unwrapKey'],
    )
    publicKeyPem = await exportPublicKeyPem(keyPair.publicKey)
    privateKeyPem = await exportPrivateKeyPem(keyPair.privateKey)
  }, 30_000) // RSA key generation can be slow under load

  const plaintext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03])

  // ── keyId in encrypted bundle ─────────────────────────────────────────────

  it('first byte of bundle is 0 when encrypt() is called with default keyId', async () => {
    // Arrange
    // (keyId defaults to 0 — third argument omitted)

    // Act
    const token = await encrypt(plaintext, publicKeyPem)
    const bundleBytes = base64urlDecode(token)

    // Assert: offset 0 is the keyId byte
    expect(bundleBytes[0]).toBe(0)
  })

  it('first byte of bundle is 5 when encrypt() is called with explicit keyId 5', async () => {
    // Arrange
    const keyId = 5

    // Act
    const token = await encrypt(plaintext, publicKeyPem, keyId)
    const bundleBytes = base64urlDecode(token)

    // Assert
    expect(bundleBytes[0]).toBe(5)
  })

  it('first byte of bundle is 255 when encrypt() is called with keyId 255 (max u8)', async () => {
    // Arrange: 255 is the largest valid single-byte value
    const keyId = 255

    // Act
    const token = await encrypt(plaintext, publicKeyPem, keyId)
    const bundleBytes = base64urlDecode(token)

    // Assert
    expect(bundleBytes[0]).toBe(255)
  })

  // ── decrypt() extracts keyId ──────────────────────────────────────────────

  it('decrypt() returns keyId 3 when the bundle was encrypted with keyId 3', async () => {
    // Arrange
    const token = await encrypt(plaintext, publicKeyPem, 3)

    // Act
    const result = await decrypt(token, privateKeyPem)

    // Assert
    expect(result.keyId).toBe(3)
  })

  // ── Full round-trip with non-zero keyId ────────────────────────────────────

  it('round-trip with keyId 7 — plaintext is preserved and keyId matches', async () => {
    // Arrange
    const keyId = 7

    // Act
    const token = await encrypt(plaintext, publicKeyPem, keyId)
    const result = await decrypt(token, privateKeyPem)

    // Assert: data integrity
    expect(Array.from(result.plaintext)).toEqual(Array.from(plaintext))
    // Assert: key ID fidelity
    expect(result.keyId).toBe(keyId)
  })

  it('round-trip with keyId 0 (default) — plaintext is preserved', async () => {
    // Arrange + Act
    const token = await encrypt(plaintext, publicKeyPem)
    const result = await decrypt(token, privateKeyPem)

    // Assert
    expect(Array.from(result.plaintext)).toEqual(Array.from(plaintext))
    expect(result.keyId).toBe(0)
  })

  it('round-trip with keyId 1 — two independent encryptions of the same data return different ciphertexts (random IV)', async () => {
    // Arrange: AES-GCM uses a random 12-byte IV per encrypt call, so ciphertext differs
    const token1 = await encrypt(plaintext, publicKeyPem, 1)
    const token2 = await encrypt(plaintext, publicKeyPem, 1)

    // Act: both should decrypt to the same plaintext
    const [r1, r2] = await Promise.all([
      decrypt(token1, privateKeyPem),
      decrypt(token2, privateKeyPem),
    ])

    // Assert: same keyId extracted from both
    expect(r1.keyId).toBe(1)
    expect(r2.keyId).toBe(1)
    // Assert: same plaintext recovered from both despite different ciphertexts
    expect(Array.from(r1.plaintext)).toEqual(Array.from(plaintext))
    expect(Array.from(r2.plaintext)).toEqual(Array.from(plaintext))
    // Assert: ciphertexts differ (non-deterministic due to random IV)
    expect(token1).not.toBe(token2)
  })

  // ── keyId out-of-range — u8 truncation behavior ────────────────────────────
  //
  // `bundle[0] = keyId` writes to a Uint8Array slot. JavaScript Typed Arrays
  // apply a ToUint8 conversion (i.e. value & 0xFF) before storing, so values
  // outside [0, 255] are silently truncated — no error is thrown.
  //
  // 256  → 256 & 0xFF = 0
  // 257  → 257 & 0xFF = 1
  // -1   → (-1 & 0xFF) as unsigned = 255

  it('keyId 256 is truncated to 0 (u8 overflow wraps around)', async () => {
    // Arrange
    const token = await encrypt(plaintext, publicKeyPem, 256)
    const bundleBytes = base64urlDecode(token)

    // Assert: 256 % 256 = 0
    expect(bundleBytes[0]).toBe(0)
  })

  it('keyId 257 is truncated to 1 (u8 overflow wraps around)', async () => {
    // Arrange
    const token = await encrypt(plaintext, publicKeyPem, 257)
    const bundleBytes = base64urlDecode(token)

    // Assert: 257 % 256 = 1
    expect(bundleBytes[0]).toBe(1)
  })

  it('keyId -1 is truncated to 255 (negative wraps to max u8)', async () => {
    // Arrange
    const token = await encrypt(plaintext, publicKeyPem, -1)
    const bundleBytes = base64urlDecode(token)

    // Assert: -1 in u8 two's complement = 255
    expect(bundleBytes[0]).toBe(255)
  })
})
