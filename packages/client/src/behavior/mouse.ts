import type { BfMouseEvent } from '../types.js'

const LISTENER_OPTIONS = { capture: true, passive: true } as const

export class MouseTracker {
  private readonly _buffer: BfMouseEvent[]
  private readonly _capacity: number
  private _head = 0
  private _count = 0
  private _totalEvents = 0
  private _listening = false
  private _lastMoveAt = -Infinity

  private static readonly MOVE_THROTTLE_MS = 16

  // Stable listener references for cleanup
  private _onMove: ((e: MouseEvent) => void) | null = null
  private _onDown: ((e: MouseEvent) => void) | null = null
  private _onUp: ((e: MouseEvent) => void) | null = null
  private _onClick: ((e: MouseEvent) => void) | null = null

  constructor(capacity: number) {
    this._capacity = capacity
    this._buffer = new Array<BfMouseEvent>(capacity)
  }

  start(): void {
    if (this._listening) return
    this._listening = true

    this._onMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - this._lastMoveAt < MouseTracker.MOVE_THROTTLE_MS) return
      this._lastMoveAt = now
      this.push(this._buildEvent('move', e, now))
    }

    this._onDown = (e: MouseEvent) => {
      this.push(this._buildEvent('down', e, performance.now()))
    }

    this._onUp = (e: MouseEvent) => {
      this.push(this._buildEvent('up', e, performance.now()))
    }

    this._onClick = (e: MouseEvent) => {
      this.push(this._buildEvent('click', e, performance.now()))
    }

    document.addEventListener('pointermove', this._onMove, LISTENER_OPTIONS)
    document.addEventListener('pointerdown', this._onDown, LISTENER_OPTIONS)
    document.addEventListener('pointerup', this._onUp, LISTENER_OPTIONS)
    document.addEventListener('click', this._onClick, LISTENER_OPTIONS)
  }

  stop(): void {
    if (!this._listening) return
    this._listening = false

    if (this._onMove) document.removeEventListener('pointermove', this._onMove, LISTENER_OPTIONS)
    if (this._onDown) document.removeEventListener('pointerdown', this._onDown, LISTENER_OPTIONS)
    if (this._onUp) document.removeEventListener('pointerup', this._onUp, LISTENER_OPTIONS)
    if (this._onClick) document.removeEventListener('click', this._onClick, LISTENER_OPTIONS)

    this._onMove = null
    this._onDown = null
    this._onUp = null
    this._onClick = null
  }

  push(event: BfMouseEvent): void {
    this._buffer[this._head] = event
    this._head = (this._head + 1) % this._capacity
    if (this._count < this._capacity) this._count++
    this._totalEvents++
  }

  snapshot(): readonly BfMouseEvent[] {
    if (this._count === 0) return []
    const start = this._count < this._capacity ? 0 : this._head
    const result: BfMouseEvent[] = []
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

  private _buildEvent(
    type: BfMouseEvent['type'],
    e: MouseEvent,
    t: number,
  ): BfMouseEvent {
    return {
      type,
      x: e.clientX,
      y: e.clientY,
      t,
      buttons: e.buttons,
    }
  }
}
