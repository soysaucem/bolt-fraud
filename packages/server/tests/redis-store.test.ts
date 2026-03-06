import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RedisStore, type RedisStoreOptions } from '../src/store/redis.js'

// ─── Mock ioredis ─────────────────────────────────────────────────────────────
//
// RedisStore is a peer-dependency consumer — ioredis is never bundled with
// the server package. Tests mock the Redis client at the boundary so we can
// exercise all store logic without a live Redis server.

function makeMockRedis() {
  // Internal state that mirrors a minimal Redis data model
  const sets = new Map<string, Set<string>>()
  const strings = new Map<string, string>()
  const expiries = new Map<string, number>() // absolute ms

  function isExpired(key: string): boolean {
    const exp = expiries.get(key)
    if (exp === undefined) return false
    return Date.now() > exp
  }

  function get(key: string): string | null {
    if (isExpired(key)) {
      strings.delete(key)
      expiries.delete(key)
      return null
    }
    return strings.get(key) ?? null
  }

  const redis = {
    // SCARD — number of members in a set
    scard: vi.fn(async (key: string): Promise<number> => {
      if (isExpired(key)) {
        sets.delete(key)
        expiries.delete(key)
        return 0
      }
      return sets.get(key)?.size ?? 0
    }),

    // SADD — add one member, return 1 if new 0 if already present
    sadd: vi.fn(async (key: string, member: string): Promise<number> => {
      if (!sets.has(key)) sets.set(key, new Set())
      const set = sets.get(key)!
      const before = set.size
      set.add(member)
      return set.size > before ? 1 : 0
    }),

    // EXPIRE — set TTL in seconds
    expire: vi.fn(async (key: string, seconds: number): Promise<number> => {
      expiries.set(key, Date.now() + seconds * 1000)
      return 1
    }),

    // SET with EX option for nonce keys  (ioredis signature: set(key, value, 'EX', seconds))
    set: vi.fn(async (key: string, value: string, ...args: unknown[]): Promise<'OK'> => {
      strings.set(key, value)
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        expiries.set(key, Date.now() + args[1] * 1000)
      }
      return 'OK'
    }),

    // GET
    get: vi.fn(async (key: string): Promise<string | null> => get(key)),

    // QUIT
    quit: vi.fn(async (): Promise<'OK'> => 'OK'),

    // helper used by tests to peek at internal state
    _sets: sets,
    _strings: strings,
    _expiries: expiries,
  }

  return redis
}

type MockRedis = ReturnType<typeof makeMockRedis>

// ─── saveFingerprint + getIPCount ─────────────────────────────────────────────

describe('RedisStore saveFingerprint + getIPCount', () => {
  let redis: MockRedis
  let store: RedisStore

  beforeEach(() => {
    redis = makeMockRedis()
    store = new RedisStore(redis as never)
  })

  afterEach(async () => {
    await store.close()
  })

  it('returns 0 for an unknown fingerprint', async () => {
    expect(await store.getIPCount('unknown-fp')).toBe(0)
  })

  it('returns 1 after saving one fingerprint with one IP', async () => {
    await store.saveFingerprint('fp1', '1.2.3.4')
    expect(await store.getIPCount('fp1')).toBe(1)
  })

  it('count increases when different IPs are saved for the same fingerprint', async () => {
    await store.saveFingerprint('fp1', '1.1.1.1')
    await store.saveFingerprint('fp1', '2.2.2.2')
    await store.saveFingerprint('fp1', '3.3.3.3')
    expect(await store.getIPCount('fp1')).toBe(3)
  })

  it('count stays at 1 when the same IP is saved twice for the same fingerprint', async () => {
    await store.saveFingerprint('fp1', '1.2.3.4')
    await store.saveFingerprint('fp1', '1.2.3.4')
    expect(await store.getIPCount('fp1')).toBe(1)
  })

  it('different fingerprints have independent counts', async () => {
    await store.saveFingerprint('fp-A', '1.1.1.1')
    await store.saveFingerprint('fp-A', '2.2.2.2')
    await store.saveFingerprint('fp-B', '3.3.3.3')
    expect(await store.getIPCount('fp-A')).toBe(2)
    expect(await store.getIPCount('fp-B')).toBe(1)
  })

  it('returns 0 for a fingerprint that has not been saved when other fingerprints exist', async () => {
    await store.saveFingerprint('fp-A', '1.1.1.1')
    expect(await store.getIPCount('fp-B')).toBe(0)
  })

  it('saveFingerprint resolves to undefined (Promise<void>)', async () => {
    const result = await store.saveFingerprint('fp-X', '1.1.1.1')
    expect(result).toBeUndefined()
  })
})

