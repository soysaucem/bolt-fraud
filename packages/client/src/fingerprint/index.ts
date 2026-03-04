import type { FingerprintData } from '../types.js'
import { getCanvasFingerprint } from './canvas.js'
import { getWebGLFingerprint } from './webgl.js'
import { getAudioFingerprint } from './audio.js'
import { getNavigatorInfo } from './navigator.js'
import { getScreenInfo } from './screen.js'

/**
 * Collect all device fingerprint signals in parallel.
 */
export async function collectFingerprint(): Promise<FingerprintData> {
  const [canvas, webgl, audio] = await Promise.all([
    getCanvasFingerprint(),
    getWebGLFingerprint(),
    getAudioFingerprint(),
  ])

  return {
    canvas,
    webgl,
    audio,
    navigator: getNavigatorInfo(),
    screen: getScreenInfo(),
    collectedAt: Date.now(),
  }
}
