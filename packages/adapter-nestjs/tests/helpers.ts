import type { ExecutionContext } from '@nestjs/common'
import type { Decision } from '@soysaucem/bolt-fraud-server'

export interface MockRequest {
  headers: Record<string, string | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
  boltFraudDecision?: Decision
}

export function createMockExecutionContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
    getClass: () => Object,
    getHandler: () => () => {},
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}), getPattern: () => '' }),
    getType: () => 'http' as const,
  } as unknown as ExecutionContext
}

export function createMockBoltFraud(
  verifyResult: Decision = {
    decision: 'allow',
    score: 0,
    instantBlock: false,
    reasons: [],
  },
) {
  return {
    verify: async (_token: string, _clientIP?: string) => verifyResult,
    getPublicKey: () => 'mock-public-key',
  }
}

export function createAllowDecision(score = 0): Decision {
  return { decision: 'allow', score, instantBlock: false, reasons: [] }
}

export function createBlockDecision(reasons: string[] = ['instant_block:webdriver_present']): Decision {
  return { decision: 'block', score: 100, instantBlock: true, reasons }
}

export function createChallengeDecision(score = 50): Decision {
  return { decision: 'challenge', score, instantBlock: false, reasons: ['suspicious_fingerprint'] }
}
