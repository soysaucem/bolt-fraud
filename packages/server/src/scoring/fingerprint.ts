import type { Fingerprint } from '../model/types.js'

/**
 * Score fingerprint consistency signals.
 *
 * Score contributions:
 *   canvas empty/zero:                          +25  canvas_fingerprint_empty
 *   webgl hash empty OR renderer empty:         +25  webgl_fingerprint_empty
 *   audio hash empty/zero:                      +20  audio_fingerprint_zero
 *   hardwareConcurrency === 0:                  + 5  hardware_concurrency_zero
 *   canvas+webgl both empty but real UA:        +10  fingerprint_suppressed_suspicious
 *   screen dimensions all 0:                   +10  screen_dimensions_zero
 *   devicePixelRatio === 1.0 AND width > 1920:  + 5  headless_default_dpr
 */
export function scoreFingerprint(
  fp: Fingerprint,
  reasons: string[],
): number {
  let score = 0

  const canvasEmpty = fp.canvas.hash === '' || fp.canvas.hash === '0'
  const webglEmpty = fp.webgl.hash === '' || fp.webgl.renderer === ''

  // Canvas fingerprint empty or zero hash
  if (canvasEmpty) {
    score += 25
    reasons.push('canvas_fingerprint_empty_or_zero')
  }

  // WebGL hash empty OR renderer string empty
  if (webglEmpty) {
    score += 25
    reasons.push('webgl_fingerprint_empty')
  }

  // Audio fingerprint zero or empty — common in sandboxed/headless environments
  if (fp.audio.hash === '' || fp.audio.hash === '0') {
    score += 20
    reasons.push('audio_fingerprint_zero_or_empty')
  }

  // No CPU core count — missing in some stripped-down environments
  if (fp.navigator.hardwareConcurrency === 0) {
    score += 5
    reasons.push('hardware_concurrency_zero')
  }

  // Canvas + WebGL suppressed but UA looks like a real browser:
  // fingerprinting APIs blocked (e.g. Brave shields, privacy extension) on an actual browser
  // would still leave a real UA string. If combined with both fingerprints missing, it is
  // suspicious because bots that spoof a real UA often blank these fields.
  if (canvasEmpty && webglEmpty) {
    const ua = fp.navigator.userAgent
    const looksLikeRealBrowser = /Chrome|Firefox|Safari|Edge/i.test(ua) && ua.length > 20
    if (looksLikeRealBrowser) {
      score += 10
      reasons.push('fingerprint_suppressed_suspicious')
    }
  }

  // Screen dimensions all zero — headless browsers commonly report 0x0
  if (fp.screen.width === 0 && fp.screen.height === 0 && fp.screen.colorDepth === 0) {
    score += 10
    reasons.push('screen_dimensions_zero')
  }

  // Default devicePixelRatio of exactly 1.0 on a very wide screen —
  // headless Chrome/Puppeteer defaults to DPR=1 even on large virtual viewports
  if (fp.screen.devicePixelRatio === 1.0 && fp.screen.width > 1920) {
    score += 5
    reasons.push('headless_default_dpr')
  }

  return score
}
