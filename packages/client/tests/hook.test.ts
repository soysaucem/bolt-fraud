// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { shouldProtect } from '../src/transport/hook.js'
import type { BoltFraudConfig } from '../src/types.js'

// ─── shouldProtect ────────────────────────────────────────────────────────────

describe('shouldProtect', () => {
  const baseConfig: BoltFraudConfig = { serverUrl: 'https://example.com' }

  // ── Pattern-based matching ──────────────────────────────────────────────────

  describe('when protectedPatterns are specified', () => {
    it('returns true when URL matches a protectedPattern regex', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }

      // Act
      const result = shouldProtect('https://example.com/api/users', config)

      // Assert
      expect(result).toBe(true)
    })

    it('returns true when URL matches one of multiple protectedPatterns', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/public\//, /\/api\//],
      }

      // Act
      const result = shouldProtect('https://example.com/api/checkout', config)

      // Assert
      expect(result).toBe(true)
    })

    it('returns false when URL does not match any protectedPattern', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }

      // Act
      const result = shouldProtect('https://other.com/static/image.png', config)

      // Assert
      expect(result).toBe(false)
    })

    it('returns false when protectedPatterns is an empty array (no same-origin fallback)', () => {
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [],
      }

      expect(shouldProtect('https://other.com/path', config)).toBe(false)
      expect(shouldProtect(`${window.location.origin}/api/data`, config)).toBe(false)
    })

    it('gives the same answer on repeated calls with a global-flag regex', () => {
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//g],
      }

      for (let i = 0; i < 4; i++) {
        expect(shouldProtect('https://example.com/api/users', config)).toBe(true)
      }
    })

    it('gives the same answer on repeated calls with a sticky regex', () => {
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/^https:\/\/example\.com/y],
      }

      for (let i = 0; i < 4; i++) {
        expect(shouldProtect('https://example.com/a', config)).toBe(true)
      }
    })

    it('returns true when URL matches a pattern anchored to path prefix', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/^https:\/\/secure\.example\.com/],
      }

      // Act
      const result = shouldProtect('https://secure.example.com/checkout', config)

      // Assert
      expect(result).toBe(true)
    })
  })

  // ── No patterns ─────────────────────────────────────────────────────────────

  describe('without protectedPatterns', () => {
    it('never protects anything, including same-origin URLs', () => {
      const config: BoltFraudConfig = { ...baseConfig }

      expect(shouldProtect('/api/data', config)).toBe(false)
      expect(shouldProtect(`${window.location.origin}/api/data`, config)).toBe(false)
      expect(shouldProtect('https://evil.com/steal-data', config)).toBe(false)
    })
  })

  // ── SSR / no window ─────────────────────────────────────────────────────────

  describe('when window is undefined (SSR)', () => {
    let originalWindow: typeof globalThis.window

    beforeEach(() => {
      originalWindow = globalThis.window
    })

    afterEach(() => {
      globalThis.window = originalWindow
    })

    it('returns false when window is undefined and no patterns configured', () => {
      // Arrange: simulate SSR by deleting window
      // @ts-expect-error — intentionally removing window for SSR simulation
      delete globalThis.window
      const config: BoltFraudConfig = { ...baseConfig }

      // Act
      const result = shouldProtect('https://example.com/api/users', config)

      // Assert
      expect(result).toBe(false)
    })

    it('still returns true based on patterns even when window is undefined', () => {
      // Arrange: patterns are evaluated before the window check
      // @ts-expect-error — intentionally removing window for SSR simulation
      delete globalThis.window
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }

      // Act
      const result = shouldProtect('https://example.com/api/users', config)

      // Assert: pattern matching happens before window check
      expect(result).toBe(true)
    })
  })

  // ── Request objects ──────────────────────────────────────────────────────────

  describe('Request object handling', () => {
    it('returns true when a Request object URL matches a protectedPattern (URL extracted by caller)', () => {
      // Arrange: the fetch hook extracts the URL from Request before calling shouldProtect
      // shouldProtect receives the string URL
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }
      const request = new Request('https://example.com/api/submit', { method: 'POST' })

      // Act: extract URL from Request (as the hook does) and pass string to shouldProtect
      const result = shouldProtect(request.url, config)

      // Assert
      expect(result).toBe(true)
    })

    it('returns false when a Request object URL does not match any pattern', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }
      const request = new Request('https://cdn.example.com/image.png')

      // Act: extract URL from Request (as the hook does)
      const result = shouldProtect(request.url, config)

      // Assert
      expect(result).toBe(false)
    })

    it('returns false for a Request URL when no patterns are configured', () => {
      const config: BoltFraudConfig = { ...baseConfig }
      const request = new Request('https://evil.com/exfiltrate')

      expect(shouldProtect(request.url, config)).toBe(false)
    })
  })

  // ── URL object handling ──────────────────────────────────────────────────────

  describe('URL object handling', () => {
    it('returns true when a URL object matches a protectedPattern (URL.href passed as string)', () => {
      // Arrange: shouldProtect receives the string representation of the URL
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/secure\//],
      }
      const url = new URL('https://example.com/secure/checkout')

      // Act: pass URL.href as string (as the hook does via String(input))
      const result = shouldProtect(url.href, config)

      // Assert
      expect(result).toBe(true)
    })

    it('returns false when a URL object does not match any pattern', () => {
      // Arrange
      const config: BoltFraudConfig = {
        ...baseConfig,
        protectedPatterns: [/\/api\//],
      }
      const url = new URL('https://cdn.example.com/bundle.js')

      // Act: pass URL.href as string
      const result = shouldProtect(url.href, config)

      // Assert
      expect(result).toBe(false)
    })
  })
})
