import { describe, it, expect } from 'vitest'
import { BoltFraudModule, BOLT_FRAUD_INSTANCE } from '../src/bolt-fraud.module.js'
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

    it('provides BOLT_FRAUD_INSTANCE via async useFactory', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: async () => ({}),
        inject: ['CONFIG_SERVICE'],
      })

      const boltProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_INSTANCE,
      )
      expect(boltProvider).toBeDefined()
      expect(typeof boltProvider.useFactory).toBe('function')
      expect(boltProvider.inject).toEqual(['CONFIG_SERVICE'])
    })

    it('defaults inject to empty array when not provided', () => {
      const result = BoltFraudModule.forRootAsync({
        useFactory: () => ({}),
      })

      const boltProvider = (result.providers as any[])?.find(
        (p: any) => p.provide === BOLT_FRAUD_INSTANCE,
      )
      expect(boltProvider.inject).toEqual([])
    })
  })
})
