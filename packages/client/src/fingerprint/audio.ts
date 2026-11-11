import { arrayBufferToHex } from './utils.js'

export const AUDIO_RENDER_FRAMES = 5120
export const AUDIO_SAMPLE_RATE = 44100
export const AUDIO_HASH_SLICE = [4500, 5000] as const
export const AUDIO_RENDER_TIMEOUT_MS = 3000
export const AUDIO_CACHE_KEY = 'bf_audio_v1'
export const AUDIO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const AUDIO_RETRY_AFTER_MS = 60 * 60 * 1000

interface AudioCacheEntry {
  v: 1
  ua: string
  hash: string
  at: number
  failedAt?: number
}

/**
 * Renders a short oscillator + compressor graph offline and hashes a stable slice.
 * Returns '' when the API is missing, on timeout, or on any error. Never throws.
 */
export async function renderAudioHash(): Promise<string> {
  if (typeof OfflineAudioContext === 'undefined') return ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ctx = new OfflineAudioContext(1, AUDIO_RENDER_FRAMES, AUDIO_SAMPLE_RATE)

    const oscillator = ctx.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = 10000

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -50
    compressor.knee.value = 40
    compressor.ratio.value = 12
    compressor.attack.value = 0
    compressor.release.value = 0.25

    oscillator.connect(compressor)
    compressor.connect(ctx.destination)
    oscillator.start(0)

    const audioBuffer = await Promise.race([
      ctx.startRendering(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('audio_render_timeout')), AUDIO_RENDER_TIMEOUT_MS)
      }),
    ])
    const slice = audioBuffer.getChannelData(0).slice(AUDIO_HASH_SLICE[0], AUDIO_HASH_SLICE[1])
    const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength)
    return arrayBufferToHex(await crypto.subtle.digest('SHA-256', bytes))
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

function readEntry(): AudioCacheEntry | null {
  try {
    const raw = localStorage.getItem(AUDIO_CACHE_KEY)
    if (raw === null) return null
    const e = JSON.parse(raw) as Partial<AudioCacheEntry> | null
    if (e === null || typeof e !== 'object' || e.v !== 1) return null
    if (typeof e.ua !== 'string' || typeof e.hash !== 'string' || typeof e.at !== 'number') return null
    return e as AudioCacheEntry
  } catch {
    return null
  }
}

/** Synchronous cache read: the hash only when it belongs to this user agent and is within the TTL. */
export function cachedAudioHash(now: number = Date.now()): string {
  try {
    const e = readEntry()
    if (e === null || e.hash === '') return ''
    if (e.ua !== navigator.userAgent || now - e.at >= AUDIO_CACHE_TTL_MS) return ''
    return e.hash
  } catch {
    return ''
  }
}

function shouldSkip(now: number): boolean {
  if (cachedAudioHash(now) !== '') return true
  const e = readEntry()
  return e !== null && e.ua === navigator.userAgent &&
    typeof e.failedAt === 'number' && now - e.failedAt < AUDIO_RETRY_AFTER_MS
}

function store(hash: string): void {
  try {
    const now = Date.now()
    const entry: AudioCacheEntry = hash !== ''
      ? { v: 1, ua: navigator.userAgent, hash, at: now }
      : { v: 1, ua: navigator.userAgent, hash: '', at: 0, failedAt: now }
    localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // storage unavailable or full
  }
}

let scheduled = false

/**
 * Renders the audio hash once per page in the background and caches it per browser profile.
 * Waits for load, a visible tab and an idle slice; never blocks token collection.
 */
export function scheduleAudioProbe(): void {
  if (scheduled) return
  scheduled = true
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (shouldSkip(Date.now())) return

    const run = (): void => {
      const render = (): void => {
        void renderAudioHash().then(store, () => {})
      }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(render, { timeout: 2000 })
      else setTimeout(render, 0)
    }

    const whenVisible = (): void => {
      if (document.visibilityState === 'visible') {
        run()
        return
      }
      const onChange = (): void => {
        if (document.visibilityState !== 'visible') return
        document.removeEventListener('visibilitychange', onChange)
        run()
      }
      document.addEventListener('visibilitychange', onChange)
    }

    if (document.readyState === 'complete') whenVisible()
    else window.addEventListener('load', whenVisible, { once: true })
  } catch {
    // never throws
  }
}
