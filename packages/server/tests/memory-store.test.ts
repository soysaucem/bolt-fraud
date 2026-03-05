import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { MemoryStore } from '../src/store/memory.js'

// ─── MemoryStore ──────────────────────────────────────────────────────────────

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    // Arrange: fresh store for each test — no shared mutable state
    store = new MemoryStore()
  })

  describe('getIPCount before any saves', () => {
    it('returns 0 for an unknown fingerprint', async () => {
      const count = await store.getIPCount('unknown-fingerprint')
      expect(count).toBe(0)
    })

    it('returns 0 for any string key when store is empty', async () => {
      expect(await store.getIPCount('')).toBe(0)
      expect(await store.getIPCount('abc')).toBe(0)
    })
  })

  describe('saveFingerprint + getIPCount', () => {
    it('returns 1 after saving one fingerprint with one IP', async () => {
      // Arrange + Act
      await store.saveFingerprint('fp-hash-1', '1.2.3.4')

      // Assert
      const count = await store.getIPCount('fp-hash-1')
      expect(count).toBe(1)
    })

    it('count increases when different IPs are saved for the same fingerprint', async () => {
      // Arrange
      await store.saveFingerprint('fp-hash-1', '1.1.1.1')
      await store.saveFingerprint('fp-hash-1', '2.2.2.2')
      await store.saveFingerprint('fp-hash-1', '3.3.3.3')

      // Act
      const count = await store.getIPCount('fp-hash-1')

      // Assert
      expect(count).toBe(3)
    })

    it('count stays at 1 when the same IP is saved twice for the same fingerprint', () => {
      // Set (de-duplication via Set<string>) means duplicate IPs don't count twice
      return expect(
        store
          .saveFingerprint('fp-hash-1', '1.2.3.4')
          .then(() => store.saveFingerprint('fp-hash-1', '1.2.3.4'))
          .then(() => store.getIPCount('fp-hash-1')),
      ).resolves.toBe(1)
    })

    it('count stays at 1 when the same IP is saved many times for the same fingerprint', async () => {
      for (let i = 0; i < 10; i++) {
        await store.saveFingerprint('fp-hash-1', '192.168.1.1')
      }
      expect(await store.getIPCount('fp-hash-1')).toBe(1)
    })

    it('different fingerprints have independent counts', async () => {
      // Arrange
      await store.saveFingerprint('fp-A', '1.1.1.1')
      await store.saveFingerprint('fp-A', '2.2.2.2')
      await store.saveFingerprint('fp-B', '3.3.3.3')

      // Act + Assert
      expect(await store.getIPCount('fp-A')).toBe(2)
      expect(await store.getIPCount('fp-B')).toBe(1)
    })

    it('returns 0 for a fingerprint that has not been saved when other fingerprints exist', async () => {
      await store.saveFingerprint('fp-A', '1.1.1.1')

      expect(await store.getIPCount('fp-B')).toBe(0)
    })
  })

  describe('clear()', () => {
    it('resets all fingerprint counts to 0 after clear', async () => {
      // Arrange: populate the store
      await store.saveFingerprint('fp-A', '1.1.1.1')
      await store.saveFingerprint('fp-A', '2.2.2.2')
      await store.saveFingerprint('fp-B', '3.3.3.3')

      // Act
      store.clear()

      // Assert: all counts are now 0
      expect(await store.getIPCount('fp-A')).toBe(0)
      expect(await store.getIPCount('fp-B')).toBe(0)
    })

    it('allows re-adding fingerprints after clear', async () => {
      // Arrange
      await store.saveFingerprint('fp-A', '1.1.1.1')
      store.clear()

      // Act
      await store.saveFingerprint('fp-A', '9.9.9.9')

      // Assert: starts from 1 again
      expect(await store.getIPCount('fp-A')).toBe(1)
    })

    it('clear on empty store does not throw', () => {
      expect(() => store.clear()).not.toThrow()
    })
  })

  describe('saveFingerprint returns void (Promise<void>)', () => {
    it('resolves without a return value', async () => {
      const result = await store.saveFingerprint('fp-X', '1.1.1.1')
      expect(result).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles empty string as fingerprint hash', async () => {
      await store.saveFingerprint('', '1.2.3.4')
      expect(await store.getIPCount('')).toBe(1)
    })

    it('handles empty string as IP address', async () => {
      await store.saveFingerprint('fp-X', '')
      expect(await store.getIPCount('fp-X')).toBe(1)
    })

    it('handles many unique IPs correctly', async () => {
      const ipCount = 200
      for (let i = 0; i < ipCount; i++) {
        await store.saveFingerprint('fp-popular', `10.0.${Math.floor(i / 256)}.${i % 256}`)
      }
      expect(await store.getIPCount('fp-popular')).toBe(ipCount)
    })
  })
})

