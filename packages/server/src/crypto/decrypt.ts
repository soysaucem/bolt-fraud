import {
  createPrivateKey,
  privateDecrypt,
  createDecipheriv,
  constants,
} from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import type {
  Token,
  Fingerprint,
  DetectionData,
  BehaviorData,
  MouseEvent,
  KeyboardEvent,
  ScrollEvent,
} from '../model/types.js'

const MAX_TOKEN_SIZE = 65_536 // 64 KB
const MAX_DECOMPRESSED_SIZE = 1_048_576 // 1 MB

/**
 * Decrypt an encrypted token bundle from the client.
 * Bundle format: [wrappedKeyLen (u16 big-endian)] [wrappedKey] [iv (12 bytes)] [ciphertext + authTag (last 16 bytes)]
 */
export function decryptToken(
  bundle: string,
  privateKeyPem: string,
): Token {
  // 1. base64url decode
  const raw = base64urlDecode(bundle)

  // Token size limit — reject oversized bundles before any expensive ops
  if (raw.length > MAX_TOKEN_SIZE) {
    throw new Error(`decryptToken: bundle exceeds max size (${raw.length} > ${MAX_TOKEN_SIZE})`)
  }

  // 2. Parse bundle: [wrappedKeyLen u16] [wrappedKey] [iv 12 bytes] [ciphertext+authTag]
  if (raw.length < 2) {
    throw new Error('decryptToken: bundle too short to contain wrappedKeyLen')
  }
  const wrappedKeyLen = raw.readUInt16BE(0)
  const offset = 2
  if (raw.length < offset + wrappedKeyLen + 12 + 16) {
    throw new Error('decryptToken: bundle too short')
  }
  const wrappedKey = raw.subarray(offset, offset + wrappedKeyLen)
  const iv = raw.subarray(offset + wrappedKeyLen, offset + wrappedKeyLen + 12)
  const ciphertextWithTag = raw.subarray(offset + wrappedKeyLen + 12)

  // 3. RSA-OAEP decrypt the wrappedKey → AES session key
  const aesKeyBytes = privateDecrypt(
    {
      key: createPrivateKey(privateKeyPem),
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    wrappedKey,
  )

  // 4. AES-256-GCM decrypt
  // Auth tag is the last 16 bytes of the ciphertext blob
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)

  const decipher = createDecipheriv('aes-256-gcm', aesKeyBytes, iv)
  decipher.setAuthTag(authTag)
  let plaintext: Buffer = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  // 5. Attempt deflate-raw decompression. The client uses deflate-raw (no zlib header),
  //    so we can't rely on a fixed magic byte. Try decompression; if it succeeds and the
  //    result looks like a valid token (version 0x01 or JSON '{'), use decompressed data.
  plaintext = tryDecompress(plaintext)

  // 6. Deserialize: check if v1 binary format (first byte is version 1)
  //    or JSON fallback (first byte is '{' = 0x7b)
  if (plaintext.length > 0 && plaintext.readUInt8(0) === 0x01) {
    return deserializeBinary(plaintext)
  }

  // JSON fallback for development
  return JSON.parse(plaintext.toString('utf-8')) as Token
}

/**
 * Dev mode decrypt: no encryption, just base64url decode + deserialize.
 * The client in dev mode sends a plain base64url-encoded JSON or binary token.
 */
export function decryptTokenDev(base64urlToken: string): Token {
  const raw = base64urlDecode(base64urlToken)

  // Token size limit
  if (raw.length > MAX_TOKEN_SIZE) {
    throw new Error(`decryptTokenDev: token exceeds max size (${raw.length} > ${MAX_TOKEN_SIZE})`)
  }

  const bytes = tryDecompress(raw)

  if (bytes.length > 0 && bytes.readUInt8(0) === 0x01) {
    return deserializeBinary(bytes)
  }

  return JSON.parse(bytes.toString('utf-8')) as Token
}

/**
 * Attempt deflate-raw decompression. The client uses deflate-raw (no zlib header),
 * so there is no fixed magic byte to check. Try inflateRawSync; if it succeeds and
 * the result starts with a valid token marker (0x01 or '{'), use the decompressed data.
 * If decompression fails or the result doesn't look like a token, return the original.
 * Always enforces MAX_DECOMPRESSED_SIZE.
 */
