/**
 * RedisStore — Redis-backed FingerprintStore implementation.
 *
 * Uses Redis Sets for fingerprint→IP mapping (with sliding TTL) and
 * Redis STRING with EX for nonce deduplication.
 *
 * ioredis is an optional peerDependency and is never imported by this package:
 * pass your own ioredis-compatible client instance.
 *
 * Key layout:
 *   bf:fp:<fingerprintHash>   — Redis Set of IP addresses
 *   bf:nonce:<nonce>          — Redis String (value "1") with EX
 *
 * Usage:
 *   import { RedisStore } from '@soysaucem/bolt-fraud-server'
 *   import Redis from 'ioredis'
 *
 *   const redis = new Redis({ host: 'localhost', port: 6379 })
 *   const store = new RedisStore(redis)
 */

import type { FingerprintStore } from '../model/types.js'

// ─── Minimal ioredis interface ────────────────────────────────────────────────
//
// We define only the subset of commands RedisStore needs. This keeps the type
// safe while avoiding a hard import of ioredis types at build time.

interface RedisPipeline {
  sadd(key: string, member: string): RedisPipeline
  expire(key: string, seconds: number): RedisPipeline
  scard(key: string): RedisPipeline
  exec(): Promise<Array<[Error | null, unknown]> | null>
}

interface RedisClient {
  scard(key: string): Promise<number>
  srem(key: string, member: string): Promise<number>
  set(key: string, value: string, pxFlag: 'PX', ms: number, nxFlag: 'NX'): Promise<'OK' | null>
  multi(): RedisPipeline
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface RedisStoreOptions {
  /**
   * TTL for fingerprint Sets in milliseconds. Refreshed on every saveFingerprint
   * call (sliding window). Default: 86_400_000 (24 hours).
   */
  readonly fingerprintTtlMs?: number

  /**
   * Maximum number of unique IPs tracked per fingerprint hash.
   * When the Set reaches this size, SADD is skipped (TTL still refreshes).
   * Default: 10_000.
   */
  readonly ipSetCap?: number

  /**
   * Key namespace prefix. Must end with a colon if you want dot-notation style.
   * Default: 'bf:'.
   */
  readonly keyPrefix?: string
}

const DEFAULT_FINGERPRINT_TTL_MS = 86_400_000 // 24 hours
const DEFAULT_IP_SET_CAP = 10_000
const DEFAULT_KEY_PREFIX = 'bf:'

// ─── RedisStore ───────────────────────────────────────────────────────────────

/**
 * Redis-backed implementation of FingerprintStore.
 *
 * Pass an existing ioredis-compatible client: `new RedisStore(redisClient)`.
 * RedisStore borrows the connection and never closes it; the caller owns its lifecycle.
 */
export class RedisStore implements FingerprintStore {
  private readonly _redis: RedisClient
  private readonly _fingerprintTtlSeconds: number
  private readonly _ipSetCap: number
  private readonly _fpPrefix: string   // e.g. "bf:fp:"
  private readonly _noncePrefix: string // e.g. "bf:nonce:"

  constructor(redis: RedisClient, options?: RedisStoreOptions) {
    const fingerprintTtlMs = options?.fingerprintTtlMs ?? DEFAULT_FINGERPRINT_TTL_MS
    this._fingerprintTtlSeconds = Math.max(1, Math.ceil(fingerprintTtlMs / 1000))
    this._ipSetCap = options?.ipSetCap ?? DEFAULT_IP_SET_CAP
    const prefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX
    this._fpPrefix = `${prefix}fp:`
    this._noncePrefix = `${prefix}nonce:`
    this._redis = redis
  }

  /**
   * Record that `ip` was seen presenting `fingerprintHash`.
   *
   * One MULTI round trip: SADD, EXPIRE (sliding TTL), SCARD. If SCARD reports the Set
   * above `ipSetCap`, the member just added is removed again (rare, extra round trip).
   */
  async saveFingerprint(fingerprintHash: string, ip: string): Promise<void> {
    const key = `${this._fpPrefix}${fingerprintHash}`
    const results = await this._redis
      .multi()
      .sadd(key, ip)
      .expire(key, this._fingerprintTtlSeconds)
      .scard(key)
      .exec()
    const count = results?.[2]?.[1]
    if (typeof count === 'number' && count > this._ipSetCap) {
      await this._redis.srem(key, ip)
    }
  }

  /**
   * Return the number of distinct IPs that have presented `fingerprintHash`.
   * Returns 0 for unknown or expired fingerprints.
   */
  async getIPCount(fingerprintHash: string): Promise<number> {
    const key = `${this._fpPrefix}${fingerprintHash}`
    return this._redis.scard(key)
  }

  /**
   * Atomically claim `nonce` (`SET key 1 PX ttl NX`). Resolves true when this call
   * created the key, false when it already existed (replay).
   */
  async claimNonce(nonce: string, ttlMs: number): Promise<boolean> {
    const key = `${this._noncePrefix}${nonce}`
    const res = await this._redis.set(key, '1', 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX')
    return res === 'OK'
  }
}
