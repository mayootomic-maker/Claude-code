/**
 * Drives the real app in a real browser at iPhone dimensions.
 *
 * Loads the built bundle, walks onboarding, then forces each state the Now
 * screen has to handle and screenshots it in both themes. Console errors,
 * page errors and failed requests are collected — a screen that renders while
 * throwing counts as a failure, not a pass.
 *
 * Data comes from e2e/stub-server.mjs; see the note there on why.
 */

import { chromium, devices } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4174'
const OUT = new URL('./shots/', import.meta.url).pathname

const problems = []
const findings = []

/** Stop ids the stub server maps to specific scenarios. */
const SCENARIOS = [
  { id: '8502113', name: 'normal', expect: /Losgehen in|Jetzt losgehen/ },
  { id: '9000001', name: 'no-realtime', expect: /Keine Echtzeitdaten/ },
  // The cancelled train must be *announced*, while the screen leads with the
  // next one that is actually running.
  { id: '9000002', name: 'cancelled', expect: /fällt aus/ },
  { id: '9000003', name: 'go-now', expect: /Jetzt losgehen/ },
  { id: '9000004', name: 'empty', expect: /keine Verbindung mehr/ },
  { id: '9000005', name: 'error', expect: /nicht erreichbar/ },
  { id: '9000006', name: 'malformed', expect: /unlesbar/ },
]

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png` })
}

/** Seeds a route directly so each scenario starts from a known state. */
async function seedRoute(page, stopId, walkMinutes) {
  await page.evaluate(
    async ({ stopId, walkMinutes }) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('pendlo', 1)
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv')
        }
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(
            {
              version: 1,
              routes: [
                {
                  id: 'test-route',
                  label: 'Test',
                  origin: { id: stopId, name: 'Teststart', coord: null },
                  destination: { id: '8503000', name: 'Zürich HB', coord: null },
                  walkSeconds: walkMinutes * 60,
                  note: '',
                },
              ],
              settings: { language: 'de', theme: 'system', delayAlertMinutes: 3 },
            },
            'app-data',
          )
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      })
    },
    { stopId, walkMinutes },
  )
}

async function drive(browser) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      ...devices['iPhone 13'],
      colorScheme: theme,
      locale: 'de-CH',
    })
    const page = await context.newPage()

    // Set while driving a scenario that is supposed to fail, so expected
    // network noise is not reported as a defect.
    let deliberateFailure = false

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      // The error scenario deliberately serves a 503; the browser logs the
      // failed load regardless of the app handling it correctly.
      if (deliberateFailure && msg.text().includes('Failed to load resource')) return
      problems.push(`[${theme}] console: ${msg.text()}`)
    })
    page.on('pageerror', (error) => problems.push(`[${theme}] pageerror: ${error.message}`))
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown'
      // Aborts are deliberate: superseded searches and unmounted polls.
      if (failure.includes('ERR_ABORTED')) return
      if (deliberateFailure) return
      problems.push(`[${theme}] requestfailed: ${request.url()} — ${failure}`)
    })

    console.log(`\n== ${theme} ==`)

    // --- Onboarding ------------------------------------------------------
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1', { timeout: 10_000 })
    await shot(page, `${theme}-01-onboarding-origin`)

    await page.fill('input[type="search"]', 'Aarau')
    await page.waitForSelector('ul button', { timeout: 10_000 })
    await shot(page, `${theme}-02-onboarding-results`)
    await page.click('ul button >> nth=0')

    await page.waitForTimeout(200)
    await page.fill('input[type="search"]', 'Zürich')
    await page.waitForSelector('ul button', { timeout: 10_000 })
    await page.click('ul button >> nth=0')

    await page.waitForSelector('input[type="range"]', { timeout: 5_000 })
    await shot(page, `${theme}-03-onboarding-walk`)
    await page.click('footer button >> nth=-1')

    await page.waitForTimeout(1_500)
    await shot(page, `${theme}-04-now-after-onboarding`)
    const afterOnboarding = (await page.textContent('main')) ?? ''
    findings.push(`[${theme}] after onboarding: ${JSON.stringify(afterOnboarding.trim().slice(0, 90))}`)

    // --- Every Now-screen state ------------------------------------------
    for (const scenario of SCENARIOS) {
      // "go-now" needs a walk longer than the time remaining; the others use a
      // realistic 8 minutes.
      deliberateFailure = scenario.name === 'error'
      await seedRoute(page, scenario.id, 8)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_400)

      const body = (await page.textContent('body')) ?? ''
      const matched = scenario.expect.test(body)
      findings.push(
        `[${theme}] ${scenario.name.padEnd(12)} ${matched ? 'OK  ' : 'MISS'} ${JSON.stringify(body.replace(/\s+/g, ' ').trim().slice(0, 100))}`,
      )
      if (!matched) {
        problems.push(`[${theme}] scenario "${scenario.name}" did not render ${scenario.expect}`)
      }
      await shot(page, `${theme}-scenario-${scenario.name}`)
      deliberateFailure = false
    }

    // --- Offline ---------------------------------------------------------
    await seedRoute(page, '8502113', 8)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_200)
    await context.setOffline(true)
    await page.evaluate(() => dispatchEvent(new Event('offline')))
    await page.waitForTimeout(600)

    const offlineBody = (await page.textContent('body')) ?? ''
    const offlineOk = /Offline/.test(offlineBody)
    findings.push(`[${theme}] offline      ${offlineOk ? 'OK' : 'MISS'}`)
    if (!offlineOk) problems.push(`[${theme}] offline banner did not render`)
    await shot(page, `${theme}-scenario-offline`)
    await context.setOffline(false)

    await context.close()
  }
}

async function run() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    // Running as root in the container: Chromium's sandbox cannot initialise.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    await drive(browser)
  } finally {
    await browser.close()
  }
}

function report() {
  console.log('\n=== findings ===')
  for (const finding of findings) console.log(`  ${finding}`)

  console.log('\n=== problems ===')
  if (problems.length === 0) {
    console.log('  none')
  } else {
    for (const problem of problems) console.log(`  ${problem}`)
    process.exitCode = 1
  }
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(report)
