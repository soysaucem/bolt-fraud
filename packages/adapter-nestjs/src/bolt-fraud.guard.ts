import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { BoltFraud, Decision } from '@soysaucem/bolt-fraud-server'
import { BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BOLT_FRAUD_GUARD_OPTIONS } from './tokens.js'

const MAX_TOKEN_LENGTH = 65_536 // 64KB base64 encoded

export interface BoltFraudGuardOptions {
  /** What to do when the request carries no token. Default: 'allow' (decision reason 'missing_token'). */
  readonly missingToken?: 'allow' | 'block'
  /**
   * What to do when verify() itself rejects (store outage, bug). Default: true — the error is
   * reported to onError and the request is allowed with reason 'verification_error'.
   * When false the request is rejected with 403.
   */
  readonly failOpen?: boolean
  /** Called with errors thrown by verify(). */
  readonly onError?: (err: unknown) => void
}

@Injectable()
export class BoltFraudGuard implements CanActivate {
  constructor(
    @Inject(BOLT_FRAUD_INSTANCE)
    private readonly boltFraud: BoltFraud,
    @Inject(BOLT_FRAUD_TOKEN_HEADER)
    private readonly tokenHeader: string,
    @Inject(BOLT_FRAUD_GUARD_OPTIONS)
    private readonly options: BoltFraudGuardOptions = {},
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token = request.headers[this.tokenHeader]

    if (!token || typeof token !== 'string') {
      if (this.options.missingToken === 'block') {
        throw new HttpException(
          { decision: 'block', reason: 'missing_token' },
          HttpStatus.FORBIDDEN,
        )
      }
      request.boltFraudDecision = {
        decision: 'allow' as const,
        score: 0,
        instantBlock: false,
        reasons: ['missing_token'],
      }
      return true
    }

    if (token.length > MAX_TOKEN_LENGTH) {
      throw new HttpException(
        { decision: 'block', reason: 'token_too_large' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const clientIP = request.ip ?? request.socket?.remoteAddress

    let decision: Decision
    try {
      decision = await this.boltFraud.verify(token, clientIP)
    } catch (err) {
      this.options.onError?.(err)
      if (this.options.failOpen === false) {
        throw new HttpException(
          { decision: 'block', reason: 'verification_error' },
          HttpStatus.FORBIDDEN,
        )
      }
      request.boltFraudDecision = {
        decision: 'allow' as const,
        score: 0,
        instantBlock: false,
        reasons: ['verification_error'],
      }
      return true
    }

    if (decision.decision === 'block') {
      throw new HttpException(
        { decision: 'block', reason: 'request_blocked' },
        HttpStatus.FORBIDDEN,
      )
    }

    // Attach decision to request for downstream use via @BoltFraudDecision()
    request.boltFraudDecision = decision
    return true
  }
}
