import type { BoltFraudConfig } from '../types.js'

let _originalFetch: typeof globalThis.fetch | null = null
let _originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null
let _originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null
let _fetchInstalled = false
let _xhrInstalled = false
let _gettingToken = false // Re-entrancy guard: prevent infinite recursion if getToken uses fetch

export function installFetchHook(config: BoltFraudConfig): void {
  if (_fetchInstalled) return
  _originalFetch = globalThis.fetch

  globalThis.fetch = async function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Skip token injection if we're already inside a getToken() call
    // to prevent infinite recursion (getToken → fetch → getToken → ...)
    if (_gettingToken) {
      return _originalFetch!(input, init)
    }
    const url = input instanceof Request ? input.url : String(input)
    if (shouldProtect(url, config)) {
      _gettingToken = true
      try {
        const { getToken } = await import('../index.js')
        const token = await getToken()
        const headers = new Headers(init?.headers)
        headers.set(config.tokenHeader ?? 'X-Client-Data', token.token)
        return _originalFetch!(input, { ...init, headers })
      } catch {
        // Token generation failed — send without token
        return _originalFetch!(input, init)
      } finally {
        _gettingToken = false
      }
    }
    return _originalFetch!(input, init)
  }

  _fetchInstalled = true
}

export function installXHRHook(config: BoltFraudConfig): void {
  if (_xhrInstalled) return

  _originalXHROpen = XMLHttpRequest.prototype.open
  _originalXHRSend = XMLHttpRequest.prototype.send

  const originalOpen = _originalXHROpen
  const originalSend = _originalXHRSend

  // Use a WeakMap to avoid polluting XHR instances with custom properties
  const urlMap = new WeakMap<XMLHttpRequest, string>()

  // Override with a compatible overload signature
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(XMLHttpRequest.prototype as any).open = function patchedOpen(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    urlMap.set(this as XMLHttpRequest, String(url))
    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null)
  }

  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const self = this
    const url = urlMap.get(self)
    if (url !== undefined && shouldProtect(url, config)) {
      // Defer send until token is ready to avoid the race condition where
      // the async token injection completes after originalSend has already fired.
      void (async () => {
        try {
          const { getToken } = await import('../index.js')
          const token = await getToken()
          self.setRequestHeader(config.tokenHeader ?? 'X-Client-Data', token.token)
        } catch {
          // Token generation failed — send without token
        }
        originalSend.call(self, body)
      })()
      return // Don't call originalSend synchronously
    }
    return originalSend.call(self, body)
  }

  _xhrInstalled = true
}

export function uninstallHooks(): void {
  if (_fetchInstalled && _originalFetch !== null) {
    globalThis.fetch = _originalFetch
    _originalFetch = null
    _fetchInstalled = false
  }
  if (_xhrInstalled && _originalXHROpen !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(XMLHttpRequest.prototype as any).open = _originalXHROpen
    _originalXHROpen = null
    if (_originalXHRSend !== null) {
      XMLHttpRequest.prototype.send = _originalXHRSend
      _originalXHRSend = null
    }
    _xhrInstalled = false
  }
}

export function shouldProtect(url: string, config: BoltFraudConfig): boolean {
  if (config.protectedPatterns && config.protectedPatterns.length > 0) {
    return config.protectedPatterns.some((pattern) => pattern.test(url))
  }
  if (typeof window === 'undefined') return false
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}
