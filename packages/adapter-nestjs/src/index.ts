export {
  BoltFraudModule,
  BOLT_FRAUD_INSTANCE,
  BOLT_FRAUD_OPTIONS,
  BOLT_FRAUD_TOKEN_HEADER,
  type BoltFraudModuleConfig,
} from './bolt-fraud.module.js'
export { BoltFraudGuard } from './bolt-fraud.guard.js'
export { BoltFraudDecision, BoltFraudProtected } from './bolt-fraud.decorator.js'

// Re-export key types from @bolt-fraud/server for convenience
export type {
  BoltFraudServerConfig,
  Decision,
  ClientSafeDecision,
  DecisionType,
  BoltFraud,
} from '@bolt-fraud/server'
export { toClientSafeDecision } from '@bolt-fraud/server'
