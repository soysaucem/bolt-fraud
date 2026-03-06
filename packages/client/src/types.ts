// ─── Fingerprint ────────────────────────────────────────────────────────────

export interface CanvasFingerprint {
  readonly hash: string
}

export interface WebGLFingerprint {
  readonly hash: string
  readonly renderer: string
  readonly vendor: string
  readonly version: string
  readonly shadingLanguageVersion: string
  readonly extensions: readonly string[]
}

export interface AudioFingerprint {
  readonly hash: string
}

export interface NavigatorInfo {
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

export interface ScreenInfo {
  readonly width: number
  readonly height: number
  readonly availWidth: number
  readonly availHeight: number
  readonly colorDepth: number
  readonly pixelDepth: number
  readonly devicePixelRatio: number
}

export interface FingerprintData {
  readonly canvas: CanvasFingerprint
  readonly webgl: WebGLFingerprint
  readonly audio: AudioFingerprint
  readonly navigator: NavigatorInfo
  readonly screen: ScreenInfo
  readonly collectedAt: number
}

// ─── Detection ──────────────────────────────────────────────────────────────

export type AutomationSignalName =
  | 'webdriver_present'
  | 'puppeteer_runtime'
  | 'playwright_runtime'
  | 'selenium_runtime'
  | 'phantom_runtime'
  | 'stack_trace_headless'
  | 'user_agent_headless'
  | 'languages_empty'
  | 'connection_rtt_zero'

export interface AutomationSignal {
  readonly name: AutomationSignalName
  readonly detected: boolean
  readonly detail?: string
}

export interface AutomationResult {
  readonly isAutomated: boolean
  readonly signals: readonly AutomationSignal[]
}

export type IntegrityViolationName =
  | 'native_function_toString_overridden'
  | 'window_event_target_chain_broken'
  | 'document_node_chain_broken'
  | 'fetch_native_overridden'
  | 'xhr_open_overridden'
  | 'date_now_overridden'
  | 'performance_now_overridden'

export interface IntegrityViolation {
  readonly name: IntegrityViolationName
  readonly detail?: string
}

export interface IntegrityResult {
  readonly isValid: boolean
  readonly violations: readonly IntegrityViolation[]
}

// ─── Behavior ───────────────────────────────────────────────────────────────

export interface BfMouseEvent {
  readonly type: 'move' | 'down' | 'up' | 'click'
  readonly x: number
  readonly y: number
  readonly t: number
  readonly buttons: number
}

export interface BfKeyboardEvent {
  readonly type: 'keydown' | 'keyup'
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

// ─── Token ──────────────────────────────────────────────────────────────────

export interface TokenPayload {
  readonly fingerprint: FingerprintData
  readonly detection: AutomationResult & { readonly integrity: IntegrityResult }
  readonly behavior: BehaviorData
  readonly timestamp: number
  readonly nonce: string
  readonly sdkVersion: string
}

export interface EncryptedToken {
  readonly token: string
  readonly v: number
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface BoltFraudConfig {
  readonly serverUrl: string
  readonly publicKey?: string
  readonly keyId?: number
  readonly hookFetch?: boolean
  readonly hookXHR?: boolean
  readonly collectInterval?: number
  readonly ringBufferSize?: number
  readonly tokenHeader?: string
  readonly protectedPatterns?: readonly RegExp[]
  readonly onTokenReady?: (token: EncryptedToken) => void
  readonly onError?: (error: Error) => void
}
