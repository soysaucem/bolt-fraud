import type { ExecutionContext } from '@nestjs/common'
import type { Decision, Token } from '@soysaucem/bolt-fraud-server'

export type { Token }

export interface MockRequest {
  headers: Record<string, string | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
  boltFraudDecision?: Decision
}

export function createMockExecutionContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
    getClass: () => Object,
    getHandler: () => () => {},
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}), getPattern: () => '' }),
    getType: () => 'http' as const,
  } as unknown as ExecutionContext
}

export function createMockBoltFraud(
  verifyResult: Decision = {
    decision: 'allow',
    score: 0,
    instantBlock: false,
    reasons: [],
  },
) {
  return {
    verify: async (_token: string, _clientIP?: string) => verifyResult,
    getPublicKey: () => 'mock-public-key',
  }
}

export function createAllowDecision(score = 0): Decision {
  return { decision: 'allow', score, instantBlock: false, reasons: [] }
}

export function createBlockDecision(reasons: string[] = ['instant_block:webdriver_present']): Decision {
  return { decision: 'block', score: 100, instantBlock: true, reasons }
}

export function createChallengeDecision(score = 50): Decision {
  return { decision: 'challenge', score, instantBlock: false, reasons: ['suspicious_fingerprint'] }
}

// ─── Real-token helpers (v1 binary wire format, mirrors the client serializer) ───

export function createMockToken(): Token {
  return {
    timestamp: Date.now(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    sdkVersion: '0.4.0',
    fingerprint: {
      canvas: { hash: 'canvashash0123456789' },
      webgl: {
        hash: 'webglhash0123456789',
        renderer: 'ANGLE (Apple, Apple M2)',
        vendor: 'Google Inc.',
        version: 'WebGL 2.0',
        shadingLanguageVersion: 'WebGL GLSL ES 3.00',
        extensions: ['OES_texture_float'],
      },
      audio: { hash: '' },
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
        width: 1512,
        height: 982,
        availWidth: 1512,
        availHeight: 944,
        colorDepth: 30,
        pixelDepth: 30,
        devicePixelRatio: 2,
      },
      collectedAt: Date.now(),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    detection: { isAutomated: false, signals: [], integrity: { isValid: true, violations: [] } },
    behavior: {
      mouse: [
        { type: 'move', x: 100, y: 200, t: 1000, buttons: 0 },
        { type: 'move', x: 150, y: 220, t: 1016, buttons: 0 },
        { type: 'move', x: 120, y: 280, t: 1032, buttons: 0 },
        { type: 'click', x: 200, y: 300, t: 1064, buttons: 1 },
      ],
      keyboard: [{ type: 'keydown', code: '', t: 2000 }],
      scroll: [{ x: 0, y: 100, t: 3000 }],
      totalMouseEvents: 4,
      totalKeyboardEvents: 1,
      totalScrollEvents: 1,
      snapshotAt: 5000,
    },
  }
}

export function serializeToken(token: Token): Uint8Array {
  const bytes: number[] = []
  const u8 = (v: number) => void bytes.push(v & 0xff)
  const u16 = (v: number) => void bytes.push((v >> 8) & 0xff, v & 0xff)
  const u32 = (v: number) => void bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  const u64 = (v: number) => {
    u32(Math.floor(v / 0x1_0000_0000))
    u32(v >>> 0)
  }
  const str = (v: string) => {
    const enc = new TextEncoder().encode(v)
    u16(enc.length)
    bytes.push(...enc)
  }
  const fp = token.fingerprint

  u8(1)
  u64(token.timestamp)
  str(token.nonce)
  str(token.sdkVersion)
  str(fp.canvas.hash)
  str(fp.webgl.hash)
  str(fp.audio.hash)
  str(fp.webgl.renderer)
  str(fp.webgl.vendor)
  str(fp.webgl.version)
  str(fp.webgl.shadingLanguageVersion)
  u16(fp.webgl.extensions.length)
  fp.webgl.extensions.forEach(str)
  str(fp.navigator.userAgent)
  str(fp.navigator.language)
  u16(fp.navigator.hardwareConcurrency)
  u16(fp.navigator.maxTouchPoints)
  u16(fp.navigator.pluginCount)
  u8(fp.navigator.deviceMemory ?? 0)
  u8(fp.navigator.cookieEnabled ? 1 : 0)
  u16(fp.navigator.languages.length)
  fp.navigator.languages.forEach(str)
  str(fp.navigator.platform)
  str(fp.navigator.vendor)
  str(fp.navigator.doNotTrack ?? '')
  u16(fp.screen.width)
  u16(fp.screen.height)
  u16(fp.screen.availWidth)
  u16(fp.screen.availHeight)
  u8(fp.screen.colorDepth)
  u8(fp.screen.pixelDepth)
  u16(Math.round(fp.screen.devicePixelRatio * 100))
  u64(fp.collectedAt)
  u8(token.detection.isAutomated ? 1 : 0)
  u16(token.detection.signals.length)
  for (const sig of token.detection.signals) {
    str(sig.name)
    u8(sig.detected ? 1 : 0)
  }
  u8(token.detection.integrity.isValid ? 1 : 0)
  u16(token.detection.integrity.violations.length)
  for (const v of token.detection.integrity.violations) str(v.name)
  const b = token.behavior
  u16(b.mouse.length)
  for (const e of b.mouse) {
    str(e.type)
    u16(e.x)
    u16(e.y)
    u32(e.t)
    u8(e.buttons)
  }
  u16(b.keyboard.length)
  for (const e of b.keyboard) {
    str(e.type)
    str(e.code)
    u32(e.t)
  }
  u16(b.scroll.length)
  for (const e of b.scroll) {
    u16(e.x)
    u16(e.y)
    u32(e.t)
  }
  u32(b.totalMouseEvents)
  u32(b.totalKeyboardEvents)
  u32(b.totalScrollEvents)
  u64(b.snapshotAt)
  str(fp.timezone)
  return Uint8Array.from(bytes)
}
