import { describe, it, expect } from 'vitest'
import { scoreAutomation } from '../src/scoring/automation.js'
import { createMockDetection, createAutomationSignal } from './helpers.js'

// ─── scoreAutomation ──────────────────────────────────────────────────────────

describe('scoreAutomation', () => {
  it('returns score 0 and no instant block when no signals detected', () => {
    // Arrange
    const detection = createMockDetection()
    const reasons: string[] = []

    // Act
    const result = scoreAutomation(detection, reasons)

    // Assert
    expect(result.score).toBe(0)
    expect(result.instantBlock).toBe(false)
    expect(reasons).toHaveLength(0)
  })

  it('returns score 0 and no instant block when isAutomated is false even if signals exist', () => {
    // Arrange: signals present but isAutomated=false
    const detection = createMockDetection({
      isAutomated: false,
      signals: [createAutomationSignal('webdriver_present', true)],
    })
    const reasons: string[] = []

    // Act
    const result = scoreAutomation(detection, reasons)

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
      const reasons: string[] = []

      // Act
      const result = scoreAutomation(detection, reasons)

      // Assert
      expect(result.instantBlock).toBe(true)
      expect(result.score).toBe(0) // automation scoring itself doesn't add to score
      expect(reasons).toContain(`instant_block:${signalName}`)
    })

    it('does not trigger instant block for user_agent_headless (not in instant-block set)', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('user_agent_headless', true)],
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(false)
      expect(reasons).toHaveLength(0)
    })

    it('does not trigger instant block for stack_trace_headless (not in instant-block set)', () => {
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('stack_trace_headless', true)],
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(false)
    })

    it('does not trigger instant block for signals that are detected=false', () => {
      // Signal is in instant-block set but detected is false
      const detection = createMockDetection({
        isAutomated: true,
        signals: [createAutomationSignal('webdriver_present', false)],
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(false)
      expect(reasons).toHaveLength(0)
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
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(true)
      expect(reasons).toContain('instant_block:webdriver_present')
      expect(reasons).toContain('instant_block:puppeteer_runtime')
      expect(reasons).toContain('instant_block:selenium_runtime')
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
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(true)
      expect(reasons).toContain('instant_block:native_function_toString_overridden')
    })

    it('triggers instant block when window_event_target_chain_broken violation is present', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'window_event_target_chain_broken' }],
        },
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(true)
      expect(reasons).toContain('instant_block:window_event_target_chain_broken')
    })

    it('triggers instant block when document_node_chain_broken violation is present', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'document_node_chain_broken' }],
        },
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(true)
      expect(reasons).toContain('instant_block:document_node_chain_broken')
    })

    it('does not trigger instant block for non-critical violations like fetch_native_overridden', () => {
      const detection = createMockDetection({
        isAutomated: false,
        integrity: {
          isValid: false,
          violations: [{ name: 'fetch_native_overridden' }],
        },
      })
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

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
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(false)
      expect(reasons).toHaveLength(0)
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
      const reasons: string[] = []

      const result = scoreAutomation(detection, reasons)

      expect(result.instantBlock).toBe(true)
      expect(reasons).toContain('instant_block:webdriver_present')
      expect(reasons).toContain('instant_block:native_function_toString_overridden')
    })
  })
})
