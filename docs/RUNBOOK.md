# Operations Runbook

## Key Generation

### Generate RSA Key Pair

```bash
make generate-keys
```

This creates `keys/private.pem` (2048-bit RSA) and `keys/public.pem`. The `keys/` directory is gitignored.

### Manual Key Generation

```bash
# Generate 2048-bit RSA private key
openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048

# Extract public key
openssl rsa -pubout -in keys/private.pem -out keys/public.pem
```

### Programmatic Key Generation

```typescript
import { generateKeyPair, generateKeyPairAsync } from '@bolt-fraud/server'

// Synchronous
const keys = generateKeyPair()
// keys.publicKey, keys.privateKey (PEM strings)

// Async (non-blocking)
const keys = await generateKeyPairAsync()
```

## Key Rotation

Key rotation allows seamless updates without downtime or client synchronization issues.

```mermaid
sequenceDiagram
  participant Admin
  participant Server
  participant Client

  Admin->>Server: Deploy additionalKeys: [{ keyId: 1, ... }]
  Note over Server: Both keyId=0 and keyId=1 accepted
  Admin->>Client: Push new publicKey with keyId: 1
  Note over Client: New tokens embed keyId=1

  par Old tokens
    Client->>Server: Token with keyId=0
    Server->>Server: Decrypt using keyId=0
  and New tokens
    Client->>Server: Token with keyId=1
    Server->>Server: Decrypt using keyId=1
  end

  Admin->>Server: Remove keyId=0 from additionalKeys
  Note over Server: Only keyId=1 remains
```

**Step-by-step procedure**:

1. Generate a new RSA key pair:
   ```bash
   openssl genpkey -algorithm RSA -out keys/private-v2.pem -pkeyopt rsa_keygen_bits:2048
   openssl rsa -pubout -in keys/private-v2.pem -out keys/public-v2.pem
   ```

2. Deploy server with both keys in `additionalKeys`:
   ```typescript
   const bf = createBoltFraud({
     privateKeyPem: oldPrivateKey,  // keyId=0 (default)
     publicKeyPem: oldPublicKey,
     additionalKeys: [
       { keyId: 1, publicKeyPem: newPublicKey, privateKeyPem: newPrivateKey }
     ]
   })
   ```

3. Update client SDK to use the new key:
   ```typescript
   await init({
     serverUrl: 'https://api.example.com',
     publicKey: newPublicKey,
     keyId: 1  // Embed in token header
   })
   ```

4. Monitor logs for successful decryption with both keys.

5. After grace period (24-48 hours), remove the old key:
   ```typescript
   const bf = createBoltFraud({
     privateKeyPem: newPrivateKey,
     publicKeyPem: newPublicKey,
     // additionalKeys removed — only new key remains
   })
   ```

> Note: Tokens encrypted with the old key are no longer decryptable. Ensure client rollout is complete before removing the old key.

## Configuration

### Server Configuration

```typescript
interface BoltFraudServerConfig {
  privateKeyPem?: string                    // Private key for keyId=0 (optional in dev)
  publicKeyPem?: string                     // Public key for keyId=0
  blockThreshold?: number                   // Default: 70
  challengeThreshold?: number               // Default: 30
  store?: FingerprintStore                  // Optional IP reputation + nonce store
  additionalKeys?: Array<{                  // For key rotation
    keyId: number
    publicKeyPem: string
    privateKeyPem: string
  }>
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RSA_PRIVATE_KEY` | Yes | - | RSA private key PEM (or read from file) |
| `RSA_PUBLIC_KEY` | Yes | - | RSA public key PEM (or read from file) |
| `BLOCK_THRESHOLD` | No | `70` | Score ≥ this value triggers block |
| `CHALLENGE_THRESHOLD` | No | `30` | Score ≥ this value triggers challenge |
| `REDIS_URL` | No | - | Redis URL for fingerprint store (optional) |

