import { Module, type DynamicModule, type Provider } from '@nestjs/common'
import { createBoltFraud, type BoltFraudServerConfig, type BoltFraud } from '@bolt-fraud/server'
import { BoltFraudGuard } from './bolt-fraud.guard.js'

export const BOLT_FRAUD_INSTANCE = 'BOLT_FRAUD_INSTANCE'
export const BOLT_FRAUD_OPTIONS = 'BOLT_FRAUD_OPTIONS'

@Module({})
export class BoltFraudModule {
  static forRoot(config: BoltFraudServerConfig): DynamicModule {
    const boltFraudProvider: Provider = {
      provide: BOLT_FRAUD_INSTANCE,
      useFactory: () => createBoltFraud(config),
    }

    return {
      module: BoltFraudModule,
      global: true,
      providers: [boltFraudProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BoltFraudGuard],
    }
  }

  static forRootAsync(options: {
    useFactory: (...args: unknown[]) => BoltFraudServerConfig | Promise<BoltFraudServerConfig>
    inject?: any[]
  }): DynamicModule {
    const boltFraudProvider: Provider = {
      provide: BOLT_FRAUD_INSTANCE,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args)
        return createBoltFraud(config)
      },
      inject: options.inject ?? [],
    }

    return {
      module: BoltFraudModule,
      global: true,
      providers: [boltFraudProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BoltFraudGuard],
    }
  }
}
