import { describe, it, expect } from 'vitest'
import { BoltFraudModule } from '../src/bolt-fraud.module.js'
import { BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BOLT_FRAUD_OPTIONS } from '../src/tokens.js'
import { BoltFraudGuard } from '../src/bolt-fraud.guard.js'

describe('BoltFraudModule', () => {
  describe('forRoot', () => {
    it('returns a DynamicModule with global scope', () => {
      const result = BoltFraudModule.forRoot({})

      expect(result.module).toBe(BoltFraudModule)
      expect(result.global).toBe(true)
    })

    it('includes BoltFraudGuard in providers', () => {
      const result = BoltFraudModule.forRoot({})

      expect(result.providers).toBeDefined()
      expect(result.providers).toContainEqual(BoltFraudGuard)
    })

    it('exports BOLT_FRAUD_INSTANCE and BoltFraudGuard', () => {
      const result = BoltFraudModule.forRoot({})

      expect(result.exports).toContain(BOLT_FRAUD_INSTANCE)
      expect(result.exports).toContain(BoltFraudGuard)
    })

    it('exports BOLT_FRAUD_TOKEN_HEADER', () => {
      const result = BoltFraudModule.forRoot({})

      expect(result.exports).toContain(BOLT_FRAUD_TOKEN_HEADER)
    })

    it('BOLT_FRAUD_TOKEN_HEADER provider returns default header when tokenHeader not set', () => {
      const result = BoltFraudModule.forRoot({})

      const headerProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_TOKEN_HEADER,
      )
      expect(headerProvider).toBeDefined()
      expect(headerProvider.useValue).toBe('x-client-data')
    })

    it('BOLT_FRAUD_TOKEN_HEADER provider returns custom header when tokenHeader is provided', () => {
      const result = BoltFraudModule.forRoot({ tokenHeader: 'x-custom' })

      const headerProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_TOKEN_HEADER,
      )
      expect(headerProvider).toBeDefined()
      expect(headerProvider.useValue).toBe('x-custom')
    })

    it('provides BOLT_FRAUD_INSTANCE via useFactory', () => {
      const result = BoltFraudModule.forRoot({})

      const boltProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_INSTANCE,
      )
      expect(boltProvider).toBeDefined()
      expect(typeof boltProvider.useFactory).toBe('function')
    })

    it('factory creates a BoltFraud instance with verify and getPublicKey methods', () => {
      const result = BoltFraudModule.forRoot({})

      const boltProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_INSTANCE,
      )
      const instance = boltProvider.useFactory()

      expect(typeof instance.verify).toBe('function')
      expect(typeof instance.getPublicKey).toBe('function')
    })
  })

  describe('forRootAsync', () => {
    it('returns a DynamicModule with global scope', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      expect(result.module).toBe(BoltFraudModule)
      expect(result.global).toBe(true)
    })

    it('includes BoltFraudGuard in providers', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      expect(result.providers).toContainEqual(BoltFraudGuard)
    })

    it('exports BOLT_FRAUD_INSTANCE and BoltFraudGuard', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      expect(result.exports).toContain(BOLT_FRAUD_INSTANCE)
      expect(result.exports).toContain(BoltFraudGuard)
    })

    it('exports BOLT_FRAUD_TOKEN_HEADER', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      expect(result.exports).toContain(BOLT_FRAUD_TOKEN_HEADER)
    })

    it('includes BOLT_FRAUD_OPTIONS provider in providers', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      const optionsProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_OPTIONS,
      )
      expect(optionsProvider).toBeDefined()
      expect(typeof optionsProvider.useFactory).toBe('function')
    })

    it('provides BOLT_FRAUD_INSTANCE via async useFactory (injects BOLT_FRAUD_OPTIONS)', () => {
      // In forRootAsync, BOLT_FRAUD_INSTANCE uses a shared config provider.
      // The BOLT_FRAUD_OPTIONS provider holds the user-provided inject array.
      const result = BoltFraudModule.forRootAsync({
        useFactory: async () => ({}),
        inject: ['CONFIG_SERVICE'],
      })

      const boltProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_INSTANCE,
      )
      expect(boltProvider).toBeDefined()
      expect(typeof boltProvider.useFactory).toBe('function')
      // BOLT_FRAUD_INSTANCE injects BOLT_FRAUD_OPTIONS (not the user inject array directly)
      expect(boltProvider.inject).toContain(BOLT_FRAUD_OPTIONS)

      // The user-provided inject array is on the BOLT_FRAUD_OPTIONS provider
      const optionsProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_OPTIONS,
      )
      expect(optionsProvider.inject).toEqual(['CONFIG_SERVICE'])
    })

    it('defaults inject to empty array when not provided (on BOLT_FRAUD_OPTIONS)', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      // The user inject array defaults to [] on the BOLT_FRAUD_OPTIONS provider
      const optionsProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_OPTIONS,
      )
      expect(optionsProvider.inject).toEqual([])
    })
  })
})
