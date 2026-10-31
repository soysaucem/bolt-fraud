import type { RiskEngineConfig } from '../scoring/engine.js'

// ─── Token (deserialized from client) ───────────────────────────────────────

export interface Token {
  readonly fingerprint: Fingerprint
  readonly detection: DetectionData
  readonly behavior: BehaviorData
  readonly timestamp: number
  readonly nonce: string
  readonly sdkVersion: string
}

export interface Fingerprint {
  readonly canvas: { readonly hash: string }
  readonly webgl: {
    readonly hash: string
    readonly renderer: string
    readonly vendor: string
    readonly version: string
    readonly shadingLanguageVersion: string
    readonly extensions: readonly string[]
  }
  readonly audio: { readonly hash: string }
  readonly navigator: {
    readonly userAgent: string
    readonly language: string
    readonly languages: readonly string[]
    readonly platform: string
    readonly hardwareConcurrency: number
    readonly deviceMemory: number | null
    readonly maxTouchPoints: number
    readonly cookieEnabled: boolean
    readonly doNotTrack: string | null
    readonly vendor: string
    readonly pluginCount: number
  }
  readonly screen: {
    readonly width: number
    readonly height: number
    readonly availWidth: number
    readonly availHeight: number
    readonly colorDepth: number
    readonly pixelDepth: number
    readonly devicePixelRatio: number
  }
  readonly collectedAt: number
  /** IANA time zone reported by the client; '' when absent (clients < 0.4.0). */
  readonly timezone: string
}

export interface DetectionData {
  readonly isAutomated: boolean
  readonly signals: readonly AutomationSignal[]
  readonly integrity: {
    readonly isValid: boolean
    readonly violations: readonly IntegrityViolation[]
  }
}

export interface AutomationSignal {
  readonly name: string
  readonly detected: boolean
  readonly detail?: string
}

export interface IntegrityViolation {
  readonly name: string
  readonly detail?: string
}

export interface BfMouseEvent {
  readonly type: string
  readonly x: number
  readonly y: number
  readonly t: number
  readonly buttons: number
}

export interface BfKeyboardEvent {
  readonly type: string
  readonly code: string
  readonly t: number
}

export interface BfScrollEvent {
  readonly x: number
  readonly y: number
  readonly t: number
}

export interface BehaviorData {
  readonly mouse: readonly BfMouseEvent[]
  readonly keyboard: readonly BfKeyboardEvent[]
  readonly scroll: readonly BfScrollEvent[]
  readonly totalMouseEvents: number
  readonly totalKeyboardEvents: number
  readonly totalScrollEvents: number
  readonly snapshotAt: number
}

// ─── Decision ───────────────────────────────────────────────────────────────

export type DecisionType = 'allow' | 'challenge' | 'block'

/** Full decision with internal diagnostic data — never expose to clients */
export interface Decision {
  readonly decision: DecisionType
  readonly score: number
  readonly instantBlock: boolean
  readonly reasons: readonly string[]
}

/** Safe to return to clients — no score, no reasons, no internal data */
export interface ClientSafeDecision {
  readonly decision: DecisionType
}

/** Helper to strip internal fields from a Decision */
export function toClientSafeDecision(decision: Decision): ClientSafeDecision {
  return { decision: decision.decision }
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface BoltFraudServerConfig extends RiskEngineConfig {
  readonly privateKeyPem?: string
  readonly publicKeyPem?: string
  readonly additionalKeys?: readonly { readonly keyId: number; readonly publicKeyPem: string; readonly privateKeyPem: string }[]
  /** Key id used by getPublicKey() and as the default private key. Default 0. */
  readonly defaultKeyId?: number
  /** Accept unencrypted dev tokens. Throws at creation when NODE_ENV === 'production'. */
  readonly devMode?: boolean
  /** Called when a token fails to decrypt. */
  readonly onError?: (err: unknown) => void
}

// ─── Store ──────────────────────────────────────────────────────────────────

export interface FingerprintStore {
  saveFingerprint(fingerprintHash: string, ip: string): Promise<void>
  getIPCount(fingerprintHash: string): Promise<number>
  /**
   * Atomically claim a nonce. Resolves true if this call claimed it (first use),
   * false if it was already claimed (replay). The claim expires after ttlMs.
   */
  claimNonce?(nonce: string, ttlMs: number): Promise<boolean>
  close?(): Promise<void>
}
