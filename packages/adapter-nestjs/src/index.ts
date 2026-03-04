export { BoltFraudModule, BOLT_FRAUD_INSTANCE } from './bolt-fraud.module.js'
export { BoltFraudGuard } from './bolt-fraud.guard.js'
export { BoltFraudDecision, Protected } from './bolt-fraud.decorator.js'

// Re-export key types from @bolt-fraud/server for convenience
export type {
  BoltFraudServerConfig,
  Decision,
  DecisionType,
  BoltFraud,
} from '@bolt-fraud/server'
