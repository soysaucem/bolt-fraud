import type { DetectionData } from '../model/types.js'

/**
 * Signals that trigger an immediate block regardless of total score.
 * These indicate definitive automated/bot environments.
 */
const INSTANT_BLOCK_SIGNALS = new Set([
  'webdriver_present',
  'puppeteer_runtime',
  'playwright_runtime',
  'selenium_runtime',
  'phantom_runtime',
])

/**
 * Signals that are strong indicators but not definitive — contribute score instead
 * of triggering instant block.
 */
const SCORED_SIGNALS: ReadonlyMap<string, number> = new Map([
  ['languages_empty', 10],
  ['connection_rtt_zero', 10],
  ['stack_trace_headless', 15],
  ['user_agent_headless', 20],
])

/**
 * Score automation detection signals.
 * Returns score, whether to instant-block, and the reasons array.
 * Does NOT mutate any external state.
 */
export function scoreAutomation(
  detection: DetectionData,
): { readonly score: number; readonly instantBlock: boolean; readonly reasons: readonly string[] } {
  let score = 0
  let instantBlock = false
  const reasons: string[] = []

  // Check automation signals
  if (detection.isAutomated) {
    for (const signal of detection.signals) {
      if (!signal.detected) continue

      if (INSTANT_BLOCK_SIGNALS.has(signal.name)) {
        instantBlock = true
        reasons.push(`instant_block:${signal.name}`)
      } else {
        const contribution = SCORED_SIGNALS.get(signal.name)
        if (contribution !== undefined) {
          score += contribution
          reasons.push(signal.name)
        }
      }
    }
  }

  // Check integrity violations for instant-block
  if (!detection.integrity.isValid) {
    for (const violation of detection.integrity.violations) {
      if (
        violation.name === 'native_function_toString_overridden' ||
        violation.name === 'window_event_target_chain_broken' ||
        violation.name === 'document_node_chain_broken'
      ) {
        instantBlock = true
        reasons.push(`instant_block:${violation.name}`)
      }
    }
  }

  return { score, instantBlock, reasons }
}
