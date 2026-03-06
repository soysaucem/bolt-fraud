import type {
  TokenPayload,
  AutomationSignal,
  AutomationSignalName,
  IntegrityViolation,
  IntegrityViolationName,
} from '../types.js'

/**
 * Binary serialization for TokenPayload using DataView with big-endian byte order.
 * Reference: sws-chunk-6476.js module 5907
 */

const textEncoder = new TextEncoder()

export function serialize(payload: TokenPayload): Uint8Array {
  const writer = new BinaryWriter()

  // Format version
  writer.writeU8(1)

  // Timestamp as two u32s (high/low bits of ms timestamp)
  writer.writeU32(Math.floor(payload.timestamp / 0x100000000))
  writer.writeU32(payload.timestamp >>> 0)

  // Nonce and SDK version
  writer.writeStr(payload.nonce)
  writer.writeStr(payload.sdkVersion)

  // ── Fingerprint ────────────────────────────────────────────────────────────
  const fp = payload.fingerprint

  // Canvas, WebGL, Audio hashes
  writer.writeStr(fp.canvas.hash)
  writer.writeStr(fp.webgl.hash)
  writer.writeStr(fp.audio.hash)

  // WebGL renderer info
  writer.writeStr(fp.webgl.renderer)
  writer.writeStr(fp.webgl.vendor)
  writer.writeStr(fp.webgl.version)
  writer.writeStr(fp.webgl.shadingLanguageVersion)

  // WebGL extensions
  writer.writeU16(fp.webgl.extensions.length)
  for (const ext of fp.webgl.extensions) {
    writer.writeStr(ext)
  }

  // Navigator
  writer.writeStr(fp.navigator.userAgent)
  writer.writeStr(fp.navigator.language)
  writer.writeU16(fp.navigator.hardwareConcurrency)
  writer.writeU16(fp.navigator.maxTouchPoints)
  writer.writeU16(fp.navigator.pluginCount)
  writer.writeU8(fp.navigator.deviceMemory === null ? 0 : fp.navigator.deviceMemory)
  writer.writeU8(fp.navigator.cookieEnabled ? 1 : 0)

  // Navigator languages
  writer.writeU16(fp.navigator.languages.length)
  for (const lang of fp.navigator.languages) {
    writer.writeStr(lang)
  }

  // Screen
  writer.writeU16(fp.screen.width)
  writer.writeU16(fp.screen.height)
  writer.writeU16(fp.screen.availWidth)
  writer.writeU16(fp.screen.availHeight)
  writer.writeU8(fp.screen.colorDepth)
  writer.writeU8(fp.screen.pixelDepth)
  writer.writeU16(Math.round(fp.screen.devicePixelRatio * 100))

  // ── Detection ──────────────────────────────────────────────────────────────
  const det = payload.detection

  writer.writeU8(det.isAutomated ? 1 : 0)

  // Automation signals
  writer.writeU16(det.signals.length)
  for (const signal of det.signals) {
    writer.writeStr(signal.name)
    writer.writeU8(signal.detected ? 1 : 0)
  }

  // Integrity
  writer.writeU8(det.integrity.isValid ? 1 : 0)
  writer.writeU16(det.integrity.violations.length)
  for (const violation of det.integrity.violations) {
    writer.writeStr(violation.name)
  }

  // ── Behavior ───────────────────────────────────────────────────────────────
  const beh = payload.behavior

  // Mouse events
  writer.writeU16(beh.mouse.length)
  for (const ev of beh.mouse) {
    writer.writeStr(ev.type)
    writer.writeU16(ev.x)
    writer.writeU16(ev.y)
    writer.writeU32(Math.round(ev.t))
    writer.writeU8(ev.buttons)
  }

  // Keyboard events
  writer.writeU16(beh.keyboard.length)
  for (const ev of beh.keyboard) {
    writer.writeStr(ev.type)
    writer.writeStr(ev.code)
    writer.writeU32(Math.round(ev.t))
  }

  // Scroll events
  writer.writeU16(beh.scroll.length)
  for (const ev of beh.scroll) {
    writer.writeU16(ev.x)
    writer.writeU16(ev.y)
    writer.writeU32(Math.round(ev.t))
  }

  // Totals and snapshot timestamp
  writer.writeU32(beh.totalMouseEvents)
  writer.writeU32(beh.totalKeyboardEvents)
  writer.writeU32(beh.totalScrollEvents)
  const snap = Math.round(beh.snapshotAt)
  writer.writeU32(Math.floor(snap / 0x1_0000_0000))  // high
  writer.writeU32(snap >>> 0)                          // low

  return writer.finish()
}

