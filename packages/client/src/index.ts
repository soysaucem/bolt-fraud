import type { BoltFraudConfig, EncryptedToken } from './types.js'
import { runDetection } from './detection/index.js'
import type { DetectionResult } from './detection/index.js'
import { collectFingerprint } from './fingerprint/index.js'
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
let _cachedDetection: DetectionResult | null = null
let _initPromise: Promise<void> | null = null

export function init(config: BoltFraudConfig): Promise<void> {
  if (_initialized && _config?.serverUrl === config.serverUrl && _config?.publicKey === config.publicKey) {
    return Promise.resolve()
  }
  if (!config.serverUrl) {
    throw new Error('[bolt-fraud] config.serverUrl is required')
  }

  _initPromise = (async () => {
    _config = config
    _initialized = true

    // Run detection BEFORE installing hooks to avoid false positives from our own hooks
    // being detected as integrity violations (e.g., fetch/XHR overrides flagged as non-native).
    _cachedDetection = await runDetection()

    // Start behavior collection
    startBehaviorCollection(config.ringBufferSize)

    // Auto-install hooks if configured
    if (config.hookFetch !== false) {
      installFetchHook(config)
    }
    if (config.hookXHR) {
      installXHRHook(config)
    }
  })()

  _initPromise.finally(() => {
    _initPromise = null
  })

  return _initPromise
}

export async function getToken(): Promise<EncryptedToken> {
  assertInitialized()
  const config = _config!

  // Use cached detection result (collected before hooks were installed) to avoid
  // false positive integrity violations from our own fetch/XHR hooks.
  const [fingerprint, detection] = await Promise.all([
    collectFingerprint(),
    Promise.resolve(_cachedDetection ?? runDetection()),
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

export async function destroy(): Promise<void> {
  if (_initPromise) {
    await _initPromise.catch(() => {})  // await in-flight init, ignore errors
    _initPromise = null
  }
  stopBehaviorCollection()
  uninstallHooks()
  _config = null
  _initialized = false
  _cachedDetection = null
}

function assertInitialized(): void {
  if (!_initialized || _config === null) {
    throw new Error('[bolt-fraud] SDK not initialized — call init() first')
  }
}
