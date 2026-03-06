import type { BfScrollEvent } from '../types.js'

export class ScrollTracker {
  private readonly _buffer: BfScrollEvent[]
  private readonly _capacity: number
  private _head = 0
  private _count = 0
  private _totalEvents = 0
  private _lastEventAt = -Infinity
  private _listening = false

  private static readonly THROTTLE_MS = 100

  // Stable listener reference for cleanup
  private _onScroll: (() => void) | null = null

  constructor(capacity: number) {
    this._capacity = capacity
    this._buffer = new Array<BfScrollEvent>(capacity)
  }

  start(): void {
    if (this._listening) return
    this._listening = true

    this._onScroll = () => {
      const now = performance.now()
      if (now - this._lastEventAt < ScrollTracker.THROTTLE_MS) return
      this.push(this._buildEvent(now))
    }

    document.addEventListener('scroll', this._onScroll, { passive: true })
  }

  stop(): void {
    if (!this._listening) return
    this._listening = false

    if (this._onScroll) {
      document.removeEventListener('scroll', this._onScroll)
    }
    this._onScroll = null
  }

  push(event: BfScrollEvent): void {
    this._lastEventAt = event.t
    this._buffer[this._head] = event
    this._head = (this._head + 1) % this._capacity
    if (this._count < this._capacity) this._count++
    this._totalEvents++
  }

  snapshot(): readonly BfScrollEvent[] {
    if (this._count === 0) return []
    const start = this._count < this._capacity ? 0 : this._head
    const result: BfScrollEvent[] = []
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

  private _buildEvent(t: number): BfScrollEvent {
    return {
      x: typeof window !== 'undefined' ? window.scrollX : 0,
      y: typeof window !== 'undefined' ? window.scrollY : 0,
      t,
    }
  }
}
