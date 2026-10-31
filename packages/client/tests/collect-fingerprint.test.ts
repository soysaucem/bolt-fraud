// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

const order: string[] = []

vi.mock('../src/fingerprint/canvas.js', () => ({
  getCanvasFingerprint: vi.fn(async () => {
    order.push('canvas')
    return { hash: 'canvas-hash' }
  }),
}))

vi.mock('../src/fingerprint/webgl.js', () => ({
  getWebGLFingerprint: vi.fn(async () => {
    order.push('webgl')
    return {
      hash: 'webgl-hash',
      renderer: 'R',
      vendor: 'V',
      version: '2',
      shadingLanguageVersion: '3',
      extensions: [],
    }
  }),
}))

import { collectFingerprint, yieldToIdle } from '../src/fingerprint/index.js'

describe('collectFingerprint', () => {
  afterEach(() => {
    order.length = 0
    vi.unstubAllGlobals()
  })

  it('starts each probe in its own macrotask', async () => {
    // Fake idle API absent in jsdom: yieldToIdle falls back to setTimeout(0)
    vi.stubGlobal('requestIdleCallback', undefined)
    const tick = () => {
      order.push('tick')
      setTimeout(tick, 0)
    }
    setTimeout(tick, 0)

    const result = await collectFingerprint()
    // Stop the tick loop by making it a no-op on the next turn
    order.push('end')

    const canvasAt = order.indexOf('canvas')
    const webglAt = order.indexOf('webgl')
    expect(canvasAt).toBeGreaterThanOrEqual(0)
    expect(webglAt).toBeGreaterThan(canvasAt)
    // At least one other task ran between the two probes
    expect(order.slice(canvasAt + 1, webglAt)).toContain('tick')
    expect(result.canvas.hash).toBe('canvas-hash')
    expect(result.webgl.hash).toBe('webgl-hash')
  })

  it('uses requestIdleCallback with a 50 ms timeout when available', async () => {
    const ric = vi.fn((cb: () => void, _options?: { timeout: number }) => {
      cb()
      return 1
    })
    vi.stubGlobal('requestIdleCallback', ric)

    await collectFingerprint()

    expect(ric).toHaveBeenCalledTimes(2)
    for (const call of ric.mock.calls) expect(call[1]).toEqual({ timeout: 50 })
  })

  it('falls back to setTimeout when requestIdleCallback is missing', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const spy = vi.spyOn(globalThis, 'setTimeout')
    try {
      await yieldToIdle()
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 0)
    } finally {
      spy.mockRestore()
    }
  })

  it('never constructs an audio context', async () => {
    const offline = vi.fn()
    const audio = vi.fn()
    vi.stubGlobal('OfflineAudioContext', offline)
    vi.stubGlobal('webkitOfflineAudioContext', offline)
    vi.stubGlobal('AudioContext', audio)

    const result = await collectFingerprint()

    expect(offline).not.toHaveBeenCalled()
    expect(audio).not.toHaveBeenCalled()
    expect('audio' in result).toBe(false)
  })

  it('includes the timezone and collectedAt', async () => {
    const result = await collectFingerprint()

    expect(result.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(result.collectedAt).toBeGreaterThan(0)
  })
})
