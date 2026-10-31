import type { BoltFraudConfig, EncryptedToken } from '../types.js'

/**
 * Hooks read the live config and token source through these callbacks, so they stay
 * correct across re-init and become pass-through after destroy().
 */
export interface HookDeps {
  readonly getConfig: () => BoltFraudConfig | null
  readonly getToken: () => Promise<EncryptedToken>
}

const DEFAULT_TOKEN_HEADER = 'X-Client-Data'

let _originalFetch: typeof globalThis.fetch | null = null
let _wrappedFetch: typeof globalThis.fetch | null = null

let _originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null
let _originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null
let _originalXHRAbort: typeof XMLHttpRequest.prototype.abort | null = null
let _patchedXHROpen: typeof XMLHttpRequest.prototype.open | null = null
let _patchedXHRSend: typeof XMLHttpRequest.prototype.send | null = null
let _patchedXHRAbort: typeof XMLHttpRequest.prototype.abort | null = null

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/** Token or null; a failure is reported to onError and the request goes out without a token. */
async function tokenOrNull(deps: HookDeps, config: BoltFraudConfig): Promise<EncryptedToken | null> {
  try {
    return await deps.getToken()
  } catch (err) {
    config.onError?.(toError(err))
    return null
  }
}

export function installFetchHook(deps: HookDeps): void {
  if (_wrappedFetch !== null) return
  const original = globalThis.fetch
  _originalFetch = original

  const wrapped = async function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const config = deps.getConfig()
    const request = typeof input === 'object' && input !== null && 'url' in input ? input : null
    const url = request ? request.url : String(input)
    if (!config || !shouldProtect(url, config)) {
      return original(input, init)
    }

    const token = await tokenOrNull(deps, config)
    if (!token) return original(input, init)

    // Preserve headers carried by a Request input; init.headers overrides them (fetch semantics).
    const headers = new Headers(request?.headers)
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    }
    headers.set(config.tokenHeader ?? DEFAULT_TOKEN_HEADER, token.token)
    return original(input, { ...init, headers })
  }

  _wrappedFetch = wrapped
  globalThis.fetch = wrapped
}

interface XHRState {
  readonly url: string
  readonly async: boolean
  pending: boolean
  aborted: boolean
}

export function installXHRHook(deps: HookDeps): void {
  if (_patchedXHRSend !== null) return

  const proto = XMLHttpRequest.prototype
  const originalOpen = proto.open
  const originalSend = proto.send
  const originalAbort = proto.abort
  _originalXHROpen = originalOpen
  _originalXHRSend = originalSend
  _originalXHRAbort = originalAbort

  // WeakMap avoids polluting XHR instances with custom properties
  const states = new WeakMap<XMLHttpRequest, XHRState>()

  const patchedOpen = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    // Re-open invalidates a send that is still waiting for its token
    const previous = states.get(this)
    if (previous?.pending) previous.aborted = true
    states.set(this, { url: String(url), async: async !== false, pending: false, aborted: false })
    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null)
  }

  const patchedSend = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const self = this
    const state = states.get(self)
    const config = deps.getConfig()
    // A synchronous XHR cannot wait for an async token
    if (!state || !state.async || !config || !shouldProtect(state.url, config)) {
      return originalSend.call(self, body)
    }

    // Defer send until the token is ready, so the header is set before the request fires.
    state.pending = true
    state.aborted = false
    void (async () => {
      const token = await tokenOrNull(deps, config)
      state.pending = false
      if (state.aborted) return
      try {
        if (token) self.setRequestHeader(config.tokenHeader ?? DEFAULT_TOKEN_HEADER, token.token)
      } catch (err) {
        config.onError?.(toError(err))
      }
      try {
        originalSend.call(self, body)
      } catch (err) {
        config.onError?.(toError(err))
      }
    })()
  }

  const patchedAbort = function patchedAbort(this: XMLHttpRequest): void {
    const state = states.get(this)
    if (state?.pending) {
      state.aborted = true
      state.pending = false
    }
    originalAbort.call(this)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(proto as any).open = patchedOpen
  proto.send = patchedSend
  proto.abort = patchedAbort
  _patchedXHROpen = patchedOpen as typeof proto.open
  _patchedXHRSend = patchedSend
  _patchedXHRAbort = patchedAbort
}

export function uninstallHooks(): void {
  if (_wrappedFetch !== null) {
    // Restore only if nobody wrapped fetch after us; otherwise our wrapper stays as a
    // pass-through (getConfig() is null after destroy).
    if (globalThis.fetch === _wrappedFetch && _originalFetch !== null) {
      globalThis.fetch = _originalFetch
    }
    _wrappedFetch = null
    _originalFetch = null
  }

  if (_patchedXHRSend !== null && typeof XMLHttpRequest !== 'undefined') {
    const proto = XMLHttpRequest.prototype
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (proto.open === _patchedXHROpen && _originalXHROpen) (proto as any).open = _originalXHROpen
    if (proto.send === _patchedXHRSend && _originalXHRSend) proto.send = _originalXHRSend
    if (proto.abort === _patchedXHRAbort && _originalXHRAbort) proto.abort = _originalXHRAbort
  }
  _originalXHROpen = null
  _originalXHRSend = null
  _originalXHRAbort = null
  _patchedXHROpen = null
  _patchedXHRSend = null
  _patchedXHRAbort = null
}

/** Only `protectedPatterns` match; there is no same-origin fallback. */
export function shouldProtect(url: string, config: BoltFraudConfig): boolean {
  const patterns = config.protectedPatterns
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => {
    pattern.lastIndex = 0 // g/y flags make test() stateful
    return pattern.test(url)
  })
}
