import { describe, it, expect, vi, afterEach } from 'vitest'
import { RedisStore, type RedisStoreOptions } from '../src/store/redis.js'

// ─── Mock ioredis ─────────────────────────────────────────────────────────────
//
// RedisStore never imports ioredis; tests inject a minimal fake client that
// mirrors the Redis data model (sets, strings, absolute-ms expiries).

function makeMockRedis() {
  const sets = new Map<string, Set<string>>()
  const strings = new Map<string, string>()
  const expiries = new Map<string, number>() // absolute ms

  function isExpired(key: string): boolean {
    const exp = expiries.get(key)
    return exp !== undefined && exp <= Date.now()
  }

  function liveSet(key: string): Set<string> | undefined {
    if (isExpired(key)) {
      sets.delete(key)
      expiries.delete(key)
      return undefined
    }
    return sets.get(key)
  }

  const redis = {
    scard: vi.fn(async (key: string): Promise<number> => liveSet(key)?.size ?? 0),
    sadd: vi.fn(async (key: string, member: string): Promise<number> => {
      const set = liveSet(key) ?? new Set<string>()
      const before = set.size
      set.add(member)
      sets.set(key, set)
      return set.size - before
    }),
    srem: vi.fn(async (key: string, member: string): Promise<number> => {
      return liveSet(key)?.delete(member) ? 1 : 0
    }),
    expire: vi.fn(async (key: string, seconds: number): Promise<number> => {
      expiries.set(key, Date.now() + seconds * 1000)
      return 1
    }),
    set: vi.fn(
      async (key: string, value: string, _px: 'PX', ms: number, _nx: 'NX'): Promise<'OK' | null> => {
        if (strings.has(key) && !isExpired(key)) return null
        strings.set(key, value)
        expiries.set(key, Date.now() + ms)
        return 'OK'
      },
    ),
    multi: vi.fn(() => {
      const ops: Array<() => Promise<unknown>> = []
      const pipeline = {
        sadd: (key: string, member: string) => {
          ops.push(() => redis.sadd(key, member))
          return pipeline
        },
        expire: (key: string, seconds: number) => {
          ops.push(() => redis.expire(key, seconds))
          return pipeline
        },
        scard: (key: string) => {
          ops.push(() => redis.scard(key))
          return pipeline
        },
        exec: async (): Promise<Array<[Error | null, unknown]>> => {
          const out: Array<[Error | null, unknown]> = []
          for (const op of ops) out.push([null, await op()])
          return out
        },
      }
      return pipeline
    }),
  }

  return redis
}

function makeStore(options?: RedisStoreOptions) {
  const redis = makeMockRedis()
  return { store: new RedisStore(redis, options), redis }
}

afterEach(() => {
  vi.useRealTimers()
})

// ─── saveFingerprint + getIPCount ─────────────────────────────────────────────

describe('RedisStore saveFingerprint + getIPCount', () => {
  it('returns 0 for an unknown fingerprint', async () => {
    const { store } = makeStore()
    expect(await store.getIPCount('unknown')).toBe(0)
  })

  it('counts distinct IPs per fingerprint', async () => {
    const { store } = makeStore()
    await store.saveFingerprint('fp1', '1.1.1.1')
    await store.saveFingerprint('fp1', '2.2.2.2')
    await store.saveFingerprint('fp1', '2.2.2.2')
    await store.saveFingerprint('fp2', '3.3.3.3')
    expect(await store.getIPCount('fp1')).toBe(2)
    expect(await store.getIPCount('fp2')).toBe(1)
  })

  it('resolves to undefined (Promise<void>)', async () => {
    const { store } = makeStore()
    expect(await store.saveFingerprint('fp', '1.1.1.1')).toBeUndefined()
  })

  it('issues exactly one multi() per saveFingerprint and no separate round trips', async () => {
    const { store, redis } = makeStore()
    await store.saveFingerprint('fp', '1.1.1.1')
    expect(redis.multi).toHaveBeenCalledTimes(1)
    expect(redis.scard).toHaveBeenCalledTimes(1) // only the SCARD inside the transaction
    expect(redis.sadd).toHaveBeenCalledWith('bf:fp:fp', '1.1.1.1')
    expect(redis.expire).toHaveBeenCalledWith('bf:fp:fp', 86_400)
  })
})

// ─── Key prefix ───────────────────────────────────────────────────────────────

