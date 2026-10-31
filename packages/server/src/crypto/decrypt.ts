import {
  privateDecrypt,
  createDecipheriv,
  constants,
  type KeyObject,
} from 'node:crypto'
import type {
  Token,
  Fingerprint,
  DetectionData,
  BehaviorData,
  BfMouseEvent,
  BfKeyboardEvent,
  BfScrollEvent,
} from '../model/types.js'

const MAX_TOKEN_SIZE = 65_536 // 64 KB
/** Max base64url length of a MAX_TOKEN_SIZE-byte bundle (plus slack), checked before decoding. */
const MAX_BUNDLE_CHARS = Math.ceil((MAX_TOKEN_SIZE * 4) / 3) + 4

/**
 * Decrypt an encrypted token bundle from the client.
 * Bundle format: [keyId (u8)] [wrappedKeyLen (u16 big-endian)] [wrappedKey] [iv (12 bytes)] [ciphertext + authTag (last 16 bytes)]
 * The plaintext must be a v1 binary token (first byte 0x01).
 */
export function decryptToken(
  bundle: string,
  getPrivateKey: (keyId: number) => KeyObject,
): Token {
  // Reject oversized input before allocating a decoded buffer
  if (bundle.length > MAX_BUNDLE_CHARS) {
    throw new Error(`decryptToken: bundle exceeds max size (${bundle.length} chars > ${MAX_BUNDLE_CHARS})`)
  }

  const raw = base64urlDecode(bundle)

  if (raw.length > MAX_TOKEN_SIZE) {
    throw new Error(`decryptToken: bundle exceeds max size (${raw.length} > ${MAX_TOKEN_SIZE})`)
  }

  // Parse bundle: [keyId u8] [wrappedKeyLen u16] [wrappedKey] [iv 12 bytes] [ciphertext+authTag]
  if (raw.length < 3) {
    throw new Error('decryptToken: bundle too short to contain keyId and wrappedKeyLen')
  }
  const keyId = raw.readUInt8(0)
  const wrappedKeyLen = raw.readUInt16BE(1)
  const offset = 3
  if (raw.length < offset + wrappedKeyLen + 12 + 16) {
    throw new Error('decryptToken: bundle too short')
  }

  // RSA-OAEP output is always exactly modulus-length bytes; reject anything else before decrypting
  const privateKey = getPrivateKey(keyId)
  const modulusLength = privateKey.asymmetricKeyDetails?.modulusLength
  if (modulusLength === undefined || wrappedKeyLen !== modulusLength / 8) {
    throw new Error(`decryptToken: wrapped key length ${wrappedKeyLen} does not match key size`)
  }

  const wrappedKey = raw.subarray(offset, offset + wrappedKeyLen)
  const iv = raw.subarray(offset + wrappedKeyLen, offset + wrappedKeyLen + 12)
  const ciphertextWithTag = raw.subarray(offset + wrappedKeyLen + 12)

  // RSA-OAEP decrypt the wrappedKey → AES session key
  const aesKeyBytes = privateDecrypt(
    {
      key: privateKey,
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    wrappedKey,
  )

  // AES-256-GCM decrypt; auth tag is the last 16 bytes of the ciphertext blob
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)

  const decipher = createDecipheriv('aes-256-gcm', aesKeyBytes, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  const format = plaintext.length > 0 ? plaintext.readUInt8(0) : -1
  if (format !== 0x01) {
    throw new Error(`decryptToken: unsupported token format ${format}`)
  }
  return deserializeBinary(plaintext)
}

/**
 * Dev mode decrypt: no encryption, just base64url decode + deserialize.
 * The client in dev mode sends a plain base64url-encoded JSON or binary token.
 * Never use in production: JSON tokens are validated structurally only.
 */
export function decryptTokenDev(base64urlToken: string): Token {
  if (base64urlToken.length > MAX_BUNDLE_CHARS) {
    throw new Error(`decryptTokenDev: token exceeds max size (${base64urlToken.length} chars > ${MAX_BUNDLE_CHARS})`)
  }
  const raw = base64urlDecode(base64urlToken)

  if (raw.length > MAX_TOKEN_SIZE) {
    throw new Error(`decryptTokenDev: token exceeds max size (${raw.length} > ${MAX_TOKEN_SIZE})`)
  }

  if (raw.length > 0 && raw.readUInt8(0) === 0x01) {
    return deserializeBinary(raw)
  }

  return validateTokenShape(JSON.parse(raw.toString('utf-8')))
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function need(cond: boolean, field: string): void {
  if (!cond) throw new Error(`validateTokenShape: invalid ${field}`)
}

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isStrArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(isStr)
}

function isNamedList(v: unknown): boolean {
  return Array.isArray(v) && v.every((e) => isObject(e) && isStr(e.name))
}

function isEventList(v: unknown, numeric: readonly string[], strings: readonly string[]): boolean {
  return (
    Array.isArray(v) &&
    v.every((e) => isObject(e) && numeric.every((k) => isNum(e[k])) && strings.every((k) => isStr(e[k])))
  )
}

/**
 * Runtime validation of a parsed JSON object into a Token shape.
 * Throws if any field the scorers read is missing or of wrong type.
 * Optional fields absent from older payloads (fingerprint.audio, fingerprint.timezone) are defaulted.
 */
function validateTokenShape(raw: unknown): Token {
  if (!isObject(raw)) {
    throw new Error('validateTokenShape: not an object')
  }
  need(isNum(raw.timestamp), 'timestamp')
  need(isStr(raw.nonce), 'nonce')
  need(isStr(raw.sdkVersion), 'sdkVersion')

  const fp = raw.fingerprint
  need(isObject(fp), 'fingerprint')
  const f = fp as Record<string, unknown>
  need(isObject(f.canvas) && isStr(f.canvas.hash), 'fingerprint.canvas')
  const webgl = f.webgl
  need(
    isObject(webgl) &&
      isStr(webgl.hash) &&
      isStr(webgl.renderer) &&
      isStr(webgl.vendor) &&
      isStr(webgl.version) &&
      isStr(webgl.shadingLanguageVersion) &&
      isStrArray(webgl.extensions),
    'fingerprint.webgl',
  )
  need(f.audio === undefined || (isObject(f.audio) && isStr(f.audio.hash)), 'fingerprint.audio')
  const nav = f.navigator
  need(
    isObject(nav) &&
      isStr(nav.userAgent) &&
      isStr(nav.language) &&
      isStrArray(nav.languages) &&
      isStr(nav.platform) &&
      isNum(nav.hardwareConcurrency) &&
      (nav.deviceMemory === null || isNum(nav.deviceMemory)) &&
      isNum(nav.maxTouchPoints) &&
      typeof nav.cookieEnabled === 'boolean' &&
      (nav.doNotTrack === null || isStr(nav.doNotTrack)) &&
      isStr(nav.vendor) &&
      isNum(nav.pluginCount),
    'fingerprint.navigator',
  )
  const screen = f.screen
  need(
    isObject(screen) &&
      ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth', 'devicePixelRatio'].every((k) =>
        isNum(screen[k]),
      ),
    'fingerprint.screen',
  )
  need(isNum(f.collectedAt), 'fingerprint.collectedAt')
  need(f.timezone === undefined || isStr(f.timezone), 'fingerprint.timezone')

  const det = raw.detection
  need(isObject(det) && typeof det.isAutomated === 'boolean', 'detection')
  const d = det as Record<string, unknown>
  need(isNamedList(d.signals) && (d.signals as Record<string, unknown>[]).every((e) => typeof e.detected === 'boolean'), 'detection.signals')
  const integrity = d.integrity
  need(isObject(integrity) && typeof integrity.isValid === 'boolean' && isNamedList(integrity.violations), 'detection.integrity')

  const beh = raw.behavior
  need(isObject(beh), 'behavior')
  const b = beh as Record<string, unknown>
  need(isEventList(b.mouse, ['x', 'y', 't', 'buttons'], ['type']), 'behavior.mouse')
  need(isEventList(b.keyboard, ['t'], ['type']), 'behavior.keyboard')
  need(isEventList(b.scroll, ['x', 'y', 't'], []), 'behavior.scroll')
  need(
    isNum(b.totalMouseEvents) && isNum(b.totalKeyboardEvents) && isNum(b.totalScrollEvents) && isNum(b.snapshotAt),
    'behavior totals',
  )

  return {
    ...raw,
    fingerprint: {
      ...f,
      audio: f.audio ?? { hash: '' },
      timezone: f.timezone ?? '',
    },
  } as unknown as Token
}

