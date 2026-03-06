export { boltFraudMiddleware, type BoltFraudExpressConfig } from './middleware.js'

// Re-export key types from @soysaucem/bolt-fraud-server for convenience
export type {
  BoltFraudServerConfig,
  Decision,
  ClientSafeDecision,
  DecisionType,
  BoltFraud,
} from '@soysaucem/bolt-fraud-server'
export { toClientSafeDecision } from '@soysaucem/bolt-fraud-server'