### Client Configuration

```typescript
interface BoltFraudConfig {
  serverUrl: string                         // Required: API base URL
  publicKey?: string                        // RSA public key PEM (dev: optional)
  keyId?: number                            // Default: 0 (which key to use)
  hookFetch?: boolean                       // Default: true
  hookXHR?: boolean                         // Default: false
  tokenHeader?: string                      // Default: 'x-client-data'
  collectInterval?: number                  // Fingerprint collection interval (ms)
  ringBufferSize?: number                   // Behavior history size
  protectedPatterns?: RegExp[]              // URL patterns requiring tokens
  onTokenReady?: (token: EncryptedToken) => void
  onError?: (error: Error) => void
}
```

### Scoring Thresholds

Tune thresholds based on your use case:

- **High security** (payments): `blockThreshold: 50, challengeThreshold: 20`
- **Default** (general API): `blockThreshold: 70, challengeThreshold: 30`
- **Lenient** (public content): `blockThreshold: 90, challengeThreshold: 50`

## Monitoring

### Key Metrics to Track

| Metric | What to Watch |
|--------|---------------|
| Block rate | Sudden spikes may indicate attack or false positives |
| Challenge rate | High rate may frustrate legitimate users |
| Score distribution | Bimodal (bots vs humans) is healthy; unimodal is concerning |
| Token decryption failures | Spikes indicate key mismatch or replay attacks |
| `instant_block` reasons | Which bot frameworks are targeting you |

### Decision Reasons

Monitor the `reasons` array in decisions. Common patterns:

- `token_decryption_failed` — Invalid/tampered token, key mismatch
- `token_timestamp_future` — Clock skew or replay attack
- `token_too_old` — Token older than 30s (replay or slow client)
- `token_nonce_replayed` — Same nonce seen within 60s window (replay attack)
- `token_expired` — Token older than 5 minutes (instant block)
- `instant_block:webdriver_present` — Selenium WebDriver detected
- `instant_block:puppeteer_runtime` — Puppeteer detected
- `no_interaction_events` — No mouse/keyboard activity (headless browser)
- `mouse_entropy_too_low` — Linear mouse paths (scripted movement)
- `canvas_fingerprint_empty_or_zero` — Headless/sandboxed environment

## Custom Scorers

Extend the risk engine with domain-specific scoring logic:

```typescript
import { RiskEngine, type Scorer, type ScorerResult } from '@bolt-fraud/server'

class GeoIPScorer implements Scorer {
  readonly name = 'geo'
  score(token, context) {
    if (!context.clientIP) return { score: 0, reasons: [] }

    const country = geoipLookup(context.clientIP)
    if (!allowedCountries.has(country)) {
      return { score: 20, reasons: ['geo_blocked_country'] }
    }
    return { score: 0, reasons: [] }
  }
}

const engine = new RiskEngine({
  scorers: [
    // Built-in scorers...
    new GeoIPScorer()
  ]
})
```

**Best practices**:
- Keep scorer logic simple and fast (avoid blocking operations)
- Return descriptive reason strings for monitoring
- Use `instantBlock: true` sparingly (reserved for high-confidence signals)
- Consider async operations (scorer can return Promise<ScorerResult>)

## Troubleshooting

### All Requests Blocked

1. **Check key configuration**: Ensure private key matches the public key used by clients
2. **Check token header**: Verify client sends `x-client-data` header (default: `x-client-data`)
3. **Check thresholds**: May be too aggressive; try raising `blockThreshold` to 80
4. **Check clock sync**: Token age check fails if server/client clocks differ by >30s

### High False Positive Rate

1. **Canvas/WebGL fingerprints empty**: Privacy extensions (Brave shields, Firefox ETP) can blank these. Lower the weight or exclude for known browser populations.
2. **No interaction events**: Mobile users or quick page loads may not generate enough events. Increase the collection window.
3. **Keystroke uniformity**: Power users with mechanical keyboards may trigger this. Raise the uniformity threshold.

