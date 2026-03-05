import { describe, it, expect, vi } from 'vitest'
import { HttpException, HttpStatus } from '@nestjs/common'
import { BoltFraudGuard } from '../src/bolt-fraud.guard.js'
import {
  createMockExecutionContext,
  createMockBoltFraud,
  createAllowDecision,
  createBlockDecision,
  createChallengeDecision,
  type MockRequest,
} from './helpers.js'

function createGuard(verifyResult = createAllowDecision(), tokenHeader = 'x-client-data') {
  const mockBoltFraud = createMockBoltFraud(verifyResult)
  const guard = new BoltFraudGuard(mockBoltFraud as any, tokenHeader)
  return { guard, mockBoltFraud }
}

describe('BoltFraudGuard', () => {
  it('throws 403 when no token header is present', async () => {
    const { guard } = createGuard()
    const request: MockRequest = { headers: {} }
    const ctx = createMockExecutionContext(request)

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException)

    try {
      await guard.canActivate(ctx)
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException)
      expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN)
      const response = (e as HttpException).getResponse() as Record<string, unknown>
      expect(response.reason).toBe('missing_token')
    }
  })

  it('throws 403 when token header is empty string', async () => {
    const { guard } = createGuard()
    const request: MockRequest = { headers: { 'x-client-data': '' } }
    const ctx = createMockExecutionContext(request)

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException)
  })

  it('calls verify with token and client IP', async () => {
    const decision = createAllowDecision()
    const { guard, mockBoltFraud } = createGuard(decision)
    const verifySpy = vi.spyOn(mockBoltFraud, 'verify')
    const request: MockRequest = {
      headers: { 'x-client-data': 'encrypted-token-data' },
      ip: '192.168.1.1',
    }
    const ctx = createMockExecutionContext(request)

    await guard.canActivate(ctx)

    expect(verifySpy).toHaveBeenCalledWith('encrypted-token-data', '192.168.1.1')
  })

  it('falls back to connection.remoteAddress when ip is not set', async () => {
    const decision = createAllowDecision()
    const { guard, mockBoltFraud } = createGuard(decision)
    const verifySpy = vi.spyOn(mockBoltFraud, 'verify')
    const request: MockRequest = {
      headers: { 'x-client-data': 'some-token' },
      connection: { remoteAddress: '10.0.0.1' },
    }
    const ctx = createMockExecutionContext(request)

    await guard.canActivate(ctx)

    expect(verifySpy).toHaveBeenCalledWith('some-token', '10.0.0.1')
  })

  it('returns true when decision is "allow"', async () => {
    const { guard } = createGuard(createAllowDecision())
    const request: MockRequest = {
      headers: { 'x-client-data': 'valid-token' },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
  })

  it('returns true when decision is "challenge" (only blocks on "block")', async () => {
    const { guard } = createGuard(createChallengeDecision())
    const request: MockRequest = {
      headers: { 'x-client-data': 'suspicious-token' },
      ip: '5.6.7.8',
    }
    const ctx = createMockExecutionContext(request)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
  })

  it('throws 403 when decision is "block"', async () => {
    const blockDecision = createBlockDecision(['instant_block:puppeteer_runtime'])
    const { guard } = createGuard(blockDecision)
    const request: MockRequest = {
      headers: { 'x-client-data': 'bot-token' },
      ip: '9.10.11.12',
    }
    const ctx = createMockExecutionContext(request)

    try {
      await guard.canActivate(ctx)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException)
      expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN)
      const response = (e as HttpException).getResponse() as Record<string, unknown>
      expect(response.decision).toBe('block')
      expect(response.reason).toBe('request_blocked')
    }
  })

  it('attaches decision to request.boltFraudDecision on allow', async () => {
    const decision = createAllowDecision(5)
    const { guard } = createGuard(decision)
    const request: MockRequest = {
      headers: { 'x-client-data': 'valid-token' },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    await guard.canActivate(ctx)

    expect(request.boltFraudDecision).toEqual(decision)
  })

  it('attaches decision to request.boltFraudDecision on challenge', async () => {
    const decision = createChallengeDecision()
    const { guard } = createGuard(decision)
    const request: MockRequest = {
      headers: { 'x-client-data': 'challenge-token' },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    await guard.canActivate(ctx)

    expect(request.boltFraudDecision).toEqual(decision)
  })

  it('reads token from custom header when tokenHeader is configured', async () => {
    // Arrange
    const decision = createAllowDecision()
    const mockBoltFraud = createMockBoltFraud(decision)
    const guard = new BoltFraudGuard(mockBoltFraud as any, 'x-custom-token')
    const verifySpy = vi.spyOn(mockBoltFraud, 'verify')
    const request: MockRequest = {
      headers: { 'x-custom-token': 'my-custom-token-value' },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    // Act
    const result = await guard.canActivate(ctx)

    // Assert
    expect(result).toBe(true)
    expect(verifySpy).toHaveBeenCalledWith('my-custom-token-value', '1.2.3.4')
  })

  it('throws 403 when custom header is missing', async () => {
    // Arrange
    const guard = new BoltFraudGuard(createMockBoltFraud() as any, 'x-custom-token')
    const request: MockRequest = {
      headers: { 'x-client-data': 'wrong-header-name' }, // default header, not the custom one
    }
    const ctx = createMockExecutionContext(request)

    // Act & Assert
    try {
      await guard.canActivate(ctx)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException)
      expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN)
      const response = (e as HttpException).getResponse() as Record<string, unknown>
      expect(response.reason).toBe('missing_token')
    }
  })

  it('throws 400 BAD_REQUEST when token exceeds 65,536 characters', async () => {
    // Arrange
    const { guard } = createGuard()
    const oversizedToken = 'a'.repeat(65_537)
    const request: MockRequest = {
      headers: { 'x-client-data': oversizedToken },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    // Act & Assert
    try {
      await guard.canActivate(ctx)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException)
      expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST)
      const response = (e as HttpException).getResponse() as Record<string, unknown>
      expect(response.reason).toBe('token_too_large')
    }
  })

  it('propagates errors thrown by boltFraud.verify()', async () => {
    // Arrange
    const mockBoltFraud = createMockBoltFraud()
    const verifyError = new Error('decrypt_failed: corrupted ciphertext')
    vi.spyOn(mockBoltFraud, 'verify').mockRejectedValue(verifyError)
    const guard = new BoltFraudGuard(mockBoltFraud as any, 'x-client-data')
    const request: MockRequest = {
      headers: { 'x-client-data': 'malformed-token' },
      ip: '1.2.3.4',
    }
    const ctx = createMockExecutionContext(request)

    // Act & Assert
    await expect(guard.canActivate(ctx)).rejects.toThrow('decrypt_failed: corrupted ciphertext')
  })
})
