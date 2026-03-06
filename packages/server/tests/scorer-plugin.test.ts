import { describe, it, expect, vi } from 'vitest'
import {
  RiskEngine,
  AutomationScorer,
  FingerprintScorer,
  BehaviorScorer,
  TokenAgeScorer,
  IPReputationScorer,
} from '../src/scoring/engine.js'
import type { Scorer, ScorerResult, ScoringContext } from '../src/scoring/engine.js'
import type { Token } from '../src/model/types.js'
import { createMockToken } from './helpers.js'

// ─── Built-in Scorer Classes ───────────────────────────────────────────────────

describe('Built-in scorer classes', () => {
  it('AutomationScorer has name "automation" and can be instantiated', () => {
    // Arrange + Act
    const scorer = new AutomationScorer()

    // Assert
    expect(scorer.name).toBe('automation')
    expect(typeof scorer.score).toBe('function')
  })

  it('FingerprintScorer has name "fingerprint" and can be instantiated', () => {
    const scorer = new FingerprintScorer()

    expect(scorer.name).toBe('fingerprint')
    expect(typeof scorer.score).toBe('function')
  })

  it('BehaviorScorer has name "behavior" and can be instantiated', () => {
    const scorer = new BehaviorScorer()

    expect(scorer.name).toBe('behavior')
    expect(typeof scorer.score).toBe('function')
  })

  it('TokenAgeScorer has name "token_age" and can be instantiated', () => {
    const scorer = new TokenAgeScorer(30_000, 300_000)

    expect(scorer.name).toBe('token_age')
    expect(typeof scorer.score).toBe('function')
  })

  it('IPReputationScorer has name "ip_reputation" and can be instantiated', () => {
    const scorer = new IPReputationScorer(100)

    expect(scorer.name).toBe('ip_reputation')
    expect(typeof scorer.score).toBe('function')
  })

  it('each built-in scorer returns a ScorerResult with required fields', async () => {
    // Arrange
    const token = createMockToken()
    const context: ScoringContext = {}

    const scorers: Scorer[] = [
      new AutomationScorer(),
      new FingerprintScorer(),
      new BehaviorScorer(),
      new TokenAgeScorer(30_000, 300_000),
    ]

    for (const scorer of scorers) {
      // Act
      const result = await scorer.score(token, context)

      // Assert: result must conform to ScorerResult shape
      expect(typeof result.score).toBe('number')
      expect(Array.isArray(result.reasons)).toBe(true)
      // instantBlock is optional but if present must be boolean
      if (result.instantBlock !== undefined) {
        expect(typeof result.instantBlock).toBe('boolean')
      }
    }
  })
})

// ─── Custom Scorer via RiskEngineConfig.scorers ────────────────────────────────

describe('Custom scorer registration', () => {
  it('calls the custom scorer score() method when engine.score() is invoked', async () => {
    // Arrange
    const customScore = vi.fn<(token: Token, context: ScoringContext) => ScorerResult>()
      .mockReturnValue({ score: 0, reasons: [] })

    const customScorer: Scorer = { name: 'custom_test', score: customScore }
    const engine = new RiskEngine({ scorers: [customScorer] })
    const token = createMockToken()

    // Act
    await engine.score(token)

    // Assert: our scorer was called exactly once with the token
    expect(customScore).toHaveBeenCalledOnce()
    expect(customScore).toHaveBeenCalledWith(token, expect.any(Object))
  })

  it('uses the score returned by the custom scorer in the final decision', async () => {
    // Arrange: custom scorer adds 40 points — puts us in "challenge" territory (30–69)
    const customScorer: Scorer = {
      name: 'medium_risk',
      score: () => ({ score: 40, reasons: ['custom_medium_risk'] }),
    }
    const engine = new RiskEngine({ scorers: [customScorer] })
    const token = createMockToken()

    // Act
    const decision = await engine.score(token)

    // Assert
    expect(decision.score).toBe(40)
    expect(decision.decision).toBe('challenge')
    expect(decision.reasons).toContain('custom_medium_risk')
    expect(decision.instantBlock).toBe(false)
  })

  it('replaces ALL built-in scorers when a custom scorers array is provided', async () => {
    // Arrange: a token that would normally trigger "no_interaction_events" from BehaviorScorer
    // but our custom scorer array does not include BehaviorScorer
    const emptyScorer: Scorer = {
      name: 'passthrough',
      score: () => ({ score: 0, reasons: [] }),
    }
    const engine = new RiskEngine({ scorers: [emptyScorer] })
    const token = createMockToken({
      behavior: { mouse: [], keyboard: [], scroll: [], totalMouseEvents: 0, totalKeyboardEvents: 0, totalScrollEvents: 0, snapshotAt: 0 },
    })

    // Act
    const decision = await engine.score(token)

    // Assert: BehaviorScorer is NOT in the pipeline — no_interaction_events must be absent
    expect(decision.reasons).not.toContain('no_interaction_events')
    expect(decision.score).toBe(0)
  })
})

