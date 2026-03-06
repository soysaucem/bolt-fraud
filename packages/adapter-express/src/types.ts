import type { Decision } from '@bolt-fraud/server'

declare global {
  namespace Express {
    interface Request {
      boltFraudDecision?: Decision
    }
  }
}

// This file must be imported for the augmentation to take effect.
export {}
