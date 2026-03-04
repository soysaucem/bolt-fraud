import type { BfMouseEvent } from '../types.js'

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

    document.addEventListener('mousemove', this._onMove)
    document.addEventListener('mousedown', this._onDown)
    document.addEventListener('mouseup', this._onUp)
    document.addEventListener('click', this._onClick)
  }

  stop(): void {
    if (!this._listening) return
    this._listening = false

    if (this._onMove) document.removeEventListener('mousemove', this._onMove)
    if (this._onDown) document.removeEventListener('mousedown', this._onDown)
    if (this._onUp) document.removeEventListener('mouseup', this._onUp)
    if (this._onClick) document.removeEventListener('click', this._onClick)

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
