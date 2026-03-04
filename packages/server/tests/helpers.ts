import type {
  Token,
  Fingerprint,
  DetectionData,
  BehaviorData,
  AutomationSignal,
} from '../src/model/types.js'

export function createMockFingerprint(overrides?: Partial<Fingerprint>): Fingerprint {
  return {
    canvas: { hash: 'abc123canvashash' },
    webgl: {
      hash: 'def456webglhash',
      renderer: 'ANGLE (Intel, Mesa)',
      vendor: 'Google Inc.',
      version: 'WebGL 2.0',
      shadingLanguageVersion: 'WebGL GLSL ES 3.00',
      extensions: ['OES_texture_float'],
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
      colorDepth: 24,
      devicePixelRatio: 2,
    },
    collectedAt: 1700000000000,
    ...overrides,
  }
}

export function createMockDetection(overrides?: Partial<DetectionData>): DetectionData {
  return {
    isAutomated: false,
    signals: [],
    integrity: {
      isValid: true,
      violations: [],
    },
    ...overrides,
  }
}

export function createMockBehavior(overrides?: Partial<BehaviorData>): BehaviorData {
  return {
    mouse: [
      { type: 'move', x: 100, y: 200, t: 1000 },
      { type: 'move', x: 150, y: 220, t: 1016 },
      { type: 'move', x: 120, y: 280, t: 1032 },
      { type: 'move', x: 180, y: 240, t: 1048 },
      { type: 'click', x: 200, y: 300, t: 1064 },
    ],
    keyboard: [
      { type: 'keydown', code: 'KeyA', t: 2000 },
      { type: 'keyup', code: 'KeyA', t: 2100 },
    ],
    scroll: [{ x: 0, y: 100, t: 3000 }],
    totalMouseEvents: 5,
    totalKeyboardEvents: 2,
    totalScrollEvents: 1,
    snapshotAt: 5000,
    ...overrides,
  }
}

export function createMockToken(overrides?: Partial<Token>): Token {
  return {
    fingerprint: createMockFingerprint(),
    detection: createMockDetection(),
    behavior: createMockBehavior(),
    timestamp: Date.now(),
    nonce: 'test-nonce-12345678',
    sdkVersion: '0.1.0',
    ...overrides,
  }
}

export function createAutomationSignal(
  name: string,
  detected: boolean,
  detail?: string,
): AutomationSignal {
  return { name, detected, ...(detail !== undefined ? { detail } : {}) }
}
