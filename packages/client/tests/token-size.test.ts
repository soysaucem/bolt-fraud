// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { buildToken } from '../src/transport/index.js'
import { createMockTokenPayload, createMockFingerprint, createMockBehavior } from './helpers.js'
import type { BoltFraudConfig, BfMouseEvent, BfKeyboardEvent, BfScrollEvent } from '../src/types.js'

const RING = 128

function fullBehavior() {
  const mouse: BfMouseEvent[] = Array.from({ length: RING }, (_, i) => ({
    type: 'move', x: 1000 + i, y: 800 + i, t: 100000 + i * 16, buttons: 0,
  }))
  const keyboard: BfKeyboardEvent[] = Array.from({ length: RING }, (_, i) => ({
    type: i % 2 === 0 ? 'keydown' : 'keyup', t: 100000 + i * 40,
  }))
  const scroll: BfScrollEvent[] = Array.from({ length: RING }, (_, i) => ({
    x: 0, y: i * 100, t: 100000 + i * 100,
  }))
  return createMockBehavior({
    mouse, keyboard, scroll,
    totalMouseEvents: 5000, totalKeyboardEvents: 4000, totalScrollEvents: 900,
    snapshotAt: 987654,
  })
}

function emptyBehavior() {
  return createMockBehavior({
    mouse: [], keyboard: [], scroll: [],
    totalMouseEvents: 0, totalKeyboardEvents: 0, totalScrollEvents: 0,
  })
}

function worstCaseFingerprint() {
  const base = createMockFingerprint()
  return createMockFingerprint({
    webgl: {
      ...base.webgl,
      extensions: Array.from({ length: 32 }, (_, i) => `EXT_${String(i).padStart(2, '0')}_`.padEnd(64, 'x')),
    },
    navigator: { ...base.navigator, userAgent: 'M'.repeat(512) },
  })
}

describe('token size', () => {
  let config: BoltFraudConfig

  beforeAll(() => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    config = {
      serverUrl: 'https://example.com',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }
  }, 30_000)

  it('full rings, 32 extensions of 64 chars and a 512-char UA stay under 6000 chars', async () => {
    const payload = createMockTokenPayload({
      fingerprint: worstCaseFingerprint(),
      behavior: fullBehavior(),
    })

    const { token } = await buildToken(payload, config)

    expect(token.length).toBeLessThan(6000)
  })

  it('behavior: false with 32 realistic extensions and a 180-char UA stays under 4096 chars', async () => {
    const base = createMockFingerprint()
    const payload = createMockTokenPayload({
      fingerprint: createMockFingerprint({
        webgl: {
          ...base.webgl,
          extensions: Array.from({ length: 32 }, (_, i) => `WEBGL_ext_name_${i}`.padEnd(28, 'x')),
        },
        navigator: { ...base.navigator, userAgent: 'M'.repeat(180) },
      }),
      behavior: emptyBehavior(),
    })

    const { token } = await buildToken(payload, config)

    expect(token.length).toBeLessThan(4096)
  })

  it('behavior: false removes the whole behavior block from the worst-case token', async () => {
    const withBehavior = await buildToken(
      createMockTokenPayload({ fingerprint: worstCaseFingerprint(), behavior: fullBehavior() }),
      config,
    )
    const without = await buildToken(
      createMockTokenPayload({ fingerprint: worstCaseFingerprint(), behavior: emptyBehavior() }),
      config,
    )

    expect(without.token.length).toBeLessThan(withBehavior.token.length - 1000)
  })

  it('a realistic token with full rings is under 4096 chars', async () => {
    const payload = createMockTokenPayload({ behavior: fullBehavior() })

    const { token } = await buildToken(payload, config)

    expect(token.length).toBeLessThan(4096)
  })
})
