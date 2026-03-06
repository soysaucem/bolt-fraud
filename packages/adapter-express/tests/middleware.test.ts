import { describe, it, expect, vi, beforeEach } from 'vitest'
import { boltFraudMiddleware } from '../src/middleware.js'
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockBoltFraud,
  createAllowDecision,
  createBlockDecision,
  createChallengeDecision,
  asRequest,
  asResponse,
} from './helpers.js'

// ─── Mock @soysaucem/bolt-fraud-server ─────────────────────────────────────────────────

const mockBoltFraud = createMockBoltFraud()

vi.mock('@soysaucem/bolt-fraud-server', () => ({
  createBoltFraud: vi.fn(() => mockBoltFraud),
}))

import { createBoltFraud } from '@soysaucem/bolt-fraud-server'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMiddleware(config: Parameters<typeof boltFraudMiddleware>[0] = {}) {
  return boltFraudMiddleware(config)
}

describe('boltFraudMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
  })

  // ── 1. Missing token ────────────────────────────────────────────────────────

  it('responds 403 with missing_token when no token header is present', async () => {
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: {} })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'missing_token' })
    expect(next).not.toHaveBeenCalled()
  })

  // ── 2. Empty token ──────────────────────────────────────────────────────────

  it('responds 403 with missing_token when token header is an empty string', async () => {
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': '' } })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'missing_token' })
    expect(next).not.toHaveBeenCalled()
  })

  // ── 3. Token too large ──────────────────────────────────────────────────────

  it('responds 400 with token_too_large when token exceeds 65,536 characters', async () => {
    const middleware = createMiddleware()
    const oversizedToken = 'a'.repeat(65_537)
    const req = createMockRequest({ headers: { 'x-client-data': oversizedToken } })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'token_too_large' })
    expect(next).not.toHaveBeenCalled()
  })

  it('accepts a token at exactly the 65,536 character limit', async () => {
    const middleware = createMiddleware()
    const maxToken = 'a'.repeat(65_536)
    const req = createMockRequest({ headers: { 'x-client-data': maxToken } })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200) // unchanged — not set by middleware on success
  })

  // ── 4. Allow decision ───────────────────────────────────────────────────────

  it('calls next() and attaches decision to req when decision is allow', async () => {
    const decision = createAllowDecision(10)
    mockBoltFraud.verify.mockResolvedValue(decision)
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': 'valid-token' }, ip: '1.2.3.4' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.boltFraudDecision).toEqual(decision)
    expect(res.status).not.toHaveBeenCalled()
  })

  // ── 5. Challenge decision ───────────────────────────────────────────────────

  it('calls next() and attaches decision to req when decision is challenge', async () => {
    const decision = createChallengeDecision(45)
    mockBoltFraud.verify.mockResolvedValue(decision)
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': 'suspicious-token' }, ip: '5.6.7.8' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.boltFraudDecision).toEqual(decision)
  })

  // ── 6. Block decision ───────────────────────────────────────────────────────

  it('responds 403 with blocked error and does NOT call next() when decision is block', async () => {
    mockBoltFraud.verify.mockResolvedValue(createBlockDecision())
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': 'bot-token' }, ip: '9.9.9.9' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'blocked', decision: 'block' })
    expect(next).not.toHaveBeenCalled()
  })

  // ── 7. Custom onBlock handler ───────────────────────────────────────────────

  it('calls custom onBlock handler instead of default 403 when decision is block', async () => {
    const blockDecision = createBlockDecision(['instant_block:puppeteer_runtime'])
    mockBoltFraud.verify.mockResolvedValue(blockDecision)
    const onBlock = vi.fn()
    const middleware = createMiddleware({ onBlock })
    const req = createMockRequest({ headers: { 'x-client-data': 'bot-token' }, ip: '1.1.1.1' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(onBlock).toHaveBeenCalledOnce()
    expect(onBlock).toHaveBeenCalledWith(asRequest(req), asResponse(res), blockDecision)
    expect(next).not.toHaveBeenCalled()
    // Default 403 must NOT have been sent
    expect(res.status).not.toHaveBeenCalled()
  })

  // ── 8. Custom onChallenge handler ───────────────────────────────────────────

  it('calls custom onChallenge handler (non-blocking) and still calls next() when decision is challenge', async () => {
    const challengeDecision = createChallengeDecision()
    mockBoltFraud.verify.mockResolvedValue(challengeDecision)
    const onChallenge = vi.fn()
    const middleware = createMiddleware({ onChallenge })
    const req = createMockRequest({ headers: { 'x-client-data': 'suspicious-token' }, ip: '2.2.2.2' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(onChallenge).toHaveBeenCalledOnce()
    expect(onChallenge).toHaveBeenCalledWith(asRequest(req), asResponse(res), challengeDecision)
    // Must still proceed
    expect(next).toHaveBeenCalledOnce()
  })

  it('does NOT call onChallenge when decision is allow', async () => {
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
    const onChallenge = vi.fn()
    const middleware = createMiddleware({ onChallenge })
    const req = createMockRequest({ headers: { 'x-client-data': 'good-token' }, ip: '3.3.3.3' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(onChallenge).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  // ── 9. verify() throws ──────────────────────────────────────────────────────

  it('responds 403 with verification_error when verify() throws', async () => {
    mockBoltFraud.verify.mockRejectedValue(new Error('decrypt failed'))
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': 'corrupted-token' }, ip: '4.4.4.4' })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'verification_error' })
    expect(next).not.toHaveBeenCalled()
  })

  // ── 10. Custom tokenHeader ──────────────────────────────────────────────────

  it('reads token from custom tokenHeader when configured', async () => {
    const decision = createAllowDecision()
    mockBoltFraud.verify.mockResolvedValue(decision)
    const middleware = createMiddleware({ tokenHeader: 'x-my-token' })
    const req = createMockRequest({
      headers: { 'x-my-token': 'custom-header-token' },
      ip: '5.5.5.5',
    })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(mockBoltFraud.verify).toHaveBeenCalledWith('custom-header-token', '5.5.5.5')
    expect(next).toHaveBeenCalledOnce()
  })

  it('responds 403 with missing_token when custom tokenHeader is absent', async () => {
    const middleware = createMiddleware({ tokenHeader: 'x-my-token' })
    // Sends default header — not the custom one
    const req = createMockRequest({ headers: { 'x-client-data': 'wrong-header' } })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'missing_token' })
    expect(next).not.toHaveBeenCalled()
  })

  // ── 11. IP fallback to socket.remoteAddress ─────────────────────────────────

  it('falls back to socket.remoteAddress when req.ip is undefined', async () => {
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
    const middleware = createMiddleware()
    const req = createMockRequest({
      headers: { 'x-client-data': 'some-token' },
      socket: { remoteAddress: '10.0.0.1' },
    })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(mockBoltFraud.verify).toHaveBeenCalledWith('some-token', '10.0.0.1')
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes undefined as clientIP when neither req.ip nor socket.remoteAddress is available', async () => {
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
    const middleware = createMiddleware()
    const req = createMockRequest({ headers: { 'x-client-data': 'some-token' } })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(mockBoltFraud.verify).toHaveBeenCalledWith('some-token', undefined)
  })

  // ── 12. Token passed correctly to verify() ──────────────────────────────────

  it('passes the exact token string to verify()', async () => {
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
    const middleware = createMiddleware()
    const tokenValue = 'eyJhbGciOiJSU0EtT0FFUC0yNTYifQ.encrypted-payload.tag'
    const req = createMockRequest({
      headers: { 'x-client-data': tokenValue },
      ip: '6.6.6.6',
    })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(mockBoltFraud.verify).toHaveBeenCalledWith(tokenValue, '6.6.6.6')
  })

  it('uses the first value when the token header is an array', async () => {
    mockBoltFraud.verify.mockResolvedValue(createAllowDecision())
    const middleware = createMiddleware()
    const req = createMockRequest({
      headers: { 'x-client-data': ['first-token', 'second-token'] },
      ip: '7.7.7.7',
    })
    const res = createMockResponse()
    const next = createMockNext()

    await middleware(asRequest(req), asResponse(res), next)

    expect(mockBoltFraud.verify).toHaveBeenCalledWith('first-token', '7.7.7.7')
  })

  // ── createBoltFraud called once at init, not per-request ───────────────────

  it('calls createBoltFraud exactly once when the middleware is created', () => {
    const mockedCreateBoltFraud = vi.mocked(createBoltFraud)
    mockedCreateBoltFraud.mockClear()

    createMiddleware({ tokenHeader: 'x-bolt' })

    expect(mockedCreateBoltFraud).toHaveBeenCalledOnce()
  })
})
