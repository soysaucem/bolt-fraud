import type { AudioFingerprint } from '../types.js'
import { arrayBufferToHex } from './utils.js'

/**
 * Audio fingerprint via OfflineAudioContext oscillator + compressor.
 * Audio hardware introduces deterministic device-unique rounding.
 * Reference: sws-chunk-6476.js line ~15506
 */
export async function getAudioFingerprint(): Promise<AudioFingerprint> {
  if (typeof OfflineAudioContext === 'undefined') return { hash: '' }

  try {
    const sampleRate = 44100
    const duration = 1 // seconds → 44100 samples total
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate)

    // Oscillator: triangle wave at 10 kHz
    const oscillator = ctx.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = 10000

    // DynamicsCompressor with specific coefficients
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -50
    compressor.knee.value = 40
    compressor.ratio.value = 12
    compressor.attack.value = 0
    compressor.release.value = 0.25

    // Connect: oscillator → compressor → destination
    oscillator.connect(compressor)
    compressor.connect(ctx.destination)

    oscillator.start(0)
    oscillator.stop(duration)

    // startRendering() can hang forever during early page load (before user gesture,
    // during React hydration, in background tabs). Race against a timeout to prevent
    // blocking the entire getToken() call chain.
    const audioBuffer = await Promise.race([
      ctx.startRendering(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('audio_fingerprint_timeout')), 3000),
      ),
    ])
    const channelData = audioBuffer.getChannelData(0)

    // Take a stable slice of samples (4500 to 5000)
    const slice = channelData.slice(4500, 5000)
    const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength)

    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    return { hash: arrayBufferToHex(hashBuffer) }
  } catch {
    // AudioContext may be blocked or suspended in some environments
    return { hash: '' }
  }
}