/**
 * Deserialize the v1 binary token format that the client serializer writes.
 *
 * Binary layout (all strings are length-prefixed: u16 len then UTF-8 bytes):
 *   u8     version  (must be 0x01)
 *   u32    timestamp high 32 bits
 *   u32    timestamp low  32 bits
 *   str    nonce
 *   str    sdkVersion
 *   --- Fingerprint ---
 *   str    canvas.hash
 *   str    webgl.hash
 *   str    audio.hash          ← retired: clients >= 0.4.0 always write ''; read for 0.3.x compat
 *   str    webgl.renderer
 *   str    webgl.vendor
 *   str    webgl.version
 *   str    webgl.shadingLanguageVersion
 *   u16    webgl.extensions.length
 *   str[]  webgl.extensions
 *   str    navigator.userAgent
 *   str    navigator.language
 *   u16    navigator.hardwareConcurrency   (u16, not u32)
 *   u16    navigator.maxTouchPoints        (u16, not u32)
 *   u16    navigator.pluginCount           (u16, not u32)
 *   u8     navigator.deviceMemory          (0 = null, else the value)
 *   u8     navigator.cookieEnabled         (0/1)
 *   u16    navigator.languages.length
 *   str[]  navigator.languages
 *   str    navigator.platform
 *   str    navigator.vendor
 *   str    navigator.doNotTrack      (empty string encodes null)
 *   u16    screen.width
 *   u16    screen.height
 *   u16    screen.availWidth
 *   u16    screen.availHeight
 *   u8     screen.colorDepth
 *   u8     screen.pixelDepth
 *   u16    screen.devicePixelRatio * 100   (u16, not f64)
 *   u32    collectedAt high 32 bits
 *   u32    collectedAt low  32 bits
 *   --- DetectionData ---
 *   u8     isAutomated (0/1)
 *   u16    signals.length
 *   per signal:
 *     str  name
 *     u8   detected (0/1)
 *     (NO detail flag)
 *   u8     integrity.isValid (0/1)
 *   u16    violations.length
 *   per violation:
 *     str  name
 *     (NO detail flag)
 *   --- BehaviorData ---
 *   u16    mouse.length
 *   per mouse event:
 *     str  type
 *     u16  x
 *     u16  y
 *     u32  t
 *     u8   buttons
 *   u16    keyboard.length
 *   per keyboard event:
 *     str  type
 *     str  code           ← retired: clients >= 0.4.0 always write ''; read for 0.3.x compat
 *     u32  t
 *   u16    scroll.length
 *   per scroll event:
 *     u16  x
 *     u16  y
 *     u32  t
 *   u32    totalMouseEvents
 *   u32    totalKeyboardEvents
 *   u32    totalScrollEvents
 *   u64    snapshotAt (as two u32s, high then low)
 *   str    timezone            (optional trailing field; absent from clients < 0.4.0, then '')
 *
 * Bytes after the optional timezone are ignored so a newer client can talk to an older server.
 * Every string and count is capped; exceeding a cap throws `field <name> exceeds <n>`.
 */
