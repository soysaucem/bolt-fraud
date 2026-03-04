// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MouseTracker } from '../src/behavior/mouse.js'
import { KeyboardTracker } from '../src/behavior/keyboard.js'
import { ScrollTracker } from '../src/behavior/scroll.js'
import type { BfMouseEvent, BfKeyboardEvent, BfScrollEvent } from '../src/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMouseEvent(x: number, y: number, t: number): BfMouseEvent {
  return { type: 'move', x, y, t, buttons: 0 }
}

function makeKeyboardEvent(code: string, t: number): BfKeyboardEvent {
  return { type: 'keydown', code, t }
}

function makeScrollEvent(y: number, t: number): BfScrollEvent {
  return { x: 0, y, t }
}

// ─── MouseTracker ─────────────────────────────────────────────────────────────

describe('MouseTracker ring buffer', () => {
  it('snapshot returns empty array when no events have been pushed', () => {
    const tracker = new MouseTracker(5)
    expect(tracker.snapshot()).toEqual([])
    expect(tracker.totalEvents).toBe(0)
  })

  it('snapshot returns all events when fewer than capacity events are pushed', () => {
    // Arrange
    const tracker = new MouseTracker(5)

    // Act
    tracker.push(makeMouseEvent(1, 1, 100))
    tracker.push(makeMouseEvent(2, 2, 200))
    tracker.push(makeMouseEvent(3, 3, 300))

    // Assert
    const snap = tracker.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]).toMatchObject({ x: 1, y: 1, t: 100 })
    expect(snap[1]).toMatchObject({ x: 2, y: 2, t: 200 })
    expect(snap[2]).toMatchObject({ x: 3, y: 3, t: 300 })
  })

  it('snapshot returns all events when exactly capacity events are pushed, in order', () => {
    // Arrange
    const tracker = new MouseTracker(3)

    // Act
    tracker.push(makeMouseEvent(1, 1, 10))
    tracker.push(makeMouseEvent(2, 2, 20))
    tracker.push(makeMouseEvent(3, 3, 30))

    // Assert
    const snap = tracker.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]).toMatchObject({ t: 10 })
    expect(snap[1]).toMatchObject({ t: 20 })
    expect(snap[2]).toMatchObject({ t: 30 })
  })

  it('snapshot returns newest N events when more than capacity events are pushed', () => {
    // Arrange: capacity = 3, push 5 events
    const tracker = new MouseTracker(3)

    // Act
    tracker.push(makeMouseEvent(1, 1, 10)) // oldest — will be overwritten
    tracker.push(makeMouseEvent(2, 2, 20)) // will be overwritten
    tracker.push(makeMouseEvent(3, 3, 30))
    tracker.push(makeMouseEvent(4, 4, 40))
    tracker.push(makeMouseEvent(5, 5, 50))

    // Assert: only the last 3 are kept
    const snap = tracker.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]).toMatchObject({ t: 30 })
    expect(snap[1]).toMatchObject({ t: 40 })
    expect(snap[2]).toMatchObject({ t: 50 })
  })

  it('totalEvents tracks all pushes, not just buffered ones', () => {
    // Arrange: capacity = 2, push 5 events
    const tracker = new MouseTracker(2)

    // Act
    for (let i = 0; i < 5; i++) {
      tracker.push(makeMouseEvent(i, i, i * 100))
    }

    // Assert: buffer holds 2 but total is 5
    expect(tracker.snapshot()).toHaveLength(2)
    expect(tracker.totalEvents).toBe(5)
  })

  it('ring wraps correctly after many overwrites', () => {
    // Arrange
    const tracker = new MouseTracker(3)

    // Act: push 9 events (3 full wraps)
    for (let i = 0; i < 9; i++) {
      tracker.push(makeMouseEvent(i, i, i * 10))
    }

    // Assert: last 3 events are 6, 7, 8 (t = 60, 70, 80)
    const snap = tracker.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]).toMatchObject({ t: 60 })
    expect(snap[1]).toMatchObject({ t: 70 })
    expect(snap[2]).toMatchObject({ t: 80 })
    expect(tracker.totalEvents).toBe(9)
  })
})

// ─── KeyboardTracker ──────────────────────────────────────────────────────────

describe('KeyboardTracker ring buffer', () => {
  it('snapshot returns empty array when no events pushed', () => {
    const tracker = new KeyboardTracker(5)
    expect(tracker.snapshot()).toEqual([])
    expect(tracker.totalEvents).toBe(0)
  })

  it('snapshot returns all events when fewer than capacity', () => {
    const tracker = new KeyboardTracker(10)
    tracker.push(makeKeyboardEvent('KeyA', 100))
    tracker.push(makeKeyboardEvent('KeyB', 200))

    const snap = tracker.snapshot()
    expect(snap).toHaveLength(2)
    expect(snap[0]).toMatchObject({ code: 'KeyA', t: 100 })
    expect(snap[1]).toMatchObject({ code: 'KeyB', t: 200 })
  })

  it('snapshot returns exactly capacity events when exactly capacity pushed', () => {
    const tracker = new KeyboardTracker(3)
    tracker.push(makeKeyboardEvent('KeyA', 10))
    tracker.push(makeKeyboardEvent('KeyB', 20))
    tracker.push(makeKeyboardEvent('KeyC', 30))

    const snap = tracker.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]).toMatchObject({ code: 'KeyA' })
    expect(snap[2]).toMatchObject({ code: 'KeyC' })
  })

  it('discards oldest events when more than capacity are pushed', () => {
    const tracker = new KeyboardTracker(2)
    tracker.push(makeKeyboardEvent('KeyA', 10)) // discarded
    tracker.push(makeKeyboardEvent('KeyB', 20))
    tracker.push(makeKeyboardEvent('KeyC', 30))

    const snap = tracker.snapshot()
    expect(snap).toHaveLength(2)
    expect(snap[0]).toMatchObject({ code: 'KeyB' })
    expect(snap[1]).toMatchObject({ code: 'KeyC' })
  })

  it('totalEvents counts all pushes beyond capacity', () => {
    const tracker = new KeyboardTracker(3)
    for (let i = 0; i < 7; i++) {
      tracker.push(makeKeyboardEvent(`Key${i}`, i * 100))
    }
    expect(tracker.totalEvents).toBe(7)
    expect(tracker.snapshot()).toHaveLength(3)
  })
})

