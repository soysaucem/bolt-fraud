import { generateKeyPairSync as _generateKeyPairSync, generateKeyPair as _generateKeyPair, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface KeyPair {
  readonly publicKey: string
  readonly privateKey: string
}

export function generateKeyPairSync(modulusLength: number = 2048): KeyPair {
  const { publicKey, privateKey } = _generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/**
 * Async variant of generateKeyPairSync. Avoids blocking the event loop
 * during key generation (RSA-2048 can take ~100ms synchronously).
 */
export function generateKeyPairAsync(modulusLength: number = 2048): Promise<KeyPair> {
  return new Promise((resolve, reject) => {
    _generateKeyPair(
      'rsa',
      {
        modulusLength,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err, publicKey, privateKey) => {
        if (err) {
          reject(err)
        } else {
          // Encoding options above guarantee string output
          resolve({
            publicKey: publicKey as unknown as string,
            privateKey: privateKey as unknown as string,
          })
        }
      },
    )
  })
}

export function loadKeyFromFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

export function loadKeyFromEnv(envVar: string): string {
  const value = process.env[envVar]
  if (!value) {
    throw new Error(`Environment variable ${envVar} is not set`)
  }
  return value
}

function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

export class KeyManager {
  private readonly _keys = new Map<number, { publicKey: string; privateKey: string; privateKeyObject: KeyObject }>()
  private _defaultKeyId = 0

  addKeyPair(keyId: number, publicKey: string, privateKey: string): void {
    if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
      throw new Error(`KeyManager: keyId must be an integer from 0 to 255 (got ${keyId})`)
    }
    // Env vars and secret stores often carry PEMs with literal "\n" sequences
    const publicPem = normalizePem(publicKey)
    const privatePem = normalizePem(privateKey)
    const privateKeyObject = createPrivateKey(privatePem)
    const derivedPublic = createPublicKey(privateKeyObject).export({ type: 'spki', format: 'der' })
    const givenPublic = createPublicKey(publicPem).export({ type: 'spki', format: 'der' })
    if (!derivedPublic.equals(givenPublic)) {
      throw new Error(`KeyManager: public key does not match private key for keyId ${keyId}`)
    }
    this._keys.set(keyId, { publicKey: publicPem, privateKey: privatePem, privateKeyObject })
  }

  setDefaultKeyId(keyId: number): void {
    if (!this._keys.has(keyId)) throw new Error(`Key ID ${keyId} not loaded`)
    this._defaultKeyId = keyId
  }

  getPrivateKeyObject(keyId?: number): KeyObject {
    const id = keyId ?? this._defaultKeyId
    const entry = this._keys.get(id)
    if (!entry) throw new Error(`Key ID ${id} not loaded`)
    return entry.privateKeyObject
  }

  getPublicKey(keyId?: number): string {
    const id = keyId ?? this._defaultKeyId
    const entry = this._keys.get(id)
    if (!entry) throw new Error(`Key ID ${id} not loaded`)
    return entry.publicKey
  }

  loadFromFiles(publicKeyPath: string, privateKeyPath: string): void {
    const publicKey = loadKeyFromFile(publicKeyPath)
    const privateKey = loadKeyFromFile(privateKeyPath)
    this.addKeyPair(0, publicKey, privateKey)
  }

  loadFromStrings(publicKey: string, privateKey: string): void {
    this.addKeyPair(0, publicKey, privateKey)
  }

  get publicKey(): string {
    return this.getPublicKey()
  }

  get privateKey(): string {
    const id = this._defaultKeyId
    const entry = this._keys.get(id)
    if (!entry) throw new Error(`Key ID ${id} not loaded`)
    return entry.privateKey
  }

  get privateKeyObject(): KeyObject {
    return this.getPrivateKeyObject()
  }
}
