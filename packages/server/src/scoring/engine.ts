import type { Token, Decision, FingerprintStore } from '../model/types.js'
import { scoreFingerprint } from './fingerprint.js'
import { scoreAutomation } from './automation.js'
import { scoreBehavior } from './behavior.js'

const DEFAULT_BLOCK_THRESHOLD = 70
const DEFAULT_CHALLENGE_THRESHOLD = 30
const DEFAULT_IP_COUNT_THRESHOLD = 100
const DEFAULT_MAX_TOKEN_AGE_MS = 30_000
const DEFAULT_MAX_TOKEN_ABSOLUTE_AGE_MS = 300_000

export interface ScorerResult {
  readonly score: number
  readonly reasons: readonly string[]
  readonly instantBlock?: boolean
}

export interface ScoringContext {
  readonly clientIP?: string
  readonly store?: FingerprintStore
}

export interface Scorer {
  readonly name: string
  score(token: Token, context: ScoringContext): ScorerResult | Promise<ScorerResult>
}

export interface RiskEngineConfig {
  readonly blockThreshold?: number
  readonly challengeThreshold?: number
  readonly store?: FingerprintStore
  readonly ipCountThreshold?: number
  readonly maxTokenAgeMs?: number
  readonly maxTokenAbsoluteAgeMs?: number
  readonly scorers?: readonly Scorer[]
}

/**
 * Compute a stable fingerprint hash from available canvas/webgl/audio hashes.
 * Avoids using empty string as a store key (which would conflate all blocked-canvas clients).
 */
export function computeFingerprintHash(token: Token): string {
  return (
    token.fingerprint.canvas.hash ||
    token.fingerprint.webgl.hash ||
    token.fingerprint.audio.hash ||
    'unknown'
  )
}

class AutomationScorer implements Scorer {
  readonly name = 'automation'
  score(token: Token): ScorerResult {
    const result = scoreAutomation(token.detection)
    return { score: result.score, reasons: [...result.reasons], instantBlock: result.instantBlock }
  }
}

class FingerprintScorer implements Scorer {
  readonly name = 'fingerprint'
  score(token: Token): ScorerResult {
    return scoreFingerprint(token.fingerprint)
  }
}

class BehaviorScorer implements Scorer {
  readonly name = 'behavior'
  score(token: Token): ScorerResult {
    return scoreBehavior(token.behavior)
  }
}

class TokenAgeScorer implements Scorer {
  private readonly _maxTokenAgeMs: number
  private readonly _maxTokenAbsoluteAgeMs: number

  constructor(maxTokenAgeMs: number, maxTokenAbsoluteAgeMs: number) {
    this._maxTokenAgeMs = maxTokenAgeMs
    this._maxTokenAbsoluteAgeMs = maxTokenAbsoluteAgeMs
  }

  readonly name = 'token_age'
  score(token: Token): ScorerResult {
    const now = Date.now()
    if (token.timestamp > now + 5000) {
      return { score: 100, reasons: ['token_timestamp_future'], instantBlock: true }
    }
    if (now - token.timestamp > this._maxTokenAbsoluteAgeMs) {
      return { score: 100, reasons: ['token_expired'], instantBlock: true }
    }
    if (now - token.timestamp > this._maxTokenAgeMs) {
      return { score: 10, reasons: ['token_too_old'] }
    }
    return { score: 0, reasons: [] }
  }
}

class IPReputationScorer implements Scorer {
  private readonly _ipCountThreshold: number

  constructor(ipCountThreshold: number) {
    this._ipCountThreshold = ipCountThreshold
  }

  readonly name = 'ip_reputation'
  async score(token: Token, context: ScoringContext): Promise<ScorerResult> {
    if (!context.clientIP || !context.store) return { score: 0, reasons: [] }
    const fpHash = computeFingerprintHash(token)
    const ipCount = await context.store.getIPCount(fpHash)
    if (ipCount > this._ipCountThreshold) {
      return { score: 5, reasons: ['fingerprint_ip_abuse'] }
    }
    return { score: 0, reasons: [] }
  }
}

export { AutomationScorer, FingerprintScorer, BehaviorScorer, TokenAgeScorer, IPReputationScorer }

export class RiskEngine {
  private readonly _blockThreshold: number
  private readonly _challengeThreshold: number
  private readonly _store: FingerprintStore | null
  private readonly _ipCountThreshold: number
  private readonly _maxTokenAgeMs: number
  private readonly _maxTokenAbsoluteAgeMs: number
  private readonly _scorers: readonly Scorer[]

  constructor(config: RiskEngineConfig = {}) {
    this._blockThreshold = config.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD
    this._challengeThreshold = config.challengeThreshold ?? DEFAULT_CHALLENGE_THRESHOLD
    this._store = config.store ?? null
    this._ipCountThreshold = config.ipCountThreshold ?? DEFAULT_IP_COUNT_THRESHOLD
    this._maxTokenAgeMs = config.maxTokenAgeMs ?? DEFAULT_MAX_TOKEN_AGE_MS
    this._maxTokenAbsoluteAgeMs = config.maxTokenAbsoluteAgeMs ?? DEFAULT_MAX_TOKEN_ABSOLUTE_AGE_MS
    this._scorers = config.scorers ?? [
      new AutomationScorer(),
      new FingerprintScorer(),
      new BehaviorScorer(),
      new TokenAgeScorer(this._maxTokenAgeMs, this._maxTokenAbsoluteAgeMs),
      new IPReputationScorer(this._ipCountThreshold),
    ]
  }

  async score(token: Token, clientIP?: string): Promise<Decision> {
    // Nonce replay protection — check before any other scoring
    if (this._store?.hasSeenNonce) {
      const replayed = await this._store.hasSeenNonce(token.nonce)
      if (replayed) {
        return {
          decision: 'block',
          score: 100,
          instantBlock: true,
          reasons: ['token_nonce_replayed'],
        }
      }
    }

    const context: ScoringContext = { clientIP, store: this._store ?? undefined }
    let totalScore = 0
    const allReasons: string[] = []

    for (const scorer of this._scorers) {
      const result = await scorer.score(token, context)
      if (result.instantBlock) {
        // Short-circuit on instant block — save nonce then return immediately
        if (this._store?.saveNonce) {
          await this._store.saveNonce(token.nonce, 60_000)
        }
        return { decision: 'block', score: 100, instantBlock: true, reasons: [...result.reasons] }
      }
      totalScore += result.score
      allReasons.push(...result.reasons)
    }

    // Save fingerprint + nonce after scoring
    if (clientIP && this._store) {
      const fpHash = computeFingerprintHash(token)
      await this._store.saveFingerprint(fpHash, clientIP)
    }
    if (this._store?.saveNonce) {
      await this._store.saveNonce(token.nonce, 60_000)
    }

    if (totalScore >= this._blockThreshold) {
      return { decision: 'block', score: totalScore, instantBlock: false, reasons: allReasons }
    }
    if (totalScore >= this._challengeThreshold) {
      return { decision: 'challenge', score: totalScore, instantBlock: false, reasons: allReasons }
    }
    return { decision: 'allow', score: totalScore, instantBlock: false, reasons: allReasons }
  }

}
