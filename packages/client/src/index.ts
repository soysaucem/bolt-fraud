import type { BoltFraudConfig, EncryptedToken } from './types.js'
import { collectFingerprint } from './fingerprint/index.js'
import { runDetection } from './detection/index.js'
import {
  startBehaviorCollection,
  stopBehaviorCollection,
  snapshotBehavior,
} from './behavior/index.js'
import {
  buildToken,
  installFetchHook,
  installXHRHook,
  uninstallHooks,
} from './transport/index.js'

export type {
  BoltFraudConfig,
  EncryptedToken,
  TokenPayload,
  FingerprintData,
  AutomationResult,
  IntegrityResult,
  BehaviorData,
} from './types.js'

const SDK_VERSION = '1.0.0'

let _config: BoltFraudConfig | null = null
let _initialized = false

export async function init(config: BoltFraudConfig): Promise<void> {
  if (_initialized && _config?.serverUrl === config.serverUrl) {
    return
  }
  if (!config.serverUrl) {
    throw new Error('[bolt-fraud] config.serverUrl is required')
  }
  _config = config
  _initialized = true

  // Start behavior collection
  startBehaviorCollection(config.ringBufferSize)

  // Auto-install hooks if configured
  if (config.hookFetch !== false) {
    installFetchHook(config)
  }
  if (config.hookXHR) {
    installXHRHook(config)
  }
}

export async function getToken(): Promise<EncryptedToken> {
  assertInitialized()
  const config = _config!

  // Collect fingerprint and run detection in parallel
  const [fingerprint, detection] = await Promise.all([
    collectFingerprint(),
    runDetection(),
  ])

  // Snapshot current behavior
  const behavior = snapshotBehavior()

  // Generate a cryptographically random 32-hex-char nonce
  const nonce = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

  const payload = {
    fingerprint,
    detection,
    behavior,
    timestamp: Date.now(),
    nonce,
    sdkVersion: SDK_VERSION,
  }

  const token = await buildToken(payload, config)

  config.onTokenReady?.(token)

  return token
}

export function hookFetch(): void {
  assertInitialized()
  installFetchHook(_config!)
}

export function hookXHR(): void {
  assertInitialized()
  installXHRHook(_config!)
}

export function destroy(): void {
  stopBehaviorCollection()
  uninstallHooks()
  _config = null
  _initialized = false
}

function assertInitialized(): void {
  if (!_initialized || _config === null) {
    throw new Error('[bolt-fraud] SDK not initialized — call init() first')
  }
}
