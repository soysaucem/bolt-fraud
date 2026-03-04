import type { IntegrityResult, IntegrityViolation, IntegrityViolationName } from '../types.js'

/**
 * Validate browser API integrity: prototype chains, native function toString().
 * Catches automation frameworks that patch DOM APIs.
 */
export async function validateIntegrity(): Promise<IntegrityResult> {
  const violations: IntegrityViolation[] = []

  function push(name: IntegrityViolationName, detail?: string): void {
    violations.push({ name, detail })
  }

  // 1. Verify Function.prototype.toString itself is native
  // If toString is overridden, all subsequent isNativeFunction checks are unreliable.
  // We use the raw toString check directly here without relying on isNativeFunction.
  try {
    const toStringSrc = Function.prototype.toString.call(Function.prototype.toString)
    if (!toStringSrc.includes('[native code]')) {
      push('native_function_toString_overridden', 'Function.prototype.toString is not native')
    }
  } catch {
    push('native_function_toString_overridden', 'Function.prototype.toString threw')
  }

  // 2. Window → EventTarget prototype chain
  try {
    if (Object.getPrototypeOf(Window.prototype) !== EventTarget.prototype) {
      push(
        'window_event_target_chain_broken',
        'Window.prototype.__proto__ !== EventTarget.prototype',
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
    return Function.prototype.toString.call(fn).includes('[native code]')
  } catch {
    return false
  }
}
