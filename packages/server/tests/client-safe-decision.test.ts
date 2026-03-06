import { describe, it, expect } from 'vitest'
import { toClientSafeDecision } from '../src/model/types.js'
import type { Decision, ClientSafeDecision } from '../src/model/types.js'

// ─── toClientSafeDecision ────────────────────────────────────────────────────

describe('toClientSafeDecision', () => {
  // ─── Happy paths ───────────────────────────────────────────────────────────

  it('returns an object with the decision field set to "allow"', () => {
    // Arrange
    const fullDecision: Decision = {
      decision: 'allow',
      score: 5,
      instantBlock: false,
      reasons: [],
    }

    // Act
    const safe = toClientSafeDecision(fullDecision)

    // Assert
    expect(safe.decision).toBe('allow')
  })

  it('returns an object with the decision field set to "challenge"', () => {
    const fullDecision: Decision = {
      decision: 'challenge',
      score: 45,
      instantBlock: false,
      reasons: ['no_interaction_events'],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect(safe.decision).toBe('challenge')
  })

  it('returns an object with the decision field set to "block"', () => {
    const fullDecision: Decision = {
      decision: 'block',
      score: 90,
      instantBlock: true,
      reasons: ['instant_block:webdriver_present'],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect(safe.decision).toBe('block')
  })

  // ─── No internal field leakage ────────────────────────────────────────────

  it('does not expose the score field', () => {
    const fullDecision: Decision = {
      decision: 'allow',
      score: 77,
      instantBlock: false,
      reasons: [],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect((safe as Record<string, unknown>)['score']).toBeUndefined()
  })

  it('does not expose the reasons field', () => {
    const fullDecision: Decision = {
      decision: 'block',
      score: 100,
      instantBlock: true,
      reasons: ['canvas_fingerprint_empty_or_zero', 'instant_block:webdriver_present'],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect((safe as Record<string, unknown>)['reasons']).toBeUndefined()
  })

  it('does not expose the instantBlock field', () => {
    const fullDecision: Decision = {
      decision: 'block',
      score: 100,
      instantBlock: true,
      reasons: [],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect((safe as Record<string, unknown>)['instantBlock']).toBeUndefined()
  })

  it('returns an object with exactly one key — the decision field', () => {
    // Arrange: a Decision with all internal fields populated
    const fullDecision: Decision = {
      decision: 'challenge',
      score: 35,
      instantBlock: false,
      reasons: ['no_interaction_events', 'canvas_fingerprint_empty_or_zero'],
    }

    // Act
    const safe = toClientSafeDecision(fullDecision)

    // Assert: only the "decision" key is present
    const keys = Object.keys(safe)
    expect(keys).toEqual(['decision'])
    expect(keys).toHaveLength(1)
  })

  // ─── Immutability — original Decision is not mutated ──────────────────────

  it('does not mutate the original Decision object', () => {
    const fullDecision: Decision = {
      decision: 'allow',
      score: 10,
      instantBlock: false,
      reasons: ['no_interaction_events'],
    }

    toClientSafeDecision(fullDecision)

    // Original is untouched
    expect(fullDecision.score).toBe(10)
    expect(fullDecision.instantBlock).toBe(false)
    expect(fullDecision.reasons).toEqual(['no_interaction_events'])
  })

  it('returns a new object reference, not the original', () => {
    const fullDecision: Decision = {
      decision: 'allow',
      score: 0,
      instantBlock: false,
      reasons: [],
    }

    const safe = toClientSafeDecision(fullDecision)

    expect(safe).not.toBe(fullDecision as unknown as ClientSafeDecision)
  })

  // ─── Type safety verification ────────────────────────────────────────────

  it('result satisfies the ClientSafeDecision interface (decision is a DecisionType)', () => {
    const decisions: Decision[] = [
      { decision: 'allow', score: 0, instantBlock: false, reasons: [] },
      { decision: 'challenge', score: 30, instantBlock: false, reasons: [] },
      { decision: 'block', score: 80, instantBlock: false, reasons: [] },
    ]

    for (const d of decisions) {
      const safe: ClientSafeDecision = toClientSafeDecision(d)
      expect(['allow', 'challenge', 'block']).toContain(safe.decision)
    }
  })
})
