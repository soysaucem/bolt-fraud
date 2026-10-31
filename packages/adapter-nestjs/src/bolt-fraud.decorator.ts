import { createParamDecorator, type ExecutionContext, UseGuards, applyDecorators } from '@nestjs/common'
import type { Decision } from '@soysaucem/bolt-fraud-server'
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
 * Class or method decorator that applies @UseGuards(BoltFraudGuard).
 *
 * Usage:
 *   @Get()
 *   @BoltFraudProtected()
 *   handler() { ... }
 *
 *   @BoltFraudProtected()
 *   @Controller('orders')
 *   class OrdersController { ... }
 */
export function BoltFraudProtected(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseGuards(BoltFraudGuard))
}
