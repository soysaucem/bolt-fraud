import { describe, it, expect } from 'vitest'
import { scoreFingerprint } from '../src/scoring/fingerprint.js'
import { createMockFingerprint } from './helpers.js'

// ─── scoreFingerprint ─────────────────────────────────────────────────────────

describe('scoreFingerprint', () => {
  it('returns score 0 when all fingerprint fields are valid', () => {
    // Arrange: valid fingerprint with non-empty hashes and non-zero concurrency
    const fp = createMockFingerprint()

    // Act
    const { score, reasons } = scoreFingerprint(fp)

    // Assert
    expect(score).toBe(0)
    expect(reasons).toHaveLength(0)
  })

  it('adds 25 when canvas hash is empty string', () => {
    const fp = createMockFingerprint({ canvas: { hash: '' } })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(25)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
  })

  it('adds 25 when canvas hash is "0"', () => {
    const fp = createMockFingerprint({ canvas: { hash: '0' } })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(25)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
  })

  it('does not add canvas penalty when canvas hash is a non-empty, non-zero value', () => {
    const fp = createMockFingerprint({ canvas: { hash: 'abc123' } })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(0)
    expect(reasons).not.toContain('canvas_fingerprint_empty_or_zero')
  })

  it('adds 25 when webgl hash is empty string', () => {
    const fp = createMockFingerprint({
      webgl: {
        hash: '',
        renderer: 'ANGLE',
        vendor: 'Google',
        version: 'WebGL 2.0',
        shadingLanguageVersion: 'GLSL 3.00',
        extensions: [],
      },
    })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(25)
    expect(reasons).toContain('webgl_fingerprint_empty')
  })

  it('adds 25 when webgl renderer is empty string (even if hash is non-empty)', () => {
    const fp = createMockFingerprint({
      webgl: {
        hash: 'somehash',
        renderer: '',
        vendor: 'Google',
        version: 'WebGL 2.0',
        shadingLanguageVersion: 'GLSL 3.00',
        extensions: [],
      },
    })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(25)
    expect(reasons).toContain('webgl_fingerprint_empty')
  })

  it('does not add webgl penalty when both hash and renderer are non-empty', () => {
    const fp = createMockFingerprint()

    const { reasons } = scoreFingerprint(fp)

    expect(reasons).not.toContain('webgl_fingerprint_empty')
  })

  it.each(['', '0', 'validaudiohash'])('does not score the retired audio hash (%j)', (hash) => {
    const fp = createMockFingerprint({ audio: { hash } })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(0)
    expect(reasons).toEqual([])
  })

  it('adds 5 when hardwareConcurrency is 0', () => {
    const fp = createMockFingerprint({
      navigator: {
        userAgent: 'Mozilla/5.0',
        language: 'en-US',
        languages: ['en-US'],
        platform: 'MacIntel',
        hardwareConcurrency: 0,
        deviceMemory: 8,
        maxTouchPoints: 0,
        cookieEnabled: true,
        doNotTrack: null,
        vendor: 'Apple',
        pluginCount: 0,
      },
    })

    const { score, reasons } = scoreFingerprint(fp)

    expect(score).toBe(5)
    expect(reasons).toContain('hardware_concurrency_zero')
  })

  it('does not add hardware concurrency penalty when hardwareConcurrency > 0', () => {
    const fp = createMockFingerprint({
      navigator: {
        userAgent: 'Mozilla/5.0',
        language: 'en-US',
        languages: ['en-US'],
        platform: 'MacIntel',
        hardwareConcurrency: 4,
        deviceMemory: 8,
        maxTouchPoints: 0,
        cookieEnabled: true,
        doNotTrack: null,
        vendor: 'Apple',
        pluginCount: 0,
      },
    })

    const { reasons } = scoreFingerprint(fp)

    expect(reasons).not.toContain('hardware_concurrency_zero')
  })

  it('adds 55 total when all three signals are bad (canvas + webgl + hardwareConcurrency)', () => {
    // Arrange: everything is empty/zero
    const fp = createMockFingerprint({
      canvas: { hash: '' },
      webgl: {
        hash: '',
        renderer: '',
        vendor: '',
        version: '',
        shadingLanguageVersion: '',
        extensions: [],
      },
      audio: { hash: '' },
      navigator: {
        userAgent: 'Mozilla/5.0',
        language: 'en-US',
        languages: ['en-US'],
        platform: '',
        hardwareConcurrency: 0,
        deviceMemory: null,
        maxTouchPoints: 0,
        cookieEnabled: false,
        doNotTrack: null,
        vendor: '',
        pluginCount: 0,
      },
    })

    // Act
    const { score, reasons } = scoreFingerprint(fp)

    // Assert: 25 + 25 + 5 = 55 (audio is no longer scored)
    expect(score).toBe(55)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
    expect(reasons).toContain('webgl_fingerprint_empty')
    expect(reasons).toContain('hardware_concurrency_zero')
  })

  it('accumulates reasons for each individual failure independently', () => {
    // Arrange: canvas empty but others valid
    const fp = createMockFingerprint({ canvas: { hash: '' } })

    const { reasons } = scoreFingerprint(fp)

    // Should only have the one reason
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe('canvas_fingerprint_empty_or_zero')
  })

  it('returns a reasons array containing only the triggered reasons', () => {
    const fp = createMockFingerprint({ canvas: { hash: '' } })

    const { reasons } = scoreFingerprint(fp)

    expect(Array.isArray(reasons)).toBe(true)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
    // Each call returns its own independent array (not a shared reference)
    const { reasons: reasons2 } = scoreFingerprint(fp)
    expect(reasons2).not.toBe(reasons)
  })

  describe('fingerprint_suppressed_suspicious', () => {
    it('adds +10 when canvas AND webgl are both empty but UA looks like a real browser (Chrome)', () => {
      // Arrange: canvas empty + webgl empty + Chrome UA → suspicious suppression
      const fp = createMockFingerprint({
        canvas: { hash: '' },
        webgl: {
          hash: '',
          renderer: '',
          vendor: '',
          version: '',
          shadingLanguageVersion: '',
          extensions: [],
        },
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          language: 'en-US',
          languages: ['en-US'],
          platform: 'Win32',
          hardwareConcurrency: 8,
          deviceMemory: 8,
          maxTouchPoints: 0,
          cookieEnabled: true,
          doNotTrack: null,
          vendor: 'Google Inc.',
          pluginCount: 3,
        },
      })

      // Act
      const { score, reasons } = scoreFingerprint(fp)

      // Assert: canvas(+25) + webgl(+25) + suppressed_suspicious(+10) = 60
      expect(reasons).toContain('fingerprint_suppressed_suspicious')
      expect(score).toBe(60)
    })

    it('adds +10 when canvas AND webgl are both empty but UA looks like Firefox', () => {
      // Arrange
      const fp = createMockFingerprint({
        canvas: { hash: '' },
        webgl: {
          hash: '',
          renderer: '',
          vendor: '',
          version: '',
          shadingLanguageVersion: '',
          extensions: [],
        },
        navigator: {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
          language: 'en-US',
          languages: ['en-US'],
          platform: 'Linux x86_64',
          hardwareConcurrency: 4,
          deviceMemory: null,
          maxTouchPoints: 0,
          cookieEnabled: true,
          doNotTrack: null,
          vendor: '',
          pluginCount: 0,
        },
      })

      // Act
      const { score, reasons } = scoreFingerprint(fp)

      // Assert: fingerprint_suppressed_suspicious should fire
      expect(reasons).toContain('fingerprint_suppressed_suspicious')
    })

    it('does NOT add fingerprint_suppressed_suspicious when UA is too short (< 20 chars)', () => {
      // Arrange: UA contains "Chrome" but is too short to be a real browser UA
      const fp = createMockFingerprint({
        canvas: { hash: '' },
        webgl: {
          hash: '',
          renderer: '',
          vendor: '',
          version: '',
          shadingLanguageVersion: '',
          extensions: [],
        },
        navigator: {
          userAgent: 'Chrome',
          language: 'en-US',
          languages: ['en-US'],
          platform: '',
          hardwareConcurrency: 4,
          deviceMemory: null,
          maxTouchPoints: 0,
          cookieEnabled: true,
          doNotTrack: null,
          vendor: '',
          pluginCount: 0,
        },
      })

      // Act
      const { reasons } = scoreFingerprint(fp)

      // Assert: UA length is too short (≤ 20), so the check doesn't fire
      expect(reasons).not.toContain('fingerprint_suppressed_suspicious')
    })

    it('does NOT add fingerprint_suppressed_suspicious when only canvas is empty (webgl OK)', () => {
      // Arrange: canvas empty, webgl non-empty (both must be empty to trigger)
      const fp = createMockFingerprint({ canvas: { hash: '' } })

      // Act
      const { reasons } = scoreFingerprint(fp)

      // Assert
      expect(reasons).not.toContain('fingerprint_suppressed_suspicious')
    })
  })

  describe('screen_dimensions_zero', () => {
    it('adds +10 when screen width, height, AND colorDepth are all 0', () => {
      // Arrange: classic headless zero-dimensions
      const fp = createMockFingerprint({
        screen: {
          width: 0,
          height: 0,
          availWidth: 0,
          availHeight: 0,
          colorDepth: 0,
          pixelDepth: 0,
          devicePixelRatio: 1,
        },
      })

      // Act
      const { score, reasons } = scoreFingerprint(fp)

      // Assert
      expect(reasons).toContain('screen_dimensions_zero')
      expect(score).toBe(10)
    })

    it('does NOT add screen_dimensions_zero when only width is 0 (height and colorDepth non-zero)', () => {
      // Arrange: partial zero — all three must be 0 to trigger
      const fp = createMockFingerprint({
        screen: {
          width: 0,
          height: 1080,
          availWidth: 1920,
          availHeight: 1080,
          colorDepth: 24,
          pixelDepth: 24,
          devicePixelRatio: 2,
        },
      })

      // Act
      const { reasons } = scoreFingerprint(fp)

      // Assert
      expect(reasons).not.toContain('screen_dimensions_zero')
    })

    it('does NOT add screen_dimensions_zero when width and height are 0 but colorDepth is non-zero', () => {
      // Arrange
      const fp = createMockFingerprint({
        screen: {
          width: 0,
          height: 0,
          availWidth: 0,
          availHeight: 0,
          colorDepth: 24,
          pixelDepth: 24,
          devicePixelRatio: 1,
        },
      })

      // Act
      const { reasons } = scoreFingerprint(fp)

      // Assert: colorDepth != 0 so the check does not fire
      expect(reasons).not.toContain('screen_dimensions_zero')
    })
  })

  describe('devicePixelRatio', () => {
    it('does not penalise DPR 1.0 on a wide display (2560x1440 monitors are common)', () => {
      const fp = createMockFingerprint({
        screen: {
          width: 2560,
          height: 1440,
          availWidth: 2560,
          availHeight: 1400,
          colorDepth: 24,
          pixelDepth: 24,
          devicePixelRatio: 1.0,
        },
      })

      const { score, reasons } = scoreFingerprint(fp)

      expect(score).toBe(0)
      expect(reasons).not.toContain('headless_default_dpr')
    })
  })
})