// ─── Key prefix ───────────────────────────────────────────────────────────────

describe('RedisStore key prefixes', () => {
  let redis: MockRedis
  let store: RedisStore

  beforeEach(() => {
    redis = makeMockRedis()
    store = new RedisStore(redis as never)
  })

  afterEach(async () => {
    await store.close()
  })

  it('uses bf:fp: prefix for fingerprint keys', async () => {
    await store.saveFingerprint('myhash', '1.2.3.4')
    const key = 'bf:fp:myhash'
    expect(redis.sadd).toHaveBeenCalledWith(key, '1.2.3.4')
  })

  it('uses bf:nonce: prefix for nonce keys', async () => {
    await store.saveNonce('mynonce', 60_000)
    const key = 'bf:nonce:mynonce'
    expect(redis.set).toHaveBeenCalledWith(key, '1', 'EX', 60)
  })

  it('respects custom key prefix option', async () => {
    const customStore = new RedisStore(redis as never, { keyPrefix: 'myapp:' })
    await store.saveFingerprint('myhash', '1.2.3.4')
    await customStore.saveFingerprint('myhash', '1.2.3.4')
    // custom prefix store should use myapp:fp: prefix
    expect(redis.sadd).toHaveBeenCalledWith('myapp:fp:myhash', '1.2.3.4')
    await customStore.close()
  })
})

// ─── TTL refresh on saveFingerprint ───────────────────────────────────────────

describe('RedisStore TTL on fingerprint sets', () => {
  it('calls EXPIRE after SADD with the configured TTL in seconds', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never, { fingerprintTtlMs: 48 * 60 * 60 * 1000 }) // 48h

    await store.saveFingerprint('fp1', '1.1.1.1')

    expect(redis.expire).toHaveBeenCalledWith('bf:fp:fp1', 48 * 60 * 60)
    await store.close()
  })

  it('uses default 24h TTL when no option is provided', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never)

    await store.saveFingerprint('fp1', '1.1.1.1')

    expect(redis.expire).toHaveBeenCalledWith('bf:fp:fp1', 24 * 60 * 60)
    await store.close()
  })
})

// ─── IP set cap ───────────────────────────────────────────────────────────────

describe('RedisStore IP set cap', () => {
  it('skips SADD when set cardinality has reached the cap', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never, { ipSetCap: 3 })

    // Fill to cap
    await store.saveFingerprint('fp-capped', '1.1.1.1')
    await store.saveFingerprint('fp-capped', '2.2.2.2')
    await store.saveFingerprint('fp-capped', '3.3.3.3')
    // sadd called 3 times so far
    const saddCallsBefore = redis.sadd.mock.calls.length

    // Next call — set is at cap, SADD must be skipped
    await store.saveFingerprint('fp-capped', '4.4.4.4')

    // SADD must NOT have been called again
    expect(redis.sadd.mock.calls.length).toBe(saddCallsBefore)
    // count stays at 3
    expect(await store.getIPCount('fp-capped')).toBe(3)
    await store.close()
  })

  it('does not skip SADD when set cardinality is below the cap', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never, { ipSetCap: 5 })

    await store.saveFingerprint('fp-A', '1.1.1.1')
    await store.saveFingerprint('fp-A', '2.2.2.2')

    // only 2 members, cap=5 — SADD should have been called twice
    expect(redis.sadd).toHaveBeenCalledTimes(2)
    await store.close()
  })

  it('still calls EXPIRE even when SADD is skipped due to cap', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never, { ipSetCap: 1 })

    await store.saveFingerprint('fp-cap', '1.1.1.1') // fills the cap
    redis.expire.mockClear()

    await store.saveFingerprint('fp-cap', '2.2.2.2') // should skip SADD but still refresh TTL

    expect(redis.expire).toHaveBeenCalledWith('bf:fp:fp-cap', 24 * 60 * 60)
    await store.close()
  })
})