function deserializeBinary(bytes: Buffer): Token {
  let pos = 0

  function readU8(): number {
    if (pos + 1 > bytes.length) throw new Error('deserializeBinary: unexpected end of buffer at offset ' + pos)
    const val = bytes.readUInt8(pos)
    pos += 1
    return val
  }

  function readU16(): number {
    if (pos + 2 > bytes.length) throw new Error('deserializeBinary: unexpected end of buffer at offset ' + pos)
    const val = bytes.readUInt16BE(pos)
    pos += 2
    return val
  }

  function readU32(): number {
    if (pos + 4 > bytes.length) throw new Error('deserializeBinary: unexpected end of buffer at offset ' + pos)
    const val = bytes.readUInt32BE(pos)
    pos += 4
    return val
  }

  function readStr(name: string, max: number): string {
    const len = readU16()
    if (len > max) throw new Error(`deserializeBinary: field ${name} exceeds ${max}`)
    if (pos + len > bytes.length) throw new Error('deserializeBinary: string exceeds buffer at offset ' + pos)
    const str = bytes.toString('utf-8', pos, pos + len)
    pos += len
    return str
  }

  function readCount(name: string, max: number): number {
    const count = readU16()
    if (count > max) throw new Error(`deserializeBinary: field ${name} exceeds ${max}`)
    return count
  }

  function readStrArray(name: string, maxCount: number, maxLen: number): readonly string[] {
    const count = readCount(name, maxCount)
    const arr: string[] = []
    for (let i = 0; i < count; i++) {
      arr.push(readStr(name, maxLen))
    }
    return arr
  }

  // version
  const version = readU8()
  if (version !== 0x01) {
    throw new Error(`deserializeBinary: unsupported version ${version}`)
  }

  // timestamp: high 32 bits + low 32 bits
  const tsHigh = readU32()
  const tsLow = readU32()
  const timestamp = tsHigh * 0x1_0000_0000 + tsLow

  const nonce = readStr('nonce', 64)
  const sdkVersion = readStr('sdkVersion', 32)

  // Fingerprint — order matches client serializer exactly
  const canvasHash = readStr('canvas.hash', 128)
  const webglHash = readStr('webgl.hash', 128)
  const audioHash = readStr('audio.hash', 128)   // retired slot: '' from clients >= 0.4.0
  const webglRenderer = readStr('webgl.renderer', 256)
  const webglVendor = readStr('webgl.vendor', 256)
  const webglVersion = readStr('webgl.version', 256)
  const webglShadingLanguageVersion = readStr('webgl.shadingLanguageVersion', 256)
  const webglExtensions = readStrArray('webgl.extensions', 64, 256)

  const navUserAgent = readStr('navigator.userAgent', 512)
  const navLanguage = readStr('navigator.language', 128)
  const hardwareConcurrency = readU16()   // u16
  const maxTouchPoints = readU16()        // u16
  const pluginCount = readU16()           // u16
  const deviceMemoryRaw = readU8()        // u8: 0 = null, else value
  const deviceMemory: number | null = deviceMemoryRaw === 0 ? null : deviceMemoryRaw
  const cookieEnabled = readU8() === 1
  const navLanguages = readStrArray('navigator.languages', 32, 128)

  const navPlatform = readStr('navigator.platform', 128)
  const navVendor = readStr('navigator.vendor', 128)
  const doNotTrackRaw = readStr('navigator.doNotTrack', 128)
  const doNotTrack: string | null = doNotTrackRaw === '' ? null : doNotTrackRaw

  const screenWidth = readU16()
  const screenHeight = readU16()
  const screenAvailWidth = readU16()
  const screenAvailHeight = readU16()
  const screenColorDepth = readU8()       // u8
  const screenPixelDepth = readU8()       // u8
  const devicePixelRatioRaw = readU16()   // u16: DPR * 100
  const devicePixelRatio = devicePixelRatioRaw / 100

  const collectedAtHigh = readU32()
  const collectedAtLow = readU32()
  const collectedAt = collectedAtHigh * 0x1_0000_0000 + collectedAtLow

  // DetectionData — no detail flag in binary
  const isAutomated = readU8() === 1
  const signalCount = readCount('detection.signals', 64)
  const signals: Array<{ readonly name: string; readonly detected: boolean }> = []
  for (let i = 0; i < signalCount; i++) {
    const name = readStr('signal.name', 128)
    const detected = readU8() === 1
    signals.push({ name, detected })
  }
  const integrityValid = readU8() === 1
  const violationCount = readCount('detection.violations', 64)
  const violations: Array<{ readonly name: string }> = []
  for (let i = 0; i < violationCount; i++) {
    const name = readStr('violation.name', 128)
    violations.push({ name })
  }

  const detection: DetectionData = {
    isAutomated,
    signals,
    integrity: {
      isValid: integrityValid,
      violations,
    },
  }

  // BehaviorData
  const mouseCount = readCount('behavior.mouse', 512)
  const mouse: BfMouseEvent[] = []
  for (let i = 0; i < mouseCount; i++) {
    const type = readStr('mouse.type', 16)
    const x = readU16()
    const y = readU16()
    const t = readU32()
    const buttons = readU8()
    mouse.push({ type, x, y, t, buttons })
  }

  const keyboardCount = readCount('behavior.keyboard', 512)
  const keyboard: BfKeyboardEvent[] = []
  for (let i = 0; i < keyboardCount; i++) {
    const type = readStr('keyboard.type', 16)
    const code = readStr('keyboard.code', 32)
    const t = readU32()
    keyboard.push({ type, code, t })
  }

  const scrollCount = readCount('behavior.scroll', 512)
  const scroll: BfScrollEvent[] = []
  for (let i = 0; i < scrollCount; i++) {
    const x = readU16()
    const y = readU16()
    const t = readU32()
    scroll.push({ x, y, t })
  }

  const totalMouseEvents = readU32()
  const totalKeyboardEvents = readU32()
  const totalScrollEvents = readU32()
  const snapHigh = readU32()
  const snapLow = readU32()
  const snapshotAt = snapHigh * 0x1_0000_0000 + snapLow

  // Optional trailing field (clients >= 0.4.0); anything after it is ignored
  const timezone = pos < bytes.length ? readStr('timezone', 64) : ''

  const fingerprint: Fingerprint = {
    canvas: { hash: canvasHash },
    webgl: {
      hash: webglHash,
      renderer: webglRenderer,
      vendor: webglVendor,
      version: webglVersion,
      shadingLanguageVersion: webglShadingLanguageVersion,
      extensions: webglExtensions,
    },
    audio: { hash: audioHash },
    navigator: {
      userAgent: navUserAgent,
      language: navLanguage,
      languages: navLanguages,
      platform: navPlatform,
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints,
      cookieEnabled,
      doNotTrack,
      vendor: navVendor,
      pluginCount,
    },
    screen: {
      width: screenWidth,
      height: screenHeight,
      availWidth: screenAvailWidth,
      availHeight: screenAvailHeight,
      colorDepth: screenColorDepth,
      pixelDepth: screenPixelDepth,
      devicePixelRatio,
    },
    collectedAt,
    timezone,
  }


  const behavior: BehaviorData = {
    mouse,
    keyboard,
    scroll,
    totalMouseEvents,
    totalKeyboardEvents,
    totalScrollEvents,
    snapshotAt,
  }

  return { fingerprint, detection, behavior, timestamp, nonce, sdkVersion }
}

export function base64urlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url')
}
