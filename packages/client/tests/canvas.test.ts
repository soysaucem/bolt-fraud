// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import { getCanvasFingerprint } from '../src/fingerprint/canvas.js'

// jsdom does not provide crypto.subtle — wire in Node's webcrypto so that
// canvas.ts can call crypto.subtle.digest('SHA-256', ...) in the test environment.
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * jsdom stubs canvas.getContext('2d') to return null — it does not implement
 * the 2D rendering API. To test getCanvasFingerprint we spy on
 * HTMLCanvasElement.prototype.getContext and return a minimal fake context
 * whose getImageData returns controlled RGBA pixel data.
 *
 * The fake context implements only the surface area that canvas.ts calls:
 * fillStyle, fillRect, beginPath, arc, stroke, moveTo, quadraticCurveTo,
 * createLinearGradient, font, measureText, fillText, lineWidth, strokeStyle,
 * and getImageData.
 */
function makeFakeContext(imageData: ImageData): CanvasRenderingContext2D {
  const gradient = {
    addColorStop: vi.fn(),
  }

  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue(gradient),
    measureText: vi.fn().mockReturnValue({ width: 0 }),
    fillText: vi.fn(),
    getImageData: vi.fn().mockReturnValue(imageData),
  } as unknown as CanvasRenderingContext2D
}

/**
 * Build a minimal ImageData-like object with the given RGBA pixel bytes.
 * canvas.ts only accesses imageData.data, so width/height are informational.
 */
function makeImageData(pixels: Uint8ClampedArray, width = 400, height = 200): ImageData {
  return { data: pixels, width, height, colorSpace: 'srgb' } as unknown as ImageData
}

/**
 * Spy on HTMLCanvasElement.prototype.getContext so that every canvas created
 * during the test receives a fake context that returns the supplied pixel data.
 */
function mockCanvasWithPixels(pixels: Uint8ClampedArray): void {
  const imageData = makeImageData(pixels)
  const fakeCtx = makeFakeContext(imageData)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx)
}

// ─── getCanvasFingerprint ──────────────────────────────────────────────────────

describe('getCanvasFingerprint', () => {
  describe('return shape', () => {
    it('returns an object with a hash property', async () => {
      // Arrange: stable pixel data so SHA-256 can complete
      const pixels = new Uint8ClampedArray(400 * 200 * 4).fill(128)
      mockCanvasWithPixels(pixels)

      // Act
      const result = await getCanvasFingerprint()

      // Assert
      expect(result).toHaveProperty('hash')
    })

    it('returns a 64-character lowercase hex string (SHA-256 output shape)', async () => {
      // Arrange
      const pixels = new Uint8ClampedArray(400 * 200 * 4).fill(200)
      mockCanvasWithPixels(pixels)

      // Act
      const { hash } = await getCanvasFingerprint()

      // Assert: SHA-256 → 32 bytes → 64 hex chars, all lowercase
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('determinism', () => {
    it('produces the same hash for identical pixel data on two calls', async () => {
      // Arrange: same pixel array for both calls
      const pixels = new Uint8ClampedArray(400 * 200 * 4).fill(42)

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixels)))
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixels)))

      // Act
      const first = await getCanvasFingerprint()
      const second = await getCanvasFingerprint()

      // Assert: hash is deterministic — same pixels always produce same digest
      expect(first.hash).toBe(second.hash)
      expect(first.hash).not.toBe('')
    })

    it('produces a non-empty hash when pixel data is all zeros (blank canvas)', async () => {
      // Arrange: blank canvas (transparent black)
      const pixels = new Uint8ClampedArray(400 * 200 * 4).fill(0)
      mockCanvasWithPixels(pixels)

      // Act
      const { hash } = await getCanvasFingerprint()

      // Assert: all-zero pixels still produce a valid SHA-256 hash
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces a non-empty hash when pixel data is all 255 (white canvas)', async () => {
      // Arrange: fully white, fully opaque pixels
      const pixels = new Uint8ClampedArray(400 * 200 * 4).fill(255)
      mockCanvasWithPixels(pixels)

      // Act
      const { hash } = await getCanvasFingerprint()

      // Assert
      expect(hash).toHaveLength(64)
      expect(hash).not.toBe('')
    })
  })

  describe('sensitivity to pixel data changes', () => {
    it('produces a different hash when pixel data changes by a single byte', async () => {
      // Arrange: two pixel arrays differing by one byte at position 0
      const pixelsA = new Uint8ClampedArray(400 * 200 * 4).fill(0)
      const pixelsB = new Uint8ClampedArray(400 * 200 * 4).fill(0)
      pixelsB[0] = 1 // flip one channel of the first pixel

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixelsA)))
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixelsB)))

      // Act
      const hashA = (await getCanvasFingerprint()).hash
      const hashB = (await getCanvasFingerprint()).hash

      // Assert: SHA-256 is collision-resistant — any pixel change changes the digest
      expect(hashA).not.toBe(hashB)
      expect(hashA).toHaveLength(64)
      expect(hashB).toHaveLength(64)
    })

    it('produces a different hash when a pixel channel in the middle changes (subpixel difference)', async () => {
      // Arrange: differ at an interior pixel to simulate GPU subpixel rendering differences
      const pixelsA = new Uint8ClampedArray(400 * 200 * 4).fill(255)
      const pixelsB = new Uint8ClampedArray(400 * 200 * 4).fill(255)
      const midIndex = Math.floor((400 * 200 * 4) / 2)
      pixelsB[midIndex] = 254

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixelsA)))
        .mockReturnValueOnce(makeFakeContext(makeImageData(pixelsB)))

      // Act
      const hashA = (await getCanvasFingerprint()).hash
      const hashB = (await getCanvasFingerprint()).hash

      // Assert
      expect(hashA).not.toBe(hashB)
    })
  })

  describe('error handling', () => {
    it('returns empty hash when getImageData throws SecurityError (tainted canvas)', async () => {
      // Arrange: simulate a cross-origin tainted canvas — getImageData throws
      const fakeCtx = makeFakeContext(makeImageData(new Uint8ClampedArray(4)))
      ;(fakeCtx.getImageData as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const err = new DOMException(
          'The canvas has been tainted by cross-origin data.',
          'SecurityError',
        )
        throw err
      })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx)

      // Act
      const { hash } = await getCanvasFingerprint()

      // Assert: graceful degradation — returns empty string rather than throwing
      expect(hash).toBe('')
    })

    it('returns empty hash when getContext returns null (canvas API unavailable)', async () => {
      // Arrange: simulate a context creation failure (e.g. max canvas contexts exceeded)
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

      // Act
      const { hash } = await getCanvasFingerprint()

      // Assert
      expect(hash).toBe('')
    })
  })
})
