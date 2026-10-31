// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock heavy dependencies before importing the SDK so they don't run real browser APIs
vi.mock('../src/fingerprint/index.js', () => ({
  collectFingerprint: vi.fn().mockResolvedValue({
    canvas: { hash: 'canvas-mock' },
    webgl: {
      hash: 'webgl-mock',
      renderer: 'Mock Renderer',
      vendor: 'Mock Vendor',
      version: 'WebGL 2.0',
      shadingLanguageVersion: 'GLSL 3.00',
      extensions: [],
    },
    navigator: {
      userAgent: 'Mozilla/5.0 Mock',
      language: 'en-US',
      languages: ['en-US'],
      platform: 'MockOS',
      hardwareConcurrency: 4,
      deviceMemory: null,
      maxTouchPoints: 0,
      cookieEnabled: true,
      doNotTrack: null,
      vendor: 'Mock',
      pluginCount: 0,
    },
    screen: {
      width: 1280,
      height: 720,
      availWidth: 1280,
      availHeight: 700,
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio: 1,
    },
    timezone: 'UTC',
    collectedAt: 1700000000000,
  }),
}))

vi.mock('../src/detection/index.js', () => ({
  runDetection: vi.fn().mockResolvedValue({
    isAutomated: false,
    signals: [],
    integrity: { isValid: true, violations: [] },
  }),
}))

vi.mock('../src/transport/hook.js', () => ({
  installFetchHook: vi.fn(),
  installXHRHook: vi.fn(),
  uninstallHooks: vi.fn(),
}))

// Import SDK after mocks are set up
import { init, getToken, destroy, isReady } from '../src/index.js'
import { runDetection } from '../src/detection/index.js'
import { collectFingerprint } from '../src/fingerprint/index.js'
import { installFetchHook, installXHRHook } from '../src/transport/hook.js'
import { deserialize } from '../src/transport/serializer.js'
import { base64urlDecode } from '../src/transport/crypto.js'
import type { BoltFraudConfig } from '../src/types.js'

const BASE: BoltFraudConfig = { serverUrl: 'https://api.example.com', devMode: true }

const runDetectionMock = vi.mocked(runDetection)
const collectFingerprintMock = vi.mocked(collectFingerprint)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ─── SDK init() lifecycle ─────────────────────────────────────────────────────

