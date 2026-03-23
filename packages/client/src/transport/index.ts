import type { BoltFraudConfig, EncryptedToken, TokenPayload } from '../types.js'
import { serialize } from './serializer.js'
import { encrypt } from './crypto.js'

export { installFetchHook, installXHRHook, uninstallHooks } from './hook.js'

export async function buildToken(
  payload: TokenPayload,
  config: BoltFraudConfig,
): Promise<EncryptedToken> {
  const bytes = serialize(payload)
  // Skip compression — CompressionStream hangs during early page load in some
  // browsers (same stalling pattern as OfflineAudioContext). The server's
  // tryDecompress() handles uncompressed payloads transparently. At ~1-2KB
  // per token, compression saves <500 bytes — not worth the hang risk.
  const token = await encrypt(bytes, config.publicKey, config.keyId ?? 0)
  console.log('[bolt-fraud] buildToken: encrypted, token length:', token.length)
  return { token, v: 1 }
}

/**
 * Compress bytes with deflate-raw if CompressionStream is available (all modern browsers).
 * Falls back to uncompressed bytes for SSR or older environments.
 */
async function tryCompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return bytes
  }

  try {
    const cs = new CompressionStream('deflate-raw')
    const writer = cs.writable.getWriter()
    const reader = cs.readable.getReader()

    await writer.write(bytes as Uint8Array<ArrayBuffer>)
    await writer.close()

    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }

    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } catch {
    // Compression failed — return original bytes
    return bytes
  }
}
