// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
    audio: { hash: 'audio-mock' },
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
import { init, getToken, destroy } from '../src/index.js'

// ─── SDK init() lifecycle ─────────────────────────────────────────────────────

describe('SDK init() lifecycle', () => {
  // Always destroy after each test to reset module-level state
  afterEach(() => {
    destroy()
  })

  // ── init() validation ────────────────────────────────────────────────────────

  describe('init() validation', () => {
    it('throws when serverUrl is missing', async () => {
      // Arrange: config without serverUrl
      // Act + Assert
      await expect(
        // @ts-expect-error — intentionally passing invalid config to test runtime validation
        init({ publicKey: undefined }),
      ).rejects.toThrow('[bolt-fraud] config.serverUrl is required')
    })

    it('throws when serverUrl is an empty string', async () => {
      // Act + Assert
      await expect(
        init({ serverUrl: '' }),
      ).rejects.toThrow('[bolt-fraud] config.serverUrl is required')
    })

    it('does not throw with a valid serverUrl', async () => {
      // Act + Assert
      await expect(
        init({ serverUrl: 'https://api.example.com' }),
      ).resolves.toBeUndefined()
    })
  })

  // ── getToken() before init ───────────────────────────────────────────────────

  describe('getToken() before init()', () => {
    it('throws when called before init()', async () => {
      // Arrange: ensure destroyed state
      destroy()

      // Act + Assert
      await expect(getToken()).rejects.toThrow(
        '[bolt-fraud] SDK not initialized — call init() first',
      )
    })
  })

  // ── destroy() resets state ────────────────────────────────────────────────────

  describe('destroy() resets state', () => {
    it('getToken() throws after destroy() is called', async () => {
      // Arrange: initialize first
      await init({ serverUrl: 'https://api.example.com' })

      // Act: destroy
      destroy()

      // Assert: calling getToken() now throws
      await expect(getToken()).rejects.toThrow(
        '[bolt-fraud] SDK not initialized — call init() first',
      )
    })

    it('can be re-initialized after destroy()', async () => {
      // Arrange: init, destroy, then re-init
      await init({ serverUrl: 'https://api.example.com' })
      destroy()

      // Act + Assert: second init should succeed
      await expect(
        init({ serverUrl: 'https://api.example.com' }),
      ).resolves.toBeUndefined()
    })
  })

  // ── init() idempotency ───────────────────────────────────────────────────────

  describe('init() idempotency', () => {
    it('calling init() twice with the same serverUrl is a no-op (second call returns without re-running)', async () => {
      // Arrange
      const { runDetection } = await import('../src/detection/index.js')
      const runDetectionMock = vi.mocked(runDetection)
      runDetectionMock.mockClear()

      // Act: call init() twice with the same serverUrl
      await init({ serverUrl: 'https://api.example.com' })
      await init({ serverUrl: 'https://api.example.com' })

      // Assert: runDetection was called only once (second call was a no-op)
      expect(runDetectionMock).toHaveBeenCalledTimes(1)
    })

    it('calling init() with a different serverUrl re-initializes', async () => {
      // Arrange
      const { runDetection } = await import('../src/detection/index.js')
      const runDetectionMock = vi.mocked(runDetection)
      runDetectionMock.mockClear()

      // Act: call init() with different serverUrls
      await init({ serverUrl: 'https://api.example.com' })
      await init({ serverUrl: 'https://api.other.com' })

      // Assert: runDetection was called twice (different serverUrl triggers re-init)
      expect(runDetectionMock).toHaveBeenCalledTimes(2)
    })
  })
})