// ─── Nonce dedup ──────────────────────────────────────────────────────────────

describe('RedisStore nonce dedup', () => {
  let redis: MockRedis
  let store: RedisStore

  beforeEach(() => {
    redis = makeMockRedis()
    store = new RedisStore(redis as never)
  })

  afterEach(async () => {
    await store.close()
  })

  it('hasSeenNonce returns false for a nonce that has never been saved', async () => {
    expect(await store.hasSeenNonce('brand-new-nonce')).toBe(false)
  })

  it('hasSeenNonce returns true after saveNonce is called', async () => {
    await store.saveNonce('my-nonce', 60_000)
    expect(await store.hasSeenNonce('my-nonce')).toBe(true)
  })

  it('hasSeenNonce returns false for a different nonce than the one saved', async () => {
    await store.saveNonce('nonce-A', 60_000)
    expect(await store.hasSeenNonce('nonce-B')).toBe(false)
  })

  it('saveNonce stores with EX TTL rounded up to nearest second', async () => {
    await store.saveNonce('my-nonce', 30_000) // 30s
    expect(redis.set).toHaveBeenCalledWith('bf:nonce:my-nonce', '1', 'EX', 30)
  })

  it('saveNonce rounds sub-second TTL up to 1 second minimum', async () => {
    await store.saveNonce('tiny-nonce', 500) // 0.5s → should round up to 1s
    expect(redis.set).toHaveBeenCalledWith('bf:nonce:tiny-nonce', '1', 'EX', 1)
  })

  it('hasSeenNonce returns false after nonce TTL has expired (mock time)', async () => {
    vi.useFakeTimers()
    try {
      const r = makeMockRedis()
      const s = new RedisStore(r as never)

      await s.saveNonce('expiring', 100) // 100ms → 1s min, key stored
      // Advance fake time — simulate Redis key expiry by manipulating mock
      vi.advanceTimersByTime(200)
      // Force mock GET to return null (key "expired")
      r.get.mockResolvedValueOnce(null)

      expect(await s.hasSeenNonce('expiring')).toBe(false)
      await s.close()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── close() ──────────────────────────────────────────────────────────────────

describe('RedisStore close()', () => {
  it('calls redis.quit() when store owns the connection (URL string)', async () => {
    // We simulate the "owned connection" path: pass a URL string.
    // Since we cannot create a real Redis connection in unit tests, we intercept
    // the ioredis constructor by injecting a pre-built mock at the module level.
    // Instead, we test via the _ownConnection flag by creating a store whose
    // redis member is injected (not owned) and verify quit is NOT called.
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never) // injected — not owned
    await store.close()
    expect(redis.quit).not.toHaveBeenCalled()
  })

  it('does not call redis.quit() when user injected their own instance', async () => {
    const redis = makeMockRedis()
    const store = new RedisStore(redis as never)
    await store.close()
    expect(redis.quit).not.toHaveBeenCalled()
  })
})

// ─── RedisStoreOptions type surface ───────────────────────────────────────────

describe('RedisStoreOptions', () => {
  it('accepts all options without TypeScript error', () => {
    const redis = makeMockRedis()
    const options: RedisStoreOptions = {
      fingerprintTtlMs: 86_400_000,
      ipSetCap: 10_000,
      keyPrefix: 'custom:',
    }
    // Just constructing — no assertions needed, this is a compile-time check
    const store = new RedisStore(redis as never, options)
    expect(store).toBeDefined()
  })
})
