import type { FingerprintStore } from '../model/types.js'

const DEFAULT_MAX_ENTRIES = 10_000
const DEFAULT_TTL_MS = 86_400_000 // 24 hours
const MAX_IPS_PER_FINGERPRINT = 10_000
const MAX_NONCES = 100_000

interface StoreEntry {
  readonly ips: Set<string>
  lastSeenAt: number
}

export interface MemoryStoreOptions {
  readonly maxEntries?: number
  readonly ttlMs?: number
}

/**
 * In-memory fingerprint store. Suitable for development and testing.
 * Replace with Redis adapter for production use.
 *
 * Features:
 *   - maxEntries: evicts oldest entries when capacity is exceeded (default 10_000)
 *   - ttlMs: entries older than this are considered stale and excluded (default 24h)
 */
export class MemoryStore implements FingerprintStore {
  private readonly _entries = new Map<string, StoreEntry>()
  private readonly _seenNonces = new Map<string, number>()
  private readonly _maxEntries: number
  private readonly _ttlMs: number

  constructor(options?: MemoryStoreOptions) {
    this._maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this._ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  async saveFingerprint(fingerprintHash: string, ip: string): Promise<void> {
    const existing = this._entries.get(fingerprintHash)
    if (existing) {
      if (existing.ips.size < MAX_IPS_PER_FINGERPRINT) existing.ips.add(ip)
      existing.lastSeenAt = Date.now()
      // delete-then-set moves the key to the tail of the Map's insertion order,
      // so head eviction removes the least recently seen fingerprint
      this._entries.delete(fingerprintHash)
      this._entries.set(fingerprintHash, existing)
      return
    }

    if (this._entries.size >= this._maxEntries) {
      const oldestKey = this._entries.keys().next().value
      if (oldestKey !== undefined) {
        this._entries.delete(oldestKey)
      }
    }
    this._entries.set(fingerprintHash, { ips: new Set([ip]), lastSeenAt: Date.now() })
  }

  async getIPCount(fingerprintHash: string): Promise<number> {
    const entry = this._entries.get(fingerprintHash)
    if (!entry) return 0

    // Evict stale entries (TTL is sliding — based on lastSeenAt)
    if (entry.lastSeenAt + this._ttlMs < Date.now()) {
      this._entries.delete(fingerprintHash)
      return 0
    }

    return entry.ips.size
  }

  async claimNonce(nonce: string, ttlMs: number): Promise<boolean> {
    const now = Date.now()

    // Entries are in insertion order; evict only expired ones from the head (O(evicted)).
    for (const [key, expiry] of this._seenNonces) {
      if (expiry >= now) break
      this._seenNonces.delete(key)
    }

    const expiry = this._seenNonces.get(nonce)
    if (expiry !== undefined && expiry >= now) return false

    if (this._seenNonces.size >= MAX_NONCES) {
      const oldest = this._seenNonces.keys().next().value
      if (oldest !== undefined) this._seenNonces.delete(oldest)
    }
    this._seenNonces.delete(nonce)
    this._seenNonces.set(nonce, now + ttlMs)
    return true
  }

  async close(): Promise<void> {
    this._entries.clear()
    this._seenNonces.clear()
  }

  clear(): void {
    this._entries.clear()
    this._seenNonces.clear()
  }
}
