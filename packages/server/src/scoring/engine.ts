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
    const reasons: string[] = []
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
    const { score: automationScore, instantBlock } = scoreAutomation(
      token.detection,
      reasons,
    )

    if (instantBlock) {
      return {
        decision: 'block',
        score: 100,
        instantBlock: true,
        reasons,
      }
    }

    const fpScore = scoreFingerprint(token.fingerprint, reasons)
    const behaviorScore = scoreBehavior(token.behavior, reasons)

    // Token age: tokens older than 30s are suspect (replay attack or clock skew)
    let ageScore = 0
    if (now - token.timestamp > 30_000) {
      ageScore = 10
      reasons.push('token_too_old')
    }

    let ipScore = 0
    if (this._store && clientIP) {
      const ipCount = await this._store.getIPCount(token.fingerprint.canvas.hash)
      if (ipCount > 100) {
        ipScore = 5
        reasons.push(`fingerprint_seen_from_${ipCount}_ips`)
      }
    }

    const totalScore = automationScore + fpScore + behaviorScore + ageScore + ipScore
    const decision = this._classify(totalScore)

    return {
      decision,
      score: totalScore,
      instantBlock: false,
      reasons,
    }
  }

  private _classify(score: number): DecisionType {
    if (score > this._blockThreshold) return 'block'
    if (score >= this._challengeThreshold) return 'challenge'
    return 'allow'
  }
}