// ─── ScrollTracker ────────────────────────────────────────────────────────────

describe('ScrollTracker ring buffer', () => {
  it('snapshot returns empty array when no events pushed', () => {
    const tracker = new ScrollTracker(5)
    expect(tracker.snapshot()).toEqual([])
    expect(tracker.totalEvents).toBe(0)
  })

  it('snapshot returns all events when fewer than capacity', () => {
    const tracker = new ScrollTracker(5)
    // Events at least 100ms apart to pass throttle
    tracker.push(makeScrollEvent(100, 0))
    tracker.push(makeScrollEvent(200, 200))

    const snap = tracker.snapshot()
    expect(snap).toHaveLength(2)
    expect(snap[0]).toMatchObject({ y: 100 })
    expect(snap[1]).toMatchObject({ y: 200 })
  })

  it('discards oldest events when more than capacity are pushed (spaced >100ms)', () => {
    const tracker = new ScrollTracker(2)
    tracker.push(makeScrollEvent(100, 0))     // discarded
    tracker.push(makeScrollEvent(200, 200))
    tracker.push(makeScrollEvent(300, 400))

    const snap = tracker.snapshot()
    expect(snap).toHaveLength(2)
    expect(snap[0]).toMatchObject({ y: 200 })
    expect(snap[1]).toMatchObject({ y: 300 })
  })

  it('totalEvents counts only accepted events (not throttled ones)', () => {
    const tracker = new ScrollTracker(10)
    tracker.push(makeScrollEvent(100, 0))     // accepted
    tracker.push(makeScrollEvent(200, 200))   // accepted
    expect(tracker.totalEvents).toBe(2)
  })

  describe('throttling: events within 100ms of the last accepted event are dropped', () => {
    it('drops an event that is exactly 0ms after the previous', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 1000))
      tracker.push(makeScrollEvent(200, 1000)) // same timestamp — dropped

      expect(tracker.snapshot()).toHaveLength(1)
      expect(tracker.totalEvents).toBe(1)
    })

    it('drops an event that is 50ms after the previous (within 100ms window)', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 1000))
      tracker.push(makeScrollEvent(200, 1050)) // 50ms — dropped

      expect(tracker.snapshot()).toHaveLength(1)
      expect(tracker.totalEvents).toBe(1)
    })

    it('drops an event that is 99ms after the previous', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 1000))
      tracker.push(makeScrollEvent(200, 1099)) // 99ms — dropped

      expect(tracker.snapshot()).toHaveLength(1)
    })

    it('accepts an event that is exactly 100ms after the previous (at the boundary — not throttled since diff >= 100)', () => {
      // The condition is: event.t - lastEventAt < THROTTLE_MS (100)
      // So difference of 100 means NOT dropped (100 < 100 is false)
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 1000))
      tracker.push(makeScrollEvent(200, 1100)) // 100ms — accepted

      expect(tracker.snapshot()).toHaveLength(2)
      expect(tracker.totalEvents).toBe(2)
    })

    it('accepts an event that is 101ms after the previous', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 1000))
      tracker.push(makeScrollEvent(200, 1101)) // 101ms — accepted

      expect(tracker.snapshot()).toHaveLength(2)
    })

    it('handles rapid-fire events where only 1 of 5 passes the throttle', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 0))   // accepted (first event always passes: 0 - (-Infinity) = Infinity >= 100)
      tracker.push(makeScrollEvent(110, 10))  // dropped (10 < 100)
      tracker.push(makeScrollEvent(120, 20))  // dropped
      tracker.push(makeScrollEvent(130, 30))  // dropped
      tracker.push(makeScrollEvent(140, 40))  // dropped

      expect(tracker.snapshot()).toHaveLength(1)
      expect(tracker.totalEvents).toBe(1)
    })

    it('accepts events after the throttle window resets', () => {
      const tracker = new ScrollTracker(10)
      tracker.push(makeScrollEvent(100, 0))    // accepted
      tracker.push(makeScrollEvent(200, 50))   // dropped
      tracker.push(makeScrollEvent(300, 101))  // accepted (101ms after t=0)
      tracker.push(makeScrollEvent(400, 150))  // dropped (49ms after t=101)
      tracker.push(makeScrollEvent(500, 202))  // accepted (101ms after t=101)

      expect(tracker.snapshot()).toHaveLength(3)
      expect(tracker.totalEvents).toBe(3)
    })
  })
})
