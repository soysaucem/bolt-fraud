import type { CanvasFingerprint } from '../types.js'

export function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Render a deterministic canvas scene and return its SHA-256 hash.
 * GPU rendering pipelines introduce device-unique subpixel differences.
 * Reference: sws-chunk-6476.js line ~8546
 */
export async function getCanvasFingerprint(): Promise<CanvasFingerprint> {
  try {
    let canvas: HTMLCanvasElement | OffscreenCanvas
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(400, 200)
      const offCtx = canvas.getContext('2d')
      if (!offCtx) return { hash: '' }
      ctx = offCtx
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas')
      el.width = 400
      el.height = 200
      const elCtx = el.getContext('2d')
      if (!elCtx) return { hash: '' }
      canvas = el
      ctx = elCtx
    } else {
      return { hash: '' }
    }

    // Background fill
    ctx.fillStyle = '#f0f0f0'
    ctx.fillRect(0, 0, 400, 200)

    // Colored rectangles
    ctx.fillStyle = 'rgba(255, 100, 0, 0.7)'
    ctx.fillRect(20, 20, 100, 60)

    ctx.fillStyle = 'rgba(0, 150, 255, 0.5)'
    ctx.fillRect(60, 50, 120, 80)

    // Arc
    ctx.beginPath()
    ctx.arc(200, 100, 60, 0, Math.PI * 2, false)
    ctx.strokeStyle = '#9900cc'
    ctx.lineWidth = 3
    ctx.stroke()

    // Quadratic curve
    ctx.beginPath()
    ctx.moveTo(10, 180)
    ctx.quadraticCurveTo(100, 50, 200, 180)
    ctx.strokeStyle = '#ff4500'
    ctx.lineWidth = 2
    ctx.stroke()

    // Linear gradient with 3+ color stops
    const gradient = ctx.createLinearGradient(220, 0, 400, 200)
    gradient.addColorStop(0, '#ff0000')
    gradient.addColorStop(0.33, '#00ff00')
    gradient.addColorStop(0.66, '#0000ff')
    gradient.addColorStop(1, '#ffff00')
    ctx.fillStyle = gradient
    ctx.fillRect(220, 10, 170, 90)

    // Text with multiple fonts — use measureText to ensure font is loaded
    const texts: Array<{ text: string; font: string; x: number; y: number }> = [
      { text: 'BoltFraud Arial', font: '14px Arial', x: 20, y: 140 },
      { text: 'Cwm fjordbank glyphs vext quiz!', font: '13px Times New Roman', x: 20, y: 158 },
      { text: 'Pack my box with five.', font: '12px Courier New', x: 20, y: 175 },
    ]

    for (const { text, font, x, y } of texts) {
      ctx.font = font
      // measureText ensures the font is resolved before drawing
      ctx.measureText(text)
      ctx.fillStyle = '#1a1a2e'
      ctx.fillText(text, x, y)
    }

    // Extract image data URL
    let dataURL: string
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      dataURL = await blobToDataURL(blob)
    } else {
      try {
        dataURL = canvas.toDataURL('image/png')
      } catch {
        // SecurityError in cross-origin iframes
        return { hash: '' }
      }
    }

    const encoded = new TextEncoder().encode(dataURL)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return { hash: arrayBufferToHex(hashBuffer) }
  } catch {
    return { hash: '' }
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
