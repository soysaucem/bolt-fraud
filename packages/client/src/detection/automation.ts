import type { AutomationResult, AutomationSignal, AutomationSignalName } from '../types.js'

/**
 * Detect automation tools: Puppeteer, Playwright, Selenium, PhantomJS.
 * Uses global property checks, stack trace inspection, UA analysis.
 * Reference: sws-chunk-6476.js line ~4503-4742
 */
export async function detectAutomation(): Promise<AutomationResult> {
  const signals: AutomationSignal[] = []

  function push(name: AutomationSignalName, detected: boolean, detail?: string): void {
    signals.push({ name, detected, detail })
  }

  const w = window as unknown as Record<string, unknown>

  // 1. WebDriver flag (set by ChromeDriver, GeckoDriver, etc.)
  push('webdriver_present', navigator.webdriver === true)

  // 2. Puppeteer runtime
  const hasPuppeteerGlobal =
    typeof w['__puppeteer_evaluation_script__'] !== 'undefined'
  push('puppeteer_runtime', hasPuppeteerGlobal)

  // 3. Playwright runtime
  const hasPlaywright =
    typeof w['__playwright'] !== 'undefined' ||
    typeof w['_playwrightInstance'] !== 'undefined'
  push('playwright_runtime', hasPlaywright)

  // 4. Selenium runtime — various injected globals
  const hasSelenium =
    typeof w['_selenium'] !== 'undefined' ||
    typeof w['__webdriver_evaluate'] !== 'undefined' ||
    typeof w['__selenium_evaluate'] !== 'undefined' ||
    typeof w['__webdriver_script_function'] !== 'undefined' ||
    typeof w['__webdriverFunc'] !== 'undefined' ||
    typeof w['domAutomation'] !== 'undefined' ||
    typeof w['domAutomationController'] !== 'undefined'
  push('selenium_runtime', hasSelenium)

  // 5. PhantomJS runtime
  const hasPhantom =
    typeof w['_phantom'] !== 'undefined' || typeof w['callPhantom'] !== 'undefined'
  push('phantom_runtime', hasPhantom)

  // 6. Stack trace analysis — check for automation framework frames
  const stack = captureStack().toLowerCase()
  // Only the injected-script markers: a bare "webdriver" or "selenium" substring
  // appears in legitimate URLs and library names.
  const stackHeadless = /__(puppeteer|playwright)_evaluation_script__/.test(stack)
  push('stack_trace_headless', stackHeadless, stackHeadless ? 'automation frame in stack' : undefined)

  // 7. Headless user-agent detection
  const uaHeadless = /HeadlessChrome|PhantomJS/i.test(navigator.userAgent)
  push(
    'user_agent_headless',
    uaHeadless,
    uaHeadless ? navigator.userAgent : undefined,
  )

  // 8. Empty languages — bots often have no language preferences
  // Cast to allow for undefined in non-standard browsers
  const languages = (navigator as Navigator & { languages?: readonly string[] }).languages
  const langEmpty = !languages || languages.length === 0
  push('languages_empty', langEmpty)

  // 9. Connection RTT === 0 — Chrome quantises RTT, so 0 happens on fast LANs.
  // Always reported as not detected; the name stays for wire compatibility.
  push('connection_rtt_zero', false)

  return {
    isAutomated: signals.some((s) => s.detected),
    signals,
  }
}

export function captureStack(): string {
  try {
    throw new Error('stack_probe')
  } catch (e) {
    return e instanceof Error ? (e.stack ?? '') : ''
  }
}