describe('SDK init() lifecycle', () => {
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await destroy()
    runDetectionMock.mockClear()
    collectFingerprintMock.mockClear()
  })

  // ── init() validation ────────────────────────────────────────────────────────

  describe('init() validation', () => {
    const cases: Array<[string, Partial<BoltFraudConfig>, RegExp]> = [
      ['serverUrl missing', { serverUrl: undefined as unknown as string }, /config\.serverUrl is required/],
      ['serverUrl empty', { serverUrl: '' }, /config\.serverUrl is required/],
      ['ringBufferSize 0', { ringBufferSize: 0 }, /ringBufferSize/],
      ['ringBufferSize 1025', { ringBufferSize: 1025 }, /ringBufferSize/],
      ['ringBufferSize fractional', { ringBufferSize: 2.5 }, /ringBufferSize/],
      ['keyId 256', { keyId: 256 }, /keyId/],
      ['keyId -1', { keyId: -1 }, /keyId/],
      ['no publicKey and no devMode', { devMode: false }, /publicKey is required/],
      ['hookFetch without patterns', { hookFetch: true }, /protectedPatterns/],
      ['hookXHR with empty patterns', { hookXHR: true, protectedPatterns: [] }, /protectedPatterns/],
    ]

    it.each(cases)('throws when %s', async (_name, override, message) => {
      let thrown: unknown
      try {
        await init({ ...BASE, ...override })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toMatch(message)
      expect(isReady()).toBe(false)
      expect(runDetectionMock).not.toHaveBeenCalled()
    })

    it('does not throw with a valid config', async () => {
      await expect(init(BASE)).resolves.toBeUndefined()
      expect(isReady()).toBe(true)
    })

    it('accepts a publicKey without devMode', async () => {
      await expect(
        init({ serverUrl: 'https://api.example.com', publicKey: 'pem' }),
      ).resolves.toBeUndefined()
    })
  })

  // ── getToken() before init ───────────────────────────────────────────────────

  describe('getToken() before init()', () => {
    it('rejects when init() was never called', async () => {
      await expect(getToken()).rejects.toThrow('[bolt-fraud] SDK not initialized — call init() first')
    })

    it('succeeds when called while init() is still running', async () => {
      const detection = deferred<Awaited<ReturnType<typeof runDetection>>>()
      runDetectionMock.mockReturnValueOnce(detection.promise)

      const initPromise = init(BASE)
      const tokenPromise = getToken()
      detection.resolve({ isAutomated: false, signals: [], integrity: { isValid: true, violations: [] } })

      await initPromise
      await expect(tokenPromise).resolves.toMatchObject({ v: 1 })
    })
  })

  // ── SSR ──────────────────────────────────────────────────────────────────────

  describe('without a window (SSR)', () => {
    it('init resolves without touching state and getToken rejects', async () => {
      vi.stubGlobal('window', undefined)

      await expect(init(BASE)).resolves.toBeUndefined()
      expect(runDetectionMock).not.toHaveBeenCalled()
      expect(isReady()).toBe(false)
      await expect(getToken()).rejects.toThrow(/not initialized/)
    })
  })

  // ── destroy() resets state ────────────────────────────────────────────────────

  describe('destroy() resets state', () => {
    it('getToken() rejects after destroy() is called', async () => {
      await init(BASE)
      await destroy()
      await expect(getToken()).rejects.toThrow('[bolt-fraud] SDK not initialized — call init() first')
    })

    it('can be re-initialized after destroy()', async () => {
      await init(BASE)
      await destroy()
      await expect(init(BASE)).resolves.toBeUndefined()
      expect(runDetectionMock).toHaveBeenCalledTimes(2)
    })

    it('never calls onTokenReady when destroyed mid-collection', async () => {
      const fingerprint = deferred<Awaited<ReturnType<typeof collectFingerprint>>>()
      const original = await collectFingerprintMock.getMockImplementation()!()
      collectFingerprintMock.mockReturnValueOnce(fingerprint.promise)
      const onTokenReady = vi.fn()
      await init({ ...BASE, onTokenReady })

      const tokenPromise = getToken()
      const outcome = tokenPromise.then(
        () => 'resolved',
        () => 'rejected',
      )
      await destroy()
      fingerprint.resolve(original)

      expect(await outcome).toBe('rejected')
      expect(onTokenReady).not.toHaveBeenCalled()
    })
  })

  // ── init() failure ────────────────────────────────────────────────────────────

  describe('init() failure', () => {
    it('rejects, stays not ready, retries detection, and leaves no unhandled rejection', async () => {
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const onError = vi.fn()
        runDetectionMock.mockRejectedValueOnce(new Error('detection boom'))

        await expect(init({ ...BASE, onError })).rejects.toThrow('detection boom')
        expect(isReady()).toBe(false)
        expect(onError).toHaveBeenCalledTimes(1)
        await expect(getToken()).rejects.toThrow(/not initialized/)

        runDetectionMock.mockClear()
        await expect(init(BASE)).resolves.toBeUndefined()
        expect(runDetectionMock).toHaveBeenCalledTimes(1)
        expect(isReady()).toBe(true)

        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('does not install hooks or start state when detection fails', async () => {
      runDetectionMock.mockRejectedValueOnce(new Error('boom'))
      vi.mocked(installFetchHook).mockClear()

      await expect(
        init({ ...BASE, hookFetch: true, protectedPatterns: [/api/] }),
      ).rejects.toThrow('boom')
      expect(installFetchHook).not.toHaveBeenCalled()
    })
  })

  // ── init() idempotency ───────────────────────────────────────────────────────

  describe('init() idempotency', () => {
    it('two concurrent same-config inits share one promise and one detection', async () => {
      const first = init(BASE)
      const second = init({ ...BASE })

      expect(second).toBe(first)
      await first
      expect(runDetectionMock).toHaveBeenCalledTimes(1)
    })

    it('a resolved same-config init is a no-op', async () => {
      await init(BASE)
      await init({ ...BASE })
      expect(runDetectionMock).toHaveBeenCalledTimes(1)
    })

    it('compares RegExp patterns by source and flags', async () => {
      const a = { ...BASE, protectedPatterns: [/api/g] }
      await init(a)
      await init({ ...BASE, protectedPatterns: [/api/g] })
      expect(runDetectionMock).toHaveBeenCalledTimes(1)
      await init({ ...BASE, protectedPatterns: [/api/i] })
      expect(runDetectionMock).toHaveBeenCalledTimes(2)
    })

    it('a different config destroys and re-initialises', async () => {
      await init(BASE)
      await init({ ...BASE, serverUrl: 'https://api.other.com' })
      expect(runDetectionMock).toHaveBeenCalledTimes(2)
      expect(isReady()).toBe(true)
    })

    it('a different config while init is in flight re-initialises cleanly', async () => {
      const first = init(BASE)
      const second = init({ ...BASE, behavior: false })
      await Promise.all([first, second])
      expect(runDetectionMock).toHaveBeenCalledTimes(2)
      expect(isReady()).toBe(true)
    })
  })

  // ── hooks are opt-in ─────────────────────────────────────────────────────────

  describe('hooks', () => {
    it('are not installed by default', async () => {
      vi.mocked(installFetchHook).mockClear()
      vi.mocked(installXHRHook).mockClear()
      await init(BASE)
      expect(installFetchHook).not.toHaveBeenCalled()
      expect(installXHRHook).not.toHaveBeenCalled()
    })

    it('are installed only when opted in', async () => {
      vi.mocked(installFetchHook).mockClear()
      vi.mocked(installXHRHook).mockClear()
      await init({ ...BASE, hookFetch: true, hookXHR: true, protectedPatterns: [/api/] })
      expect(installFetchHook).toHaveBeenCalledTimes(1)
      expect(installXHRHook).toHaveBeenCalledTimes(1)
    })
  })

  // ── fingerprint cached, token fresh ───────────────────────────────────────────

  describe('getToken() caching', () => {
    it('collects the fingerprint once but never reuses nonce or timestamp', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      await init(BASE)
      collectFingerprintMock.mockClear()
      const tokens = []
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(1000)
        tokens.push(await getToken())
      }
      vi.useRealTimers()

      // Warmup already ran during init (before mockClear); getToken never re-collects
      expect(collectFingerprintMock).not.toHaveBeenCalled()
      const payloads = tokens.map((t) => deserialize(base64urlDecode(t.token)))
      expect(new Set(payloads.map((p) => p.nonce)).size).toBe(3)
      expect(new Set(payloads.map((p) => p.timestamp)).size).toBe(3)
    })

    it('shares one collection between warmup and concurrent getToken() calls', async () => {
      await init(BASE)
      expect(collectFingerprintMock).toHaveBeenCalledTimes(1)
      const [a, b] = await Promise.all([getToken(), getToken()])
      expect(collectFingerprintMock).toHaveBeenCalledTimes(1)
      expect(a.token).not.toBe(b.token)
    })

    it('does not cache a failed collection', async () => {
      collectFingerprintMock.mockRejectedValueOnce(new Error('probe boom'))
      await init(BASE)
      // The failed warmup is not cached: the next call collects again and succeeds
      await expect(getToken()).rejects.toThrow('probe boom')
      await expect(getToken()).resolves.toMatchObject({ v: 1 })
      expect(collectFingerprintMock).toHaveBeenCalledTimes(2)
    })

    it('produces a token carrying the build-time sdk version', async () => {
      await init(BASE)
      const { token } = await getToken()
      const payload = deserialize(base64urlDecode(token))
      expect(payload.sdkVersion).toBe(__SDK_VERSION__)
      expect(payload.sdkVersion).not.toBe('1.0.0')
    })
  })

  // ── timers ────────────────────────────────────────────────────────────────────

  describe('getToken() timers', () => {
    it('leaves no timers pending after success', async () => {
      vi.useFakeTimers()
      await init(BASE)
      await getToken()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('leaves no timers pending after failure', async () => {
      vi.useFakeTimers()
      await init(BASE)
      await destroy()
      await expect(getToken()).rejects.toThrow()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('rejects with a timeout when collection hangs', async () => {
      vi.useFakeTimers()
      const hang = new Promise<never>(() => {})
      collectFingerprintMock.mockReturnValueOnce(hang)
      const onError = vi.fn()
      await init({ ...BASE, onError })

      const outcome = getToken(100).catch((err: Error) => err)
      await vi.advanceTimersByTimeAsync(101)
      expect(await outcome).toMatchObject({ message: expect.stringMatching(/timed out/) })
      expect(onError).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  // ── callbacks ─────────────────────────────────────────────────────────────────

  describe('callbacks', () => {
    it('onTokenReady receives the token', async () => {
      const onTokenReady = vi.fn()
      await init({ ...BASE, onTokenReady })
      const token = await getToken()
      expect(onTokenReady).toHaveBeenCalledWith(token)
    })

    it('a throwing onTokenReady is routed to onError and does not fail getToken', async () => {
      const failure = new Error('callback boom')
      const onError = vi.fn()
      await init({
        ...BASE,
        onError,
        onTokenReady: () => {
          throw failure
        },
      })
      await expect(getToken()).resolves.toMatchObject({ v: 1 })
      expect(onError).toHaveBeenCalledWith(failure)
    })
  })

  // ── behavior option ───────────────────────────────────────────────────────────

  describe('behavior: false', () => {
    it('registers no document listeners and sends a valid empty behavior block', async () => {
      const add = vi.spyOn(document, 'addEventListener')
      try {
        await init({ ...BASE, behavior: false })
        const behaviorTypes = ['pointermove', 'pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'scroll']
        const registered = add.mock.calls.map((call) => call[0])
        for (const type of behaviorTypes) expect(registered).not.toContain(type)

        const { token } = await getToken()
        const payload = deserialize(base64urlDecode(token))
        expect(payload.behavior.mouse).toEqual([])
        expect(payload.behavior.keyboard).toEqual([])
        expect(payload.behavior.scroll).toEqual([])
        expect(payload.behavior.totalMouseEvents).toBe(0)
        expect(payload.behavior.snapshotAt).toBeGreaterThanOrEqual(0)
      } finally {
        add.mockRestore()
      }
    })

    it('registers listeners by default', async () => {
      const add = vi.spyOn(document, 'addEventListener')
      try {
        await init(BASE)
        const registered = add.mock.calls.map((call) => call[0])
        expect(registered).toEqual(expect.arrayContaining(['pointermove', 'keydown', 'scroll']))
      } finally {
        add.mockRestore()
      }
    })
  })
})