### Token Decryption Failures

1. **Key mismatch**: Client public key doesn't match server private key. Check that `publicKey` in client config matches the PEM deployed on server.
2. **keyId mismatch**: Client sends `keyId` that server doesn't have in `additionalKeys`. Verify key rotation is complete.
3. **Token corruption**: Proxy or CDN modifying the header value. Check raw HTTP headers in logs.
4. **Base64url encoding**: Token must be valid base64url (no padding, using `-` and `_` chars). Verify no URL encoding applied twice.
5. **Payload size**: Token exceeds 64 KB compressed limit. Check `MAX_TOKEN_SIZE` constant in `decrypt.ts`.

### Memory Store Growing Unbounded

The in-memory `MemoryStore` does not evict entries. For production, use the built-in `RedisStore`:

```typescript
import { createBoltFraud, RedisStore } from '@bolt-fraud/server'
import fs from 'node:fs'

// Option A: Redis URL (RedisStore owns connection)
const store = new RedisStore('redis://localhost:6379', {
  fingerprintTtlMs: 86_400_000,  // 24 hours
  ipSetCap: 10_000,              // Max IPs per fingerprint
  keyPrefix: 'bf:'               // Redis key namespace
})

// Option B: Existing ioredis instance (you own connection)
import Redis from 'ioredis'
const redis = new Redis(process.env.REDIS_URL)
const store = new RedisStore(redis)

const bf = createBoltFraud({
  privateKeyPem: fs.readFileSync('keys/private.pem', 'utf-8'),
  publicKeyPem: fs.readFileSync('keys/public.pem', 'utf-8'),
  store,
})

// Cleanup on shutdown (Option A only)
process.on('SIGTERM', async () => {
  await store.close()
})
```

## Redis Store Configuration

### Connection Options

```typescript
import { RedisStore } from '@bolt-fraud/server'

// Option A: Connection URL (RedisStore creates and owns the connection)
const store = new RedisStore('redis://localhost:6379')
// or with auth: 'redis://:password@host:port'

// Option B: Existing client (you maintain the connection lifecycle)
import Redis from 'ioredis'
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
})
const store = new RedisStore(redis)
```

### Configuration

```typescript
interface RedisStoreOptions {
  // TTL for fingerprint Sets (sliding window). Default: 86_400_000ms (24h)
  fingerprintTtlMs?: number

  // Max distinct IPs tracked per fingerprint. Default: 10_000
  // When reached, IPs are not added but TTL still refreshes
  ipSetCap?: number

  // Redis key namespace prefix. Default: 'bf:'
  keyPrefix?: string
}

new RedisStore('redis://localhost:6379', {
  fingerprintTtlMs: 3_600_000,    // 1 hour (shorter for high-volume)
  ipSetCap: 5_000,               // Conservative cap
  keyPrefix: 'fraud:',           // Custom prefix
})
```

### Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Full connection URL |
| `REDIS_HOST` | `localhost` | Host (default: localhost) |
| `REDIS_PORT` | `6379` | Port (default: 6379) |
| `REDIS_PASSWORD` | `secret` | Auth password |
| `REDIS_DB` | `0` | Database number |

### Redis Health Checks

Monitor Redis connectivity and performance:

```typescript
import { RedisStore } from '@bolt-fraud/server'

const store = new RedisStore(process.env.REDIS_URL)

app.get('/health/redis', async (req, res) => {
  try {
    // Quick ping to verify connection
    const testKey = 'bf:health:check'
    const testValue = Date.now().toString()
    await store.saveNonce(testKey, 1000) // 1s TTL
    const exists = await store.hasSeenNonce(testKey)

    if (!exists) {
      return res.status(503).json({ redis: 'down', error: 'health_check_failed' })
    }

    res.json({ redis: 'up' })
  } catch (error) {
    res.status(503).json({ redis: 'error', error: error.message })
  }
})
```

