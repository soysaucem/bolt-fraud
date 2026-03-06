export { boltFraudMiddleware, type BoltFraudExpressConfig } from './middleware.js'

// Re-export key types from @bolt-fraud/server for convenience
export type {
  BoltFraudServerConfig,
  Decision,
  ClientSafeDecision,
  DecisionType,
  BoltFraud,
} from '@bolt-fraud/server'
export { toClientSafeDecision } from '@bolt-fraud/server'
