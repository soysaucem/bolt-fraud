import { describe, it, expect } from 'vitest'
import { generateKeyPair, KeyManager } from '../src/crypto/keys.js'

// ─── generateKeyPair ──────────────────────────────────────────────────────────

describe('generateKeyPair', () => {
  it('returns an object with publicKey and privateKey strings', () => {
    // Act
    const keyPair = generateKeyPair()

    // Assert
    expect(typeof keyPair.publicKey).toBe('string')
    expect(typeof keyPair.privateKey).toBe('string')
    expect(keyPair.publicKey.length).toBeGreaterThan(0)
    expect(keyPair.privateKey.length).toBeGreaterThan(0)
  })

  it('returns a public key in PEM format (begins and ends with PEM headers)', () => {
    const { publicKey } = generateKeyPair()

    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----')
    expect(publicKey).toContain('-----END PUBLIC KEY-----')
  })

  it('returns a private key in PEM format (PKCS8)', () => {
    const { privateKey } = generateKeyPair()

    expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    expect(privateKey).toContain('-----END PRIVATE KEY-----')
  })

  it('generates unique key pairs on each call', () => {
    // Arrange + Act
    const pair1 = generateKeyPair()
    const pair2 = generateKeyPair()

    // Assert: different keys each time
    expect(pair1.publicKey).not.toBe(pair2.publicKey)
    expect(pair1.privateKey).not.toBe(pair2.privateKey)
  })

  it('public key does not contain private key headers', () => {
    const { publicKey } = generateKeyPair()
    expect(publicKey).not.toContain('PRIVATE KEY')
  })

  it('private key does not contain public key headers', () => {
    const { privateKey } = generateKeyPair()
    expect(privateKey).not.toContain('PUBLIC KEY')
  })
})

// ─── KeyManager ───────────────────────────────────────────────────────────────

describe('KeyManager', () => {
  describe('initial state', () => {
    it('throws when accessing publicKey before loading', () => {
      const manager = new KeyManager()
      expect(() => manager.publicKey).toThrow('Public key not loaded')
    })

    it('throws when accessing privateKey before loading', () => {
      const manager = new KeyManager()
      expect(() => manager.privateKey).toThrow('Private key not loaded')
    })
  })

  describe('loadFromStrings', () => {
    it('stores and retrieves the public key', () => {
      // Arrange
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPair()

      // Act
      manager.loadFromStrings(publicKey, privateKey)

      // Assert
      expect(manager.publicKey).toBe(publicKey)
    })

    it('stores and retrieves the private key', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPair()

      manager.loadFromStrings(publicKey, privateKey)

      expect(manager.privateKey).toBe(privateKey)
    })

    it('returns exact strings that were provided (no transformation)', () => {
      const manager = new KeyManager()
      const pubKey = 'mock-public-key-pem-content'
      const privKey = 'mock-private-key-pem-content'

      manager.loadFromStrings(pubKey, privKey)

      expect(manager.publicKey).toBe(pubKey)
      expect(manager.privateKey).toBe(privKey)
    })

    it('overwrites previously loaded keys when called again', () => {
      const manager = new KeyManager()
      const pair1 = generateKeyPair()
      const pair2 = generateKeyPair()

      manager.loadFromStrings(pair1.publicKey, pair1.privateKey)
      manager.loadFromStrings(pair2.publicKey, pair2.privateKey)

      expect(manager.publicKey).toBe(pair2.publicKey)
      expect(manager.privateKey).toBe(pair2.privateKey)
    })

    it('allows loading a real generated key pair and accessing both keys', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPair()

      manager.loadFromStrings(publicKey, privateKey)

      // Both are accessible and are the real PEM content
      expect(manager.publicKey).toContain('BEGIN PUBLIC KEY')
      expect(manager.privateKey).toContain('BEGIN PRIVATE KEY')
    })
  })

  describe('multiple managers are independent', () => {
    it('two managers loaded with different keys return their own keys', () => {
      const m1 = new KeyManager()
      const m2 = new KeyManager()
      const pair1 = generateKeyPair()
      const pair2 = generateKeyPair()

      m1.loadFromStrings(pair1.publicKey, pair1.privateKey)
      m2.loadFromStrings(pair2.publicKey, pair2.privateKey)

      expect(m1.publicKey).toBe(pair1.publicKey)
      expect(m2.publicKey).toBe(pair2.publicKey)
      expect(m1.publicKey).not.toBe(m2.publicKey)
    })

    it('loading keys in one manager does not affect an unloaded manager', () => {
      const m1 = new KeyManager()
      const m2 = new KeyManager()
      const { publicKey, privateKey } = generateKeyPair()

      m1.loadFromStrings(publicKey, privateKey)

      // m2 was never loaded
      expect(() => m2.publicKey).toThrow('Public key not loaded')
      expect(() => m2.privateKey).toThrow('Private key not loaded')
    })
  })
})
