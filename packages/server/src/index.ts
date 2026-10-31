/**
 * @soysaucem/bolt-fraud-server — Framework-agnostic anti-bot verification.
 *
 * Usage:
 *   import { createBoltFraud } from '@soysaucem/bolt-fraud-server'
 *
 *   const bf = createBoltFraud({
 *     privateKeyPem: fs.readFileSync('keys/private.pem', 'utf-8'),
 *     publicKeyPem: fs.readFileSync('keys/public.pem', 'utf-8'),
 *   })
 *
 *   // In your request handler:
 *   const decision = await bf.verify(tokenHeader, clientIP)
 *   if (decision.decision === 'block') { ... }
 */

import type {
  BoltFraudServerConfig,
  Decision,
  Token,
} from './model/types.js'
import { RiskEngine } from './scoring/engine.js'
import { decryptToken, decryptTokenDev } from './crypto/decrypt.js'
import { KeyManager } from './crypto/keys.js'
import { MemoryStore } from './store/memory.js'

export type {
  BoltFraudServerConfig,
  Decision,
  ClientSafeDecision,
  DecisionType,
  Token,
  Fingerprint,
  FingerprintStore,
  DetectionData,
  BehaviorData,
  AutomationSignal,
  IntegrityViolation,
  BfMouseEvent,
  BfKeyboardEvent,
  BfScrollEvent,
} from './model/types.js'
export { toClientSafeDecision } from './model/types.js'

export { RiskEngine, computeFingerprintHash, AutomationScorer, FingerprintScorer, BehaviorScorer, TokenAgeScorer, IPReputationScorer } from './scoring/engine.js'
export type { Scorer, ScorerResult, ScoringContext, RiskEngineConfig } from './scoring/engine.js'
export { KeyManager, generateKeyPairSync, generateKeyPairAsync } from './crypto/keys.js'
export type { KeyPair } from './crypto/keys.js'
export { MemoryStore } from './store/memory.js'
export type { MemoryStoreOptions } from './store/memory.js'
export { RedisStore } from './store/redis.js'
export type { RedisStoreOptions } from './store/redis.js'
export { decryptToken, decryptTokenDev, base64urlDecode } from './crypto/decrypt.js'
export { computeKeystrokeUniformity, computeMouseEntropy } from './scoring/behavior.js'

export interface BoltFraud {
  verify(encryptedToken: string, clientIP?: string): Promise<Decision>
  getPublicKey(): string
}

export function createBoltFraud(config: BoltFraudServerConfig = {}): BoltFraud {
  const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'

  if (config.devMode && isProduction) {
    throw new Error('createBoltFraud: devMode must not be enabled when NODE_ENV=production')
  }

  // Validate: both keys must be provided together, or neither
  if ((config.privateKeyPem && !config.publicKeyPem) || (!config.privateKeyPem && config.publicKeyPem)) {
    throw new Error('createBoltFraud: both privateKeyPem and publicKeyPem must be provided together')
  }

  if (!config.privateKeyPem && !config.devMode && isProduction) {
    throw new Error('createBoltFraud: privateKeyPem is required in production (NODE_ENV=production)')
  }

  const keyManager = new KeyManager()

  if (config.privateKeyPem && config.publicKeyPem) {
    keyManager.loadFromStrings(config.publicKeyPem, config.privateKeyPem)
  }

  if (config.additionalKeys) {
    for (const key of config.additionalKeys) {
      keyManager.addKeyPair(key.keyId, key.publicKeyPem, key.privateKeyPem)
    }
  }

  if (config.defaultKeyId !== undefined) {
    keyManager.setDefaultKeyId(config.defaultKeyId)
  }

  const store = config.store ?? new MemoryStore()

  const engine = new RiskEngine({
    blockThreshold: config.blockThreshold,
    challengeThreshold: config.challengeThreshold,
    ipCountThreshold: config.ipCountThreshold,
    maxTokenAgeMs: config.maxTokenAgeMs,
    maxTokenAbsoluteAgeMs: config.maxTokenAbsoluteAgeMs,
    store,
    scorers: config.scorers,
    behaviorScoring: config.behaviorScoring,
  })

  return {
    async verify(encryptedToken: string, clientIP?: string): Promise<Decision> {
      let token: Token
      try {
        token = config.devMode
          ? decryptTokenDev(encryptedToken)
          : decryptToken(encryptedToken, (keyId) => keyManager.getPrivateKeyObject(keyId))
      } catch (error) {
        config.onError?.(error)
        const err = error as { code?: unknown; name?: unknown }
        const label = typeof err?.code === 'string' ? err.code : typeof err?.name === 'string' ? err.name : 'Error'
        return {
          decision: 'block',
          score: 100,
          instantBlock: true,
          reasons: [`token_decryption_failed:${label}`],
        }
      }

      return engine.score(token, clientIP)
    },

    getPublicKey(): string {
      return keyManager.getPublicKey()
    },
  }
}
