// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/fingerprint/index.js', () => ({
  collectFingerprint: vi.fn().mockResolvedValue({
    canvas: { hash: 'c' },
    webgl: { hash: 'w', renderer: 'r', vendor: 'v', version: '2', shadingLanguageVersion: 's', extensions: [] },
    navigator: {
      userAgent: 'UA', language: 'en', languages: ['en'], platform: 'P', hardwareConcurrency: 4,
      deviceMemory: null, maxTouchPoints: 0, cookieEnabled: true, doNotTrack: null, vendor: 'v', pluginCount: 0,
    },
    screen: { width: 1, height: 1, availWidth: 1, availHeight: 1, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1 },
    timezone: 'UTC',
    collectedAt: 1,
  }),
}))
vi.mock('../src/detection/index.js', () => ({
  runDetection: vi.fn().mockResolvedValue({ isAutomated: false, signals: [], integrity: { isValid: true, violations: [] } }),
}))

import { AUDIO_CACHE_KEY, AUDIO_CACHE_TTL_MS, cachedAudioHash } from '../src/fingerprint/audio.js'
import { deserialize } from '../src/transport/serializer.js'
import { base64urlDecode } from '../src/transport/crypto.js'

type Sdk = typeof import('../src/index.js')

function fakeBuffer(): { getChannelData: () => Float32Array } {
  const data = new Float32Array(5120)
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i) * 0.5
  return { getChannelData: () => data }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

let ctor: ReturnType<typeof vi.fn>
let startRendering: ReturnType<typeof vi.fn>

function stubAudio(render: () => Promise<unknown>): void {
  startRendering = vi.fn(render)
  ctor = vi.fn(function (this: Record<string, unknown>) {
    this.destination = {}
    this.createOscillator = () => ({ type: '', frequency: {}, connect() {}, start() {} })
    this.createDynamicsCompressor = () => ({
      threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {},
    })
    this.startRendering = startRendering
  })
  vi.stubGlobal('OfflineAudioContext', ctor)
}

async function loadSdk(): Promise<Sdk> {
  vi.resetModules()
  return (await import('../src/index.js')) as Sdk
}

async function tokenAudio(sdk: Sdk): Promise<string> {
  const { token } = await sdk.getToken()
  return deserialize(base64urlDecode(token)).audioHash
}

/** Let timers, idle callbacks and promise chains run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('background audio probe', () => {
  let sdk: Sdk

  beforeEach(() => {
    localStorage.clear()
    setVisibility('visible')
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0))
  })

  afterEach(async () => {
    await sdk?.destroy()
    vi.unstubAllGlobals()
  })

  it('builds a token promptly with an empty hash while rendering never resolves', async () => {
    stubAudio(() => new Promise(() => {}))
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false })
    await flush()
    expect(startRendering).toHaveBeenCalled()
    expect(await tokenAudio(sdk)).toBe('')
  })

  it('constructs the context with (1, 5120, 44100)', async () => {
    stubAudio(async () => fakeBuffer())
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false })
    await flush()
    expect(ctor).toHaveBeenCalledWith(1, 5120, 44100)
  })

  it('carries the hash on the next token after a successful probe and caches it', async () => {
    stubAudio(async () => fakeBuffer())
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false })
    expect(await tokenAudio(sdk)).toBe('')
    await flush()
    const hash = await tokenAudio(sdk)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(localStorage.getItem(AUDIO_CACHE_KEY)!).hash).toBe(hash)
  })

  it('does not render again when a valid hash is cached', async () => {
    localStorage.setItem(
      AUDIO_CACHE_KEY,
      JSON.stringify({ v: 1, ua: navigator.userAgent, hash: 'a'.repeat(64), at: Date.now() }),
    )
    stubAudio(async () => fakeBuffer())
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false })
    await flush()
    expect(ctor).not.toHaveBeenCalled()
    expect(await tokenAudio(sdk)).toBe('a'.repeat(64))
  })

  it('yields an empty hash after a user agent change or TTL expiry', () => {
    const now = Date.now()
    const entry = { v: 1, ua: navigator.userAgent, hash: 'b'.repeat(64), at: now }
    localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(entry))
    expect(cachedAudioHash(now)).toBe('b'.repeat(64))
    expect(cachedAudioHash(now + AUDIO_CACHE_TTL_MS)).toBe('')
    localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify({ ...entry, ua: 'other-agent' }))
    expect(cachedAudioHash(now)).toBe('')
    localStorage.setItem(AUDIO_CACHE_KEY, '{not json')
    expect(cachedAudioHash(now)).toBe('')
  })

  it('renders nothing while the document is hidden until visibilitychange', async () => {
    setVisibility('hidden')
    stubAudio(async () => fakeBuffer())
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false })
    await flush()
    expect(ctor).not.toHaveBeenCalled()
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(ctor).toHaveBeenCalledTimes(1)
  })

  it('skips the probe when audio is disabled', async () => {
    stubAudio(async () => fakeBuffer())
    sdk = await loadSdk()
    await sdk.init({ serverUrl: 'https://x', devMode: true, behavior: false, audio: false })
    await flush()
    expect(ctor).not.toHaveBeenCalled()
    expect(await tokenAudio(sdk)).toBe('')
  })
})
