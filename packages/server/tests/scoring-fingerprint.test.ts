import { describe, it, expect } from 'vitest'
import { scoreFingerprint } from '../src/scoring/fingerprint.js'
import { createMockFingerprint } from './helpers.js'

// ─── scoreFingerprint ─────────────────────────────────────────────────────────

describe('scoreFingerprint', () => {
  it('returns score 0 when all fingerprint fields are valid', () => {
    // Arrange: valid fingerprint with non-empty hashes and non-zero concurrency
    const fp = createMockFingerprint()
    const reasons: string[] = []

    // Act
    const score = scoreFingerprint(fp, reasons)

    // Assert
    expect(score).toBe(0)
    expect(reasons).toHaveLength(0)
  })

  it('adds 25 when canvas hash is empty string', () => {
    const fp = createMockFingerprint({ canvas: { hash: '' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(score).toBe(25)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
  })

  it('adds 25 when canvas hash is "0"', () => {
    const fp = createMockFingerprint({ canvas: { hash: '0' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(score).toBe(25)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
  })

  it('does not add canvas penalty when canvas hash is a non-empty, non-zero value', () => {
    const fp = createMockFingerprint({ canvas: { hash: 'abc123' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

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
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

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
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(score).toBe(25)
    expect(reasons).toContain('webgl_fingerprint_empty')
  })

  it('does not add webgl penalty when both hash and renderer are non-empty', () => {
    const fp = createMockFingerprint()
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(reasons).not.toContain('webgl_fingerprint_empty')
  })

  it('adds 20 when audio hash is empty string', () => {
    const fp = createMockFingerprint({ audio: { hash: '' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(score).toBe(20)
    expect(reasons).toContain('audio_fingerprint_zero_or_empty')
  })

  it('adds 20 when audio hash is "0"', () => {
    const fp = createMockFingerprint({ audio: { hash: '0' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(score).toBe(20)
    expect(reasons).toContain('audio_fingerprint_zero_or_empty')
  })

  it('does not add audio penalty when audio hash is valid', () => {
    const fp = createMockFingerprint({ audio: { hash: 'validaudiohash' } })
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(reasons).not.toContain('audio_fingerprint_zero_or_empty')
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
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

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
    const reasons: string[] = []

    const score = scoreFingerprint(fp, reasons)

    expect(reasons).not.toContain('hardware_concurrency_zero')
  })

  it('adds 75 total when all four signals are bad (canvas + webgl + audio + hardwareConcurrency)', () => {
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
    const reasons: string[] = []

    // Act
    const score = scoreFingerprint(fp, reasons)

    // Assert: 25 + 25 + 20 + 5 = 75
    expect(score).toBe(75)
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
    expect(reasons).toContain('webgl_fingerprint_empty')
    expect(reasons).toContain('audio_fingerprint_zero_or_empty')
    expect(reasons).toContain('hardware_concurrency_zero')
  })

  it('accumulates reasons for each individual failure independently', () => {
    // Arrange: canvas empty but others valid
    const fp = createMockFingerprint({ canvas: { hash: '' } })
    const reasons: string[] = []

    scoreFingerprint(fp, reasons)

    // Should only have the one reason
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe('canvas_fingerprint_empty_or_zero')
  })

  it('mutates the passed-in reasons array (does not return a new one)', () => {
    const fp = createMockFingerprint({ canvas: { hash: '' } })
    const reasons: string[] = ['pre-existing-reason']

    scoreFingerprint(fp, reasons)

    // Should preserve pre-existing and add new
    expect(reasons).toContain('pre-existing-reason')
    expect(reasons).toContain('canvas_fingerprint_empty_or_zero')
  })
})
