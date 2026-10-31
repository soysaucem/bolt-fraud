import { Module, type DynamicModule, type Provider } from '@nestjs/common'
import { createBoltFraud, type BoltFraudServerConfig } from '@soysaucem/bolt-fraud-server'
import { BoltFraudGuard, type BoltFraudGuardOptions } from './bolt-fraud.guard.js'
import {
  BOLT_FRAUD_INSTANCE,
  BOLT_FRAUD_OPTIONS,
  BOLT_FRAUD_TOKEN_HEADER,
  BOLT_FRAUD_GUARD_OPTIONS,
} from './tokens.js'

const DEFAULT_TOKEN_HEADER = 'x-client-data'

/**
 * Module configuration. `onError` (inherited from the server config) receives both token
 * decryption failures and errors thrown by verify().
 */
export interface BoltFraudModuleConfig extends BoltFraudServerConfig, BoltFraudGuardOptions {
  /** Header carrying the token. Matched case-insensitively. Default: 'x-client-data' */
  readonly tokenHeader?: string
}

/** Node lower-cases incoming header names, so the configured name must be lower-cased too. */
function resolveTokenHeader(config: BoltFraudModuleConfig): string {
  return (config.tokenHeader ?? DEFAULT_TOKEN_HEADER).toLowerCase()
}

function resolveGuardOptions(config: BoltFraudModuleConfig): BoltFraudGuardOptions {
  return { missingToken: config.missingToken, failOpen: config.failOpen, onError: config.onError }
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
      useValue: resolveTokenHeader(config),
    }

    const guardOptionsProvider: Provider = {
      provide: BOLT_FRAUD_GUARD_OPTIONS,
      useValue: resolveGuardOptions(config),
    }

    return {
      module: BoltFraudModule,
      global: true,
      providers: [boltFraudProvider, tokenHeaderProvider, guardOptionsProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BOLT_FRAUD_GUARD_OPTIONS, BoltFraudGuard],
    }
  }

  static forRootAsync(options: {
    /** Modules whose providers the factory's `inject` tokens come from (e.g. ConfigModule). */
    imports?: DynamicModule['imports']
    useFactory: (...args: unknown[]) => BoltFraudModuleConfig | Promise<BoltFraudModuleConfig>
    inject?: readonly (string | symbol | (abstract new (...args: unknown[]) => unknown))[]
  }): DynamicModule {
    const configProvider: Provider = {
      provide: BOLT_FRAUD_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ? [...options.inject] : [],
    }

    const boltFraudProvider: Provider = {
      provide: BOLT_FRAUD_INSTANCE,
      useFactory: (config: BoltFraudModuleConfig) => createBoltFraud(config),
      inject: [BOLT_FRAUD_OPTIONS],
    }

    const tokenHeaderProvider: Provider = {
      provide: BOLT_FRAUD_TOKEN_HEADER,
      useFactory: resolveTokenHeader,
      inject: [BOLT_FRAUD_OPTIONS],
    }

    const guardOptionsProvider: Provider = {
      provide: BOLT_FRAUD_GUARD_OPTIONS,
      useFactory: resolveGuardOptions,
      inject: [BOLT_FRAUD_OPTIONS],
    }

    return {
      module: BoltFraudModule,
      global: true,
      imports: options.imports ? [...options.imports] : [],
      providers: [configProvider, boltFraudProvider, tokenHeaderProvider, guardOptionsProvider, BoltFraudGuard],
      exports: [BOLT_FRAUD_INSTANCE, BOLT_FRAUD_TOKEN_HEADER, BOLT_FRAUD_GUARD_OPTIONS, BoltFraudGuard],
    }
  }
}
