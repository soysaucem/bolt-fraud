// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectAutomation, captureStack } from '../src/detection/automation.js'

describe('captureStack', () => {
  it('returns a non-empty string containing a stack trace', () => {
    const stack = captureStack()
    expect(typeof stack).toBe('string')
    // Stack trace should reference the file that threw
    expect(stack.length).toBeGreaterThan(0)
  })

  it('returns a string (does not throw)', () => {
    expect(() => captureStack()).not.toThrow()
  })
})

describe('detectAutomation', () => {
  // Save originals to restore after each test
  let originalWebdriver: boolean | undefined
  let originalLanguages: readonly string[]
  let originalUserAgent: string

  beforeEach(() => {
    // jsdom defaults: navigator.webdriver is false/undefined, languages is ['en-US']
    originalWebdriver = navigator.webdriver
    originalLanguages = navigator.languages
    originalUserAgent = navigator.userAgent
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Restore window properties set during tests
    const w = window as Record<string, unknown>
    delete w['__puppeteer_evaluation_script__']
    delete w['__playwright']
    delete w['_playwrightInstance']
    delete w['_selenium']
    delete w['__webdriver_evaluate']
    delete w['__selenium_evaluate']
    delete w['__webdriver_script_function']
    delete w['__webdriverFunc']
    delete w['domAutomation']
    delete w['domAutomationController']
    delete w['_phantom']
    delete w['callPhantom']
  })

  it('returns an AutomationResult object with isAutomated and signals array', async () => {
    const result = await detectAutomation()

    expect(result).toHaveProperty('isAutomated')
    expect(result).toHaveProperty('signals')
    expect(Array.isArray(result.signals)).toBe(true)
    expect(typeof result.isAutomated).toBe('boolean')
  })

  it('returns all expected signal names in the signals array', async () => {
    const result = await detectAutomation()
    const names = result.signals.map((s) => s.name)

    expect(names).toContain('webdriver_present')
    expect(names).toContain('puppeteer_runtime')
    expect(names).toContain('playwright_runtime')
    expect(names).toContain('selenium_runtime')
    expect(names).toContain('phantom_runtime')
    expect(names).toContain('stack_trace_headless')
    expect(names).toContain('user_agent_headless')
    expect(names).toContain('languages_empty')
    expect(names).toContain('connection_rtt_zero')
  })

  it('each signal has a name and detected boolean', async () => {
    const result = await detectAutomation()

    for (const signal of result.signals) {
      expect(typeof signal.name).toBe('string')
      expect(typeof signal.detected).toBe('boolean')
    }
  })

  it('detects webdriver_present when navigator.webdriver is true', async () => {
    // Arrange: spoof the webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true })

    // Act
    const result = await detectAutomation()

    // Assert
    const signal = result.signals.find((s) => s.name === 'webdriver_present')
    expect(signal?.detected).toBe(true)
    expect(result.isAutomated).toBe(true)
  })

  it('does not detect webdriver_present when navigator.webdriver is false', async () => {
    // jsdom defaults to false
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'webdriver_present')
    expect(signal?.detected).toBe(false)
  })

  it('detects puppeteer_runtime when __puppeteer_evaluation_script__ is present on window', async () => {
    // Arrange
    ;(window as Record<string, unknown>)['__puppeteer_evaluation_script__'] = true

    // Act
    const result = await detectAutomation()

    // Assert
    const signal = result.signals.find((s) => s.name === 'puppeteer_runtime')
    expect(signal?.detected).toBe(true)
    expect(result.isAutomated).toBe(true)
  })

  it('detects playwright_runtime when __playwright is present on window', async () => {
    // Arrange
    ;(window as Record<string, unknown>)['__playwright'] = {}

    // Act
    const result = await detectAutomation()

    // Assert
    const signal = result.signals.find((s) => s.name === 'playwright_runtime')
    expect(signal?.detected).toBe(true)
    expect(result.isAutomated).toBe(true)
  })

  it('detects playwright_runtime when _playwrightInstance is present on window', async () => {
    ;(window as Record<string, unknown>)['_playwrightInstance'] = {}

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'playwright_runtime')
    expect(signal?.detected).toBe(true)
  })

  it('detects selenium_runtime when domAutomation is present on window', async () => {
    ;(window as Record<string, unknown>)['domAutomation'] = true

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'selenium_runtime')
    expect(signal?.detected).toBe(true)
    expect(result.isAutomated).toBe(true)
  })

  it('detects selenium_runtime when domAutomationController is present on window', async () => {
    ;(window as Record<string, unknown>)['domAutomationController'] = {}

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'selenium_runtime')
    expect(signal?.detected).toBe(true)
  })

  it('detects phantom_runtime when _phantom is present on window', async () => {
    ;(window as Record<string, unknown>)['_phantom'] = {}

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'phantom_runtime')
    expect(signal?.detected).toBe(true)
    expect(result.isAutomated).toBe(true)
  })

  it('detects phantom_runtime when callPhantom is present on window', async () => {
    ;(window as Record<string, unknown>)['callPhantom'] = () => {}

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'phantom_runtime')
    expect(signal?.detected).toBe(true)
  })

  it('detects user_agent_headless when navigator.userAgent contains HeadlessChrome', async () => {
    // Arrange
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0',
    )

    // Act
    const result = await detectAutomation()

    // Assert
    const signal = result.signals.find((s) => s.name === 'user_agent_headless')
    expect(signal?.detected).toBe(true)
    expect(signal?.detail).toBeDefined()
    expect(result.isAutomated).toBe(true)
  })

  it('detects user_agent_headless when navigator.userAgent contains PhantomJS', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('PhantomJS/2.1.1')

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'user_agent_headless')
    expect(signal?.detected).toBe(true)
  })

  it('does not detect user_agent_headless for a normal Chrome UA', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    )

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'user_agent_headless')
    expect(signal?.detected).toBe(false)
  })

  it('isAutomated is false when no automation signals are detected (clean jsdom)', async () => {
    // jsdom: no webdriver, no headless UA, has languages
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
    )
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en'] as unknown as readonly string[])

    const result = await detectAutomation()

    // With no signals detected, isAutomated should be false
    expect(result.isAutomated).toBe(false)
  })

  it('isAutomated is true when at least one signal is detected', async () => {
    Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true })

    const result = await detectAutomation()

    expect(result.isAutomated).toBe(true)
  })

  it('languages_empty is detected when navigator.languages is empty', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([] as unknown as readonly string[])

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'languages_empty')
    expect(signal?.detected).toBe(true)
  })

  it('languages_empty is not detected when navigator.languages has values', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'] as unknown as readonly string[])

    const result = await detectAutomation()

    const signal = result.signals.find((s) => s.name === 'languages_empty')
    expect(signal?.detected).toBe(false)
  })
})