export function deserialize(bytes: Uint8Array): TokenPayload {
  const reader = new BinaryReader(bytes)

  // Format version
  const version = reader.readU8()
  if (version !== 1) {
    throw new Error(`Unsupported binary format version: ${version}`)
  }

  // Timestamp
  const high = reader.readU32()
  const low = reader.readU32()
  const timestamp = high * 0x100000000 + low

  // Nonce and SDK version
  const nonce = reader.readStr()
  const sdkVersion = reader.readStr()

  // ── Fingerprint ────────────────────────────────────────────────────────────
  const canvasHash = reader.readStr()
  const webglHash = reader.readStr()
  const audioHash = reader.readStr()

  const webglRenderer = reader.readStr()
  const webglVendor = reader.readStr()
  const webglVersion = reader.readStr()
  const webglShadingLanguageVersion = reader.readStr()

  const extCount = reader.readU16()
  const extensions: string[] = []
  for (let i = 0; i < extCount; i++) {
    extensions.push(reader.readStr())
  }

  const userAgent = reader.readStr()
  const language = reader.readStr()
  const hardwareConcurrency = reader.readU16()
  const maxTouchPoints = reader.readU16()
  const pluginCount = reader.readU16()
  const deviceMemoryRaw = reader.readU8()
  const deviceMemory = deviceMemoryRaw === 0 ? null : deviceMemoryRaw
  const cookieEnabled = reader.readU8() === 1

  const langCount = reader.readU16()
  const languages: string[] = []
  for (let i = 0; i < langCount; i++) {
    languages.push(reader.readStr())
  }

  const screenWidth = reader.readU16()
  const screenHeight = reader.readU16()
  const screenAvailWidth = reader.readU16()
  const screenAvailHeight = reader.readU16()
  const colorDepth = reader.readU8()
  const pixelDepth = reader.readU8()
  const devicePixelRatio = reader.readU16() / 100

  // ── Detection ──────────────────────────────────────────────────────────────
  const isAutomated = reader.readU8() === 1

  const signalCount = reader.readU16()
  const signals: AutomationSignal[] = []
  for (let i = 0; i < signalCount; i++) {
    const name = reader.readStr() as AutomationSignalName
    const detected = reader.readU8() === 1
    signals.push({ name, detected })
  }

  const integrityIsValid = reader.readU8() === 1
  const violationCount = reader.readU16()
  const violations: IntegrityViolation[] = []
  for (let i = 0; i < violationCount; i++) {
    violations.push({ name: reader.readStr() as IntegrityViolationName })
  }

  // ── Behavior ───────────────────────────────────────────────────────────────
  const mouseCount = reader.readU16()
  const mouse: Array<{ type: 'move' | 'down' | 'up' | 'click'; x: number; y: number; t: number; buttons: number }> = []
  for (let i = 0; i < mouseCount; i++) {
    const type = reader.readStr() as 'move' | 'down' | 'up' | 'click'
    const x = reader.readU16()
    const y = reader.readU16()
    const t = reader.readU32()
    const buttons = reader.readU8()
    mouse.push({ type, x, y, t, buttons })
  }

  const keyboardCount = reader.readU16()
  const keyboard: Array<{ type: 'keydown' | 'keyup'; code: string; t: number }> = []
  for (let i = 0; i < keyboardCount; i++) {
    const type = reader.readStr() as 'keydown' | 'keyup'
    const code = reader.readStr()
    const t = reader.readU32()
    keyboard.push({ type, code, t })
  }

  const scrollCount = reader.readU16()
  const scroll: Array<{ x: number; y: number; t: number }> = []
  for (let i = 0; i < scrollCount; i++) {
    const x = reader.readU16()
    const y = reader.readU16()
    const t = reader.readU32()
    scroll.push({ x, y, t })
  }

  const totalMouseEvents = reader.readU32()
  const totalKeyboardEvents = reader.readU32()
  const totalScrollEvents = reader.readU32()
  const snapshotAtHigh = reader.readU32()
  const snapshotAtLow = reader.readU32()
  const snapshotAt = snapshotAtHigh * 0x1_0000_0000 + snapshotAtLow

  return {
    timestamp,
    nonce,
    sdkVersion,
    fingerprint: {
      canvas: { hash: canvasHash },
      webgl: {
        hash: webglHash,
        renderer: webglRenderer,
        vendor: webglVendor,
        version: webglVersion,
        shadingLanguageVersion: webglShadingLanguageVersion,
        extensions,
      },
      audio: { hash: audioHash },
      navigator: {
        userAgent,
        language,
        languages,
        platform: '',
        hardwareConcurrency,
        deviceMemory,
        maxTouchPoints,
        cookieEnabled,
        doNotTrack: null,
        vendor: '',
        pluginCount,
      },
      screen: {
        width: screenWidth,
        height: screenHeight,
        availWidth: screenAvailWidth,
        availHeight: screenAvailHeight,
        colorDepth,
        pixelDepth,
        devicePixelRatio,
      },
      collectedAt: timestamp,
    },
    detection: {
      isAutomated,
      signals,
      integrity: {
        isValid: integrityIsValid,
        violations,
      },
    },
    behavior: {
      mouse,
      keyboard,
      scroll,
      totalMouseEvents,
      totalKeyboardEvents,
      totalScrollEvents,
      snapshotAt,
    },
  }
}

