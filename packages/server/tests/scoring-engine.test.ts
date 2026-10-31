import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RiskEngine } from '../src/scoring/engine.js'
import { createMockToken, createMockFingerprint, createMockDetection, createMockBehavior } from './helpers.js'
import type { FingerprintStore } from '../src/model/types.js'
import { MemoryStore } from '../src/store/memory.js'

// Default acceptance window (maxTokenAbsoluteAgeMs): 1 hour
const WINDOW = 3_600_000

// ─── RiskEngine ───────────────────────────────────────────────────────────────

describe('RiskEngine', () => {
  describe('normal token (no signals, good fingerprint, has behavior)', () => {
    it('returns "allow" decision with a low score', async () => {
      // Arrange: a clean token with valid fingerprint, no automation, and behavior events
      const engine = new RiskEngine()
      const token = createMockToken()

      // Act
      const decision = await engine.score(token)

      // Assert
      expect(decision.decision).toBe('allow')
      expect(decision.score).toBeLessThan(30) // below challenge threshold
      expect(decision.instantBlock).toBe(false)
      expect(Array.isArray(decision.reasons)).toBe(true)
    })

    it('score is 0 for a perfectly clean token', async () => {
      const engine = new RiskEngine()
      const token = createMockToken()

      const decision = await engine.score(token)

      expect(decision.score).toBe(0)
      expect(decision.reasons).toHaveLength(0)
    })
  })

  describe('token with webdriver_present signal', () => {
    it('returns instant block with decision "block"', async () => {
      // Arrange
      const engine = new RiskEngine()
      const token = createMockToken({
        detection: createMockDetection({
          isAutomated: true,
          signals: [{ name: 'webdriver_present', detected: true }],
          integrity: { isValid: true, violations: [] },
        }),
      })

      // Act
      const decision = await engine.score(token)

      // Assert
      expect(decision.decision).toBe('block')
      expect(decision.instantBlock).toBe(true)
      expect(decision.score).toBe(100)
      expect(decision.reasons).toContain('instant_block:webdriver_present')
    })
  })

  describe('token with puppeteer_runtime signal', () => {
    it('returns instant block', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({
        detection: createMockDetection({
          isAutomated: true,
          signals: [{ name: 'puppeteer_runtime', detected: true }],
          integrity: { isValid: true, violations: [] },
        }),
      })

      const decision = await engine.score(token)

      expect(decision.instantBlock).toBe(true)
      expect(decision.decision).toBe('block')
      expect(decision.reasons).toContain('instant_block:puppeteer_runtime')
    })
  })

  describe('token with playwright_runtime signal', () => {
    it('returns instant block', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({
        detection: createMockDetection({
          isAutomated: true,
          signals: [{ name: 'playwright_runtime', detected: true }],
          integrity: { isValid: true, violations: [] },
        }),
      })

      const decision = await engine.score(token)

      expect(decision.instantBlock).toBe(true)
      expect(decision.decision).toBe('block')
    })
  })

  describe('token with empty fingerprint hashes', () => {
    it('adds 50 and reaches "challenge"', async () => {
      // Arrange: empty canvas and webgl → +25 +25 = 50 (audio is no longer scored)
      const engine = new RiskEngine()
      const token = createMockToken({
        fingerprint: createMockFingerprint({
          canvas: { hash: '' },
          webgl: {
            hash: '',
            renderer: '',
            vendor: '',
            version: '',
            shadingLanguageVersion: '',
            extensions: [],
          },
          audio: { hash: '' },
        }),
      })

      // Act
      const decision = await engine.score(token)

      expect(decision.score).toBe(50)
      expect(decision.decision).toBe('challenge')
      expect(decision.reasons).toContain('canvas_fingerprint_empty_or_zero')
      expect(decision.reasons).toContain('webgl_fingerprint_empty')
      expect(decision.reasons).not.toContain('audio_fingerprint_zero_or_empty')
    })
  })

  describe('token with no behavior events', () => {
    it('adds 15 to score for missing interaction', async () => {
      // Arrange: good fingerprint, no automation, but zero interaction events
      const engine = new RiskEngine()
      const token = createMockToken({
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
      const decision = await engine.score(token)

      // Assert: 15 points for no interaction
      expect(decision.score).toBe(15)
      expect(decision.reasons).toContain('no_interaction_events')
    })
  })

  describe('token with both bad fingerprint and no behavior', () => {
    it('score reaches 70 → "block"', async () => {
      // Arrange: empty fingerprint (+50) + hardwareConcurrency 0 (+5) + no behavior (+15) = 70
      const engine = new RiskEngine()
      const token = createMockToken({
        fingerprint: createMockFingerprint({
          canvas: { hash: '' },
          webgl: {
            hash: '',
            renderer: '',
            vendor: '',
            version: '',
            shadingLanguageVersion: '',
            extensions: [],
          },
          audio: { hash: '' },
          navigator: {
            userAgent: 'Mozilla/5.0',
            language: 'en-US',
            languages: ['en-US'],
            platform: '',
            hardwareConcurrency: 0,
            deviceMemory: null,
            maxTouchPoints: 0,
            cookieEnabled: false,
            doNotTrack: null,
            vendor: '',
            pluginCount: 0,
          },
        }),
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
      const decision = await engine.score(token)

      // Assert: 25 + 25 + 5 + 15 = 70 → block (threshold is inclusive)
      expect(decision.score).toBe(70)
      expect(decision.decision).toBe('block')
      expect(decision.instantBlock).toBe(false)
    })
  })

  describe('custom thresholds', () => {
    it('uses custom blockThreshold and challengeThreshold', async () => {
      // Arrange: lower thresholds so a no-behavior token triggers block
      const engine = new RiskEngine({ blockThreshold: 10, challengeThreshold: 5 })
      const token = createMockToken({
        behavior: createMockBehavior({
          mouse: [],
          keyboard: [],
          scroll: [],
          totalMouseEvents: 0,
          totalKeyboardEvents: 0,
          totalScrollEvents: 0,
        }),
      })

      // Act: score will be 15 (no behavior), which exceeds blockThreshold=10
      const decision = await engine.score(token)

      expect(decision.decision).toBe('block')
    })

    it('classifies as "challenge" when score is at challengeThreshold', async () => {
      // Arrange: challengeThreshold=5, blockThreshold=50
      const engine = new RiskEngine({ blockThreshold: 50, challengeThreshold: 5 })
      const token = createMockToken({
        behavior: createMockBehavior({
          mouse: [],
          keyboard: [],
          scroll: [],
          totalMouseEvents: 0,
          totalKeyboardEvents: 0,
          totalScrollEvents: 0,
        }),
      })

      // score = 15 (no behavior) → between 5 and 50 → 'challenge'
      const decision = await engine.score(token)

      expect(decision.decision).toBe('challenge')
    })

    it('classifies as "allow" when score is below challengeThreshold', async () => {
      // Arrange: very high thresholds
      const engine = new RiskEngine({ blockThreshold: 200, challengeThreshold: 100 })
      const token = createMockToken()

      const decision = await engine.score(token)

      expect(decision.decision).toBe('allow')
    })
  })

  describe('with store and IP scoring', () => {
    it('does not crash when store is provided but IP count is low', async () => {
      // Arrange
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(5),
      }
      const engine = new RiskEngine({ store: mockStore })
      const token = createMockToken()

      // Act
      const decision = await engine.score(token, '1.2.3.4')

      // Assert: IP count 5 < 100, no extra score
      expect(decision).toBeDefined()
      expect(decision.decision).toBe('allow')
    })

    it('adds IP score when fingerprint has been seen from more than 100 IPs', async () => {
      // Arrange
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(101),
      }
      const engine = new RiskEngine({ store: mockStore })
      const token = createMockToken()

      // Act
      const decision = await engine.score(token, '1.2.3.4')

      // Assert: +5 for high IP count — reason is now the fixed string fingerprint_ip_abuse
      expect(decision.score).toBe(5)
      expect(decision.reasons).toContain('fingerprint_ip_abuse')
    })

    it('uses custom ipCountThreshold when provided', async () => {
      // Arrange: lower threshold of 10 so IP count of 15 triggers the score
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(15),
      }
      const engine = new RiskEngine({ store: mockStore, ipCountThreshold: 10 })
      const token = createMockToken()

      // Act
      const decision = await engine.score(token, '1.2.3.4')

      // Assert: IP count 15 > threshold 10 → +5 added
      expect(decision.score).toBe(5)
      expect(decision.reasons).toContain('fingerprint_ip_abuse')
    })

    it('does not add IP score when IP count is at (not above) the default threshold', async () => {
      // Arrange: exactly at threshold (100) — check is > not >=
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(100),
      }
      const engine = new RiskEngine({ store: mockStore })
      const token = createMockToken()

      const decision = await engine.score(token, '1.2.3.4')

      expect(decision.score).toBe(0)
      expect(decision.reasons).not.toContain('fingerprint_ip_abuse')
    })

    it('does not add IP score when clientIP is not provided', async () => {
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(999),
      }
      const engine = new RiskEngine({ store: mockStore })
      const token = createMockToken()

      // No clientIP → store is not consulted
      const decision = await engine.score(token)

      expect(decision.score).toBe(0)
      expect(mockStore.getIPCount).not.toHaveBeenCalled()
    })
  })

  describe('token age scoring', () => {
    it('adds token_too_old reason and +10 score when token timestamp is more than 30 seconds old', async () => {
      // Arrange: set timestamp to 31 seconds in the past
      const engine = new RiskEngine()
      const oldTimestamp = Date.now() - 31_000
      const token = createMockToken({ timestamp: oldTimestamp })

      // Act
      const decision = await engine.score(token)

      // Assert: +10 for age
      expect(decision.score).toBe(10)
      expect(decision.reasons).toContain('token_too_old')
    })

    it('does NOT add token_too_old when token is exactly 30 seconds old (boundary: must be > 30s)', async () => {
      // Arrange: exactly 30 seconds old — the check is `now - timestamp > 30_000` (strictly greater)
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() - 30_000 })

      // Act
      const decision = await engine.score(token)

      // Assert: 30000ms is NOT > 30000, so no age penalty
      expect(decision.reasons).not.toContain('token_too_old')
    })

    it('adds token_too_old when token is 60 seconds old', async () => {
      // Arrange: stale token beyond soft max (30s) but within absolute max (300s)
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() - 60_000 })

      // Act
      const decision = await engine.score(token)

      // Assert
      expect(decision.reasons).toContain('token_too_old')
      expect(decision.score).toBeGreaterThanOrEqual(10)
    })

    it('does NOT block a token 20 s in the future (inside the acceptance window)', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() + 20_000 })

      const decision = await engine.score(token)

      expect(decision.decision).not.toBe('block')
      expect(decision.reasons).not.toContain('token_timestamp_future')
      expect(decision.score).toBe(0)
    })

    it('instant blocks token_timestamp_future beyond the acceptance window', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() + WINDOW + 10_000 })

      const decision = await engine.score(token)

      expect(decision.decision).toBe('block')
      expect(decision.instantBlock).toBe(true)
      expect(decision.score).toBe(100)
      expect(decision.reasons).toContain('token_timestamp_future')
    })

    it('scores +10 token_clock_skew (instead of token_too_old) for a token 10 minutes old', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() - 600_000 })

      const decision = await engine.score(token)

      expect(decision.decision).toBe('allow')
      expect(decision.score).toBe(10)
      expect(decision.reasons).toEqual(['token_clock_skew'])
    })

    it('scores +10 token_clock_skew for a token 10 minutes in the future', async () => {
      const engine = new RiskEngine()
      const token = createMockToken({ timestamp: Date.now() + 600_000 })

      const decision = await engine.score(token)

      expect(decision.reasons).toEqual(['token_clock_skew'])
      expect(decision.score).toBe(10)
    })
  })

  describe('hard token expiry (acceptance window)', () => {
    it('defaults the acceptance window to 1 hour', async () => {
      const engine = new RiskEngine()
      const inside = await engine.score(createMockToken({ nonce: 'in', timestamp: Date.now() - (WINDOW - 5_000) }))
      const outside = await engine.score(createMockToken({ nonce: 'out', timestamp: Date.now() - (WINDOW + 5_000) }))

      expect(inside.instantBlock).toBe(false)
      expect(outside.reasons).toContain('token_expired')
    })

    it('instant blocks token_expired for an older-than-window token whose nonce is NOT in the store', async () => {
      const engine = new RiskEngine({ store: new MemoryStore() })
      const token = createMockToken({ timestamp: Date.now() - (WINDOW + 10_000), nonce: 'never-seen' })

      const decision = await engine.score(token, '1.2.3.4')

      expect(decision.decision).toBe('block')
      expect(decision.instantBlock).toBe(true)
      expect(decision.score).toBe(100)
      expect(decision.reasons).toContain('token_expired')
    })

    it('honours a custom maxTokenAbsoluteAgeMs for both window and nonce TTL', async () => {
      const claimNonce = vi.fn().mockResolvedValue(true)
      const store: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(0),
        claimNonce,
      }
      const engine = new RiskEngine({ store, maxTokenAbsoluteAgeMs: 120_000 })

      const decision = await engine.score(createMockToken({ timestamp: Date.now() - 130_000 }))

      expect(decision.reasons).toContain('token_expired')
      expect(claimNonce).toHaveBeenCalledWith(expect.any(String), 2 * 120_000 + 5_000)
    })
  })

  describe('nonce replay protection', () => {
    it('claims the nonce with TTL = 2 x acceptance window + 5000 ms', async () => {
      const claimNonce = vi.fn().mockResolvedValue(true)
      const store: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(0),
        claimNonce,
      }
      const engine = new RiskEngine({ store })

      await engine.score(createMockToken({ nonce: 'ttl-check' }), '1.2.3.4')

      expect(claimNonce).toHaveBeenCalledTimes(1)
      expect(claimNonce).toHaveBeenCalledWith('ttl-check', 2 * WINDOW + 5_000)
    })

    it('blocks a replay at t=120 s and at t=30 min of a token that was 10 min old (inside window)', async () => {
      vi.useFakeTimers()
      try {
        const engine = new RiskEngine({ store: new MemoryStore() })
        const token = createMockToken({ nonce: 'skewed', timestamp: Date.now() - 600_000 })

        const first = await engine.score(token, '1.2.3.4')
        expect(first.decision).not.toBe('block')
        expect(first.reasons).toContain('token_clock_skew')

        vi.advanceTimersByTime(120_000)
        const at120s = await engine.score(token, '1.2.3.4')
        expect(at120s.decision).toBe('block')
        expect(at120s.reasons).toContain('token_nonce_replayed')

        vi.advanceTimersByTime(28 * 60_000)
        const at30min = await engine.score(token, '1.2.3.4')
        expect(at30min.decision).toBe('block')
        expect(at30min.reasons.some((r) => r === 'token_nonce_replayed' || r === 'token_expired')).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps blocking the replay of a FUTURE-dated token until it stops being accepted', async () => {
      vi.useFakeTimers()
      try {
        const engine = new RiskEngine({ store: new MemoryStore() })
        // Stamped 59 min ahead: accepted now, and still accepted (age within +-window) for ~2 h.
        const token = createMockToken({ nonce: 'future', timestamp: Date.now() + WINDOW - 60_000 })

        const first = await engine.score(token, '1.2.3.4')
        expect(first.decision).not.toBe('block')
        expect(first.reasons).toContain('token_clock_skew')

        // Past the old nonce lifetime (window + 5 s): the token's age is now ~ +66 s, still accepted.
        vi.advanceTimersByTime(WINDOW + 6_000)
        const replay = await engine.score(token, '1.2.3.4')
        expect(replay.decision).toBe('block')
        expect(replay.reasons).toContain('token_nonce_replayed')

        // And right up to the end of its acceptance window.
        vi.advanceTimersByTime(WINDOW - 70_000)
        const lateReplay = await engine.score(token, '1.2.3.4')
        expect(lateReplay.decision).toBe('block')
      } finally {
        vi.useRealTimers()
      }
    })

    it('a nonce never expires before its token stops being accepted', async () => {
      vi.useFakeTimers()
      try {
        const engine = new RiskEngine({ store: new MemoryStore() })
        const token = createMockToken({ nonce: 'edge', timestamp: Date.now() })

        await engine.score(token, '1.2.3.4')
        vi.advanceTimersByTime(WINDOW - 1_000) // token still inside the window
        const replay = await engine.score(token, '1.2.3.4')
        expect(replay.reasons).toContain('token_nonce_replayed')

        vi.advanceTimersByTime(10_000) // now past the window: expired block, not an accept
        const late = await engine.score(token, '1.2.3.4')
        expect(late.decision).toBe('block')
      } finally {
        vi.useRealTimers()
      }
    })

    it('two concurrent scores with the same nonce yield exactly one non-replay', async () => {
      const engine = new RiskEngine({ store: new MemoryStore() })
      const token = createMockToken({ nonce: 'race' })

      const results = await Promise.all([engine.score(token, '1.2.3.4'), engine.score(token, '1.2.3.4')])

      const replays = results.filter((r) => r.reasons.includes('token_nonce_replayed'))
      expect(replays).toHaveLength(1)
    })

    it('calls saveFingerprint exactly once per accepted token and never for instant blocks', async () => {
      const saveFingerprint = vi.fn().mockResolvedValue(undefined)
      const store: FingerprintStore = {
        saveFingerprint,
        getIPCount: vi.fn().mockResolvedValue(0),
        claimNonce: vi.fn().mockResolvedValue(true),
      }
      const engine = new RiskEngine({ store })

      await engine.score(createMockToken(), '1.2.3.4')
      expect(saveFingerprint).toHaveBeenCalledTimes(1)

      await engine.score(
        createMockToken({
          detection: createMockDetection({ isAutomated: true, signals: [{ name: 'webdriver_present', detected: true }] }),
        }),
        '1.2.3.4',
      )
      expect(saveFingerprint).toHaveBeenCalledTimes(1)
    })

    it('instant blocks on the second call with the same nonce (replay detected)', async () => {
      // Arrange: store with nonce tracking
      const store = new MemoryStore()
      const engine = new RiskEngine({ store })
      const nonce = 'unique-nonce-abc123'
      const token = createMockToken({ nonce })

      // Act: first call succeeds
      const firstDecision = await engine.score(token, '1.2.3.4')
      expect(firstDecision.decision).not.toBe('block') // or at least not nonce-blocked

      // Act: second call with identical nonce → instant block
      const secondDecision = await engine.score(token, '1.2.3.4')

      // Assert: nonce replay triggers instant block
      expect(secondDecision.decision).toBe('block')
      expect(secondDecision.instantBlock).toBe(true)
      expect(secondDecision.reasons).toContain('token_nonce_replayed')
    })

    it('does not instant block when different nonces are used', async () => {
      // Arrange
      const store = new MemoryStore()
      const engine = new RiskEngine({ store })

      const token1 = createMockToken({ nonce: 'nonce-aaa' })
      const token2 = createMockToken({ nonce: 'nonce-bbb' })

      // Act
      await engine.score(token1, '1.2.3.4')
      const decision2 = await engine.score(token2, '1.2.3.4')

      // Assert: different nonces are allowed
      expect(decision2.reasons).not.toContain('token_nonce_replayed')
    })

    it('does not perform nonce replay check when store has no claimNonce method', async () => {
      // Arrange: plain store without nonce tracking
      const mockStore: FingerprintStore = {
        saveFingerprint: vi.fn().mockResolvedValue(undefined),
        getIPCount: vi.fn().mockResolvedValue(0),
        // claimNonce is NOT provided
      }
      const engine = new RiskEngine({ store: mockStore })
      const token = createMockToken({ nonce: 'my-nonce' })

      // Act: calling twice should not crash even without nonce support
      await engine.score(token, '1.2.3.4')
      const decision = await engine.score(token, '1.2.3.4')

      // Assert: no nonce-related instant block (store doesn't support it)
      expect(decision.reasons).not.toContain('token_nonce_replayed')
    })
  })

  describe('instant block takes priority over all other scoring', () => {
    it('returns block immediately without computing fingerprint or behavior scores', async () => {
      // Arrange: both instant-block signal AND bad fingerprint — should still be instant block
      const engine = new RiskEngine()
      const token = createMockToken({
        detection: createMockDetection({
          isAutomated: true,
          signals: [{ name: 'webdriver_present', detected: true }],
          integrity: { isValid: true, violations: [] },
        }),
        fingerprint: createMockFingerprint({
          canvas: { hash: '' },
          audio: { hash: '' },
        }),
        behavior: createMockBehavior({
          totalMouseEvents: 0,
          totalKeyboardEvents: 0,
          mouse: [],
          keyboard: [],
          scroll: [],
        }),
      })

      const decision = await engine.score(token)

      // Should be instant block regardless
      expect(decision.instantBlock).toBe(true)
      expect(decision.score).toBe(100)
      expect(decision.decision).toBe('block')
    })
  })
})
