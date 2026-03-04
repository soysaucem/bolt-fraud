import {
  createPrivateKey,
  privateDecrypt,
  createDecipheriv,
  constants,
} from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import type { Token, Fingerprint, DetectionData, BehaviorData } from '../model/types.js'

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
  let plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  // 5. Check for deflate-raw magic byte (0x78) and decompress if present
  if (plaintext.readUInt8(0) === 0x78) {
    plaintext = inflateRawSync(plaintext)
  }

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
  let bytes = base64urlDecode(base64urlToken)

  // Decompress if deflate-raw magic
  if (bytes.length > 0 && bytes.readUInt8(0) === 0x78) {
    bytes = inflateRawSync(bytes)
  }

  if (bytes.length > 0 && bytes.readUInt8(0) === 0x01) {
    return deserializeBinary(bytes)
  }

  return JSON.parse(bytes.toString('utf-8')) as Token
}

/**
 * Deserialize the v1 binary token format that mirrors the client's serialize output.
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
 *   str    webgl.renderer
 *   str    webgl.vendor
 *   str    webgl.version
 *   str    webgl.shadingLanguageVersion
 *   u16    webgl.extensions.length
 *   str[]  webgl.extensions
 *   str    audio.hash
 *   str    navigator.userAgent
 *   str    navigator.language
 *   u16    navigator.languages.length
 *   str[]  navigator.languages
 *   str    navigator.platform
 *   u32    navigator.hardwareConcurrency
 *   u8     navigator.deviceMemory presence flag (0 = null, 1 = present)
 *   f64?   navigator.deviceMemory (if flag = 1)
 *   u32    navigator.maxTouchPoints
 *   u8     navigator.cookieEnabled (0/1)
 *   u8     navigator.doNotTrack presence flag (0 = null, 1 = present)
 *   str?   navigator.doNotTrack (if flag = 1)
 *   str    navigator.vendor
 *   u32    navigator.pluginCount
 *   u32    screen.width
 *   u32    screen.height
 *   u32    screen.colorDepth
 *   f64    screen.devicePixelRatio
 *   u64    fingerprint.collectedAt (as two u32s, high then low)
 *   --- DetectionData ---
 *   u8     isAutomated (0/1)
 *   u16    signals.length
 *   per signal:
 *     str  name
 *     u8   detected (0/1)
 *     u8   detail presence flag
 *     str? detail
 *   u8     integrity.isValid (0/1)
 *   u16    violations.length
 *   per violation:
 *     str  name
 *     u8   detail presence flag
 *     str? detail
 *   --- BehaviorData ---
 *   u16    mouse.length
 *   per mouse event:
 *     str  type
 *     f64  x
 *     f64  y
 *     f64  t
 *   u16    keyboard.length
 *   per keyboard event:
 *     str  type
 *     str  code
 *     f64  t
 *   u16    scroll.length
 *   per scroll event:
 *     f64  x
 *     f64  y
 *     f64  t
 *   u32    totalMouseEvents
 *   u32    totalKeyboardEvents
 *   u32    totalScrollEvents
 *   u64    snapshotAt (as two u32s, high then low)
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

  function readF64(): number {
    const val = bytes.readDoubleBE(pos)
    pos += 8
    return val
  }

  function readU64(): number {
    const high = readU32()
    const low = readU32()
    // Combine as a JS number (safe for timestamps within Number.MAX_SAFE_INTEGER)
    return high * 0x1_0000_0000 + low
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

  const timestamp = readU64()
  const nonce = readStr()
  const sdkVersion = readStr()

  // Fingerprint
  const canvasHash = readStr()
  const webglHash = readStr()
  const webglRenderer = readStr()
  const webglVendor = readStr()
  const webglVersion = readStr()
  const webglShadingLanguageVersion = readStr()
  const webglExtensions = readStrArray()
  const audioHash = readStr()
  const navUserAgent = readStr()
  const navLanguage = readStr()
  const navLanguages = readStrArray()
  const navPlatform = readStr()
  const hardwareConcurrency = readU32()
  const deviceMemoryPresent = readU8()
  const deviceMemory: number | null = deviceMemoryPresent === 1 ? readF64() : null
  const maxTouchPoints = readU32()
  const cookieEnabled = readU8() === 1
  const doNotTrackPresent = readU8()
  const doNotTrack: string | null = doNotTrackPresent === 1 ? readStr() : null
  const navVendor = readStr()
  const pluginCount = readU32()
  const screenWidth = readU32()
  const screenHeight = readU32()
  const screenColorDepth = readU32()
  const devicePixelRatio = readF64()
  const collectedAt = readU64()

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
      colorDepth: screenColorDepth,
      devicePixelRatio,
    },
    collectedAt,
  }

  // DetectionData
  const isAutomated = readU8() === 1
  const signalCount = readU16()
  const signals = []
  for (let i = 0; i < signalCount; i++) {
    const name = readStr()
    const detected = readU8() === 1
    const hasDetail = readU8() === 1
    const detail = hasDetail ? readStr() : undefined
    signals.push({ name, detected, ...(detail !== undefined ? { detail } : {}) })
  }
  const integrityValid = readU8() === 1
  const violationCount = readU16()
  const violations = []
  for (let i = 0; i < violationCount; i++) {
    const name = readStr()
    const hasDetail = readU8() === 1
    const detail = hasDetail ? readStr() : undefined
    violations.push({ name, ...(detail !== undefined ? { detail } : {}) })
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
  const mouse = []
  for (let i = 0; i < mouseCount; i++) {
    const type = readStr()
    const x = readF64()
    const y = readF64()
    const t = readF64()
    mouse.push({ type, x, y, t })
  }

  const keyboardCount = readU16()
  const keyboard = []
  for (let i = 0; i < keyboardCount; i++) {
    const type = readStr()
    const code = readStr()
    const t = readF64()
    keyboard.push({ type, code, t })
  }

  const scrollCount = readU16()
  const scroll = []
  for (let i = 0; i < scrollCount; i++) {
    const x = readF64()
    const y = readF64()
    const t = readF64()
    scroll.push({ x, y, t })
  }

  const totalMouseEvents = readU32()
  const totalKeyboardEvents = readU32()
  const totalScrollEvents = readU32()
  const snapshotAt = readU64()

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
