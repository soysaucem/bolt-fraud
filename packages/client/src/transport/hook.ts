import type { BoltFraudConfig } from '../types.js'

let _originalFetch: typeof globalThis.fetch | null = null
let _originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null
let _originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null
let _fetchInstalled = false
let _xhrInstalled = false

export function installFetchHook(config: BoltFraudConfig): void {
  if (_fetchInstalled) return
  _originalFetch = globalThis.fetch

  globalThis.fetch = async function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input)
    if (shouldProtect(url, config)) {
      // Lazy import to avoid circular deps
      const { getToken } = await import('../index.js')
      const token = await getToken()
      const headers = new Headers(init?.headers)
      headers.set(config.tokenHeader ?? 'X-Bolt-Token', JSON.stringify(token))
      return _originalFetch!(input, { ...init, headers })
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
      // Inject the token header synchronously — best effort, no await
      void (async () => {
        const { getToken } = await import('../index.js')
        const token = await getToken()
        self.setRequestHeader(config.tokenHeader ?? 'X-Bolt-Token', JSON.stringify(token))
      })()
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

export function shouldProtect(
  url: string | URL | Request,
  config: BoltFraudConfig,
): boolean {
  const urlStr = url instanceof Request ? url.url : String(url)

  // If patterns are specified, match against them
  if (config.protectedPatterns && config.protectedPatterns.length > 0) {
    return config.protectedPatterns.some((pattern) => pattern.test(urlStr))
  }

  // Default: same-origin check
  if (typeof window === 'undefined') return false

  try {
    const parsed = new URL(urlStr, window.location.href)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}
