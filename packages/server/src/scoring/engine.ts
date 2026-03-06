import type { Token, Decision, DecisionType, FingerprintStore } from '../model/types.js'
import { scoreFingerprint } from './fingerprint.js'
import { scoreAutomation } from './automation.js'
import { scoreBehavior } from './behavior.js'

const DEFAULT_BLOCK_THRESHOLD = 70
const DEFAULT_CHALLENGE_THRESHOLD = 30
const DEFAULT_IP_COUNT_THRESHOLD = 100
const DEFAULT_MAX_TOKEN_AGE_MS = 30_000
const DEFAULT_MAX_TOKEN_ABSOLUTE_AGE_MS = 300_000

export interface RiskEngineConfig {
  readonly blockThreshold?: number
  readonly challengeThreshold?: number
  readonly store?: FingerprintStore
  readonly ipCountThreshold?: number
  readonly maxTokenAgeMs?: number
  readonly maxTokenAbsoluteAgeMs?: number
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

export class RiskEngine {
  private readonly _blockThreshold: number
  private readonly _challengeThreshold: number
  private readonly _store: FingerprintStore | null
  private readonly _ipCountThreshold: number
  private readonly _maxTokenAgeMs: number
  private readonly _maxTokenAbsoluteAgeMs: number

  constructor(config: RiskEngineConfig = {}) {
    this._blockThreshold = config.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD
    this._challengeThreshold = config.challengeThreshold ?? DEFAULT_CHALLENGE_THRESHOLD
    this._store = config.store ?? null
    this._ipCountThreshold = config.ipCountThreshold ?? DEFAULT_IP_COUNT_THRESHOLD
    this._maxTokenAgeMs = config.maxTokenAgeMs ?? DEFAULT_MAX_TOKEN_AGE_MS
    this._maxTokenAbsoluteAgeMs = config.maxTokenAbsoluteAgeMs ?? DEFAULT_MAX_TOKEN_ABSOLUTE_AGE_MS
  }

  async score(token: Token, clientIP?: string): Promise<Decision> {
    const now = Date.now()

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

    // Token timestamp from the future — clocks don't run backwards; instant block
    if (token.timestamp > now + 5000) {
      return {
        decision: 'block',
        score: 100,
        instantBlock: true,
        reasons: ['token_timestamp_future'],
      }
    }

    // Hard absolute expiry — token too old to be legitimate
    if (now - token.timestamp > this._maxTokenAbsoluteAgeMs) {
      return {
        decision: 'block',
        score: 100,
        instantBlock: true,
        reasons: ['token_expired'],
      }
    }

    // Check instant-block signals first
    const { score: automationScore, instantBlock, reasons: automationReasons } = scoreAutomation(token.detection)

    if (instantBlock) {
      return {
        decision: 'block',
        score: 100,
        instantBlock: true,
        reasons: automationReasons,
      }
    }

    const { score: fpScore, reasons: fpReasons } = scoreFingerprint(token.fingerprint)
    const { score: behaviorScore, reasons: behaviorReasons } = scoreBehavior(token.behavior)

    // Token age: tokens older than configured threshold are suspect (replay attack or clock skew)
    let ageScore = 0
    const ageReasons: string[] = []
    if (now - token.timestamp > this._maxTokenAgeMs) {
      ageScore = 10
      ageReasons.push('token_too_old')
    }

    let ipScore = 0
    const ipReasons: string[] = []
    if (this._store && clientIP) {
      const fpHash = computeFingerprintHash(token)
      const ipCount = await this._store.getIPCount(fpHash)
      if (ipCount > this._ipCountThreshold) {
        ipScore = 5
        ipReasons.push('fingerprint_ip_abuse')
      }
    }

    const totalScore = automationScore + fpScore + behaviorScore + ageScore + ipScore
    const decision = this._classify(totalScore)

    const allReasons = [
      ...automationReasons,
      ...fpReasons,
      ...behaviorReasons,
      ...ageReasons,
      ...ipReasons,
    ]

    // Save nonce after scoring to prevent replay
    if (this._store?.saveNonce) {
      await this._store.saveNonce(token.nonce, 60_000)
    }

    return {
      decision,
      score: totalScore,
      instantBlock: false,
      reasons: allReasons,
    }
  }

  private _classify(score: number): DecisionType {
    if (score > this._blockThreshold) return 'block'
    if (score >= this._challengeThreshold) return 'challenge'
    return 'allow'
  }
}
