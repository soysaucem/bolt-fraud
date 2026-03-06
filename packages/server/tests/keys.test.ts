import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, KeyManager } from '../src/crypto/keys.js'

// ─── generateKeyPairSync ───────────────────────────────────────────────────────

describe('generateKeyPairSync', () => {
  it('returns an object with publicKey and privateKey strings', () => {
    // Act
    const keyPair = generateKeyPairSync()

    // Assert
    expect(typeof keyPair.publicKey).toBe('string')
    expect(typeof keyPair.privateKey).toBe('string')
    expect(keyPair.publicKey.length).toBeGreaterThan(0)
    expect(keyPair.privateKey.length).toBeGreaterThan(0)
  })

  it('returns a public key in PEM format (begins and ends with PEM headers)', () => {
    const { publicKey } = generateKeyPairSync()

    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----')
    expect(publicKey).toContain('-----END PUBLIC KEY-----')
  })

  it('returns a private key in PEM format (PKCS8)', () => {
    const { privateKey } = generateKeyPairSync()

    expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    expect(privateKey).toContain('-----END PRIVATE KEY-----')
  })

  it('generates unique key pairs on each call', () => {
    // Arrange + Act
    const pair1 = generateKeyPairSync()
    const pair2 = generateKeyPairSync()

    // Assert: different keys each time
    expect(pair1.publicKey).not.toBe(pair2.publicKey)
    expect(pair1.privateKey).not.toBe(pair2.privateKey)
  })

  it('public key does not contain private key headers', () => {
    const { publicKey } = generateKeyPairSync()
    expect(publicKey).not.toContain('PRIVATE KEY')
  })

  it('private key does not contain public key headers', () => {
    const { privateKey } = generateKeyPairSync()
    expect(privateKey).not.toContain('PUBLIC KEY')
  })
})

// ─── KeyManager ───────────────────────────────────────────────────────────────

