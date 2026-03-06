import type {
  TokenPayload,
  FingerprintData,
  AutomationResult,
  IntegrityResult,
  BehaviorData,
  BfMouseEvent,
  BfKeyboardEvent,
  BfScrollEvent,
} from '../src/types.js'

export function createMockFingerprint(overrides?: Partial<FingerprintData>): FingerprintData {
  return {
    canvas: { hash: 'abc123canvashash' },
    webgl: {
      hash: 'def456webglhash',
      renderer: 'ANGLE (Intel, Mesa)',
      vendor: 'Google Inc.',
      version: 'WebGL 2.0',
      shadingLanguageVersion: 'WebGL GLSL ES 3.00',
      extensions: ['OES_texture_float', 'EXT_color_buffer_float'],
    },
    audio: { hash: 'ghi789audiohash' },
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      language: 'en-US',
      languages: ['en-US', 'en'],
      platform: 'MacIntel',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      cookieEnabled: true,
      doNotTrack: null,
      vendor: 'Apple Computer, Inc.',
      pluginCount: 3,
    },
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1057,
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio: 2,
    },
    collectedAt: 1700000000000,
    ...overrides,
  }
}

export function createMockAutomationResult(overrides?: Partial<AutomationResult>): AutomationResult {
  return {
    isAutomated: false,
    signals: [
      { name: 'webdriver_present', detected: false },
      { name: 'user_agent_headless', detected: false },
      { name: 'languages_empty', detected: false },
    ],
    ...overrides,
  }
}

export function createMockIntegrityResult(overrides?: Partial<IntegrityResult>): IntegrityResult {
  return {
    isValid: true,
    violations: [],
    ...overrides,
  }
}

export function createMockDetection(): AutomationResult & { integrity: IntegrityResult } {
  return {
    ...createMockAutomationResult(),
    integrity: createMockIntegrityResult(),
  }
}

export function createMockBehavior(overrides?: Partial<BehaviorData>): BehaviorData {
  const mouse: BfMouseEvent[] = [
    { type: 'move', x: 100, y: 200, t: 1000, buttons: 0 },
    { type: 'move', x: 150, y: 220, t: 1016, buttons: 0 },
    { type: 'click', x: 150, y: 220, t: 1050, buttons: 1 },
  ]
  const keyboard: BfKeyboardEvent[] = [
    { type: 'keydown', code: 'KeyA', t: 2000 },
    { type: 'keyup', code: 'KeyA', t: 2100 },
  ]
  const scroll: BfScrollEvent[] = [
    { x: 0, y: 100, t: 3000 },
  ]

  return {
    mouse,
    keyboard,
    scroll,
    totalMouseEvents: 3,
    totalKeyboardEvents: 2,
    totalScrollEvents: 1,
    snapshotAt: 5000,
    ...overrides,
  }
}

export function createMockTokenPayload(overrides?: Partial<TokenPayload>): TokenPayload {
  return {
    fingerprint: createMockFingerprint(),
    detection: createMockDetection(),
    behavior: createMockBehavior(),
    timestamp: 1700000000000,
    nonce: 'test-nonce-12345678',
    sdkVersion: '0.1.0',
    ...overrides,
  }
}
