import type { BoltFraudConfig, EncryptedToken, FingerprintData } from './types.js'
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
import type { HookDeps } from './transport/index.js'

export type {
  BoltFraudConfig,
  EncryptedToken,
  TokenPayload,
  FingerprintData,
  AutomationResult,
  IntegrityResult,
  BehaviorData,
} from './types.js'

const SDK_VERSION = __SDK_VERSION__

/** Config that finished init (committed only after detection succeeded). */
let _config: BoltFraudConfig | null = null
let _initialized = false
let _cachedDetection: DetectionResult | null = null
/** In-flight or resolved init for `_pendingConfig`; null when not initialising/initialised. */
let _initPromise: Promise<void> | null = null
let _pendingConfig: BoltFraudConfig | null = null
let _fingerprintPromise: Promise<FingerprintData> | null = null
/** Incremented by destroy(); async work compares it after every await and stops if it changed. */
let _epoch = 0

const hookDeps: HookDeps = {
  getConfig: () => _config,
  // Hooks report failures themselves through onError, so skip getToken()'s own report.
  getToken: () => timedToken(DEFAULT_TOKEN_TIMEOUT_MS),
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function validateConfig(config: BoltFraudConfig): void {
  if (!config.serverUrl) {
    throw new Error('[bolt-fraud] config.serverUrl is required')
  }
  const { ringBufferSize, keyId } = config
  if (
    ringBufferSize !== undefined &&
    (!Number.isInteger(ringBufferSize) || ringBufferSize < 1 || ringBufferSize > 1024)
  ) {
    throw new Error('[bolt-fraud] config.ringBufferSize must be an integer from 1 to 1024')
  }
  if (keyId !== undefined && (!Number.isInteger(keyId) || keyId < 0 || keyId > 255)) {
    throw new Error('[bolt-fraud] config.keyId must be an integer from 0 to 255')
  }
  if (!config.publicKey && config.devMode !== true) {
    throw new Error('[bolt-fraud] config.publicKey is required unless devMode is true')
  }
  if ((config.hookFetch === true || config.hookXHR === true) &&
    (!config.protectedPatterns || config.protectedPatterns.length === 0)) {
    throw new Error('[bolt-fraud] config.protectedPatterns must be non-empty when hookFetch or hookXHR is enabled')
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }
  return Object.is(a, b)
}

function sameConfig(a: BoltFraudConfig, b: BoltFraudConfig): boolean {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false
  }
  return true
}

function resetState(): void {
  stopBehaviorCollection()
  uninstallHooks()
  _config = null
  _initialized = false
  _cachedDetection = null
  _initPromise = null
  _pendingConfig = null
  _fingerprintPromise = null
}

export function init(config: BoltFraudConfig): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  validateConfig(config)

  if (_initPromise !== null) {
    if (_pendingConfig !== null && sameConfig(_pendingConfig, config)) return _initPromise
    return destroy().then(() => init(config))
  }

  const epoch = _epoch
  _pendingConfig = config

  const promise = (async () => {
    try {
      // Run detection BEFORE installing hooks so our own hooks are not flagged as integrity violations.
      const detection = await runDetection()
      if (epoch !== _epoch) return

      _config = config
      _cachedDetection = detection
      _initialized = true

      if (config.behavior !== false) startBehaviorCollection(config.ringBufferSize)
      if (config.hookFetch === true) installFetchHook(hookDeps)
      if (config.hookXHR === true) installXHRHook(hookDeps)

      // Warm the fingerprint in idle slices so the first getToken() is fast.
      void fingerprintOnce().catch(() => {})
    } catch (err) {
      if (epoch === _epoch) resetState()
      config.onError?.(toError(err))
      throw err
    }
  })()

  _initPromise = promise
  return promise
}

function fingerprintOnce(): Promise<FingerprintData> {
  if (_fingerprintPromise === null) {
    const promise: Promise<FingerprintData> = collectFingerprint().catch((err: unknown) => {
      if (_fingerprintPromise === promise) _fingerprintPromise = null
      throw err
    })
    _fingerprintPromise = promise
  }
  return _fingerprintPromise
}

const DEFAULT_TOKEN_TIMEOUT_MS = 5000

/** Waits for a pending init, builds a token, and always clears its timer. */
async function timedToken(timeoutMs: number): Promise<EncryptedToken> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('[bolt-fraud] getToken() timed out')), timeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        if (!_initialized && _initPromise !== null) await _initPromise
        return _buildFreshToken()
      })(),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function getToken(timeoutMs = DEFAULT_TOKEN_TIMEOUT_MS): Promise<EncryptedToken> {
  const onError = (_config ?? _pendingConfig)?.onError
  try {
    return await timedToken(timeoutMs)
  } catch (err) {
    onError?.(toError(err))
    throw err
  }
}

/**
 * Cache only the fingerprint; nonce, timestamp, behavior snapshot and encryption are fresh on every
 * call because the server instantly blocks a replayed nonce.
 */
async function _buildFreshToken(): Promise<EncryptedToken> {
  assertInitialized()
  const config = _config!
  const epoch = _epoch

  const fingerprint = await fingerprintOnce()
  assertSameEpoch(epoch)
  const detection = _cachedDetection ?? (await runDetection())
  assertSameEpoch(epoch)

  const behavior = snapshotBehavior()

  // Generate a cryptographically random 32-hex-char nonce
  const nonce = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

  const token = await buildToken(
    {
      fingerprint,
      detection,
      behavior,
      timestamp: Date.now(),
      nonce,
      sdkVersion: SDK_VERSION,
    },
    config,
  )
  assertSameEpoch(epoch)

  try {
    config.onTokenReady?.(token)
  } catch (err) {
    config.onError?.(toError(err))
  }

  return token
}

export function hookFetch(): void {
  assertInitialized()
  installFetchHook(hookDeps)
}

export function hookXHR(): void {
  assertInitialized()
  installXHRHook(hookDeps)
}

export async function destroy(): Promise<void> {
  const pending = _initPromise
  _epoch++
  resetState()
  if (pending) await pending.catch(() => {}) // let an in-flight init settle; its result is discarded
}

/** Returns true if init() has completed successfully */
export function isReady(): boolean {
  return _initialized && _config !== null
}

function assertInitialized(): void {
  if (!_initialized || _config === null) {
    throw new Error('[bolt-fraud] SDK not initialized — call init() first')
  }
}

function assertSameEpoch(epoch: number): void {
  if (epoch !== _epoch) throw new Error('[bolt-fraud] SDK destroyed during token collection')
}
