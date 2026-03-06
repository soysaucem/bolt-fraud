# Contributing Guide

## Prerequisites

- Node.js >= 18
- npm >= 9 (workspaces support)
- OpenSSL (for key generation)

## Setup

```bash
git clone <repo-url>
cd bolt-fraud
make install
make generate-keys
```

## Monorepo Structure

```
bolt-fraud/
├── packages/
│   ├── client/          # @soysaucem/bolt-fraud-client — browser SDK
│   │   ├── src/
│   │   │   ├── fingerprint/   # Canvas, WebGL, audio, navigator, screen collectors
│   │   │   ├── detection/     # Automation detection, integrity validation
│   │   │   ├── behavior/      # Mouse, keyboard, scroll tracking (ring buffers)
│   │   │   └── transport/     # Binary serializer, AES-GCM + RSA encryption, fetch/XHR hooks
│   │   └── tests/
│   ├── server/          # @soysaucem/bolt-fraud-server — framework-agnostic verification
│   │   ├── src/
│   │   │   ├── crypto/        # Token decryption, key management
│   │   │   ├── scoring/       # Risk engine (fingerprint, automation, behavior scoring)
│   │   │   ├── model/         # Core types (Token, Decision, Fingerprint, Store)
│   │   │   └── store/         # In-memory store (pluggable via FingerprintStore interface)
│   │   └── tests/
│   └── adapter-nestjs/  # @soysaucem/bolt-fraud-adapter-nestjs — NestJS module + guard
│       ├── src/
│       └── tests/
├── shared/
│   └── signals.md       # Signal types, weights, thresholds reference
├── keys/                # Generated RSA keys (gitignored)
├── Makefile
└── PLAN.md              # Architecture and design decisions
```

## Running Tests

```bash
# All packages
make test

# Individual packages
make test-client
make test-server
npm run test -w packages/adapter-nestjs

# Type-check without building
make typecheck
```

All packages use **Vitest**. Client tests run in a `jsdom` environment for browser API access.

## Test Conventions

- Test files live in `packages/<pkg>/tests/`
- Each source module has a corresponding test file
- Mock factories live in `tests/helpers.ts`
- TDD: write tests before implementation (RED → GREEN → REFACTOR)
- Minimum 80% coverage on new code

## Code Style

- **TypeScript strict mode** — all packages
- **ESM** — `"type": "module"` with `.js` import extensions
- **Immutability** — all interfaces use `readonly`, never mutate objects
- **Small files** — 200-400 lines typical, 800 max
- No `console.log` in production code
- Error messages must not leak sensitive data

## Package Boundaries

- `@soysaucem/bolt-fraud-client` depends on **nothing** (browser-only, zero dependencies)
- `@soysaucem/bolt-fraud-server` depends on **nothing** (Node.js crypto only)
- `@soysaucem/bolt-fraud-adapter-nestjs` depends on `@soysaucem/bolt-fraud-server` + NestJS peer deps

Shared types are defined in `@soysaucem/bolt-fraud-server` (`model/types.ts`) and re-exported. Client has its own types for browser-specific interfaces.

## Build

```bash
make build    # Builds all packages with tsup (CJS + ESM dual output)
make clean    # Remove all dist/ directories
```

## Branch Naming

| Type | When | Example |
|------|------|---------|
| `feat/` | New feature | `feat/redis-store` |
| `fix/` | Bug fix | `fix/canvas-hash-collision` |
| `refactor/` | Refactoring | `refactor/scoring-engine` |
| `chore/` | Tooling, deps | `chore/upgrade-vitest` |
| `test/` | Test-only changes | `test/add-e2e-coverage` |

## Commit Messages

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`

## PR Workflow

1. Create a branch from `main`
2. Implement with tests (TDD)
3. Run `make test && make typecheck`
4. Push and create PR
5. All tests must pass before merge
