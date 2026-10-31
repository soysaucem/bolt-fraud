import type { IntegrityResult, IntegrityViolation, IntegrityViolationName } from '../types.js'

// Captured at module load so later patching of Function.prototype.toString cannot
// make the native-function checks unreliable. Whether it was native at load time is
// recorded once; a page that patches toString afterwards is not flagged.
const nativeToString = Function.prototype.toString
const toStringNativeAtLoad = ((): boolean => {
  try {
    return nativeToString.call(nativeToString).includes('[native code]')
  } catch {
    return false
  }
})()

/** Max prototype hops between Window.prototype and EventTarget.prototype (Chromium has WindowProperties). */
const MAX_PROTO_HOPS = 3

function inheritsFromWithin(proto: object, target: object, maxHops: number): boolean {
  let current: object | null = proto
  for (let i = 0; i < maxHops; i++) {
    current = Object.getPrototypeOf(current) as object | null
    if (current === null) return false
    if (current === target) return true
  }
  return false
}

/**
 * Validate browser API integrity: prototype chains, native function toString().
 * Catches automation frameworks that patch DOM APIs.
 */
export async function validateIntegrity(): Promise<IntegrityResult> {
  const violations: IntegrityViolation[] = []

  function push(name: IntegrityViolationName, detail?: string): void {
    violations.push({ name, detail })
  }

  // 1. Function.prototype.toString was native when this module loaded
  if (!toStringNativeAtLoad) {
    push('native_function_toString_overridden', 'Function.prototype.toString was not native at load')
  }

  // 2. Window → EventTarget prototype chain
  try {
    if (!inheritsFromWithin(Window.prototype, EventTarget.prototype, MAX_PROTO_HOPS)) {
      push(
        'window_event_target_chain_broken',
        'Window.prototype does not inherit from EventTarget.prototype',
      )
    }
  } catch {
    push('window_event_target_chain_broken', 'prototype chain check threw')
  }

  // 3. Document → Node → EventTarget chain
  try {
    const docProto = Object.getPrototypeOf(Document.prototype) // should be Node.prototype
    const nodeProto = Object.getPrototypeOf(Node.prototype) // should be EventTarget.prototype
    if (docProto !== Node.prototype || nodeProto !== EventTarget.prototype) {
      push(
        'document_node_chain_broken',
        'Document→Node→EventTarget chain is broken',
      )
    }
  } catch {
    push('document_node_chain_broken', 'prototype chain check threw')
  }

  // 4. fetch native check
  if (typeof window.fetch !== 'undefined' && !isNativeFunction(window.fetch)) {
    push('fetch_native_overridden')
  }

  // 5. XMLHttpRequest.prototype.open native check
  if (
    typeof XMLHttpRequest !== 'undefined' &&
    !isNativeFunction(XMLHttpRequest.prototype.open)
  ) {
    push('xhr_open_overridden')
  }

  // 6. Date.now native check
  if (!isNativeFunction(Date.now)) {
    push('date_now_overridden')
  }

  // 7. performance.now native check
  if (typeof performance !== 'undefined' && !isNativeFunction(performance.now)) {
    push('performance_now_overridden')
  }

  return {
    isValid: violations.length === 0,
    violations,
  }
}

export function isNativeFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') return false
  try {
    return nativeToString.call(fn).includes('[native code]')
  } catch {
    return false
  }
}
