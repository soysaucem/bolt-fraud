import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { BoltFraud } from '@bolt-fraud/server'
import { BOLT_FRAUD_INSTANCE } from './bolt-fraud.module.js'

const DEFAULT_TOKEN_HEADER = 'x-bolt-token'

@Injectable()
export class BoltFraudGuard implements CanActivate {
  constructor(
    @Inject(BOLT_FRAUD_INSTANCE)
    private readonly boltFraud: BoltFraud,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token = request.headers[DEFAULT_TOKEN_HEADER]

    if (!token || typeof token !== 'string') {
      throw new HttpException(
        { decision: 'block', reason: 'missing_token' },
        HttpStatus.FORBIDDEN,
      )
    }

    const clientIP = request.ip ?? request.connection?.remoteAddress
    const decision = await this.boltFraud.verify(token, clientIP)

    if (decision.decision === 'block') {
      throw new HttpException(
        { decision: 'block', reasons: decision.reasons },
        HttpStatus.FORBIDDEN,
      )
    }

    // Attach decision to request for downstream use
    request.boltFraudDecision = decision
    return true
  }
}
