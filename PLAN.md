# bolt-fraud — Anti-Bot Detection System

## Context

Inspired by reverse engineering Shopee's SFU (Secure Fetch Utils) SDK. Shopee uses a full-stack anti-bot system:
- **Client SDK** (browser JS) — collects device fingerprints (canvas, WebGL, audio, navigator), detects automation tools (Puppeteer/Playwright/Selenium/PhantomJS), validates browser integrity (prototype chains, native function checks), collects behavioral signals (mouse/keyboard/scroll telemetry), serializes + compresses + encrypts into tokens, hooks fetch/XHR to auto-inject tokens into protected API requests
- **Server** — decrypts tokens, validates fingerprint consistency, scores risk, returns allow/block/challenge decision

## Tech Stack

- **Client SDK**: TypeScript, runs in browser (`@bolt-fraud/client`)
- **Server Core**: TypeScript, Node.js package (`@bolt-fraud/server`) — framework-agnostic
- **NestJS Adapter**: TypeScript, NestJS module (`@bolt-fraud/adapter-nestjs`)
- **Storage**: Redis (fingerprint history, pluggable via `FingerprintStore` interface)

## Architecture

```
Browser → [Client SDK (TS)] → HTTP Request with token header
                                        ↓
Backend (NestJS/Express/etc) → [BoltFraudGuard] → [@bolt-fraud/server] → Decision
                                                         ↓
                                                   [FingerprintStore]
```

## Project Structure

```
bolt-fraud/
├── packages/
│   ├── client/                     # TypeScript client SDK (browser)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   ├── src/
│   │   │   ├── index.ts            # Public API: init(), getToken(), hookFetch()
│   │   │   ├── types.ts            # All client-side types
│   │   │   ├── fingerprint/
│   │   │   │   ├── canvas.ts       # Canvas 2D fingerprint (SHA-256 hash)
│   │   │   │   ├── webgl.ts        # WebGL fingerprint (shader + GPU metadata)
│   │   │   │   ├── audio.ts        # AudioContext fingerprint (oscillator hash)
│   │   │   │   ├── navigator.ts    # navigator props
│   │   │   │   ├── screen.ts       # Screen dimensions, DPR
│   │   │   │   └── index.ts        # Orchestrate all collectors
│   │   │   ├── detection/
│   │   │   │   ├── automation.ts   # Detect Puppeteer/Playwright/Selenium/PhantomJS
│   │   │   │   ├── integrity.ts    # Prototype chains, native function checks
│   │   │   │   └── index.ts        # Combined detection result
│   │   │   ├── behavior/
│   │   │   │   ├── mouse.ts        # Mouse telemetry (ring buffer)
│   │   │   │   ├── keyboard.ts     # Keystroke timing (ring buffer)
│   │   │   │   ├── scroll.ts       # Scroll tracking (ring buffer)
│   │   │   │   └── index.ts        # Behavior orchestrator
│   │   │   └── transport/
│   │   │       ├── serializer.ts   # Binary serialization (DataView, big-endian)
│   │   │       ├── crypto.ts       # AES-GCM + RSA-OAEP envelope encryption
│   │   │       ├── hook.ts         # fetch/XHR interceptor
│   │   │       └── index.ts
│   │   └── tests/
│   ├── server/                     # TypeScript server package (framework-agnostic)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   ├── src/
│   │   │   ├── index.ts            # Public API: createBoltFraud(config)
│   │   │   ├── model/
│   │   │   │   └── types.ts        # Token, Decision, Fingerprint, Store interface
│   │   │   ├── crypto/
│   │   │   │   ├── decrypt.ts      # AES-GCM decryption + RSA key unwrap
│   │   │   │   └── keys.ts         # Key management (generate, load, rotate)
│   │   │   ├── scoring/
│   │   │   │   ├── engine.ts       # Risk scoring engine (weighted signals)
│   │   │   │   ├── fingerprint.ts  # Fingerprint consistency checks
│   │   │   │   ├── automation.ts   # Automation detection scoring
│   │   │   │   └── behavior.ts     # Behavioral analysis (entropy, timing)
│   │   │   └── store/
│   │   │       └── memory.ts       # In-memory store (swap for Redis later)
│   │   └── tests/
│   └── adapter-nestjs/             # NestJS integration module
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       ├── src/
│       │   ├── index.ts            # Re-exports module, guard, decorators
│       │   ├── bolt-fraud.module.ts # NestJS DynamicModule (forRoot/forRootAsync)
│       │   ├── bolt-fraud.guard.ts  # CanActivate guard (verifies token)
│       │   └── bolt-fraud.decorator.ts # @Protected(), @BoltFraudDecision()
│       └── tests/
├── shared/
│   └── signals.md              # Signal types, weights, thresholds
├── deploy/
│   └── docker-compose.yml      # Redis for production store
├── package.json                # Workspace root
├── Makefile
└── PLAN.md
```

