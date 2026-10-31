import type { BoltFraudConfig, EncryptedToken, TokenPayload } from '../types.js'
import { serialize } from './serializer.js'
import { encrypt } from './crypto.js'

export { installFetchHook, installXHRHook, uninstallHooks } from './hook.js'
export type { HookDeps } from './hook.js'

export async function buildToken(
  payload: TokenPayload,
  config: BoltFraudConfig,
): Promise<EncryptedToken> {
  const bytes = serialize(payload)
  const token = await encrypt(bytes, config.publicKey, config.keyId ?? 0, config.devMode === true)
  return { token, v: 1 }
}
