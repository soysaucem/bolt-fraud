import { describe, it, expect } from 'vitest'
import { scoreAutomation } from '../src/scoring/automation.js'
import { createMockDetection, createAutomationSignal } from './helpers.js'

// ─── scoreAutomation ──────────────────────────────────────────────────────────

describe('scoreAutomation', () => {
  it('returns score 0 and no instant block when no signals detected', () => {
    // Arrange
    const detection = createMockDetection()

    // Act
    const result = scoreAutomation(detection)

    // Assert
    expect(result.score).toBe(0)
    expect(result.instantBlock).toBe(false)
    expect(result.reasons).toHaveLength(0)
  })

  it('returns score 0 and no instant block when isAutomated is false even if signals exist', () => {
    // Arrange: signals present but isAutomated=false
    const detection = createMockDetection({
      isAutomated: false,
      signals: [createAutomationSignal('webdriver_present', true)],
    })

    // Act
    const result = scoreAutomation(detection)

    // Assert: the outer isAutomated guard prevents processing signals
    expect(result.instantBlock).toBe(false)
    expect(result.score).toBe(0)
  })

  describe('instant-block signals', () => {
    it.each([
      'webdriver_present',
      'puppeteer_runtime',
      'playwright_runtime',
      'selenium_runtime',
      'phantom_runtime',
    ])('triggers instant block when %s is detected', (signalName) => {
      // Arrange
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal(signalName, true)],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert
      expect(result.instantBlock).toBe(true)
      expect(result.score).toBe(0) // automation scoring itself doesn't add to score
      expect(result.reasons).toContain(`instant_block:${signalName}`)
    })

    it('does not trigger instant block for user_agent_headless (not in instant-block set)', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('user_agent_headless', true)],
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(false)
      expect(result.reasons).toHaveLength(0)
    })

    it('does not trigger instant block for stack_trace_headless (not in instant-block set)', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('stack_trace_headless', true)],
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(false)
    })

    it('does not trigger instant block for signals that are detected=false', () => {
      // Signal is in instant-block set but detected is false
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('webdriver_present', false)],
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(false)
      expect(result.reasons).toHaveLength(0)
    })

    it('is idempotent: multiple instant-block signals still result in instantBlock=true', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [
          createAutomationSignal('webdriver_present', true),
          createAutomationSignal('puppeteer_runtime', true),
          createAutomationSignal('selenium_runtime', true),
        ],
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(true)
      expect(result.reasons).toContain('instant_block:webdriver_present')
      expect(result.reasons).toContain('instant_block:puppeteer_runtime')
      expect(result.reasons).toContain('instant_block:selenium_runtime')
    })
  })

  describe('integrity violations that trigger instant block', () => {
    it('triggers instant block when native_function_toString_overridden violation is present', () => {
      const detection = createMockDetection({
        isAutomated: false,
        signals: [],
        integrity: {
          isValid: false,
          violations: [{ name: 'native_function_toString_overridden' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(true)
      expect(result.reasons).toContain('instant_block:native_function_toString_overridden')
    })

    it('triggers instant block when window_event_target_chain_broken violation is present', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'window_event_target_chain_broken' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(true)
      expect(result.reasons).toContain('instant_block:window_event_target_chain_broken')
    })

    it('triggers instant block when document_node_chain_broken violation is present', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'document_node_chain_broken' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(true)
      expect(result.reasons).toContain('instant_block:document_node_chain_broken')
    })

    it('does not trigger instant block for non-critical violations like fetch_native_overridden', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'fetch_native_overridden' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(false)
    })

    it('does not process violations when integrity.isValid is true', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: true,
          violations: [{ name: 'native_function_toString_overridden' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(false)
      expect(result.reasons).toHaveLength(0)
    })
  })

  describe('combination of signals and violations', () => {
    it('triggers instant block when both signal and integrity violation are present', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('webdriver_present', true)],
        integrity: {
          isValid: false,
          violations: [{ name: 'native_function_toString_overridden' }],
        },
      })

      const result = scoreAutomation(detection)

      expect(result.instantBlock).toBe(true)
      expect(result.reasons).toContain('instant_block:webdriver_present')
      expect(result.reasons).toContain('instant_block:native_function_toString_overridden')
    })
  })

  describe('SCORED_SIGNALS: signals that add score instead of instant block', () => {
    it('adds +10 score for languages_empty signal when isAutomated=true', () => {
      // Arrange: languages_empty is in SCORED_SIGNALS with contribution 10
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('languages_empty', true)],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert: scored signal — no instant block, +10 score, reason pushed
      expect(result.instantBlock).toBe(false)
      expect(result.score).toBe(10)
      expect(result.reasons).toContain('languages_empty')
    })

    it('adds +10 score for connection_rtt_zero signal when isAutomated=true', () => {
      // Arrange: connection_rtt_zero is in SCORED_SIGNALS with contribution 10
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('connection_rtt_zero', true)],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert
      expect(result.instantBlock).toBe(false)
      expect(result.score).toBe(10)
      expect(result.reasons).toContain('connection_rtt_zero')
    })

    it('adds +20 total when both languages_empty and connection_rtt_zero are detected', () => {
      // Arrange: both SCORED_SIGNALS detected together
      const detection = createMockDetection({
        isAutomated: true,
        signals: [
          createAutomationSignal('languages_empty', true),
          createAutomationSignal('connection_rtt_zero', true),
        ],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert
      expect(result.instantBlock).toBe(false)
      expect(result.score).toBe(20)
      expect(result.reasons).toContain('languages_empty')
      expect(result.reasons).toContain('connection_rtt_zero')
    })

    it('does NOT score languages_empty when isAutomated=false', () => {
      // Arrange: the isAutomated guard prevents scored signals from firing
      const detection = createMockDetection({
        isAutomated: false,
        signals: [createAutomationSignal('languages_empty', true)],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert
      expect(result.score).toBe(0)
      expect(result.reasons).not.toContain('languages_empty')
    })

    it('does NOT score languages_empty when detected=false', () => {
      // Arrange: signal present in array but not detected
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('languages_empty', false)],
      })

      // Act
      const result = scoreAutomation(detection)

      // Assert
      expect(result.score).toBe(0)
      expect(result.reasons).not.toContain('languages_empty')
    })
  })
})
