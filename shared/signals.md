# Signal Types & Weights

## Scoring Engine Signals

| Signal | Weight | Instant Block? |
|--------|--------|----------------|
| Automation tool detected (Puppeteer/Playwright/Selenium) | - | Yes |
| `window.webdriver` present | - | Yes |
| Prototype chain tampered | Critical | Yes |
| Native function toString() overridden | Critical | Yes |
| Token nonce replayed | - | Yes |
| Token expired (>5 minutes) | - | Yes |
| Canvas fingerprint inconsistent with claimed UA | High (25) | No |
| WebGL renderer doesn't match claimed GPU | High (25) | No |
| Audio fingerprint is zero/constant (virtualized) | High (20) | No |
| User-Agent claims headless browser | High (20) | No |
| Stack trace contains headless keywords | High (15) | No |
| No mouse/keyboard events in 10s+ | Medium (15) | No |
| Mouse movement entropy too low (linear paths) | Medium (15) | No |
| Keystroke timing too uniform | Medium (10) | No |
| navigator.hardwareConcurrency = 0 or missing | Low (5) | No |
| Fingerprint seen from 100+ IPs | Low (5) | No |

## Decision Thresholds

- **Score < 30**: Allow
- **Score 30-70**: Challenge (CAPTCHA)
- **Score > 70** or **instant-block signal**: Block
