import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { BoltFraudDecision, BoltFraudProtected } from '../src/bolt-fraud.decorator.js'
import { createMockExecutionContext, createAllowDecision, type MockRequest } from './helpers.js'

// NestJS internal metadata key used by createParamDecorator
const ROUTE_ARGS_METADATA = '__routeArguments__'

/**
 * Extract the factory function stored by createParamDecorator.
 * Applies the decorator to a dummy class method, reads ROUTE_ARGS_METADATA,
 * and returns the first custom factory found.
 */
function extractDecoratorFactory(
  decorator: ReturnType<typeof BoltFraudDecision>,
): (data: unknown, ctx: unknown) => unknown {
  class DummyController {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler(_arg: unknown) {}
  }

  // Apply the decorator to index 0 of the handler method
  decorator(DummyController.prototype, 'handler', 0)

  const metadata: Record<string, { factory: (data: unknown, ctx: unknown) => unknown }> =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, DummyController, 'handler') ?? {}

  // Find the entry that has a factory function (custom param decorator entries)
  const entry = Object.values(metadata).find((v) => typeof v?.factory === 'function')
  if (!entry) throw new Error('No factory found in decorator metadata')
  return entry.factory
}

describe('BoltFraudDecision decorator', () => {
  it('is a function (createParamDecorator result)', () => {
    expect(typeof BoltFraudDecision).toBe('function')
  })

  it('extracts request.boltFraudDecision from the execution context', () => {
    // Arrange
    const decision = createAllowDecision(10)
    const request: MockRequest = {
      headers: { 'x-client-data': 'some-token' },
      boltFraudDecision: decision,
    }
    const ctx = createMockExecutionContext(request)
    const factory = extractDecoratorFactory(BoltFraudDecision())

    // Act
    const result = factory(undefined, ctx)

    // Assert
    expect(result).toEqual(decision)
  })

  it('returns undefined when request.boltFraudDecision is not set', () => {
    // Arrange
    const request: MockRequest = {
      headers: { 'x-client-data': 'some-token' },
      // boltFraudDecision intentionally omitted
    }
    const ctx = createMockExecutionContext(request)
    const factory = extractDecoratorFactory(BoltFraudDecision())

    // Act
    const result = factory(undefined, ctx)

    // Assert
    expect(result).toBeUndefined()
  })
})

describe('BoltFraudProtected decorator', () => {
  it('is a function', () => {
    expect(typeof BoltFraudProtected).toBe('function')
  })

  it('returns a decorator function', () => {
    const decorator = BoltFraudProtected()
    expect(typeof decorator).toBe('function')
  })
})