// ─── Scorer Ordering ──────────────────────────────────────────────────────────

describe('Scorer execution order', () => {
  it('runs scorers in the order they are provided', async () => {
    // Arrange: track call order via a shared log
    const callOrder: string[] = []

    const scorerA: Scorer = {
      name: 'alpha',
      score: () => { callOrder.push('alpha'); return { score: 0, reasons: [] } },
    }
    const scorerB: Scorer = {
      name: 'beta',
      score: () => { callOrder.push('beta'); return { score: 0, reasons: [] } },
    }
    const scorerC: Scorer = {
      name: 'gamma',
      score: () => { callOrder.push('gamma'); return { score: 0, reasons: [] } },
    }

    const engine = new RiskEngine({ scorers: [scorerA, scorerB, scorerC] })

    // Act
    await engine.score(createMockToken())

    // Assert: order is preserved
    expect(callOrder).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('stops executing remaining scorers after the first instant-block result', async () => {
    // Arrange: first scorer instant-blocks; subsequent scorer must NOT be called
    const blockingScorer: Scorer = {
      name: 'instant_blocker',
      score: () => ({ score: 100, reasons: ['instant_block:custom'], instantBlock: true }),
    }
    const laterScorer = { name: 'should_not_run', score: vi.fn(() => ({ score: 10, reasons: [] })) }

    const engine = new RiskEngine({ scorers: [blockingScorer, laterScorer] })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: instant block propagated, later scorer never invoked
    expect(decision.instantBlock).toBe(true)
    expect(decision.decision).toBe('block')
    expect(decision.score).toBe(100)
    expect(laterScorer.score).not.toHaveBeenCalled()
  })

  it('accumulates scores and reasons from all scorers when none instant-blocks', async () => {
    // Arrange: three scorers each contributing distinct scores and reasons
    const scorers: Scorer[] = [
      { name: 'a', score: () => ({ score: 10, reasons: ['reason_a'] }) },
      { name: 'b', score: () => ({ score: 15, reasons: ['reason_b'] }) },
      { name: 'c', score: () => ({ score: 5, reasons: ['reason_c'] }) },
    ]
    const engine = new RiskEngine({ scorers, challengeThreshold: 100 }) // high threshold so we get "allow"

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: scores summed, all reasons present
    expect(decision.score).toBe(30)
    expect(decision.reasons).toContain('reason_a')
    expect(decision.reasons).toContain('reason_b')
    expect(decision.reasons).toContain('reason_c')
  })
})

// ─── Custom Scorer Returning Instant Block ────────────────────────────────────

describe('Custom scorer returning instantBlock: true', () => {
  it('engine returns decision "block" with score 100 and instantBlock true', async () => {
    // Arrange
    const blockingCustomScorer: Scorer = {
      name: 'custom_blocker',
      score: () => ({
        score: 100,
        reasons: ['custom_fraud_signal'],
        instantBlock: true,
      }),
    }
    const engine = new RiskEngine({ scorers: [blockingCustomScorer] })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert
    expect(decision.decision).toBe('block')
    expect(decision.score).toBe(100)
    expect(decision.instantBlock).toBe(true)
    expect(decision.reasons).toContain('custom_fraud_signal')
  })

  it('engine propagates custom instant-block reasons unchanged', async () => {
    // Arrange: reason naming is the custom scorer's responsibility
    const reasons = ['vpn_detected', 'datacenter_ip'] as const
    const customScorer: Scorer = {
      name: 'ip_check',
      score: () => ({ score: 100, reasons: [...reasons], instantBlock: true }),
    }
    const engine = new RiskEngine({ scorers: [customScorer] })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: reasons forwarded verbatim
    expect(decision.reasons).toEqual(expect.arrayContaining(['vpn_detected', 'datacenter_ip']))
  })
})

// ─── Empty Scorers Array ───────────────────────────────────────────────────────

describe('Empty scorers array', () => {
  it('returns score 0 and decision "allow" when no scorers are configured', async () => {
    // Arrange
    const engine = new RiskEngine({ scorers: [] })
    const token = createMockToken()

    // Act
    const decision = await engine.score(token)

    // Assert: no scorers means no risk signals → allow
    expect(decision.score).toBe(0)
    expect(decision.decision).toBe('allow')
    expect(decision.instantBlock).toBe(false)
    expect(decision.reasons).toHaveLength(0)
  })

  it('returns empty reasons array when no scorers are configured', async () => {
    // Arrange: even with a "suspicious" token, zero scorers means zero reasons
    const engine = new RiskEngine({ scorers: [] })
    const token = createMockToken({
      behavior: { mouse: [], keyboard: [], scroll: [], totalMouseEvents: 0, totalKeyboardEvents: 0, totalScrollEvents: 0, snapshotAt: 0 },
    })

    // Act
    const decision = await engine.score(token)

    // Assert
    expect(decision.reasons).toHaveLength(0)
  })
})

// ─── Mixed Built-in and Custom Scorers ────────────────────────────────────────

describe('Mixed built-in and custom scorers', () => {
  it('calls both built-in and custom scorers and sums their scores', async () => {
    // Arrange: BehaviorScorer (built-in) + custom scorer that adds 20 points
    const customScorer: Scorer = {
      name: 'extra_risk',
      score: () => ({ score: 20, reasons: ['extra_signal'] }),
    }
    const engine = new RiskEngine({
      scorers: [new BehaviorScorer(), customScorer],
      // token has no behavior → BehaviorScorer adds 15
      challengeThreshold: 200, // ensure "allow" so we can inspect score directly
    })
    const token = createMockToken({
      behavior: { mouse: [], keyboard: [], scroll: [], totalMouseEvents: 0, totalKeyboardEvents: 0, totalScrollEvents: 0, snapshotAt: 0 },
    })

    // Act
    const decision = await engine.score(token)

    // Assert: 15 (behavior) + 20 (custom) = 35
    expect(decision.score).toBe(35)
    expect(decision.reasons).toContain('no_interaction_events')
    expect(decision.reasons).toContain('extra_signal')
  })

  it('built-in FingerprintScorer instant-blocks before custom scorer runs', async () => {
    // Arrange: AutomationScorer first (which will instant-block on webdriver)
    //          then a custom scorer that must NOT run
    const customScorer = { name: 'post_automation', score: vi.fn(() => ({ score: 5, reasons: [] })) }
    const engine = new RiskEngine({ scorers: [new AutomationScorer(), customScorer] })
    const token = createMockToken({
      detection: {
        isAutomated: true,
        signals: [{ name: 'webdriver_present', detected: true }],
        integrity: { isValid: true, violations: [] },
      },
    })

    // Act
    const decision = await engine.score(token)

    // Assert: instant block from AutomationScorer, custom never invoked
    expect(decision.instantBlock).toBe(true)
    expect(decision.decision).toBe('block')
    expect(customScorer.score).not.toHaveBeenCalled()
  })
})

// ─── Async Custom Scorer ───────────────────────────────────────────────────────

describe('Async custom scorer', () => {
  it('engine awaits a scorer that returns a Promise<ScorerResult>', async () => {
    // Arrange: scorer simulates an async lookup (e.g. external database)
    const asyncScorer: Scorer = {
      name: 'async_lookup',
      score: (): Promise<ScorerResult> =>
        Promise.resolve({ score: 25, reasons: ['async_risk_signal'] }),
    }
    const engine = new RiskEngine({ scorers: [asyncScorer], challengeThreshold: 200 })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: async result was awaited and used
    expect(decision.score).toBe(25)
    expect(decision.reasons).toContain('async_risk_signal')
  })

  it('engine awaits an async scorer that returns an instant block', async () => {
    // Arrange: async scorer performs an IP lookup and decides to block
    const asyncBlocker: Scorer = {
      name: 'async_ip_block',
      score: (): Promise<ScorerResult> =>
        Promise.resolve({
          score: 100,
          reasons: ['known_bad_ip'],
          instantBlock: true,
        }),
    }
    const afterScorer = { name: 'after_async', score: vi.fn(() => ({ score: 5, reasons: [] })) }
    const engine = new RiskEngine({ scorers: [asyncBlocker, afterScorer] })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: async instant block propagated, scorer after it never called
    expect(decision.instantBlock).toBe(true)
    expect(decision.decision).toBe('block')
    expect(decision.score).toBe(100)
    expect(decision.reasons).toContain('known_bad_ip')
    expect(afterScorer.score).not.toHaveBeenCalled()
  })

  it('engine awaits multiple async scorers and accumulates results', async () => {
    // Arrange: two async scorers running in sequence (engine iterates with await)
    const asyncA: Scorer = {
      name: 'async_a',
      score: (): Promise<ScorerResult> =>
        Promise.resolve({ score: 10, reasons: ['async_a_signal'] }),
    }
    const asyncB: Scorer = {
      name: 'async_b',
      score: (): Promise<ScorerResult> =>
        Promise.resolve({ score: 8, reasons: ['async_b_signal'] }),
    }
    const engine = new RiskEngine({ scorers: [asyncA, asyncB], challengeThreshold: 200 })

    // Act
    const decision = await engine.score(createMockToken())

    // Assert: both async results accumulated
    expect(decision.score).toBe(18)
    expect(decision.reasons).toContain('async_a_signal')
    expect(decision.reasons).toContain('async_b_signal')
  })
})
