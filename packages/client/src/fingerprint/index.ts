import type { FingerprintData } from '../types.js'
import { getCanvasFingerprint } from './canvas.js'
import { getWebGLFingerprint } from './webgl.js'
import { getNavigatorInfo } from './navigator.js'
import { getScreenInfo } from './screen.js'
import { getTimezone } from './timezone.js'

/**
 * Resolve on the next idle period (max 50 ms wait) so each probe runs in its own task.
 * Safari has no requestIdleCallback; fall back to a macrotask.
 */
export function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 50 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Collect all device fingerprint signals, one probe per task, never blocking the UI.
 */
export async function collectFingerprint(): Promise<FingerprintData> {
  const navigatorInfo = getNavigatorInfo()
  const screenInfo = getScreenInfo()
  const timezone = getTimezone()

  await yieldToIdle()
  const canvas = await getCanvasFingerprint()
  await yieldToIdle()
  const webgl = await getWebGLFingerprint()

  return {
    canvas,
    webgl,
    navigator: navigatorInfo,
    screen: screenInfo,
    timezone,
    collectedAt: Date.now(),
  }
}
