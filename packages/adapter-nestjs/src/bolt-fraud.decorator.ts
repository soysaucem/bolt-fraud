import { createParamDecorator, type ExecutionContext, UseGuards, applyDecorators } from '@nestjs/common'
import type { Decision } from '@bolt-fraud/server'
import { BoltFraudGuard } from './bolt-fraud.guard.js'

/**
 * Parameter decorator to extract the bolt-fraud decision from the request.
 *
 * Usage:
 *   @Get()
 *   @UseGuards(BoltFraudGuard)
 *   handler(@BoltFraudDecision() decision: Decision) { ... }
 */
export const BoltFraudDecision = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Decision | undefined => {
    const request = ctx.switchToHttp().getRequest()
    return request.boltFraudDecision
  },
)

/**
 * Method decorator that combines @UseGuards(BoltFraudGuard).
 *
 * Usage:
 *   @Get()
 *   @Protected()
 *   handler() { ... }
 */
export function Protected(): MethodDecorator {
  return applyDecorators(UseGuards(BoltFraudGuard))
}
