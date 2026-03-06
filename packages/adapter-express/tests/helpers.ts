import { vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import type { Decision } from '@soysaucem/bolt-fraud-server'

// ─── Mock Request ─────────────────────────────────────────────────────────────

export interface MockRequest {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
  boltFraudDecision?: Decision
}

export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    headers: {},
    ...overrides,
  }
}

// ─── Mock Response ────────────────────────────────────────────────────────────

export interface MockResponse {
  statusCode: number
  body: unknown
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
}

export function createMockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(),
    json: vi.fn(),
  }

  // status() returns the response for chaining (.status(403).json(...))
  res.status.mockImplementation((code: number) => {
    res.statusCode = code
    return res
  })

  res.json.mockImplementation((body: unknown) => {
    res.body = body
    return res
  })

  return res
}

// ─── Mock Next ────────────────────────────────────────────────────────────────

export function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction
}

// ─── Mock BoltFraud ───────────────────────────────────────────────────────────

export function createMockBoltFraud(verifyResult: Decision = createAllowDecision()) {
  return {
    verify: vi.fn(async (_token: string, _clientIP?: string): Promise<Decision> => verifyResult),
    getPublicKey: vi.fn(() => 'mock-public-key'),
  }
}

// ─── Decision Factories ───────────────────────────────────────────────────────

export function createAllowDecision(score = 0): Decision {
  return { decision: 'allow', score, instantBlock: false, reasons: [] }
}

export function createBlockDecision(
  reasons: string[] = ['instant_block:webdriver_present'],
): Decision {
  return { decision: 'block', score: 100, instantBlock: true, reasons }
}

export function createChallengeDecision(score = 50): Decision {
  return { decision: 'challenge', score, instantBlock: false, reasons: ['suspicious_fingerprint'] }
}

// ─── Helpers to cast mock types for use as Express types ─────────────────────

export function asRequest(mock: MockRequest): Request {
  return mock as unknown as Request
}

export function asResponse(mock: MockResponse): Response {
  return mock as unknown as Response
}
