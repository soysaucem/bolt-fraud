// @vitest-environment node
// Node 18+ exposes globalThis.crypto (Web Crypto API) natively — no polyfill needed.
// CompressionStream is unavailable in Node, so tryCompress falls back to raw bytes.

import { describe, it, expect } from 'vitest'
import { buildToken } from '../src/transport/index.js'
import { createMockTokenPayload } from './helpers.js'
import type { BoltFraudConfig } from '../src/types.js'

// ─── buildToken ───────────────────────────────────────────────────────────────

describe('buildToken', () => {
  const devConfig: BoltFraudConfig = {
    serverUrl: 'https://example.com',
    // No publicKey → dev mode: returns base64url-encoded plaintext
  }

  // ── Return shape ─────────────────────────────────────────────────────────────

  it('returns an EncryptedToken with v: 1', async () => {
    // Arrange
    const payload = createMockTokenPayload()

    // Act
    const result = await buildToken(payload, devConfig)

    // Assert
    expect(result.v).toBe(1)
  })

  it('returns an EncryptedToken with a non-empty token string', async () => {
    // Arrange
    const payload = createMockTokenPayload()

    // Act
    const result = await buildToken(payload, devConfig)

    // Assert
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
  })

  // ── Dev mode (no publicKey) ───────────────────────────────────────────────────

  describe('dev mode — no publicKey', () => {
    it('token is valid base64url (no padding, only URL-safe chars)', async () => {
      // Arrange
      const payload = createMockTokenPayload()

      // Act
      const result = await buildToken(payload, devConfig)

      // Assert: base64url alphabet only
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('token does not contain "+" characters', async () => {
      // Arrange
      const payload = createMockTokenPayload()

      // Act
      const result = await buildToken(payload, devConfig)

      // Assert
      expect(result.token).not.toContain('+')
    })

    it('token does not contain "/" characters', async () => {
      // Arrange
      const payload = createMockTokenPayload()

      // Act
      const result = await buildToken(payload, devConfig)

      // Assert
      expect(result.token).not.toContain('/')
    })

    it('token does not contain "=" padding characters', async () => {
      // Arrange
      const payload = createMockTokenPayload()

      // Act
      const result = await buildToken(payload, devConfig)

      // Assert
      expect(result.token).not.toContain('=')
    })

    it('produces different tokens for different payloads', async () => {
      // Arrange
      const payload1 = createMockTokenPayload({ timestamp: 1700000000000 })
      const payload2 = createMockTokenPayload({ timestamp: 1700000001000 })

      // Act
      const [result1, result2] = await Promise.all([
        buildToken(payload1, devConfig),
        buildToken(payload2, devConfig),
      ])

      // Assert
      expect(result1.token).not.toBe(result2.token)
    })

    it('consistently encodes the same payload to the same token (deterministic serialization)', async () => {
      // Arrange
      const payload = createMockTokenPayload()

      // Act
      const [result1, result2] = await Promise.all([
        buildToken(payload, devConfig),
        buildToken(payload, devConfig),
      ])

      // Assert: no randomness in dev mode (no crypto IV)
      expect(result1.token).toBe(result2.token)
    })
  })
})