// ─── TTL expiration ───────────────────────────────────────────────────────────

describe('MemoryStore TTL expiration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('getIPCount returns 0 after TTL has elapsed', async () => {
    // Arrange: create a store with a very short TTL (100ms)
    const store = new MemoryStore({ ttlMs: 100 })

    // Save a fingerprint at the "current" time
    await store.saveFingerprint('fp-ttl', '10.0.0.1')

    // Verify it's stored
    expect(await store.getIPCount('fp-ttl')).toBe(1)

    // Advance fake time past the TTL
    vi.useFakeTimers()
    vi.advanceTimersByTime(150)

    // Act: getIPCount should evict the stale entry and return 0
    const count = await store.getIPCount('fp-ttl')

    // Assert
    expect(count).toBe(0)
  })

  it('entry is not evicted before TTL has elapsed', async () => {
    // Arrange: TTL = 500ms
    const store = new MemoryStore({ ttlMs: 500 })
    await store.saveFingerprint('fp-fresh', '10.0.0.2')

    vi.useFakeTimers()
    vi.advanceTimersByTime(200) // only 200ms elapsed, TTL not reached

    // Act
    const count = await store.getIPCount('fp-fresh')

    // Assert: still alive
    expect(count).toBe(1)
  })
})

// ─── Max entries eviction ─────────────────────────────────────────────────────

describe('MemoryStore max entries eviction', () => {
  it('evicts the oldest entry when maxEntries is exceeded', async () => {
    // Arrange: store with maxEntries=2
    const store = new MemoryStore({ maxEntries: 2 })

    // Save first two fingerprints (fills capacity)
    await store.saveFingerprint('fp-oldest', '1.1.1.1')
    await store.saveFingerprint('fp-second', '2.2.2.2')

    // Verify both are present
    expect(await store.getIPCount('fp-oldest')).toBe(1)
    expect(await store.getIPCount('fp-second')).toBe(1)

    // Act: saving a third fingerprint should evict the oldest
    await store.saveFingerprint('fp-newest', '3.3.3.3')

    // Assert: oldest entry is gone, newer entries remain
    expect(await store.getIPCount('fp-oldest')).toBe(0)
    expect(await store.getIPCount('fp-second')).toBe(1)
    expect(await store.getIPCount('fp-newest')).toBe(1)
  })

  it('does not evict when under capacity', async () => {
    // Arrange: store with maxEntries=3, only 2 saved
    const store = new MemoryStore({ maxEntries: 3 })
    await store.saveFingerprint('fp-a', '1.1.1.1')
    await store.saveFingerprint('fp-b', '2.2.2.2')

    // Act + Assert: both should still be present
    expect(await store.getIPCount('fp-a')).toBe(1)
    expect(await store.getIPCount('fp-b')).toBe(1)
  })

  it('can evict multiple times, each time removing the oldest', async () => {
    // Arrange: maxEntries=1 — each new entry evicts the previous
    const store = new MemoryStore({ maxEntries: 1 })

    await store.saveFingerprint('fp-1', '1.1.1.1')
    expect(await store.getIPCount('fp-1')).toBe(1)

    // Second save evicts fp-1
    await store.saveFingerprint('fp-2', '2.2.2.2')
    expect(await store.getIPCount('fp-1')).toBe(0)
    expect(await store.getIPCount('fp-2')).toBe(1)

    // Third save evicts fp-2
    await store.saveFingerprint('fp-3', '3.3.3.3')
    expect(await store.getIPCount('fp-2')).toBe(0)
    expect(await store.getIPCount('fp-3')).toBe(1)
  })
})
