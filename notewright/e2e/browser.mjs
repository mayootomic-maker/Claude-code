// Locates the Chromium this container ships rather than the one playwright-core
// would download, which it cannot: the browser has no outbound network here.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

function findChromium() {
  const fromEnvironment = process.env.CHROMIUM_PATH
  if (fromEnvironment && existsSync(fromEnvironment)) return fromEnvironment

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue
      const candidate = join(root, entry, 'chrome-linux', 'chrome')
      if (existsSync(candidate)) return candidate
    }
  }

  const bundled = chromium.executablePath()
  if (existsSync(bundled)) return bundled
  throw new Error('No Chromium found. Set CHROMIUM_PATH, or run "npx playwright install chromium".')
}

export async function launch(options = {}) {
  return chromium.launch({
    executablePath: findChromium(),
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox', '--disable-dev-shm-usage'],
    ...options,
  })
}

export function reporter() {
  let total = 0
  let failed = 0
  const failures = []
  return {
    section(name) {
      console.log(`\n${name}`)
    },
    check(name, condition, detail = '') {
      total++
      if (!condition) {
        failed++
        failures.push(`${name}${detail ? ` -- ${detail}` : ''}`)
      }
      console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
    },
    finish() {
      console.log(`\n${total - failed}/${total} checks passed`)
      if (failed > 0) {
        console.log('\nFailed:')
        for (const line of failures) console.log(`  - ${line}`)
      }
      return failed
    },
  }
}
