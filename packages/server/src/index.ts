/**
 * @bolt-fraud/server — Framework-agnostic anti-bot verification.
 *
 * Usage:
 *   import { createBoltFraud } from '@bolt-fraud/server'
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
  DecisionType,
  Token,
  Fingerprint,
  FingerprintStore,
} from './model/types.js'

export { RiskEngine } from './scoring/engine.js'
export { KeyManager, generateKeyPair, generateKeyPairAsync } from './crypto/keys.js'
export { MemoryStore } from './store/memory.js'
export { decryptToken, decryptTokenDev, base64urlDecode } from './crypto/decrypt.js'
export { computeKeystrokeUniformity, computeMouseEntropy } from './scoring/behavior.js'

export interface BoltFraud {
  verify(encryptedToken: string, clientIP?: string): Promise<Decision>
  getPublicKey(): string
}

export function createBoltFraud(config: BoltFraudServerConfig = {}): BoltFraud {
  // Validate: both keys must be provided together, or neither
  if ((config.privateKeyPem && !config.publicKeyPem) || (!config.privateKeyPem && config.publicKeyPem)) {
    throw new Error('createBoltFraud: both privateKeyPem and publicKeyPem must be provided together')
  }

  const keyManager = new KeyManager()

  if (config.privateKeyPem && config.publicKeyPem) {
    keyManager.loadFromStrings(config.publicKeyPem, config.privateKeyPem)
  }

  const store = config.store ?? new MemoryStore()
  const engine = new RiskEngine({
    blockThreshold: config.blockThreshold,
    challengeThreshold: config.challengeThreshold,
    store,
  })

  return {
    async verify(encryptedToken: string, clientIP?: string): Promise<Decision> {
      let token: Token
      try {
        token = decryptToken(encryptedToken, keyManager.privateKey)
      } catch (error) {
        return {
          decision: 'block',
          score: 100,
          instantBlock: true,
          reasons: ['token_decryption_failed'],
        }
      }

      // Compute a stable fingerprint hash — never use empty string as key
      // to avoid conflating all clients with blocked canvas APIs
      const fpHash =
        token.fingerprint.canvas.hash ||
        token.fingerprint.webgl.hash ||
        token.fingerprint.audio.hash ||
        'unknown'

      // Save fingerprint for IP tracking
      if (clientIP) {
        await store.saveFingerprint(fpHash, clientIP)
      }

      return engine.score(token, clientIP)
    },

    getPublicKey(): string {
      return keyManager.publicKey
    },
  }
}
