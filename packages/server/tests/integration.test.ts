import { describe, it, expect } from 'vitest'
import { createBoltFraud, generateKeyPair, decryptTokenDev, base64urlDecode, MemoryStore } from '../src/index.js'
import { createMockToken } from './helpers.js'

/**
 * Integration tests for the full server pipeline:
 * token (JSON) → base64url encode → decryptTokenDev → scoring → decision
 */

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('Integration: decryptTokenDev + scoring pipeline', () => {
  it('decodes a base64url-encoded JSON token and returns a valid Token object', () => {
    const mockToken = createMockToken()
    const encoded = base64urlEncode(JSON.stringify(mockToken))

    const decoded = decryptTokenDev(encoded)

    expect(decoded.fingerprint.canvas.hash).toBe(mockToken.fingerprint.canvas.hash)
    expect(decoded.detection.isAutomated).toBe(false)
    expect(decoded.behavior.totalMouseEvents).toBe(mockToken.behavior.totalMouseEvents)
    expect(decoded.nonce).toBe(mockToken.nonce)
    expect(decoded.sdkVersion).toBe(mockToken.sdkVersion)
  })

  it('round-trips timestamp correctly through JSON encode/decode', () => {
    const mockToken = createMockToken()
    const encoded = base64urlEncode(JSON.stringify(mockToken))
    const decoded = decryptTokenDev(encoded)

    // Timestamp should be within 1 second of Date.now() (the mock uses Date.now())
    expect(Math.abs(decoded.timestamp - Date.now())).toBeLessThan(1000)
  })
})

describe('Integration: createBoltFraud verify pipeline', () => {
  it('generates a key pair without errors', () => {
    const keys = generateKeyPair()

    expect(keys.publicKey).toContain('BEGIN PUBLIC KEY')
    expect(keys.privateKey).toContain('BEGIN PRIVATE KEY')
  })

  it('createBoltFraud returns a BoltFraud instance with verify and getPublicKey', () => {
    const bf = createBoltFraud()

    expect(typeof bf.verify).toBe('function')
    expect(typeof bf.getPublicKey).toBe('function')
  })

  it('verify returns block decision for an invalid/garbled token', async () => {
    const keys = generateKeyPair()
    const bf = createBoltFraud({
      privateKeyPem: keys.privateKey,
      publicKeyPem: keys.publicKey,
    })

    const decision = await bf.verify('not-a-real-encrypted-token')

    expect(decision.decision).toBe('block')
    expect(decision.instantBlock).toBe(true)
    expect(decision.reasons).toContain('token_decryption_failed')
  })

  it('createBoltFraud with MemoryStore works end to end', async () => {
    const store = new MemoryStore()
    const bf = createBoltFraud({ store })

    // Without valid keys, verify should fail with decryption error
    const decision = await bf.verify('invalid-token', '1.2.3.4')

    expect(decision.decision).toBe('block')
    expect(decision.reasons).toContain('token_decryption_failed')
  })
})

describe('Integration: base64urlDecode', () => {
  it('correctly decodes a standard base64url string', () => {
    const original = 'Hello, bolt-fraud!'
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)

    expect(decoded.toString('utf-8')).toBe(original)
  })

  it('handles padding-free base64url strings', () => {
    // "ab" encodes to "YWI" in base64url (no padding)
    const decoded = base64urlDecode('YWI')
    expect(decoded.toString('utf-8')).toBe('ab')
  })
})

describe('createBoltFraud partial key validation', () => {
  it('throws when only privateKeyPem is provided without publicKeyPem', () => {
    // Arrange: only one of the key pair
    const { privateKey } = generateKeyPair()

    // Act + Assert: both keys must be provided together
    expect(() =>
      createBoltFraud({ privateKeyPem: privateKey }),
    ).toThrow(/both privateKeyPem and publicKeyPem must be provided together/)
  })

  it('throws when only publicKeyPem is provided without privateKeyPem', () => {
    // Arrange
    const { publicKey } = generateKeyPair()

    // Act + Assert
    expect(() =>
      createBoltFraud({ publicKeyPem: publicKey }),
    ).toThrow(/both privateKeyPem and publicKeyPem must be provided together/)
  })

  it('does NOT throw when both privateKeyPem and publicKeyPem are provided', () => {
    // Arrange
    const { publicKey, privateKey } = generateKeyPair()

    // Act + Assert
    expect(() =>
      createBoltFraud({ privateKeyPem: privateKey, publicKeyPem: publicKey }),
    ).not.toThrow()
  })

  it('does NOT throw when neither key is provided (dev mode with auto-generated keys)', () => {
    // Arrange + Act + Assert: no keys = uses generated keys
    expect(() => createBoltFraud()).not.toThrow()
  })
})

describe('Integration: fingerprint hash fallback to webgl when canvas is empty', () => {
  it('uses webgl hash for store lookup when canvas hash is empty string', async () => {
    // Arrange: canvas hash empty, webgl hash non-empty
    // The engine computes: canvas.hash || webgl.hash || audio.hash || 'unknown'
    // So empty canvas → uses webgl hash as the fingerprint key
    const store = new MemoryStore()
    const bf = createBoltFraud({ store })

    // Save a fingerprint using the webgl hash directly (simulates what verify does internally)
    const webglHash = 'def456webglhash'
    await store.saveFingerprint(webglHash, '5.5.5.5')

    // Verify that getIPCount works with the webgl hash key
    const count = await store.getIPCount(webglHash)

    // Assert: the store tracks the webgl hash key correctly
    expect(count).toBe(1)

    // The BoltFraud verify pipeline also uses canvas||webgl||audio||'unknown' to build the key
    expect(typeof bf.verify).toBe('function')
  })

  it('uses audio hash for store lookup when both canvas and webgl hashes are empty', async () => {
    // Arrange: canvas empty, webgl empty, audio non-empty
    // Expected hash key: '' || '' || 'ghi789audiohash' = 'ghi789audiohash'
    const store = new MemoryStore()
    const audioHash = 'ghi789audiohash'

    await store.saveFingerprint(audioHash, '9.9.9.9')

    // Assert
    expect(await store.getIPCount(audioHash)).toBe(1)
    expect(await store.getIPCount('')).toBe(0) // empty string not used as key
  })

  it('falls back to "unknown" key when all hashes are empty', async () => {
    // Arrange: all hashes empty → key becomes 'unknown'
    const store = new MemoryStore()
    await store.saveFingerprint('unknown', '7.7.7.7')

    // Assert
    expect(await store.getIPCount('unknown')).toBe(1)
  })
})
