import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { createBoltFraud, type BoltFraudServerConfig, type Decision } from '@soysaucem/bolt-fraud-server'
import './types.js'

const MAX_TOKEN_LENGTH = 65_536 // 64 KB base64 encoded

export interface BoltFraudExpressConfig extends BoltFraudServerConfig {
  /** Header name to read the encrypted token from. Matched case-insensitively. Default: 'x-client-data' */
  readonly tokenHeader?: string
  /** What to do when the request carries no token. Default: 'allow' (decision reason 'missing_token'). */
  readonly missingToken?: 'allow' | 'block'
  /**
   * What to do when verify() itself rejects (store outage, bug). Default: true — the error is
   * reported to `onError` and the request continues with reason 'verification_error'.
   * When false the request is rejected with 403.
   */
  readonly failOpen?: boolean
  /** Custom handler invoked when decision is 'block'. If omitted, responds 403. */
  readonly onBlock?: (req: Request, res: Response, decision: Decision) => void
  /** Custom handler invoked when decision is 'challenge'. If omitted, calls next(). */
  readonly onChallenge?: (req: Request, res: Response, decision: Decision) => void
}

/**
 * Express middleware factory for bolt-fraud anti-bot verification.
 *
 * Creates a single BoltFraud instance at init time and reuses it for all
 * subsequent requests. Errors thrown by `onBlock` / `onChallenge` are forwarded to `next(err)`.
 *
 * Usage:
 *   app.use(boltFraudMiddleware({ privateKeyPem, publicKeyPem }))
 *
 * The verified Decision is attached to req.boltFraudDecision for downstream
 * handlers.
 */
export function boltFraudMiddleware(config: BoltFraudExpressConfig): RequestHandler {
  // Node lower-cases incoming header names, so the configured name must be lower-cased too
  const tokenHeader = (config.tokenHeader ?? 'x-client-data').toLowerCase()
  const bf = createBoltFraud(config)

  return async function boltFraudHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const rawToken = req.headers[tokenHeader]
      const token = Array.isArray(rawToken) ? rawToken[0] : rawToken

      if (!token) {
        if (config.missingToken === 'block') {
          res.status(403).json({ error: 'missing_token' })
          return
        }
        req.boltFraudDecision = {
          decision: 'allow',
          score: 0,
          instantBlock: false,
          reasons: ['missing_token'],
        }
        next()
        return
      }

      if (token.length > MAX_TOKEN_LENGTH) {
        res.status(400).json({ error: 'token_too_large' })
        return
      }

      const clientIP = req.ip ?? req.socket?.remoteAddress

      let decision: Decision
      try {
        decision = await bf.verify(token, clientIP)
      } catch (err) {
        config.onError?.(err)
        if (config.failOpen === false) {
          res.status(403).json({ error: 'verification_error' })
          return
        }
        req.boltFraudDecision = {
          decision: 'allow',
          score: 0,
          instantBlock: false,
          reasons: ['verification_error'],
        }
        next()
        return
      }

      if (decision.decision === 'block') {
        if (config.onBlock) {
          config.onBlock(req, res, decision)
        } else {
          res.status(403).json({ error: 'blocked', decision: 'block' })
        }
        return
      }

      // Attach decision for downstream handlers before calling next/onChallenge
      req.boltFraudDecision = decision

      if (decision.decision === 'challenge' && config.onChallenge) {
        config.onChallenge(req, res, decision)
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}