export class BinaryWriter {
  private _buf: ArrayBuffer
  private _view: DataView
  private _offset = 0

  constructor(initialCapacity = 512) {
    this._buf = new ArrayBuffer(initialCapacity)
    this._view = new DataView(this._buf)
  }

  writeU8(value: number): void {
    this._ensureCapacity(1)
    this._view.setUint8(this._offset, value)
    this._offset += 1
  }

  writeU16(value: number): void {
    this._ensureCapacity(2)
    this._view.setUint16(this._offset, value, false)
    this._offset += 2
  }

  writeU32(value: number): void {
    this._ensureCapacity(4)
    this._view.setUint32(this._offset, value, false)
    this._offset += 4
  }

  writeStr(value: string): void {
    const encoded = textEncoder.encode(value)
    this.writeU16(encoded.length)
    this._ensureCapacity(encoded.length)
    new Uint8Array(this._buf, this._offset, encoded.length).set(encoded)
    this._offset += encoded.length
  }

  writeBytes(value: Uint8Array): void {
    this.writeU32(value.length)
    this._ensureCapacity(value.length)
    new Uint8Array(this._buf, this._offset, value.length).set(value)
    this._offset += value.length
  }

  finish(): Uint8Array {
    return new Uint8Array(this._buf, 0, this._offset)
  }

  private _ensureCapacity(needed: number): void {
    const required = this._offset + needed
    if (required <= this._buf.byteLength) return
    let newSize = this._buf.byteLength * 2
    while (newSize < required) newSize *= 2
    const newBuf = new ArrayBuffer(newSize)
    new Uint8Array(newBuf).set(new Uint8Array(this._buf))
    this._buf = newBuf
    this._view = new DataView(this._buf)
  }
}

class BinaryReader {
  private _view: DataView
  private _offset = 0
  private _decoder = new TextDecoder()

  constructor(bytes: Uint8Array) {
    this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  readU8(): number {
    const value = this._view.getUint8(this._offset)
    this._offset += 1
    return value
  }

  readU16(): number {
    const value = this._view.getUint16(this._offset, false)
    this._offset += 2
    return value
  }

  readU32(): number {
    const value = this._view.getUint32(this._offset, false)
    this._offset += 4
    return value
  }

  readStr(): string {
    const len = this.readU16()
    const bytes = new Uint8Array(this._view.buffer, this._view.byteOffset + this._offset, len)
    this._offset += len
    return this._decoder.decode(bytes)
  }
}