describe('RedisStore key prefixes', () => {
  it('uses bf:fp: and bf:nonce: by default', async () => {
    const { store, redis } = makeStore()
    await store.saveFingerprint('abc', '1.1.1.1')
    await store.claimNonce('n1', 1000)
    expect(redis.sadd).toHaveBeenCalledWith('bf:fp:abc', '1.1.1.1')
    expect(redis.set).toHaveBeenCalledWith('bf:nonce:n1', '1', 'PX', 1000, 'NX')
  })

  it('respects a custom key prefix', async () => {
    const { store, redis } = makeStore({ keyPrefix: 'myapp:' })
    await store.saveFingerprint('abc', '1.1.1.1')
    await store.claimNonce('n1', 1000)
    expect(redis.sadd).toHaveBeenCalledWith('myapp:fp:abc', '1.1.1.1')
    expect(redis.set).toHaveBeenCalledWith('myapp:nonce:n1', '1', 'PX', 1000, 'NX')
  })
})

// ─── TTL ──────────────────────────────────────────────────────────────────────

describe('RedisStore TTL on fingerprint sets', () => {
  it('uses the configured TTL in seconds (rounded up)', async () => {
    const { store, redis } = makeStore({ fingerprintTtlMs: 90_500 })
    await store.saveFingerprint('fp', '1.1.1.1')
    expect(redis.expire).toHaveBeenCalledWith('bf:fp:fp', 91)
  })

  it('expires the set after the TTL passes', async () => {
    vi.useFakeTimers()
    const { store } = makeStore({ fingerprintTtlMs: 5000 })
    await store.saveFingerprint('fp', '1.1.1.1')
    vi.advanceTimersByTime(6000)
    expect(await store.getIPCount('fp')).toBe(0)
  })
})

// ─── IP set cap ───────────────────────────────────────────────────────────────

describe('RedisStore IP set cap', () => {
  it('removes the just-added member when the set exceeds the cap', async () => {
    const { store, redis } = makeStore({ ipSetCap: 2 })
    await store.saveFingerprint('fp', '1.1.1.1')
    await store.saveFingerprint('fp', '2.2.2.2')
    await store.saveFingerprint('fp', '3.3.3.3')
    expect(redis.srem).toHaveBeenCalledWith('bf:fp:fp', '3.3.3.3')
    expect(await store.getIPCount('fp')).toBe(2)
  })

  it('does not call srem while below or at the cap', async () => {
    const { store, redis } = makeStore({ ipSetCap: 2 })
    await store.saveFingerprint('fp', '1.1.1.1')
    await store.saveFingerprint('fp', '2.2.2.2')
    expect(redis.srem).not.toHaveBeenCalled()
  })
})

// ─── Nonce claim ──────────────────────────────────────────────────────────────

describe('RedisStore claimNonce', () => {
  it('first claim returns true, second returns false', async () => {
    const { store } = makeStore()
    expect(await store.claimNonce('n', 60_000)).toBe(true)
    expect(await store.claimNonce('n', 60_000)).toBe(false)
  })

  it('different nonces are independent', async () => {
    const { store } = makeStore()
    expect(await store.claimNonce('a', 60_000)).toBe(true)
    expect(await store.claimNonce('b', 60_000)).toBe(true)
  })

  it('issues one atomic SET ... PX ttl NX with no preceding GET', async () => {
    const { store, redis } = makeStore()
    await store.claimNonce('n', 30_500)
    expect(redis.set).toHaveBeenCalledTimes(1)
    expect(redis.set).toHaveBeenCalledWith('bf:nonce:n', '1', 'PX', 30_500, 'NX')
  })

  it('can be claimed again once the TTL has expired', async () => {
    vi.useFakeTimers()
    const { store } = makeStore()
    expect(await store.claimNonce('n', 100)).toBe(true)
    vi.advanceTimersByTime(200)
    expect(await store.claimNonce('n', 100)).toBe(true)
  })
})

// ─── RedisStoreOptions type surface ───────────────────────────────────────────

describe('RedisStoreOptions', () => {
  it('accepts an empty options object', () => {
    const opts: RedisStoreOptions = {}
    expect(() => new RedisStore(makeMockRedis(), opts)).not.toThrow()
  })

  it('does not expose close() — the caller owns the connection', () => {
    const { store } = makeStore()
    expect('close' in store).toBe(false)
  })
})
