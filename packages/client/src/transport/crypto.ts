/**
 * Envelope encryption: AES-256-GCM + RSA-OAEP key wrapping.
 * Improvement over Shopee: random IV per token, authenticated encryption.
 *
 * Bundle wire format:
 *   [1 byte: keyId] [2 bytes: wrappedKey length BE] [wrappedKey bytes] [12 bytes: IV] [ciphertext bytes]
 */

const IV_LENGTH = 12

const PEM_PUBLIC_HEADER = '-----BEGIN PUBLIC KEY-----'

// Imported RSA keys, keyed by PEM. A rejected import is evicted so a retry can succeed.
const _publicKeyCache = new Map<string, Promise<CryptoKey>>()

function getPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  let cached = _publicKeyCache.get(publicKeyPem)
  if (!cached) {
    cached = importPublicKey(publicKeyPem)
    cached.catch(() => _publicKeyCache.delete(publicKeyPem))
    _publicKeyCache.set(publicKeyPem, cached)
  }
  return cached
}

export async function encrypt(
  plaintext: Uint8Array,
  publicKeyPem: string | undefined,
  keyId: number = 0,
  devMode: boolean = false,
): Promise<string> {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
    throw new Error('[bolt-fraud] keyId must be an integer from 0 to 255')
  }

  if (!publicKeyPem) {
    if (!devMode) {
      throw new Error('[bolt-fraud] publicKey is required unless devMode is true')
    }
    // Dev mode — no public key provided, return plaintext as base64url
    return base64urlEncode(plaintext)
  }

  if (!publicKeyPem.includes(PEM_PUBLIC_HEADER)) {
    throw new Error('[bolt-fraud] publicKey must be a PEM-encoded SPKI public key')
  }

  const rsaKey = await getPublicKey(publicKeyPem)
  const aesKey = await generateAESKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext as Uint8Array<ArrayBuffer>,
  )

  const wrappedKey = await crypto.subtle.wrapKey('raw', aesKey, rsaKey, {
    name: 'RSA-OAEP',
  })

  // Build bundle: [u8 keyId] [u16 wrappedKey length] [wrappedKey] [12-byte IV] [ciphertext]
  const wrappedKeyBytes = new Uint8Array(wrappedKey)
  const ciphertextBytes = new Uint8Array(ciphertext)

  const bundle = new Uint8Array(1 + 2 + wrappedKeyBytes.length + IV_LENGTH + ciphertextBytes.length)
  bundle[0] = keyId
  const view = new DataView(bundle.buffer)
  view.setUint16(1, wrappedKeyBytes.length, false)
  bundle.set(wrappedKeyBytes, 3)
  bundle.set(iv, 3 + wrappedKeyBytes.length)
  bundle.set(ciphertextBytes, 3 + wrappedKeyBytes.length + IV_LENGTH)

  return base64urlEncode(bundle)
}

export async function decrypt(
  bundle: string,
  privateKeyPem: string,
): Promise<{ plaintext: Uint8Array; keyId: number }> {
  const bundleBytes = base64urlDecode(bundle)
  const view = new DataView(bundleBytes.buffer, bundleBytes.byteOffset, bundleBytes.byteLength)

  // Parse bundle: [u8 keyId] [u16 wrappedKey length] [wrappedKey] [12-byte IV] [ciphertext]
  const keyId = bundleBytes[0] ?? 0
  const wrappedKeyLen = view.getUint16(1, false)
  const wrappedKey = bundleBytes.slice(3, 3 + wrappedKeyLen)
  const iv = bundleBytes.slice(3 + wrappedKeyLen, 3 + wrappedKeyLen + IV_LENGTH)
  const ciphertext = bundleBytes.slice(3 + wrappedKeyLen + IV_LENGTH)

  const rsaKey = await importPrivateKey(privateKeyPem)

  const aesKey = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    rsaKey,
    { name: 'RSA-OAEP' },
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext,
  )

  return { plaintext: new Uint8Array(plaintext), keyId }
}

export async function importPublicKey(keyPemOrBase64: string): Promise<CryptoKey> {
  // Strip PEM headers, whitespace, and literal \n from env vars
  const b64 = keyPemOrBase64
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\\n/g, '')   // literal \n from env vars (Next.js, dotenv)
    .replace(/\s/g, '')

  const keyData = base64ToArrayBuffer(b64)

  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey'],
  )
}

export async function importPrivateKey(keyPemOrBase64: string): Promise<CryptoKey> {
  // Strip PEM headers, whitespace, and literal \n from env vars
  const b64 = keyPemOrBase64
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')   // literal \n from env vars
    .replace(/\s/g, '')

  const keyData = base64ToArrayBuffer(b64)

  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['unwrapKey'],
  )
}

export async function generateAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(encoded: string): Uint8Array {
  const padded =
    encoded.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (encoded.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
