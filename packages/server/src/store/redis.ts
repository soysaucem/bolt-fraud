/**
 * RedisStore — Redis-backed FingerprintStore implementation.
 *
 * Uses Redis Sets for fingerprint→IP mapping (with sliding TTL) and
 * Redis STRING with EX for nonce deduplication.
 *
 * ioredis is a peerDependency — never imported at the top level to keep
 * the server package zero-runtime-deps. Users must install ioredis themselves.
 *
 * Key layout:
 *   bf:fp:<fingerprintHash>   — Redis Set of IP addresses
 *   bf:nonce:<nonce>          — Redis String (value "1") with EX
 *
 * Usage:
 *   import { RedisStore } from '@bolt-fraud/server'
 *   import Redis from 'ioredis'
 *
 *   // Option A: pass a connection URL
 *   const store = new RedisStore('redis://localhost:6379')
 *
 *   // Option B: pass your own ioredis instance
 *   const redis = new Redis({ host: 'localhost', port: 6379 })
 *   const store = new RedisStore(redis)
 */

import type { FingerprintStore } from '../model/types.js'

// ─── Minimal ioredis interface ────────────────────────────────────────────────
//
// We define only the subset of commands RedisStore needs. This keeps the type
// safe while avoiding a hard import of ioredis types at build time.

interface RedisClient {
  scard(key: string): Promise<number>
  sadd(key: string, member: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  set(key: string, value: string, exFlag: 'EX', seconds: number): Promise<'OK' | null>
  get(key: string): Promise<string | null>
  quit(): Promise<'OK'>
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
 * Pass either:
 *   - A connection URL string: `new RedisStore('redis://localhost:6379')`
 *     (RedisStore owns the connection and will quit on close())
 *   - An existing ioredis instance: `new RedisStore(redisClient)`
 *     (RedisStore borrows the connection and will NOT quit on close())
 */
export class RedisStore implements FingerprintStore {
  private readonly _redis: RedisClient
  private readonly _ownConnection: boolean
  private readonly _fingerprintTtlSeconds: number
  private readonly _ipSetCap: number
  private readonly _fpPrefix: string   // e.g. "bf:fp:"
  private readonly _noncePrefix: string // e.g. "bf:nonce:"

  constructor(redisOrUrl: RedisClient | string, options?: RedisStoreOptions) {
    const fingerprintTtlMs = options?.fingerprintTtlMs ?? DEFAULT_FINGERPRINT_TTL_MS
    this._fingerprintTtlSeconds = Math.max(1, Math.ceil(fingerprintTtlMs / 1000))
    this._ipSetCap = options?.ipSetCap ?? DEFAULT_IP_SET_CAP
    const prefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX
    this._fpPrefix = `${prefix}fp:`
    this._noncePrefix = `${prefix}nonce:`

    if (typeof redisOrUrl === 'string') {
      // Dynamically require ioredis so the server package stays zero-runtime-deps
      // at import time. Users must have ioredis installed as a peer dep.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: Redis } = require('ioredis') as { default: new (url: string) => RedisClient }
      this._redis = new Redis(redisOrUrl)
      this._ownConnection = true
    } else {
      this._redis = redisOrUrl
      this._ownConnection = false
    }
  }

  /**
   * Record that `ip` was seen presenting `fingerprintHash`.
   *
   * - If the Set for `fingerprintHash` has not reached `ipSetCap`, adds `ip`.
   * - Always refreshes the Set's TTL (sliding window).
   */
  async saveFingerprint(fingerprintHash: string, ip: string): Promise<void> {
    const key = `${this._fpPrefix}${fingerprintHash}`

    // Check current cardinality BEFORE adding — avoids unbounded growth
    const count = await this._redis.scard(key)

    if (count < this._ipSetCap) {
      await this._redis.sadd(key, ip)
    }
    // Always refresh the TTL so active fingerprints don't expire mid-session
    await this._redis.expire(key, this._fingerprintTtlSeconds)
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
   * Returns true if `nonce` has been seen before (i.e. the key exists in Redis).
   * Used to prevent token replay attacks.
   */
  async hasSeenNonce(nonce: string): Promise<boolean> {
    const key = `${this._noncePrefix}${nonce}`
    const value = await this._redis.get(key)
    return value !== null
  }

  /**
   * Persist `nonce` with an expiry of `ttlMs` milliseconds.
   * TTL is rounded up to the nearest second (minimum 1s) because Redis EX is
   * an integer.
   */
  async saveNonce(nonce: string, ttlMs: number): Promise<void> {
    const key = `${this._noncePrefix}${nonce}`
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))
    await this._redis.set(key, '1', 'EX', ttlSeconds)
  }

  /**
   * Close the Redis connection.
   * Only calls `redis.quit()` if RedisStore owns the connection (created from a
   * URL string). If the caller passed their own ioredis instance, they are
   * responsible for closing it.
   */
  async close(): Promise<void> {
    if (this._ownConnection) {
      await this._redis.quit()
    }
  }
}
