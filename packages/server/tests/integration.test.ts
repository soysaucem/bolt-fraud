import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createBoltFraud, generateKeyPairSync, decryptTokenDev, base64urlDecode, MemoryStore, computeFingerprintHash } from '../src/index.js'
import { createMockToken, createMockFingerprint } from './helpers.js'

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
    const keys = generateKeyPairSync()

    expect(keys.publicKey).toContain('BEGIN PUBLIC KEY')
    expect(keys.privateKey).toContain('BEGIN PRIVATE KEY')
  })

  it('createBoltFraud returns a BoltFraud instance with verify and getPublicKey', () => {
    const bf = createBoltFraud()

    expect(typeof bf.verify).toBe('function')
    expect(typeof bf.getPublicKey).toBe('function')
  })

  it('verify returns block decision for an invalid/garbled token', async () => {
    const keys = generateKeyPairSync()
    const bf = createBoltFraud({
      privateKeyPem: keys.privateKey,
      publicKeyPem: keys.publicKey,
    })

    const decision = await bf.verify('not-a-real-encrypted-token')

    expect(decision.decision).toBe('block')
    expect(decision.instantBlock).toBe(true)
    expect(decision.reasons[0]).toMatch(/^token_decryption_failed:/)
  })

  it('createBoltFraud with MemoryStore works end to end', async () => {
    const store = new MemoryStore()
    const bf = createBoltFraud({ store })

    // Without valid keys, verify should fail with decryption error
    const decision = await bf.verify('invalid-token', '1.2.3.4')

    expect(decision.decision).toBe('block')
    expect(decision.reasons[0]).toMatch(/^token_decryption_failed:/)
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
    const { privateKey } = generateKeyPairSync()

    // Act + Assert: both keys must be provided together
    expect(() =>
      createBoltFraud({ privateKeyPem: privateKey }),
    ).toThrow(/both privateKeyPem and publicKeyPem must be provided together/)
  })

  it('throws when only publicKeyPem is provided without privateKeyPem', () => {
    // Arrange
    const { publicKey } = generateKeyPairSync()

    // Act + Assert
    expect(() =>
      createBoltFraud({ publicKeyPem: publicKey }),
    ).toThrow(/both privateKeyPem and publicKeyPem must be provided together/)
  })

  it('does NOT throw when both privateKeyPem and publicKeyPem are provided', () => {
    // Arrange
    const { publicKey, privateKey } = generateKeyPairSync()

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

describe('computeFingerprintHash', () => {
  it('is the first 32 hex chars of sha256(canvas|renderer|WxH)', () => {
    const token = createMockToken()
    const expected = createHash('sha256')
      .update(`${token.fingerprint.canvas.hash}|${token.fingerprint.webgl.renderer}|1920x1080`)
      .digest('hex')
      .slice(0, 32)

    expect(computeFingerprintHash(token)).toBe(expected)
    expect(computeFingerprintHash(token)).toMatch(/^[0-9a-f]{32}$/)
  })

  it("returns 'unknown' when canvas hash and renderer are both empty", () => {
    const base = createMockToken()
    const token = createMockToken({
      fingerprint: createMockFingerprint({ canvas: { hash: '' }, webgl: { ...base.fingerprint.webgl, renderer: '' } }),
    })
    expect(computeFingerprintHash(token)).toBe('unknown')
  })

  it('differs when only the screen size differs', () => {
    const a = createMockToken()
    const b = createMockToken({
      fingerprint: createMockFingerprint({ screen: { ...a.fingerprint.screen, width: 2560, height: 1440 } }),
    })
    expect(computeFingerprintHash(a)).not.toBe(computeFingerprintHash(b))
  })
})

describe('createBoltFraud options', () => {
  const emptyBehaviorToken = (): string => {
    const t = createMockToken({
      behavior: {
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
        snapshotAt: 5000,
      },
    })
    return base64urlEncode(JSON.stringify(t))
  }

  it('behaviorScoring: false scores a zero-event token 0 and allows', async () => {
    const bf = createBoltFraud({ devMode: true, behaviorScoring: false })
    const decision = await bf.verify(emptyBehaviorToken(), '1.1.1.1')
    expect(decision.score).toBe(0)
    expect(decision.decision).toBe('allow')
  })

  it('behaviorScoring defaults to true (no_interaction_events is scored)', async () => {
    const bf = createBoltFraud({ devMode: true })
    const decision = await bf.verify(emptyBehaviorToken(), '1.1.1.1')
    expect(decision.reasons).toContain('no_interaction_events')
  })

  it('devMode throws at creation when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(() => createBoltFraud({ devMode: true })).toThrow(/devMode/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('devMode accepts unencrypted tokens', async () => {
    const bf = createBoltFraud({ devMode: true })
    const decision = await bf.verify(base64urlEncode(JSON.stringify(createMockToken())), '1.1.1.1')
    expect(decision.reasons.join(',')).not.toMatch(/token_decryption_failed/)
  })

  it('invokes onError when decryption fails', async () => {
    const onError = vi.fn()
    const bf = createBoltFraud({ onError })
    await bf.verify('garbage')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('passes ipCountThreshold, thresholds and token age through to the engine', async () => {
    const bf = createBoltFraud({ devMode: true, challengeThreshold: 1, blockThreshold: 1000, maxTokenAgeMs: 1 })
    const old = createMockToken({ timestamp: Date.now() - 60_000 })
    const decision = await bf.verify(base64urlEncode(JSON.stringify(old)), '1.1.1.1')
    expect(decision.reasons).toContain('token_too_old')
    expect(decision.decision).toBe('challenge')
  })

  it('defaultKeyId selects the key returned by getPublicKey', () => {
    const k0 = generateKeyPairSync()
    const k5 = generateKeyPairSync()
    const bf = createBoltFraud({
      privateKeyPem: k0.privateKey,
      publicKeyPem: k0.publicKey,
      additionalKeys: [{ keyId: 5, publicKeyPem: k5.publicKey, privateKeyPem: k5.privateKey }],
      defaultKeyId: 5,
    })
    expect(bf.getPublicKey()).toBe(k5.publicKey)
  })
})
