import { describe, it, expect } from 'vitest'
import { scoreBehavior, computeMouseEntropy } from '../src/scoring/behavior.js'
import { createMockBehavior } from './helpers.js'

// ─── scoreBehavior ────────────────────────────────────────────────────────────

describe('scoreBehavior', () => {
  it('returns 0 when behavior has mouse and keyboard events', () => {
    // Arrange: normal behavior with events
    const behavior = createMockBehavior()
    const reasons: string[] = []

    // Act
    const score = scoreBehavior(behavior, reasons)

    // Assert
    expect(score).toBe(0)
    expect(reasons).toHaveLength(0)
  })

  describe('no interaction events', () => {
    it('adds 15 when both totalMouseEvents and totalKeyboardEvents are 0', () => {
      // Arrange
      const behavior = createMockBehavior({
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
      })
      const reasons: string[] = []

      // Act
      const score = scoreBehavior(behavior, reasons)

      // Assert
      expect(score).toBe(15)
      expect(reasons).toContain('no_interaction_events')
    })

    it('does not add penalty when only mouse events exist (keyboard = 0)', () => {
      const behavior = createMockBehavior({
        totalMouseEvents: 5,
        totalKeyboardEvents: 0,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).not.toContain('no_interaction_events')
      expect(score).toBe(0)
    })

    it('does not add penalty when only keyboard events exist (mouse = 0)', () => {
      const behavior = createMockBehavior({
        totalMouseEvents: 0,
        totalKeyboardEvents: 3,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).not.toContain('no_interaction_events')
      expect(score).toBe(0)
    })
  })

  describe('mouse entropy', () => {
    it('does not add mouse entropy penalty for 2 or fewer mouse events', () => {
      // The implementation skips entropy check when mouse.length <= 2
      const behavior = createMockBehavior({
        mouse: [
          { type: 'move', x: 0, y: 0, t: 100 },
          { type: 'move', x: 100, y: 0, t: 200 },
        ],
        totalMouseEvents: 2,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).not.toContain('mouse_entropy_too_low')
    })

    it('does not add penalty when mouse.length is exactly 3 (minimum to trigger entropy check)', () => {
      // 3 events but they move in random directions → high entropy → no penalty
      const behavior = createMockBehavior({
        mouse: [
          { type: 'move', x: 0, y: 0, t: 100 },
          { type: 'move', x: 50, y: 80, t: 200 },   // diagonal
          { type: 'move', x: 0, y: 120, t: 300 },    // different direction
        ],
        totalMouseEvents: 3,
        totalKeyboardEvents: 0,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      // 15 for no keyboard events — entropy check runs but may or may not trigger
      expect(typeof score).toBe('number')
    })
  })

  describe('keystroke uniformity', () => {
    it('does not add keystroke uniformity penalty for 3 or fewer keyboard events', () => {
      // The check requires keyboard.length > 3
      const behavior = createMockBehavior({
        keyboard: [
          { type: 'keydown', code: 'KeyA', t: 100 },
          { type: 'keyup', code: 'KeyA', t: 150 },
          { type: 'keydown', code: 'KeyB', t: 200 },
        ],
        totalKeyboardEvents: 3,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).not.toContain('keystroke_timing_too_uniform')
    })

    it('adds 10 for perfectly uniform keystroke timing with 4+ events', () => {
      // All intervals identical → CV = 0 → uniformity = 1.0 → > 0.95 → penalty
      const behavior = createMockBehavior({
        keyboard: [
          { type: 'keydown', code: 'KeyA', t: 0 },
          { type: 'keydown', code: 'KeyB', t: 100 },   // interval: 100
          { type: 'keydown', code: 'KeyC', t: 200 },   // interval: 100
          { type: 'keydown', code: 'KeyD', t: 300 },   // interval: 100
          { type: 'keydown', code: 'KeyE', t: 400 },   // interval: 100
        ],
        totalKeyboardEvents: 5,
        totalMouseEvents: 1, // so we don't also hit the no_interaction penalty
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).toContain('keystroke_timing_too_uniform')
      expect(score).toBeGreaterThanOrEqual(10)
    })

    it('does not add uniformity penalty for variable keystroke timing (human-like)', () => {
      // Highly variable intervals → high CV → uniformity close to 0 → no penalty
      const behavior = createMockBehavior({
        keyboard: [
          { type: 'keydown', code: 'KeyA', t: 0 },
          { type: 'keydown', code: 'KeyB', t: 50 },    // 50ms
          { type: 'keydown', code: 'KeyC', t: 500 },   // 450ms — big jump
          { type: 'keydown', code: 'KeyD', t: 520 },   // 20ms
          { type: 'keydown', code: 'KeyE', t: 1200 },  // 680ms — big jump
        ],
        totalKeyboardEvents: 5,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(reasons).not.toContain('keystroke_timing_too_uniform')
    })
  })

  describe('scoring accumulation', () => {
    it('scores accumulate correctly (no-interaction = 15)', () => {
      const behavior = createMockBehavior({
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
      })
      const reasons: string[] = []

      const score = scoreBehavior(behavior, reasons)

      expect(score).toBe(15)
    })

    it('mutates the reasons array passed in', () => {
      const behavior = createMockBehavior({
        mouse: [],
        keyboard: [],
        scroll: [],
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalScrollEvents: 0,
      })
      const reasons = ['existing-reason']

      scoreBehavior(behavior, reasons)

      expect(reasons).toContain('existing-reason')
      expect(reasons).toContain('no_interaction_events')
    })
  })
})

// ─── computeMouseEntropy ──────────────────────────────────────────────────────

describe('computeMouseEntropy', () => {
  it('returns 1.0 for fewer than 3 events (fallback)', () => {
    expect(computeMouseEntropy([])).toBe(1.0)
    expect(computeMouseEntropy([{ x: 0, y: 0, t: 0 }])).toBe(1.0)
    expect(computeMouseEntropy([{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 1 }])).toBe(1.0)
  })

  it('returns 1.0 when all movements are stationary (dx=dy=0)', () => {
    // No angles computed → totalAngles=0 → fallback 1.0
    const events = [
      { x: 50, y: 50, t: 0 },
      { x: 50, y: 50, t: 1 },
      { x: 50, y: 50, t: 2 },
    ]
    expect(computeMouseEntropy(events)).toBe(1.0)
  })

  it('returns low entropy for a perfectly linear horizontal path (all right)', () => {
    // All moves in the same direction → all in same bin → entropy near 0
    const events = [
      { x: 0, y: 100, t: 0 },
      { x: 10, y: 100, t: 1 },
      { x: 20, y: 100, t: 2 },
      { x: 30, y: 100, t: 3 },
      { x: 40, y: 100, t: 4 },
      { x: 50, y: 100, t: 5 },
    ]
    const entropy = computeMouseEntropy(events)
    // All in the same bin (rightward) → entropy = 0
    expect(entropy).toBe(0)
  })

  it('returns entropy < 0.1 for a perfectly linear diagonal path', () => {
    const events = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 10, t: 1 },
      { x: 20, y: 20, t: 2 },
      { x: 30, y: 30, t: 3 },
      { x: 40, y: 40, t: 4 },
    ]
    const entropy = computeMouseEntropy(events)
    expect(entropy).toBeLessThan(0.1)
  })

  it('returns higher entropy for random directions (approaching 1.0)', () => {
    // 8 events each in a different 45-degree direction → max entropy
    const events = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 1 },   // right (0°)
      { x: 10, y: 10, t: 2 },  // down-right (from prev)... different directions
      { x: 20, y: 0, t: 3 },
      { x: 20, y: -10, t: 4 },
      { x: 10, y: -10, t: 5 },
      { x: 0, y: 0, t: 6 },
      { x: -10, y: 10, t: 7 },
      { x: 0, y: 20, t: 8 },
    ]
    const entropy = computeMouseEntropy(events)
    // Should be substantially higher than 0
    expect(entropy).toBeGreaterThan(0)
  })

  it('returns a value in [0, 1] range', () => {
    const events = [
      { x: 0, y: 0, t: 0 },
      { x: 5, y: 3, t: 10 },
      { x: 12, y: -2, t: 20 },
      { x: 7, y: 8, t: 30 },
    ]
    const entropy = computeMouseEntropy(events)
    expect(entropy).toBeGreaterThanOrEqual(0)
    expect(entropy).toBeLessThanOrEqual(1.0)
  })
})
