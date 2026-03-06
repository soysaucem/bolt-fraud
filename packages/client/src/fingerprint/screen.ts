import type { ScreenInfo } from '../types.js'

/**
 * Capture screen geometry, color depth, and device pixel ratio.
 */
export function getScreenInfo(): ScreenInfo {
  if (typeof window === 'undefined' || typeof screen === 'undefined') {
    return {
      width: 0,
      height: 0,
      availWidth: 0,
      availHeight: 0,
      colorDepth: 0,
      pixelDepth: 0,
      devicePixelRatio: 1,
    }
  }

  return {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    devicePixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
  }
}
