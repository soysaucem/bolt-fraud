// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getWebGLFingerprint } from '../src/fingerprint/webgl.js'

interface StubOptions {
  compileOk?: boolean
  linkOk?: boolean
  withLoseContext?: boolean
}

function makeGl(options: StubOptions = {}) {
  const { compileOk = true, linkOk = true, withLoseContext = true } = options
  const loseContext = vi.fn()
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS: 3,
    COMPILE_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    COLOR_BUFFER_BIT: 8,
    TRIANGLES: 9,
    RGBA: 10,
    UNSIGNED_BYTE: 11,
    RENDERER: 12,
    VENDOR: 13,
    VERSION: 14,
    SHADING_LANGUAGE_VERSION: 15,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compileOk),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => linkOk),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    readPixels: vi.fn(),
    getParameter: vi.fn((p: number) => `param-${p}`),
    getExtension: vi.fn((name: string) =>
      name === 'WEBGL_lose_context' && withLoseContext ? { loseContext } : null,
    ),
    getSupportedExtensions: vi.fn(() => ['EXT_a', 'EXT_b']),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
  }
  return { gl, loseContext }
}

function stubCanvas(gl: unknown) {
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => gl) }
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement)
  return canvas
}

describe('getWebGLFingerprint context release', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loses the context after a successful probe', async () => {
    const { gl, loseContext } = makeGl()
    stubCanvas(gl)

    const result = await getWebGLFingerprint()

    expect(result.hash).not.toBe('')
    expect(result.extensions).toEqual(['EXT_a', 'EXT_b'])
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('loses the context when shader compilation fails', async () => {
    const { gl, loseContext } = makeGl({ compileOk: false })
    stubCanvas(gl)

    const result = await getWebGLFingerprint()

    expect(result.hash).toBe('')
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('loses the context when program linking fails', async () => {
    const { gl, loseContext } = makeGl({ linkOk: false })
    stubCanvas(gl)

    await getWebGLFingerprint()

    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('loses the context when createProgram returns null', async () => {
    const { gl, loseContext } = makeGl()
    gl.createProgram.mockReturnValue(null as unknown as Record<string, never>)
    stubCanvas(gl)

    await getWebGLFingerprint()

    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('loses the context when the probe throws midway', async () => {
    const { gl, loseContext } = makeGl()
    gl.readPixels.mockImplementation(() => {
      throw new Error('gpu reset')
    })
    stubCanvas(gl)

    const result = await getWebGLFingerprint()

    expect(result.hash).toBe('')
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('tolerates a context without the WEBGL_lose_context extension', async () => {
    const { gl } = makeGl({ withLoseContext: false })
    stubCanvas(gl)

    await expect(getWebGLFingerprint()).resolves.toMatchObject({ extensions: ['EXT_a', 'EXT_b'] })
  })

  it('returns the empty fingerprint when no context is available', async () => {
    stubCanvas(null)

    await expect(getWebGLFingerprint()).resolves.toMatchObject({ hash: '', renderer: '' })
  })
})
