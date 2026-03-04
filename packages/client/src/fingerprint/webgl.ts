import type { WebGLFingerprint } from '../types.js'
import { arrayBufferToHex } from './canvas.js'

// Extension interface for unmasked renderer info
interface WebGLDebugRendererInfo {
  readonly UNMASKED_VENDOR_WEBGL: number
  readonly UNMASKED_RENDERER_WEBGL: number
}

/**
 * WebGL fingerprint: custom shader render + GPU metadata capture.
 * Reference: sws-chunk-6476.js line ~8340
 */
export async function getWebGLFingerprint(): Promise<WebGLFingerprint> {
  const empty: WebGLFingerprint = {
    hash: '',
    renderer: '',
    vendor: '',
    version: '',
    shadingLanguageVersion: '',
    extensions: [],
  }

  if (typeof document === 'undefined') return empty

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64

    const gl: WebGLRenderingContext | WebGL2RenderingContext | null =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      getExperimentalWebGL(canvas)

    if (!gl) return empty

    // ── Shader programs ──────────────────────────────────────────────────────
    const vertSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `

    const fragSource = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(0.31415926535, 0.27182818284, 0.14142135623, 1.0);
      }
    `

    const vertShader = compileShader(gl, gl.VERTEX_SHADER, vertSource)
    const fragShader = compileShader(gl, gl.FRAGMENT_SHADER, fragSource)

    if (!vertShader || !fragShader) return empty

    const program = gl.createProgram()
    if (!program) return empty

    gl.attachShader(program, vertShader)
    gl.attachShader(program, fragShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return empty

    gl.useProgram(program)

    // ── Draw a colored triangle ───────────────────────────────────────────────
    const positions = new Float32Array([-1, -1, 1, -1, 0, 1])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    const positionLoc = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    gl.viewport(0, 0, 64, 64)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // ── Read pixels and hash ──────────────────────────────────────────────────
    const pixels = new Uint8Array(64 * 64 * 4)
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    const hashBuffer = await crypto.subtle.digest('SHA-256', pixels)
    const hash = arrayBufferToHex(hashBuffer)

    // ── GPU metadata ──────────────────────────────────────────────────────────
    let renderer = (gl.getParameter(gl.RENDERER) as string | null) ?? ''
    let vendor = (gl.getParameter(gl.VENDOR) as string | null) ?? ''
    const version = (gl.getParameter(gl.VERSION) as string | null) ?? ''
    const shadingLanguageVersion =
      (gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string | null) ?? ''

    // Try unmasked renderer info if available
    const debugInfo = gl.getExtension(
      'WEBGL_debug_renderer_info',
    ) as WebGLDebugRendererInfo | null
    if (debugInfo) {
      const unmaskedRenderer = gl.getParameter(
        debugInfo.UNMASKED_RENDERER_WEBGL,
      ) as string | null
      const unmaskedVendor = gl.getParameter(
        debugInfo.UNMASKED_VENDOR_WEBGL,
      ) as string | null
      if (unmaskedRenderer) renderer = unmaskedRenderer
      if (unmaskedVendor) vendor = unmaskedVendor
    }

    // ── Extensions (up to 32) ─────────────────────────────────────────────────
    const allExtensions = gl.getSupportedExtensions() ?? []
    const extensions = allExtensions.slice(0, 32)

    // Cleanup
    gl.deleteBuffer(buffer)
    gl.deleteShader(vertShader)
    gl.deleteShader(fragShader)
    gl.deleteProgram(program)

    return { hash, renderer, vendor, version, shadingLanguageVersion, extensions }
  } catch {
    return empty
  }
}

/**
 * Fallback for browsers that expose WebGL only under the experimental prefix.
 * Uses an unknown cast to avoid referencing the untyped context string.
 */
function getExperimentalWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    return (canvas.getContext as (id: string) => WebGLRenderingContext | null)(
      'experimental-webgl',
    )
  } catch {
    return null
  }
}

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}
