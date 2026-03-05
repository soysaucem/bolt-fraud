import type { Token, Decision, DecisionType, FingerprintStore } from '../model/types.js'
import { scoreFingerprint } from './fingerprint.js'
import { scoreAutomation } from './automation.js'
import { scoreBehavior } from './behavior.js'

const DEFAULT_BLOCK_THRESHOLD = 70
const DEFAULT_CHALLENGE_THRESHOLD = 30

export interface RiskEngineConfig {
  readonly blockThreshold?: number
  readonly challengeThreshold?: number
  readonly store?: FingerprintStore
}

/**
 * Compute a stable fingerprint hash from available canvas/webgl/audio hashes.
 * Avoids using empty string as a store key (which would conflate all blocked-canvas clients).
 */
function computeFingerprintHash(token: Token): string {
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

  constructor(config: RiskEngineConfig = {}) {
    this._blockThreshold = config.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD
    this._challengeThreshold = config.challengeThreshold ?? DEFAULT_CHALLENGE_THRESHOLD
    this._store = config.store ?? null
  }

  async score(token: Token, clientIP?: string): Promise<Decision> {
    const now = Date.now()

    // Token timestamp from the future — clocks don't run backwards; instant block
    if (token.timestamp > now + 5000) {
      return {
        decision: 'block',
        score: 100,
        instantBlock: true,
        reasons: ['token_timestamp_future'],
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

    // Token age: tokens older than 30s are suspect (replay attack or clock skew)
    let ageScore = 0
    const ageReasons: string[] = []
    if (now - token.timestamp > 30_000) {
      ageScore = 10
      ageReasons.push('token_too_old')
    }

    let ipScore = 0
    const ipReasons: string[] = []
    if (this._store && clientIP) {
      const fpHash = computeFingerprintHash(token)
      const ipCount = await this._store.getIPCount(fpHash)
      if (ipCount > 100) {
        ipScore = 5
        ipReasons.push(`fingerprint_seen_from_${ipCount}_ips`)
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