describe('KeyManager', () => {
  describe('initial state', () => {
    it('throws when accessing publicKey before loading', () => {
      const manager = new KeyManager()
      expect(() => manager.publicKey).toThrow('Key ID 0 not loaded')
    })

    it('throws when accessing privateKey before loading', () => {
      const manager = new KeyManager()
      expect(() => manager.privateKey).toThrow('Key ID 0 not loaded')
    })

    it('throws when accessing privateKeyObject before loading', () => {
      const manager = new KeyManager()
      expect(() => manager.privateKeyObject).toThrow('Key ID 0 not loaded')
    })
  })

  describe('loadFromStrings', () => {
    it('stores and retrieves the public key', () => {
      // Arrange
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      // Act
      manager.loadFromStrings(publicKey, privateKey)

      // Assert
      expect(manager.publicKey).toBe(publicKey)
    })

    it('stores and retrieves the private key', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      manager.loadFromStrings(publicKey, privateKey)

      expect(manager.privateKey).toBe(privateKey)
    })

    it('returns exact PEM strings that were provided (no transformation)', () => {
      // loadFromStrings now calls createPrivateKey() internally, so we must use real PEM keys
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      manager.loadFromStrings(publicKey, privateKey)

      expect(manager.publicKey).toBe(publicKey)
      expect(manager.privateKey).toBe(privateKey)
    })

    it('overwrites previously loaded keys when called again', () => {
      const manager = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()

      manager.loadFromStrings(pair1.publicKey, pair1.privateKey)
      manager.loadFromStrings(pair2.publicKey, pair2.privateKey)

      expect(manager.publicKey).toBe(pair2.publicKey)
      expect(manager.privateKey).toBe(pair2.privateKey)
    })

    it('allows loading a real generated key pair and accessing both keys', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      manager.loadFromStrings(publicKey, privateKey)

      // Both are accessible and are the real PEM content
      expect(manager.publicKey).toContain('BEGIN PUBLIC KEY')
      expect(manager.privateKey).toContain('BEGIN PRIVATE KEY')
    })

    it('privateKeyObject is a KeyObject after loading real keys', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      manager.loadFromStrings(publicKey, privateKey)

      // Should be a KeyObject (has asymmetricKeyType for RSA)
      expect(manager.privateKeyObject).toBeDefined()
      expect(manager.privateKeyObject.asymmetricKeyType).toBe('rsa')
    })
  })

  describe('multiple managers are independent', () => {
    it('two managers loaded with different keys return their own keys', () => {
      const m1 = new KeyManager()
      const m2 = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()

      m1.loadFromStrings(pair1.publicKey, pair1.privateKey)
      m2.loadFromStrings(pair2.publicKey, pair2.privateKey)

      expect(m1.publicKey).toBe(pair1.publicKey)
      expect(m2.publicKey).toBe(pair2.publicKey)
      expect(m1.publicKey).not.toBe(m2.publicKey)
    })

    it('loading keys in one manager does not affect an unloaded manager', () => {
      const m1 = new KeyManager()
      const m2 = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      m1.loadFromStrings(publicKey, privateKey)

      // m2 was never loaded
      expect(() => m2.publicKey).toThrow('Key ID 0 not loaded')
      expect(() => m2.privateKey).toThrow('Key ID 0 not loaded')
    })
  })

  // ─── addKeyPair ───────────────────────────────────────────────────────────

  describe('addKeyPair', () => {
    it('stores a key pair under the given keyId and retrieves the public key by that ID', () => {
      // Arrange
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      // Act
      manager.addKeyPair(42, publicKey, privateKey)

      // Assert
      expect(manager.getPublicKey(42)).toBe(publicKey)
    })

    it('stores a key pair under the given keyId and retrieves the private KeyObject by that ID', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()

      manager.addKeyPair(42, publicKey, privateKey)

      const keyObj = manager.getPrivateKeyObject(42)
      expect(keyObj).toBeDefined()
      expect(keyObj.asymmetricKeyType).toBe('rsa')
    })

    it('stores multiple key pairs under distinct IDs independently', () => {
      // Arrange
      const manager = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()

      // Act
      manager.addKeyPair(1, pair1.publicKey, pair1.privateKey)
      manager.addKeyPair(2, pair2.publicKey, pair2.privateKey)

      // Assert: each ID returns its own key, not the other
      expect(manager.getPublicKey(1)).toBe(pair1.publicKey)
      expect(manager.getPublicKey(2)).toBe(pair2.publicKey)
      expect(manager.getPublicKey(1)).not.toBe(manager.getPublicKey(2))
    })

    it('overwrites the entry for an existing keyId when called again with the same ID', () => {
      const manager = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()

      manager.addKeyPair(5, pair1.publicKey, pair1.privateKey)
      manager.addKeyPair(5, pair2.publicKey, pair2.privateKey)

      // pair2 should win since it was added last
      expect(manager.getPublicKey(5)).toBe(pair2.publicKey)
    })
  })

  // ─── setDefaultKeyId ────────────────────────────────────────────────────────

  describe('setDefaultKeyId', () => {
    it('changes the key returned by the default getter (no keyId argument) to the specified key', () => {
      // Arrange: load two keys under IDs 0 and 7
      const manager = new KeyManager()
      const pair0 = generateKeyPairSync()
      const pair7 = generateKeyPairSync()
      manager.addKeyPair(0, pair0.publicKey, pair0.privateKey)
      manager.addKeyPair(7, pair7.publicKey, pair7.privateKey)

      // Act: switch default to 7
      manager.setDefaultKeyId(7)

      // Assert: default accessors now return the key for ID 7
      expect(manager.publicKey).toBe(pair7.publicKey)
      expect(manager.privateKey).toBe(pair7.privateKey)
      expect(manager.privateKeyObject.asymmetricKeyType).toBe('rsa')
    })

    it('does not affect retrieval by explicit keyId after the default changes', () => {
      const manager = new KeyManager()
      const pair0 = generateKeyPairSync()
      const pair7 = generateKeyPairSync()
      manager.addKeyPair(0, pair0.publicKey, pair0.privateKey)
      manager.addKeyPair(7, pair7.publicKey, pair7.privateKey)

      manager.setDefaultKeyId(7)

      // Explicitly requesting ID 0 still returns the original key
      expect(manager.getPublicKey(0)).toBe(pair0.publicKey)
      expect(manager.getPrivateKeyObject(0).asymmetricKeyType).toBe('rsa')
    })

    it('throws when the specified keyId has not been loaded', () => {
      const manager = new KeyManager()
      // No keys loaded at all

      expect(() => manager.setDefaultKeyId(99)).toThrow('Key ID 99 not loaded')
    })

    it('throws when switching to an ID that was never added even when other IDs exist', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()
      manager.addKeyPair(1, publicKey, privateKey)

      expect(() => manager.setDefaultKeyId(2)).toThrow('Key ID 2 not loaded')
    })
  })

  // ─── getPrivateKeyObject(keyId) ───────────────────────────────────────────

  describe('getPrivateKeyObject', () => {
    it('returns the correct KeyObject for the given keyId', () => {
      // Arrange
      const manager = new KeyManager()
      const pair = generateKeyPairSync()
      manager.addKeyPair(3, pair.publicKey, pair.privateKey)

      // Act
      const keyObj = manager.getPrivateKeyObject(3)

      // Assert: it is an RSA KeyObject
      expect(keyObj).toBeDefined()
      expect(keyObj.asymmetricKeyType).toBe('rsa')
    })

    it('throws for an unknown keyId', () => {
      const manager = new KeyManager()

      expect(() => manager.getPrivateKeyObject(999)).toThrow('Key ID 999 not loaded')
    })

    it('returns the default key when called without an argument', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()
      manager.addKeyPair(0, publicKey, privateKey)

      const keyObj = manager.getPrivateKeyObject()

      expect(keyObj).toBeDefined()
      expect(keyObj.asymmetricKeyType).toBe('rsa')
    })

    it('returns distinct KeyObjects for distinct keyIds', () => {
      const manager = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()
      manager.addKeyPair(10, pair1.publicKey, pair1.privateKey)
      manager.addKeyPair(11, pair2.publicKey, pair2.privateKey)

      const obj10 = manager.getPrivateKeyObject(10)
      const obj11 = manager.getPrivateKeyObject(11)

      // Both are valid RSA KeyObjects but are not the same reference
      expect(obj10.asymmetricKeyType).toBe('rsa')
      expect(obj11.asymmetricKeyType).toBe('rsa')
      expect(obj10).not.toBe(obj11)
    })
  })

  // ─── getPublicKey(keyId) ─────────────────────────────────────────────────

  describe('getPublicKey', () => {
    it('returns the correct PEM string for the given keyId', () => {
      // Arrange
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()
      manager.addKeyPair(20, publicKey, privateKey)

      // Act
      const retrieved = manager.getPublicKey(20)

      // Assert
      expect(retrieved).toBe(publicKey)
      expect(retrieved).toContain('-----BEGIN PUBLIC KEY-----')
    })

    it('throws for an unknown keyId', () => {
      const manager = new KeyManager()

      expect(() => manager.getPublicKey(888)).toThrow('Key ID 888 not loaded')
    })

    it('returns the default public key when called without an argument', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()
      manager.addKeyPair(0, publicKey, privateKey)

      expect(manager.getPublicKey()).toBe(publicKey)
    })
  })

  // ─── Multiple keys — default vs specific ID ───────────────────────────────

  describe('multiple keys loaded — default vs specific ID retrieval', () => {
    it('default accessors return ID 0 key when no setDefaultKeyId has been called', () => {
      // Arrange: load keys for ID 0 and ID 1
      const manager = new KeyManager()
      const pair0 = generateKeyPairSync()
      const pair1 = generateKeyPairSync()
      manager.addKeyPair(0, pair0.publicKey, pair0.privateKey)
      manager.addKeyPair(1, pair1.publicKey, pair1.privateKey)

      // Assert: default (no arg) returns the ID-0 key
      expect(manager.publicKey).toBe(pair0.publicKey)
      expect(manager.privateKey).toBe(pair0.privateKey)
    })

    it('explicit ID retrieval is independent of the current default', () => {
      const manager = new KeyManager()
      const pair0 = generateKeyPairSync()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()
      manager.addKeyPair(0, pair0.publicKey, pair0.privateKey)
      manager.addKeyPair(1, pair1.publicKey, pair1.privateKey)
      manager.addKeyPair(2, pair2.publicKey, pair2.privateKey)

      manager.setDefaultKeyId(2)

      // Default returns pair2
      expect(manager.publicKey).toBe(pair2.publicKey)
      // But explicit IDs still return the right keys
      expect(manager.getPublicKey(0)).toBe(pair0.publicKey)
      expect(manager.getPublicKey(1)).toBe(pair1.publicKey)
      expect(manager.getPublicKey(2)).toBe(pair2.publicKey)
    })

    it('decryptToken resolver pattern: getPrivateKeyObject(keyId) routes to the correct key per token', () => {
      // Simulates how verify() passes (keyId) => keyManager.getPrivateKeyObject(keyId)
      const manager = new KeyManager()
      const pair1 = generateKeyPairSync()
      const pair2 = generateKeyPairSync()
      manager.addKeyPair(1, pair1.publicKey, pair1.privateKey)
      manager.addKeyPair(2, pair2.publicKey, pair2.privateKey)

      const resolver = (keyId: number) => manager.getPrivateKeyObject(keyId)

      // resolver(1) returns the RSA KeyObject for pair1
      expect(resolver(1).asymmetricKeyType).toBe('rsa')
      // resolver(2) returns a different RSA KeyObject for pair2
      expect(resolver(2).asymmetricKeyType).toBe('rsa')
      expect(resolver(1)).not.toBe(resolver(2))
    })

    it('resolver throws for an ID that was never loaded', () => {
      const manager = new KeyManager()
      const { publicKey, privateKey } = generateKeyPairSync()
      manager.addKeyPair(1, publicKey, privateKey)

      const resolver = (keyId: number) => manager.getPrivateKeyObject(keyId)

      expect(() => resolver(99)).toThrow('Key ID 99 not loaded')
    })
  })
})

