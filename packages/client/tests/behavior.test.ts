// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  startBehaviorCollection,
  stopBehaviorCollection,
  snapshotBehavior,
} from '../src/behavior/index.js'

// ─── behavior collection lifecycle ────────────────────────────────────────────

describe('behavior collection lifecycle', () => {
  // Always stop collection after each test to prevent listener leaks
  afterEach(() => {
    stopBehaviorCollection()
  })

  // ── Initial / stopped state ──────────────────────────────────────────────────

  describe('before startBehaviorCollection is called', () => {
    it('snapshotBehavior returns zeroed totals when no collection has started', () => {
      // Arrange: ensure stopped state
      stopBehaviorCollection()

      // Act
      const snapshot = snapshotBehavior()

      // Assert: all totals are zero, all arrays are empty
      expect(snapshot.totalMouseEvents).toBe(0)
      expect(snapshot.totalKeyboardEvents).toBe(0)
      expect(snapshot.totalScrollEvents).toBe(0)
      expect(snapshot.mouse).toHaveLength(0)
      expect(snapshot.keyboard).toHaveLength(0)
      expect(snapshot.scroll).toHaveLength(0)
    })
  })

  // ── After start ──────────────────────────────────────────────────────────────

  describe('after startBehaviorCollection()', () => {
    beforeEach(() => {
      startBehaviorCollection()
    })

    it('snapshotBehavior returns a valid BehaviorData object with required fields', () => {
      // Act
      const snapshot = snapshotBehavior()

      // Assert: required fields exist and have correct types
      expect(Array.isArray(snapshot.mouse)).toBe(true)
      expect(Array.isArray(snapshot.keyboard)).toBe(true)
      expect(Array.isArray(snapshot.scroll)).toBe(true)
      expect(typeof snapshot.totalMouseEvents).toBe('number')
      expect(typeof snapshot.totalKeyboardEvents).toBe('number')
      expect(typeof snapshot.totalScrollEvents).toBe('number')
      expect(typeof snapshot.snapshotAt).toBe('number')
    })

    it('snapshotBehavior returns zeroed totals when no events have occurred', () => {
      // Act: snapshot immediately — no events fired yet
      const snapshot = snapshotBehavior()

      // Assert
      expect(snapshot.totalMouseEvents).toBe(0)
      expect(snapshot.totalKeyboardEvents).toBe(0)
      expect(snapshot.totalScrollEvents).toBe(0)
      expect(snapshot.mouse).toHaveLength(0)
      expect(snapshot.keyboard).toHaveLength(0)
      expect(snapshot.scroll).toHaveLength(0)
    })

    it('records mouse move events dispatched on document', () => {
      // Act: fire a pointermove event on document
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 200, bubbles: true }))

      const snapshot = snapshotBehavior()

      // Assert: at least one mouse event recorded
      expect(snapshot.totalMouseEvents).toBeGreaterThan(0)
      expect(snapshot.mouse.length).toBeGreaterThan(0)
    })

    it('records keyboard events dispatched on document', () => {
      // Act: fire a keydown event
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }))

      const snapshot = snapshotBehavior()

      // Assert
      expect(snapshot.totalKeyboardEvents).toBeGreaterThan(0)
      expect(snapshot.keyboard.length).toBeGreaterThan(0)
    })

    it('records scroll events dispatched on document', () => {
      // Act: fire a scroll event (ScrollTracker listens to document scroll)
      document.dispatchEvent(new Event('scroll', { bubbles: true }))

      const snapshot = snapshotBehavior()

      // Assert
      expect(snapshot.totalScrollEvents).toBeGreaterThan(0)
      expect(snapshot.scroll.length).toBeGreaterThan(0)
    })
  })

  // ── After stop ──────────────────────────────────────────────────────────────

  describe('after stopBehaviorCollection()', () => {
    it('subsequent events are not recorded after stop', () => {
      // Arrange: start then stop
      startBehaviorCollection()
      stopBehaviorCollection()

      // Act: fire events after stop — they should not be recorded
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 20, bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }))

      const snapshot = snapshotBehavior()

      // Assert: totals remain zero since collection was stopped before events fired
      expect(snapshot.totalMouseEvents).toBe(0)
      expect(snapshot.totalKeyboardEvents).toBe(0)
    })

    it('snapshotBehavior returns zeroed totals after stop', () => {
      // Arrange: start, fire events, then stop
      startBehaviorCollection()
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 60, bubbles: true }))
      stopBehaviorCollection()

      // Act: snapshot after stop — trackers are cleared
      const snapshot = snapshotBehavior()

      // Assert: all zeroed because trackers are null after stop
      expect(snapshot.totalMouseEvents).toBe(0)
      expect(snapshot.totalKeyboardEvents).toBe(0)
      expect(snapshot.totalScrollEvents).toBe(0)
      expect(snapshot.mouse).toHaveLength(0)
      expect(snapshot.keyboard).toHaveLength(0)
      expect(snapshot.scroll).toHaveLength(0)
    })
  })

  // ── start/stop idempotency ───────────────────────────────────────────────────

  describe('start/stop idempotency', () => {
    it('calling stopBehaviorCollection multiple times does not throw', () => {
      // Act
      expect(() => {
        stopBehaviorCollection()
        stopBehaviorCollection()
        stopBehaviorCollection()
      }).not.toThrow()
    })

    it('calling startBehaviorCollection twice restarts cleanly', () => {
      // Arrange: first start + fire event
      startBehaviorCollection()
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 20, bubbles: true }))

      // Act: second start should stop then restart (clearing previous state)
      startBehaviorCollection()

      const snapshot = snapshotBehavior()

      // Assert: after restart, event buffer from prior run is gone
      expect(snapshot.totalMouseEvents).toBe(0)
    })
  })

  // ── Keyboard privacy ─────────────────────────────────────────────────────────

  describe('keyboard privacy', () => {
    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('does not record keys typed into a password field', () => {
      startBehaviorCollection()
      const input = document.createElement('input')
      input.type = 'password'
      document.body.appendChild(input)

      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP', bubbles: true }))

      const snapshot = snapshotBehavior()
      expect(snapshot.totalKeyboardEvents).toBe(0)
      expect(snapshot.keyboard).toHaveLength(0)
    })

    it('records timing but never the key code for other fields', () => {
      startBehaviorCollection()
      const input = document.createElement('input')
      input.type = 'text'
      document.body.appendChild(input)

      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }))

      const { keyboard } = snapshotBehavior()
      expect(keyboard).toHaveLength(2)
      expect(keyboard.map((e) => e.type)).toEqual(['keydown', 'keyup'])
      for (const event of keyboard) {
        expect(Object.keys(event).sort()).toEqual(['t', 'type'])
        expect(typeof event.t).toBe('number')
      }
    })

    it('captures keys that stop propagation (capture-phase listener)', () => {
      startBehaviorCollection()
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.addEventListener('keydown', (e) => e.stopPropagation())

      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))

      expect(snapshotBehavior().totalKeyboardEvents).toBe(1)
    })
  })

  // ── Listener registration ────────────────────────────────────────────────────

  describe('listener registration', () => {
    it('uses pointer events with capture + passive and removes them on stop', () => {
      const add = vi.spyOn(document, 'addEventListener')
      const remove = vi.spyOn(document, 'removeEventListener')
      try {
        startBehaviorCollection()
        const added = add.mock.calls.map((call) => [call[0], call[2]] as const)
        expect(added.map(([type]) => type).sort()).toEqual(
          ['click', 'keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'scroll'].sort(),
        )
        for (const [, options] of added) {
          expect(options).toEqual({ capture: true, passive: true })
        }

        stopBehaviorCollection()
        expect(remove.mock.calls.map((call) => call[0]).sort()).toEqual(added.map(([type]) => type).sort())
        for (const call of remove.mock.calls) expect(call[2]).toEqual({ capture: true, passive: true })
      } finally {
        add.mockRestore()
        remove.mockRestore()
      }
    })

    it('maps pointer events to the existing move/down/up/click types', () => {
      startBehaviorCollection()
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 1, clientY: 2, bubbles: true }))
      document.dispatchEvent(new MouseEvent('pointerdown', { clientX: 1, clientY: 2, bubbles: true }))
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 1, clientY: 2, bubbles: true }))
      document.dispatchEvent(new MouseEvent('click', { clientX: 1, clientY: 2, bubbles: true }))

      expect(snapshotBehavior().mouse.map((e) => e.type)).toEqual(['move', 'down', 'up', 'click'])
    })

    it('ignores legacy mouse events', () => {
      startBehaviorCollection()
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

      expect(snapshotBehavior().totalMouseEvents).toBe(0)
    })
  })
})
