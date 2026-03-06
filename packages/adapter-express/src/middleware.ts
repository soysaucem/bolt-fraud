import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { createBoltFraud, type BoltFraudServerConfig, type Decision } from '@soysaucem/bolt-fraud-server'
import './types.js'

const MAX_TOKEN_LENGTH = 65_536 // 64 KB base64 encoded

export interface BoltFraudExpressConfig extends BoltFraudServerConfig {
  /** Header name to read the encrypted token from. Default: 'x-client-data' */
  readonly tokenHeader?: string
  /** Custom handler invoked when decision is 'block'. If omitted, responds 403. */
  readonly onBlock?: (req: Request, res: Response, decision: Decision) => void
  /** Custom handler invoked when decision is 'challenge'. If omitted, calls next(). */
  readonly onChallenge?: (req: Request, res: Response, decision: Decision) => void
}

/**
 * Express middleware factory for bolt-fraud anti-bot verification.
 *
 * Creates a single BoltFraud instance at init time and reuses it for all
 * subsequent requests.
 *
 * Usage:
 *   app.use(boltFraudMiddleware({ privateKeyPem, publicKeyPem }))
 *
 * The verified Decision is attached to req.boltFraudDecision for downstream
 * handlers.
 */
export function boltFraudMiddleware(config: BoltFraudExpressConfig): RequestHandler {
  const tokenHeader = config.tokenHeader ?? 'x-client-data'
  const bf = createBoltFraud(config)

  return async function boltFraudHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const rawToken = req.headers[tokenHeader]
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken

    if (!token) {
      res.status(403).json({ error: 'missing_token' })
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
    } catch {
      res.status(403).json({ error: 'verification_error' })
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
  }
}