### Redis Key Layout

RedisStore uses namespaced keys with configurable prefix (default: `bf:`):

```
bf:fp:<fingerprintHash>  — Redis Set of IP addresses with sliding TTL
bf:nonce:<nonce>         — Redis String "1" with EX (expiry) for replay protection
```

Example with custom prefix:

```
fraud:fp:abc123def456    — Fingerprint IP set
fraud:nonce:xyz789       — Nonce entry
```

## Health Checks

The server package does not expose HTTP endpoints directly. Implement health checks in your application layer:

```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', boltFraud: 'active' })
})
```

Verify the scoring engine is functional by running a test token through `verify()` periodically. If using Redis, also check Redis connectivity (see Redis Health Checks section above).

## CI/CD Pipeline

### Continuous Integration

CI runs automatically on every push to `main` and all pull requests.

**Workflow**: `.github/workflows/ci.yml`

**Runs**:
1. Typecheck client, server, NestJS adapter, Express adapter (parallel)
2. Build server (required by adapters)
3. Run test suite (client, server, NestJS adapter, Express adapter)
4. Full build (main branch only)

**Test matrices**: Node.js 18 and 20

**Example**:
```bash
# View CI status
gh run list --repo bolt-fraud

# View specific run
gh run view <run-id>

# Re-run a failed workflow
gh run rerun <run-id>
```

### Release Process

Releases are triggered manually via the release workflow.

**Workflow**: `.github/workflows/release.yml`

**Steps**:
1. Dispatch the workflow with a version bump type
2. Workflow runs full test suite and builds all packages
3. Bumps version in all `package.json` files
4. Verifies packages are publishable with `npm pack --dry-run`
5. Commits version bump and tags with `v<version>`
6. Pushes commit and tags to origin

**Trigger a release**:

```bash
# Patch release (v0.1.0 -> v0.1.1)
gh workflow run release.yml --repo bolt-fraud -f bump=patch

# Minor release (v0.1.0 -> v0.2.0)
gh workflow run release.yml --repo bolt-fraud -f bump=minor

# Major release (v0.1.0 -> v1.0.0)
gh workflow run release.yml --repo bolt-fraud -f bump=major
```

**Monitor release**:
```bash
# View workflow run
gh run list --workflow release.yml --repo bolt-fraud

# View specific run
gh run view <run-id> --repo bolt-fraud

# Check tags created
git tag -l | tail -5
```

**Post-release**:
After the release workflow completes:
1. Verify tags on GitHub: `https://github.com/<owner>/bolt-fraud/releases`
2. Manually publish packages to npm (npm publish is not automated)
3. Update CHANGELOG.md with release notes
4. Announce release to relevant channels

### Versioning Strategy

- All packages share the same version number (monorepo)
- Use semantic versioning: MAJOR.MINOR.PATCH
- Tag format: `v<version>` (e.g., `v0.2.0`)
- Each release bumps all packages atomically

### Debugging CI/CD Failures

**Typecheck fails**:
```bash
# Run locally to reproduce
npx tsc --noEmit -p packages/client/tsconfig.json
npx tsc --noEmit -p packages/server/tsconfig.json
npx tsc --noEmit -p packages/adapter-nestjs/tsconfig.json
npx tsc --noEmit -p packages/adapter-express/tsconfig.json
```

**Tests fail**:
```bash
# Run locally
npm test  # All packages
npm test -w packages/client
npm test -w packages/server
npm test -w packages/adapter-nestjs
npm test -w packages/adapter-express
```

**Build fails**:
```bash
# Full build
npm run build

# Per-package
npx tsup -C
cd packages/client && npm run build
```

**Release versioning issues**:
```bash
# Check current versions
npm version --workspaces --include-workspace-root

# Revert accidental version bump (before push)
git reset --soft HEAD~1  # Undo commit
git restore package*.json
```