## Key Design Decisions (Learned from Shopee's SFU Analysis)

### What Shopee Does Well (Replicate)
1. **Multi-signal fingerprinting** — canvas, WebGL, audio are hardware-dependent and extremely hard to fake consistently. Collect all three.
2. **Automation detection via stack traces** — checking error stack traces for Puppeteer/Playwright/Selenium markers is clever and hard to bypass.
3. **Native function validation** — `Function.prototype.toString()` integrity checks catch overridden DOM APIs.
4. **Prototype chain validation** — Window → EventTarget, HTMLDocument → Document → Node → EventTarget chain integrity detects patched environments.
5. **fetch/XHR hooking** — transparent token injection into outgoing requests, no app code changes needed.
6. **Behavioral telemetry** — mouse/keyboard/scroll ring buffers serialized to compact binary, catches headless browsers that don't generate real human input.
7. **Field permutation** — shuffling serialized field order makes reverse engineering harder.

### What Shopee Does Poorly (Improve)
1. **AES-CBC with key=IV** — Shopee uses the AES key as the IV, which is cryptographically weak. Use **AES-256-GCM** with random 12-byte nonce instead (authenticated encryption).
2. **Custom modified RC4** — RC4 is broken. Skip it entirely, AES-GCM is sufficient.
3. **Bytecode VM obfuscation** — extremely complex, maintenance nightmare, and only delays (doesn't prevent) reverse engineering. Use standard JS minification + code splitting instead. Focus security on server-side validation rather than client obscurity.
4. **Two full SDK copies** — Shopee ships two complete copies with different obfuscation seeds. Wasteful (doubles bundle size). Use a single copy with integrity checks.
5. **CRC32 for canvas hash** — CRC32 is not collision-resistant. Use SHA-256 via SubtleCrypto for fingerprint hashing.

### Scoring Engine Design

| Signal | Weight | Instant Block? |
|--------|--------|----------------|
| Automation tool detected (Puppeteer/Playwright/Selenium) | - | Yes |
| `window.webdriver` present | - | Yes |
| Prototype chain tampered | Critical | Yes |
| Native function toString() overridden | Critical | Yes |
| Canvas fingerprint inconsistent with claimed UA | High | No |
| WebGL renderer doesn't match claimed GPU | High | No |
| Audio fingerprint is zero/constant (virtualized) | High | No |
| No mouse/keyboard events in 10s+ | Medium | No |
| Mouse movement entropy too low (linear paths) | Medium | No |
| Keystroke timing too uniform | Medium | No |
| navigator.hardwareConcurrency = 0 or missing | Low | No |
| Fingerprint seen from 100+ IPs | Low | No |

**Decision thresholds:**
- Score < 30: Allow
- Score 30-70: Challenge (CAPTCHA)
- Score > 70 or instant-block signal: Block

## Implementation Phases

1. **Scaffold** — project structure, package.json, go.mod, tsconfig, Makefile, Dockerfile
2. **Client fingerprint collectors** — canvas, WebGL, audio, navigator, screen (with tests)
3. **Client detection** — automation detection, integrity validation (with tests)
4. **Client transport** — binary serialization, AES-GCM + RSA encryption, fetch/XHR hooking (with tests)
5. **Server crypto** — decrypt tokens, key management
6. **Server scoring** — risk engine with weighted signals
7. **Server API** — Chi router, /verify endpoint, /health
8. **Integration** — end-to-end flow, docker-compose, E2E tests

## Reference Material

The Shopee SFU SDK analysis files are in `/Users/minhtriet/Code/caocao-cli/`:
- `sfu-stable.js` — SFU wrapper (prettified, 2092 lines) — fetch/XHR hooking, header injection
- `sfu-latest.js` — Alternate version
- `sws-chunk-6476.js` — DFP SDK (prettified, 39734 lines) — fingerprinting, encryption, bot detection
- `webpack-runtime.js` — Main webpack runtime (chunk URL mapping)

Key patterns to study:
- Canvas fingerprint: `sws-chunk-6476.js` line ~8546 (200x400 canvas, specific fonts/shapes)
- WebGL fingerprint: line ~8340 (custom shader vertices, 25+ GL params)
- Audio fingerprint: line ~15506 (OfflineAudioContext oscillator)
- Automation detection: line ~4503-4742 (stack trace inspection, MutationObserver)
- Binary serialization: module 5907 (uint8/16/32/64 + strings)
- Encryption pipeline: RC4 (line ~12779) → AES-CBC (line ~10126) → RSA (line ~10284)
