import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Test environments are chosen per file with `// @vitest-environment` headers.
export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
})