// ─── generateKeyPairSync with custom modulusLength ───────────────────────────

describe('generateKeyPairSync with custom modulusLength', () => {
  it('produces valid PEM headers for a 4096-bit key pair', () => {
    // Arrange + Act: 4096-bit generation is slow but produces valid PEM
    const { publicKey, privateKey } = generateKeyPairSync(4096)

    // Assert: PEM headers are present and correct
    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----')
    expect(publicKey).toContain('-----END PUBLIC KEY-----')
    expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    expect(privateKey).toContain('-----END PRIVATE KEY-----')
  }, 30_000) // 4096-bit generation can take several seconds

  it('4096-bit key pair is loadable into KeyManager and returns a valid KeyObject', () => {
    const { publicKey, privateKey } = generateKeyPairSync(4096)

    const manager = new KeyManager()
    manager.addKeyPair(0, publicKey, privateKey)

    const keyObj = manager.getPrivateKeyObject(0)
    expect(keyObj.asymmetricKeyType).toBe('rsa')
  }, 30_000)

  it('4096-bit key pair keys are longer than 2048-bit keys (more base64 content)', () => {
    const pair2048 = generateKeyPairSync(2048)
    const pair4096 = generateKeyPairSync(4096)

    // A 4096-bit public key PEM is larger than a 2048-bit one
    expect(pair4096.publicKey.length).toBeGreaterThan(pair2048.publicKey.length)
    expect(pair4096.privateKey.length).toBeGreaterThan(pair2048.privateKey.length)
  }, 30_000)
})
