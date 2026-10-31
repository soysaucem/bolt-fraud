import { createHash } from 'node:crypto'
import type { Token, Decision, FingerprintStore } from '../model/types.js'
import { scoreFingerprint } from './fingerprint.js'
import { scoreAutomation } from './automation.js'
import { scoreBehavior } from './behavior.js'

const DEFAULT_BLOCK_THRESHOLD = 70
const DEFAULT_CHALLENGE_THRESHOLD = 30
const DEFAULT_IP_COUNT_THRESHOLD = 100
const DEFAULT_MAX_TOKEN_AGE_MS = 30_000
/** Symmetric acceptance window around server time; also the base of the nonce claim TTL. */
const DEFAULT_MAX_TOKEN_ABSOLUTE_AGE_MS = 3_600_000
/** |age| beyond this (but inside the acceptance window) is treated as client clock skew. */
const CLOCK_SKEW_THRESHOLD_MS = 300_000
/**
 * Extra nonce lifetime. A token is accepted while |age| <= window, so one stamped up to
 * `window` in the future stays acceptable until `timestamp + window` (almost 2 * window after
 * the first claim); the claim therefore lives 2 * window + slack.
 */
const NONCE_TTL_SLACK_MS = 5_000

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
  /** Include the behavior scorer in the default scorer set. Default true. Ignored when `scorers` is given. */
  readonly behaviorScoring?: boolean
}

/**
 * Compute a stable fingerprint hash: first 32 hex chars of
 * sha256(`${canvas.hash}|${webgl.renderer}|${screen.width}x${screen.height}`).
 * Returns 'unknown' when both canvas hash and renderer are empty, so empty
 * fingerprints never share a store key.
 */
export function computeFingerprintHash(token: Token): string {
  const { canvas, webgl, screen } = token.fingerprint
  if (canvas.hash === '' && webgl.renderer === '') return 'unknown'
  return createHash('sha256')
    .update(`${canvas.hash}|${webgl.renderer}|${screen.width}x${screen.height}`)
    .digest('hex')
    .slice(0, 32)
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
    const age = Date.now() - token.timestamp
    const window = this._maxTokenAbsoluteAgeMs
    // Hard blocks outside the acceptance window: the nonce claim only lives as long
    // as the window, so a token older than that must never be accepted again.
    if (age > window) {
      return { score: 100, reasons: ['token_expired'], instantBlock: true }
    }
    if (age < -window) {
      return { score: 100, reasons: ['token_timestamp_future'], instantBlock: true }
    }
    // Inside the window: large offsets are probably client clock skew — score only.
    if (Math.abs(age) > CLOCK_SKEW_THRESHOLD_MS) {
      return { score: 10, reasons: ['token_clock_skew'] }
    }
    if (age > this._maxTokenAgeMs) {
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
      ...(config.behaviorScoring === false ? [] : [new BehaviorScorer()]),
      new TokenAgeScorer(this._maxTokenAgeMs, this._maxTokenAbsoluteAgeMs),
      new IPReputationScorer(this._ipCountThreshold),
    ]
  }

  async score(token: Token, clientIP?: string): Promise<Decision> {
    // Nonce replay protection — atomic claim before any other scoring. The TTL covers the whole
    // symmetric acceptance window (future-dated tokens included), so a nonce can never expire
    // while its token is still accepted.
    if (this._store?.claimNonce) {
      const claimed = await this._store.claimNonce(
        token.nonce,
        this._maxTokenAbsoluteAgeMs * 2 + NONCE_TTL_SLACK_MS,
      )
      if (!claimed) {
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
        return { decision: 'block', score: 100, instantBlock: true, reasons: [...result.reasons] }
      }
      totalScore += result.score
      allReasons.push(...result.reasons)
    }

    if (clientIP && this._store) {
      await this._store.saveFingerprint(computeFingerprintHash(token), clientIP)
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
