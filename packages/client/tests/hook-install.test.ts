// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { installFetchHook, installXHRHook, uninstallHooks } from '../src/transport/hook.js'
import type { HookDeps } from '../src/transport/hook.js'
import type { BoltFraudConfig, EncryptedToken } from '../src/types.js'

const TOKEN: EncryptedToken = { token: 'TOK', v: 1 }

function makeDeps(overrides?: Partial<BoltFraudConfig>, getToken?: () => Promise<EncryptedToken>) {
  const config: BoltFraudConfig = {
    serverUrl: 'https://example.com',
    protectedPatterns: [/\/api\//],
    onError: vi.fn(),
    ...overrides,
  }
  const getTokenMock = vi.fn(getToken ?? (() => Promise.resolve(TOKEN)))
  const deps: HookDeps = { getConfig: () => config, getToken: getTokenMock }
  return { config, deps, getTokenMock, onError: config.onError as ReturnType<typeof vi.fn> }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// ─── fetch hook ───────────────────────────────────────────────────────────────

describe('fetch hook', () => {
  const realFetch = globalThis.fetch
  let fetchMock: Mock<unknown[], Promise<Response>>

  beforeEach(() => {
    fetchMock = vi.fn(async (..._args: unknown[]) => new Response('ok'))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    uninstallHooks()
    globalThis.fetch = realFetch
  })

  function sentHeaders(callIndex = 0): Headers {
    const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined
    return new Headers(init?.headers)
  }

  it('adds the token header to a protected URL', async () => {
    const { deps } = makeDeps()
    installFetchHook(deps)

    await globalThis.fetch('https://example.com/api/x')

    expect(sentHeaders().get('x-client-data')).toBe('TOK')
  })

  it('uses a custom tokenHeader', async () => {
    const { deps } = makeDeps({ tokenHeader: 'X-Device' })
    installFetchHook(deps)

    await globalThis.fetch('https://example.com/api/x')

    expect(sentHeaders().get('x-device')).toBe('TOK')
  })

  it('does not touch unprotected URLs', async () => {
    const { deps, getTokenMock } = makeDeps()
    installFetchHook(deps)

    await globalThis.fetch('https://example.com/static/a.js', { headers: { A: '1' } })

    expect(getTokenMock).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]).toEqual(['https://example.com/static/a.js', { headers: { A: '1' } }])
  })

  it('keeps headers carried by a Request input and adds the token', async () => {
    const { deps } = makeDeps()
    installFetchHook(deps)
    const request = new Request('https://example.com/api/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer abc' },
    })

    await globalThis.fetch(request)

    const headers = sentHeaders()
    expect(headers.get('authorization')).toBe('Bearer abc')
    expect(headers.get('x-client-data')).toBe('TOK')
  })

  it('lets init.headers override Request headers while keeping both sets', async () => {
    const { deps } = makeDeps()
    installFetchHook(deps)
    const request = new Request('https://example.com/api/x', {
      headers: { Authorization: 'Bearer old', 'X-Keep': 'yes' },
    })

    await globalThis.fetch(request, { headers: { Authorization: 'Bearer new' } })

    const headers = sentHeaders()
    expect(headers.get('authorization')).toBe('Bearer new')
    expect(headers.get('x-keep')).toBe('yes')
  })

  it('two concurrent protected fetches both carry the token', async () => {
    const { deps, getTokenMock } = makeDeps()
    installFetchHook(deps)

    await Promise.all([
      globalThis.fetch('https://example.com/api/a'),
      globalThis.fetch('https://example.com/api/b'),
    ])

    expect(getTokenMock).toHaveBeenCalledTimes(2)
    expect(sentHeaders(0).get('x-client-data')).toBe('TOK')
    expect(sentHeaders(1).get('x-client-data')).toBe('TOK')
  })

  it('a global-flag pattern protects every repeated call', async () => {
    const { deps } = makeDeps({ protectedPatterns: [/\/api\//g] })
    installFetchHook(deps)

    for (let i = 0; i < 3; i++) await globalThis.fetch('https://example.com/api/x')

    for (let i = 0; i < 3; i++) expect(sentHeaders(i).get('x-client-data')).toBe('TOK')
  })

  it('still sends the request and calls onError when getToken fails', async () => {
    const failure = new Error('no token')
    const { deps, onError } = makeDeps(undefined, () => Promise.reject(failure))
    installFetchHook(deps)

    await globalThis.fetch('https://example.com/api/x', { method: 'POST' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ method: 'POST' })
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('passes through when the config getter returns null (after destroy)', async () => {
    const getToken = vi.fn(() => Promise.resolve(TOKEN))
    installFetchHook({ getConfig: () => null, getToken })

    await globalThis.fetch('https://example.com/api/x')

    expect(getToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('installing twice wraps fetch once', async () => {
    const { deps, getTokenMock } = makeDeps()
    installFetchHook(deps)
    installFetchHook(deps)

    await globalThis.fetch('https://example.com/api/x')

    expect(getTokenMock).toHaveBeenCalledTimes(1)
  })

  it('uninstall restores the original fetch when the wrapper is still installed', () => {
    const { deps } = makeDeps()
    installFetchHook(deps)
    expect(globalThis.fetch).not.toBe(fetchMock)

    uninstallHooks()

    expect(globalThis.fetch).toBe(fetchMock)
  })

  it('uninstall does not clobber a wrapper installed after ours', async () => {
    const { deps, getTokenMock } = makeDeps()
    installFetchHook(deps)
    // simulate a third-party wrapper chained on top of ours
    const ours = globalThis.fetch
    const chained = vi.fn((input: RequestInfo | URL, init?: RequestInit) => ours(input, init))
    globalThis.fetch = chained as unknown as typeof fetch

    uninstallHooks()

    expect(globalThis.fetch).toBe(chained)
    // our wrapper is still in the chain and keeps working
    await globalThis.fetch('https://example.com/api/x')
    expect(getTokenMock).toHaveBeenCalledTimes(1)
  })
})

// ─── XHR hook ─────────────────────────────────────────────────────────────────

describe('XHR hook', () => {
  const proto = XMLHttpRequest.prototype
  const saved = {
    open: proto.open,
    send: proto.send,
    abort: proto.abort,
    setRequestHeader: proto.setRequestHeader,
  }
  let openMock: ReturnType<typeof vi.fn>
  let sendMock: ReturnType<typeof vi.fn>
  let abortMock: ReturnType<typeof vi.fn>
  let setHeaderMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    openMock = vi.fn()
    sendMock = vi.fn()
    abortMock = vi.fn()
    setHeaderMock = vi.fn()
    proto.open = openMock as unknown as typeof proto.open
    proto.send = sendMock as unknown as typeof proto.send
    proto.abort = abortMock as unknown as typeof proto.abort
    proto.setRequestHeader = setHeaderMock as unknown as typeof proto.setRequestHeader
  })

  afterEach(() => {
    uninstallHooks()
    Object.assign(proto, saved)
  })

  it('defers an async protected send until the header is set', async () => {
    const { deps, getTokenMock } = makeDeps()
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('POST', 'https://example.com/api/x')
    xhr.send('body')

    expect(sendMock).not.toHaveBeenCalled()
    await flush()
    expect(getTokenMock).toHaveBeenCalledTimes(1)
    expect(setHeaderMock).toHaveBeenCalledWith('X-Client-Data', 'TOK')
    expect(sendMock).toHaveBeenCalledWith('body')
  })

  it('does not defer a synchronous XHR', () => {
    const { deps, getTokenMock } = makeDeps()
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/api/x', false)
    xhr.send()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(getTokenMock).not.toHaveBeenCalled()
    expect(setHeaderMock).not.toHaveBeenCalled()
  })

  it('sends unprotected requests immediately', () => {
    const { deps, getTokenMock } = makeDeps()
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/static/a.js')
    xhr.send()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('abort() before the deferred send suppresses the request', async () => {
    const { deps } = makeDeps()
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/api/x')
    xhr.send()
    xhr.abort()
    await flush()

    expect(abortMock).toHaveBeenCalledTimes(1)
    expect(sendMock).not.toHaveBeenCalled()
    expect(setHeaderMock).not.toHaveBeenCalled()
  })

  it('re-open() before the deferred send suppresses the stale send', async () => {
    const { deps } = makeDeps()
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/api/x')
    xhr.send()
    xhr.open('GET', 'https://example.com/static/y') // new request, never sent
    await flush()

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('still sends and calls onError when getToken fails', async () => {
    const failure = new Error('no token')
    const { deps, onError } = makeDeps(undefined, () => Promise.reject(failure))
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/api/x')
    xhr.send()
    await flush()

    expect(onError).toHaveBeenCalledWith(failure)
    expect(setHeaderMock).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('routes a throwing send to onError instead of an unhandled rejection', async () => {
    const boom = new Error('send boom')
    const { deps, onError } = makeDeps()
    installXHRHook(deps)
    sendMock.mockImplementation(() => {
      throw boom
    })
    // the hook captured the (mock) original at install time, so re-install with the throwing mock
    uninstallHooks()
    proto.send = sendMock as unknown as typeof proto.send
    installXHRHook(deps)
    const xhr = new XMLHttpRequest()

    xhr.open('GET', 'https://example.com/api/x')
    xhr.send()
    await flush()

    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('uninstall restores open, send and abort', () => {
    const { deps } = makeDeps()
    installXHRHook(deps)
    expect(proto.send).not.toBe(sendMock)

    uninstallHooks()

    expect(proto.open).toBe(openMock)
    expect(proto.send).toBe(sendMock)
    expect(proto.abort).toBe(abortMock)
  })
})
