import type { FingerprintStore } from '../model/types.js'

const DEFAULT_MAX_ENTRIES = 10_000
const DEFAULT_TTL_MS = 86_400_000 // 24 hours

interface StoreEntry {
  readonly ips: Set<string>
  readonly createdAt: number
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
  private readonly _maxEntries: number
  private readonly _ttlMs: number

  constructor(options?: MemoryStoreOptions) {
    this._maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this._ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  async saveFingerprint(fingerprintHash: string, ip: string): Promise<void> {
    const existing = this._entries.get(fingerprintHash)
    if (existing) {
      existing.ips.add(ip)
    } else {
      // Evict oldest entry if at capacity
      if (this._entries.size >= this._maxEntries) {
        const oldestKey = this._entries.keys().next().value
        if (oldestKey !== undefined) {
          this._entries.delete(oldestKey)
        }
      }
      this._entries.set(fingerprintHash, {
        ips: new Set([ip]),
        createdAt: Date.now(),
      })
    }
  }

  async getIPCount(fingerprintHash: string): Promise<number> {
    const entry = this._entries.get(fingerprintHash)
    if (!entry) return 0

    // Evict stale entries
    if (entry.createdAt + this._ttlMs < Date.now()) {
      this._entries.delete(fingerprintHash)
      return 0
    }

    return entry.ips.size
  }

  clear(): void {
    this._entries.clear()
  }
}
