import { generateKeyPairSync as _generateKeyPairSync, generateKeyPair as _generateKeyPair, createPrivateKey, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface KeyPair {
  readonly publicKey: string
  readonly privateKey: string
}

export function generateKeyPairSync(): KeyPair {
  const { publicKey, privateKey } = _generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/**
 * Async variant of generateKeyPairSync. Avoids blocking the event loop
 * during key generation (RSA-2048 can take ~100ms synchronously).
 */
export function generateKeyPairAsync(): Promise<KeyPair> {
  return new Promise((resolve, reject) => {
    _generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
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

export class KeyManager {
  private _publicKey: string | null = null
  private _privateKey: string | null = null
  private _privateKeyObject: KeyObject | null = null

  loadFromFiles(publicKeyPath: string, privateKeyPath: string): void {
    this._publicKey = loadKeyFromFile(publicKeyPath)
    this._privateKey = loadKeyFromFile(privateKeyPath)
    this._privateKeyObject = createPrivateKey(this._privateKey)
  }

  loadFromStrings(publicKey: string, privateKey: string): void {
    this._publicKey = publicKey
    this._privateKey = privateKey
    this._privateKeyObject = createPrivateKey(privateKey)
  }

  get publicKey(): string {
    if (!this._publicKey) throw new Error('Public key not loaded')
    return this._publicKey
  }

  get privateKey(): string {
    if (!this._privateKey) throw new Error('Private key not loaded')
    return this._privateKey
  }

  get privateKeyObject(): KeyObject {
    if (!this._privateKeyObject) throw new Error('Private key not loaded')
    return this._privateKeyObject
  }
}
