# Signal Types & Weights

## Instant-Block Signals

Trigger immediate block (score=100) regardless of other scores.

| Signal / reason | Detection Method |
|--------|------------------|
| `instant_block:webdriver_present` | `navigator.webdriver === true` |
| `instant_block:puppeteer_runtime` | Global `window.__puppeteer_evaluation_script__` |
| `instant_block:playwright_runtime` | Global `window.__playwright` |
| `instant_block:selenium_runtime` | Multiple Selenium-specific globals detected |
| `instant_block:phantom_runtime` | Global `window._phantom` |
| `token_nonce_replayed` | Nonce already claimed within its TTL (acceptance window + 5 s) |
| `token_expired` | Token age > acceptance window (`maxTokenAbsoluteAgeMs`, default 1 hour) |
| `token_timestamp_future` | Token timestamp > now + acceptance window |
| `token_decryption_failed:<code or name>` | Token could not be decrypted / parsed (returned by `verify()`) |

The acceptance window is symmetric around server time (default 1 hour) so real client clock skew is
tolerated. The nonce claim outlives the window, so a captured token can never be replayed after
its nonce expires: it is rejected as `token_expired` instead.

## Scored Signals

Contribute to risk score but allow other factors to influence decision.

| Reason | Weight | Detection Method |
|--------|--------|------------------|
| `canvas_fingerprint_empty_or_zero` | +25 | Hash is empty string or '0' |
| `webgl_fingerprint_empty` | +25 | WebGL hash or renderer is empty |
| `fingerprint_suppressed_suspicious` | +10 | Canvas and WebGL both empty but UA looks like a real browser |
| `screen_dimensions_zero` | +10 | Width, height and colorDepth all 0 |
| `native_function_toString_overridden` | +30 | `Function.prototype.toString` patched (extensions/polyfills do this) |
| `window_event_target_chain_broken` | +15 | DOM prototype chain validation failed |
| `document_node_chain_broken` | +15 | Document prototype chain validation failed |
| `stack_trace_headless` | +15 | Stack contains Puppeteer/Playwright evaluation-script markers |
| `user_agent_headless` | +20 | UA contains "HeadlessChrome", "PhantomJS" |
| `languages_empty` | +10 | `navigator.languages.length === 0` |
| `no_interaction_events` | +15 | No mouse or keyboard events collected |
| `mouse_entropy_too_low` | +15 | At least 5 movement angles and entropy < 0.1 (linear movement) |
| `keystroke_timing_too_uniform` | +10 | Flight times uniform (> 0.95) and, when keyup events exist, dwell times uniform too |
| `token_too_old` | +10 | Token age 30 s to 5 min |
| `token_clock_skew` | +10 | Token age or lead beyond 5 min but inside the acceptance window (replaces `token_too_old`) |
| `hardware_concurrency_zero` | +5 | `navigator.hardwareConcurrency === 0` |
| `fingerprint_ip_abuse` | +5 | Same fingerprint seen from 100+ different IPs |

Not scored: the audio fingerprint (retired in client 0.4.0; the wire slot is always empty),
`connection_rtt_zero` (still reported by the client but never scored), and DPR 1.0 on wide displays.

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
