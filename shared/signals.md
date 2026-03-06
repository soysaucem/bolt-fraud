# Signal Types & Weights

## Instant-Block Signals

Trigger immediate block (score=100) regardless of other scores.

| Signal | Detection Method |
|--------|------------------|
| `webdriver_present` | `navigator.webdriver === true` |
| `puppeteer_runtime` | Global `window.__puppeteer_evaluation_script__` |
| `playwright_runtime` | Global `window.__playwright` |
| `selenium_runtime` | Multiple Selenium-specific globals detected |
| `phantom_runtime` | Global `window._phantom` |
| `native_function_toString_overridden` | `Function.prototype.toString` patched |
| `window_event_target_chain_broken` | DOM prototype chain validation failed |
| `document_node_chain_broken` | Document prototype chain validation failed |
| `token_nonce_replayed` | Nonce seen within 60-second TTL |
| `token_expired` | Token age > 5 minutes |
| `token_timestamp_future` | Token timestamp > now + 5 seconds |

## Scored Signals

Contribute to risk score but allow other factors to influence decision.

| Signal | Weight | Detection Method |
|--------|--------|------------------|
| Canvas fingerprint empty/zero | +25 | Hash is empty string or '0' |
| WebGL fingerprint empty | +25 | Hash is empty string or '0' |
| Audio fingerprint empty/zero | +20 | Hash is empty string or '0' |
| Stack trace headless keywords | +15 | Stack contains "headless", "puppeteer", "playwright", "webdriver", "phantomjs" |
| User-Agent headless | +20 | UA contains "HeadlessChrome", "PhantomJS" |
| Languages empty | +10 | `navigator.languages.length === 0` |
| Connection RTT zero | +10 | `navigator.connection.rtt === 0` |
| No interaction events | +15 | No mouse or keyboard events collected |
| Mouse entropy too low | +15 | Entropy < 0.1 (linear movement patterns) |
| Keystroke uniformity too high | +10 | Uniformity > 0.95 (fixed timing) |
| Token too old | +10 | Token age 30-300 seconds (replay or network latency) |
| Hardware concurrency zero | +5 | `navigator.hardwareConcurrency === 0` |
| Fingerprint multi-IP abuse | +5 | Same fingerprint seen from 100+ different IPs |

## Decision Thresholds

Default thresholds (configurable):

- **Score < 30**: **Allow** (legitimate user)
- **Score 30-70**: **Challenge** (CAPTCHA or additional verification)
- **Score ≥ 70** or **instant-block signal**: **Block** (suspected bot)

### Threshold Tuning Guide

| Use Case | Block | Challenge | Notes |
|----------|-------|-----------|-------|
| High security (payments) | 50 | 20 | Strict, may have false positives |
| Default (general API) | 70 | 30 | Balance of detection and UX |
| Lenient (public content) | 90 | 50 | Permissive, allows most bots |
| Debug/testing | 100 | 100 | Disables all blocking |
