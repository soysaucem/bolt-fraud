import type { FingerprintStore } from '../model/types.js'

/**
 * In-memory fingerprint store. Suitable for development and testing.
 * Replace with Redis adapter for production use.
 */
export class MemoryStore implements FingerprintStore {
  private readonly _ipSets = new Map<string, Set<string>>()

  async saveFingerprint(fingerprintHash: string, ip: string): Promise<void> {
    const existing = this._ipSets.get(fingerprintHash)
    if (existing) {
      existing.add(ip)
    } else {
      this._ipSets.set(fingerprintHash, new Set([ip]))
    }
  }

  async getIPCount(fingerprintHash: string): Promise<number> {
    return this._ipSets.get(fingerprintHash)?.size ?? 0
  }

  clear(): void {
    this._ipSets.clear()
  }
}