function tryDecompress(data: Buffer): Buffer {
  try {
    const decompressed = inflateRawSync(data) as Buffer
    if (decompressed.length > MAX_DECOMPRESSED_SIZE) {
      throw new Error(`tryDecompress: decompressed size ${decompressed.length} exceeds limit ${MAX_DECOMPRESSED_SIZE}`)
    }
    const firstByte = decompressed.length > 0 ? decompressed.readUInt8(0) : -1
    // 0x01 = binary version byte, 0x7b = '{' (JSON)
    if (firstByte === 0x01 || firstByte === 0x7b) {
      return decompressed
    }
    // Decompressed but not a recognizable format — use original
    return data
  } catch (err) {
    // Not compressed or invalid — use raw bytes
    // Re-throw if it is our own size-limit error
    if (err instanceof Error && err.message.startsWith('tryDecompress:')) {
      throw err
    }
    return data
  }
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
 *   str    audio.hash          ← audio hash comes BEFORE webgl details
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
 *   u16    screen.width
 *   u16    screen.height
 *   u16    screen.availWidth
 *   u16    screen.availHeight
 *   u8     screen.colorDepth
 *   u8     screen.pixelDepth
 *   u16    screen.devicePixelRatio * 100   (u16, not f64)
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
 *     str  code
 *     u32  t
 *   u16    scroll.length
 *   per scroll event:
 *     u16  x
 *     u16  y
 *     u32  t
 *   u32    totalMouseEvents
 *   u32    totalKeyboardEvents
 *   u32    totalScrollEvents
 *   u32    snapshotAt          (single u32, not u64)
 */
function deserializeBinary(bytes: Buffer): Token {
  let pos = 0

  function readU8(): number {
    const val = bytes.readUInt8(pos)
    pos += 1
    return val
  }

  function readU16(): number {
    const val = bytes.readUInt16BE(pos)
    pos += 2
    return val
  }

  function readU32(): number {
    const val = bytes.readUInt32BE(pos)
    pos += 4
    return val
  }

  function readStr(): string {
    const len = readU16()
    const str = bytes.toString('utf-8', pos, pos + len)
    pos += len
    return str
  }

  function readStrArray(): readonly string[] {
    const count = readU16()
    const arr: string[] = []
    for (let i = 0; i < count; i++) {
      arr.push(readStr())
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

  const nonce = readStr()
  const sdkVersion = readStr()

  // Fingerprint — order matches client serializer exactly
  const canvasHash = readStr()
  const webglHash = readStr()
  const audioHash = readStr()        // audio comes BEFORE webgl renderer
  const webglRenderer = readStr()
  const webglVendor = readStr()
  const webglVersion = readStr()
  const webglShadingLanguageVersion = readStr()
  const webglExtensions = readStrArray()

  const navUserAgent = readStr()
  const navLanguage = readStr()
  const hardwareConcurrency = readU16()   // u16
  const maxTouchPoints = readU16()        // u16
  const pluginCount = readU16()           // u16
  const deviceMemoryRaw = readU8()        // u8: 0 = null, else value
  const deviceMemory: number | null = deviceMemoryRaw === 0 ? null : deviceMemoryRaw
  const cookieEnabled = readU8() === 1
  const navLanguages = readStrArray()

  const screenWidth = readU16()
  const screenHeight = readU16()
  const screenAvailWidth = readU16()
  const screenAvailHeight = readU16()
  const screenColorDepth = readU8()       // u8
  const screenPixelDepth = readU8()       // u8
  const devicePixelRatioRaw = readU16()   // u16: DPR * 100
  const devicePixelRatio = devicePixelRatioRaw / 100

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
      // platform, doNotTrack, vendor not in binary — set defaults
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
      colorDepth: screenColorDepth,
      pixelDepth: screenPixelDepth,
      devicePixelRatio,
    },
    // collectedAt not in binary — use token timestamp as default
    collectedAt: timestamp,
  }

  // DetectionData — no detail flag in binary
  const isAutomated = readU8() === 1
  const signalCount = readU16()
  const signals: Array<{ readonly name: string; readonly detected: boolean }> = []
  for (let i = 0; i < signalCount; i++) {
    const name = readStr()
    const detected = readU8() === 1
    signals.push({ name, detected })
  }
  const integrityValid = readU8() === 1
  const violationCount = readU16()
  const violations: Array<{ readonly name: string }> = []
  for (let i = 0; i < violationCount; i++) {
    const name = readStr()
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
  const mouseCount = readU16()
  const mouse: MouseEvent[] = []
  for (let i = 0; i < mouseCount; i++) {
    const type = readStr()
    const x = readU16()
    const y = readU16()
    const t = readU32()
    const buttons = readU8()
    mouse.push({ type, x, y, t, buttons })
  }

  const keyboardCount = readU16()
  const keyboard: KeyboardEvent[] = []
  for (let i = 0; i < keyboardCount; i++) {
    const type = readStr()
    const code = readStr()
    const t = readU32()
    keyboard.push({ type, code, t })
  }

  const scrollCount = readU16()
  const scroll: ScrollEvent[] = []
  for (let i = 0; i < scrollCount; i++) {
    const x = readU16()
    const y = readU16()
    const t = readU32()
    scroll.push({ x, y, t })
  }

  const totalMouseEvents = readU32()
  const totalKeyboardEvents = readU32()
  const totalScrollEvents = readU32()
  const snapshotAt = readU32()  // single u32, not u64

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
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (encoded.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}
