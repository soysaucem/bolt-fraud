import { Module, type DynamicModule, type Provider } from '@nestjs/common'
import { createBoltFraud, type BoltFraudServerConfig, type BoltFraud } from '@bolt-fraud/server'
import { BoltFraudGuard } from './bolt-fraud.guard.js'

export const BOLT_FRAUD_INSTANCE = 'BOLT_FRAUD_INSTANCE'
export const BOLT_FRAUD_OPTIONS = 'BOLT_FRAUD_OPTIONS'
export const BOLT_FRAUD_TOKEN_HEADER = 'BOLT_FRAUD_TOKEN_HEADER'

export interface BoltFraudModuleConfig extends BoltFraudServerConfig {
  readonly tokenHeader?: string
}

@Module({})
export class BoltFraudModule {
  static forRoot(config: BoltFraudModuleConfig): DynamicModule {
    const boltFraudProvider: Provider = {
      provide: BOLT_FRAUD_INSTANCE,
      useFactory: () => createBoltFraud(config),
    }

    const tokenHeaderProvider: Provider = {
      provide: BOLT_FRAUD_TOKEN_HEADER,
      useValue: config.tokenHeader ?? 'x-client-data',
    }

    return {
      module: BoltFraudModule,
      global: true,
      providers: [boltFraudProvider, tokenHeaderProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BoltFraudGuard],
    }
  }

  static forRootAsync(options: {
    useFactory: (...args: unknown[]) => BoltFraudModuleConfig | Promise<BoltFraudModuleConfig>
    inject?: readonly (string | symbol | Function)[]
  }): DynamicModule {
    const boltFraudProvider: Provider = {
      provide: BOLT_FRAUD_INSTANCE,
      useFactory: async (...args: unknown[]) => {
        const config = await options.useFactory(...args)
        return createBoltFraud(config)
      },
      inject: options.inject ? [...options.inject] : [],
    }

    const tokenHeaderProvider: Provider = {
      provide: BOLT_FRAUD_TOKEN_HEADER,
      useFactory: async (...args: unknown[]) => {
        const config = await options.useFactory(...args)
        return config.tokenHeader ?? 'x-client-data'
      },
      inject: options.inject ? [...options.inject] : [],
    }

    return {
      module: BoltFraudModule,
      global: true,
      providers: [boltFraudProvider, tokenHeaderProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BoltFraudGuard],
    }
  }
}
