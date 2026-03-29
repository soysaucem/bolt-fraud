import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { BoltFraud, Decision } from '@soysaucem/bolt-fraud-server'
import { BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER } from './tokens.js'

const MAX_TOKEN_LENGTH = 65_536 // 64KB base64 encoded

@Injectable()
export class BoltFraudGuard implements CanActivate {
  constructor(
    @Inject(BOLT_FRAUD_INSTANCE)
    private readonly boltFraud: BoltFraud,
    @Inject(BOLT_FRAUD_TOKEN_HEADER)
    private readonly tokenHeader: string,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token = request.headers[this.tokenHeader]

    if (!token || typeof token !== 'string') {
      throw new HttpException(
        { decision: 'block', reason: 'missing_token' },
        HttpStatus.FORBIDDEN,
      )
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
    } catch {
      throw new HttpException(
        { decision: 'block', reason: 'verification_error' },
        HttpStatus.FORBIDDEN,
      )
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
