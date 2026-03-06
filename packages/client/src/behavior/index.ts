import type { BehaviorData } from '../types.js'
import { MouseTracker } from './mouse.js'
import { KeyboardTracker } from './keyboard.js'
import { ScrollTracker } from './scroll.js'

const DEFAULT_RING_BUFFER_SIZE = 128

let _mouseTracker: MouseTracker | null = null
let _keyboardTracker: KeyboardTracker | null = null
let _scrollTracker: ScrollTracker | null = null

export function startBehaviorCollection(
  ringBufferSize: number = DEFAULT_RING_BUFFER_SIZE,
): void {
  stopBehaviorCollection()
  _mouseTracker = new MouseTracker(ringBufferSize)
  _keyboardTracker = new KeyboardTracker(ringBufferSize)
  _scrollTracker = new ScrollTracker(ringBufferSize)
  _mouseTracker.start()
  _keyboardTracker.start()
  _scrollTracker.start()
}

export function stopBehaviorCollection(): void {
  _mouseTracker?.stop()
  _keyboardTracker?.stop()
  _scrollTracker?.stop()
  _mouseTracker = null
  _keyboardTracker = null
  _scrollTracker = null
}

export function snapshotBehavior(): BehaviorData {
  return {
    mouse: _mouseTracker?.snapshot() ?? [],
    keyboard: _keyboardTracker?.snapshot() ?? [],
    scroll: _scrollTracker?.snapshot() ?? [],
    totalMouseEvents: _mouseTracker?.totalEvents ?? 0,
    totalKeyboardEvents: _keyboardTracker?.totalEvents ?? 0,
    totalScrollEvents: _scrollTracker?.totalEvents ?? 0,
    snapshotAt: typeof performance !== 'undefined' ? performance.now() : 0,
  }
}
