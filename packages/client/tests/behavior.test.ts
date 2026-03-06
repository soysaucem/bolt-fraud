// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
      // Act: fire a mousemove event on document
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200, bubbles: true }))

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
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20, bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }))

      const snapshot = snapshotBehavior()

      // Assert: totals remain zero since collection was stopped before events fired
      expect(snapshot.totalMouseEvents).toBe(0)
      expect(snapshot.totalKeyboardEvents).toBe(0)
    })

    it('snapshotBehavior returns zeroed totals after stop', () => {
      // Arrange: start, fire events, then stop
      startBehaviorCollection()
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60, bubbles: true }))
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
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20, bubbles: true }))

      // Act: second start should stop then restart (clearing previous state)
      startBehaviorCollection()

      const snapshot = snapshotBehavior()

      // Assert: after restart, event buffer from prior run is gone
      expect(snapshot.totalMouseEvents).toBe(0)
    })
  })
})
