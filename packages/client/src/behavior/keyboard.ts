import type { BfKeyboardEvent } from '../types.js'

export class KeyboardTracker {
  private readonly _buffer: BfKeyboardEvent[]
  private readonly _capacity: number
  private _head = 0
  private _count = 0
  private _totalEvents = 0
  private _listening = false

  // Stable listener references for cleanup
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null

  constructor(capacity: number) {
    this._capacity = capacity
    this._buffer = new Array<BfKeyboardEvent>(capacity)
  }

  start(): void {
    if (this._listening) return
    this._listening = true

    this._onKeyDown = (e: KeyboardEvent) => {
      // Filter out auto-repeat events — only capture initial keydown
      if (e.repeat) return
      this.push(this._buildEvent('keydown', e))
    }

    this._onKeyUp = (e: KeyboardEvent) => {
      this.push(this._buildEvent('keyup', e))
    }

    document.addEventListener('keydown', this._onKeyDown)
    document.addEventListener('keyup', this._onKeyUp)
  }

  stop(): void {
    if (!this._listening) return
    this._listening = false

    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown)
    if (this._onKeyUp) document.removeEventListener('keyup', this._onKeyUp)

    this._onKeyDown = null
    this._onKeyUp = null
  }

  push(event: BfKeyboardEvent): void {
    this._buffer[this._head] = event
    this._head = (this._head + 1) % this._capacity
    if (this._count < this._capacity) this._count++
    this._totalEvents++
  }

  snapshot(): readonly BfKeyboardEvent[] {
    if (this._count === 0) return []
    const start = this._count < this._capacity ? 0 : this._head
    const result: BfKeyboardEvent[] = []
    for (let i = 0; i < this._count; i++) {
      const idx = (start + i) % this._capacity
      const event = this._buffer[idx]
      if (event !== undefined) result.push(event)
    }
    return result
  }

  get totalEvents(): number {
    return this._totalEvents
  }

  private _buildEvent(type: BfKeyboardEvent['type'], e: KeyboardEvent): BfKeyboardEvent {
    return {
      type,
      code: e.code,
      t: performance.now(),
    }
  }
}
