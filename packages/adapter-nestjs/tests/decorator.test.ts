import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { BoltFraudDecision, Protected } from '../src/bolt-fraud.decorator.js'
import { createMockExecutionContext, createAllowDecision, type MockRequest } from './helpers.js'

describe('BoltFraudDecision decorator', () => {
  it('is a function (createParamDecorator result)', () => {
    expect(typeof BoltFraudDecision).toBe('function')
  })
})

describe('Protected decorator', () => {
  it('is a function', () => {
    expect(typeof Protected).toBe('function')
  })

  it('returns a decorator function', () => {
    const decorator = Protected()
    expect(typeof decorator).toBe('function')
  })
})
