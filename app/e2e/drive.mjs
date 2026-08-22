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
async function seedRoute(page, stopId, walkMinutes, extraSettings = {}) {
  await page.evaluate(
    async ({ stopId, walkMinutes, extraSettings }) => {
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
              settings: {
                language: 'de',
                theme: 'system',
                delayAlertMinutes: 3,
                inspectionPrior: 0.15,
                workerUrl: null,
                deviceToken: null,
                ...extraSettings,
              },
            },
            'app-data',
          )
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      })
    },
    { stopId, walkMinutes, extraSettings },
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

    // Fourth step: the seeded prior, so week one is not blank.
    await page.waitForSelector('button:has-text("Ab und zu")', { timeout: 5_000 })
    await shot(page, `${theme}-03b-onboarding-prior`)
    await page.click('button:has-text("Ab und zu")')

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

    // --- Tabs -------------------------------------------------------------
    await seedRoute(page, '8502113', 8)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_200)

    for (const [index, name] of [[1, 'board'], [2, 'routes'], [3, 'settings']]) {
      await page.click(`nav button >> nth=${index}`)
      await page.waitForTimeout(900)
      const heading = (await page.textContent('h1').catch(() => '')) ?? ''
      findings.push(`[${theme}] tab ${name.padEnd(9)} heading=${JSON.stringify(heading.trim())}`)
      if (heading.trim() === '') problems.push(`[${theme}] tab "${name}" rendered no heading`)
      await shot(page, `${theme}-tab-${name}`)
    }

    // --- Inspection capture and the ticket shortcut ------------------------
    await page.click('nav button >> nth=0')
    await page.waitForTimeout(1_000)

    const panelBefore = (await page.textContent('body')) ?? ''
    const hasEstimate = /Kontrolle: ~1 von \d+/.test(panelBefore)
    findings.push(`[${theme}] estimate shown ${hasEstimate ? 'OK  ' : 'MISS'} (usable from ride one)`)
    if (!hasEstimate) problems.push(`[${theme}] no estimate rendered despite a seeded prior`)

    // Expanding must disclose that this rests on the prior, not on real rides.
    await page.click('section button[aria-expanded]')
    await page.waitForTimeout(400)
    const stats = (await page.textContent('body')) ?? ''
    const honest = /Grobe Annahme/.test(stats)
    findings.push(`[${theme}] basis stated  ${honest ? 'OK  ' : 'MISS'} (says it is only an assumption)`)
    if (!honest) problems.push(`[${theme}] estimate did not disclose that it rests on the prior`)
    await shot(page, `${theme}-inspection-panel`)

    await page.click('button:has-text("Kontrolle")')
    await page.waitForTimeout(600)

    // Ticket view opens with nothing stored and says so, rather than blank.
    await page.click('button:has-text("Billett zeigen")')
    await page.waitForTimeout(600)
    const ticketBody = (await page.textContent('[role="dialog"]').catch(() => '')) ?? ''
    const ticketOk = /Kein Billett hinterlegt/.test(ticketBody)
    findings.push(`[${theme}] ticket view    ${ticketOk ? 'OK  ' : 'MISS'} ${JSON.stringify(ticketBody.trim().slice(0, 60))}`)
    if (!ticketOk) problems.push(`[${theme}] ticket view empty state missing`)
    await shot(page, `${theme}-ticket-view`)
    await page.click('[role="dialog"] button:has-text("Schliessen")')
    await page.waitForTimeout(300)

    // --- Worker source: occupancy and disruptions ---------------------------
    // Neither exists in the keyless API, so this is the only path that shows
    // them. Also proves the app prefers the Worker when configured.
    const worker = { workerUrl: `${BASE}/worker`, deviceToken: 'test-token' }

    await seedRoute(page, '8502113', 8, worker)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_500)

    const withWorker = (await page.textContent('body')) ?? ''
    const occupancyShown = /Nur Stehplätze/.test(withWorker)
    const exitSideShown = /Aussteigeseite: Rechts/.test(withWorker)
    findings.push(`[${theme}] occupancy     ${occupancyShown ? 'OK  ' : 'MISS'} (via worker/OJP only)`)
    findings.push(`[${theme}] exit side     ${exitSideShown ? 'OK  ' : 'MISS'} (operator attribute)`)
    if (!occupancyShown) problems.push(`[${theme}] occupancy chip did not render from worker data`)
    if (!exitSideShown) problems.push(`[${theme}] exit-side attribute did not render`)
    await shot(page, `${theme}-worker-occupancy`)

    // Disruption must appear above the countdown: it changes whether the plan holds.
    await seedRoute(page, '9000007', 8, worker)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_500)
    const disrupted = (await page.textContent('body')) ?? ''
    const disruptionShown = /Streckenunterbruch/.test(disrupted)
    findings.push(`[${theme}] disruption    ${disruptionShown ? 'OK  ' : 'MISS'}`)
    if (!disruptionShown) problems.push(`[${theme}] disruption banner did not render`)
    await shot(page, `${theme}-worker-disruption`)

    // A rejected token must fall back silently to the keyless API, not break.
    // The browser logs the 401 regardless of the app handling it correctly.
    deliberateFailure = true
    await seedRoute(page, '8502113', 8, { workerUrl: `${BASE}/worker`, deviceToken: 'wrong-token' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_000)
    const fellBack = (await page.textContent('body')) ?? ''
    const stillWorks = /Losgehen in|Jetzt losgehen/.test(fellBack)
    findings.push(`[${theme}] worker 401    ${stillWorks ? 'OK  ' : 'MISS'} (fell back to keyless API)`)
    if (!stillWorks) problems.push(`[${theme}] a rejected worker token broke the board`)

    // Clear the bad token before moving on, or the poll keeps firing 401s into
    // the sections that follow.
    await seedRoute(page, '8502113', 8)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    deliberateFailure = false

    // --- On board: the inspection must bind to the train you are ON --------
    // Mid-journey the board shows the *next* train. Without active-trip
    // tracking an inspection logged here would attach to a train never
    // boarded, and the ride count would never grow.
    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const open = indexedDB.open('pendlo', 1)
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv')
        }
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite')
          const store = tx.objectStore('kv')
          const get = store.get('app-data')
          get.onsuccess = () => {
            const data = get.result
            // A train that left eight minutes ago: you are on it right now.
            data.activeTrip = {
              tripKey: 'test-route|outbound|S29|500',
              routeId: 'test-route',
              direction: 'outbound',
              line: 'S 29',
              destination: 'Turgi',
              departedAt: Date.now() - 8 * 60_000,
              segment: ['8502113', '8503000'],
            }
            store.put(data, 'app-data')
          }
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      })
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_400)

    const onboardBody = (await page.textContent('body')) ?? ''
    // LineBadge normalises "S 29" to "S29" so badges align in a column.
    const onboardOk = /Du bist unterwegs/.test(onboardBody) && /S\s?29/.test(onboardBody)
    findings.push(`[${theme}] on board      ${onboardOk ? 'OK  ' : 'MISS'} (bound to the boarded train)`)
    if (!onboardOk) problems.push(`[${theme}] on-board mode did not render`)
    await shot(page, `${theme}-onboard`)

    // A ride must have been logged for the boarded trip, not for the next one.
    const rideCheck = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const open = indexedDB.open('pendlo', 1)
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readonly')
          const get = tx.objectStore('kv').get('app-data')
          get.onsuccess = () => {
            const rides = get.result?.log?.rides ?? []
            resolve({ count: rides.length, keys: rides.map((r) => r.tripKey) })
          }
          get.onerror = () => reject(get.error)
        }
        open.onerror = () => reject(open.error)
      })
    })
    const rideOk = rideCheck.count >= 1 && rideCheck.keys.includes('test-route|outbound|S29|500')
    findings.push(`[${theme}] ride logged   ${rideOk ? 'OK  ' : 'MISS'} ${JSON.stringify(rideCheck)}`)
    if (!rideOk) problems.push(`[${theme}] boarded ride was not logged against the boarded trip`)

    // --- Export -> wipe -> restore fidelity --------------------------------
    // Simulates iOS evicting our data: the stored payload disappears, and the
    // exported file is the only way back. Deletes the key rather than the
    // database, because the running app holds an open connection and
    // deleteDatabase would block on it indefinitely.
    const readKey = async () =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('pendlo', 1)
            open.onupgradeneeded = () => {
              if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv')
            }
            open.onsuccess = () => {
              const tx = open.result.transaction('kv', 'readonly')
              const get = tx.objectStore('kv').get('app-data')
              get.onsuccess = () => resolve(JSON.stringify(get.result ?? null))
              get.onerror = () => reject(get.error)
            }
            open.onerror = () => reject(open.error)
          }),
      )

    const writeKey = async (json) =>
      page.evaluate(
        (payload) =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('pendlo', 1)
            open.onupgradeneeded = () => {
              if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv')
            }
            open.onsuccess = () => {
              const tx = open.result.transaction('kv', 'readwrite')
              const store = tx.objectStore('kv')
              if (payload === null) store.delete('app-data')
              else store.put(JSON.parse(payload), 'app-data')
              tx.oncomplete = () => resolve(true)
              tx.onerror = () => reject(tx.error)
            }
            open.onerror = () => reject(open.error)
          }),
        json,
      )

    const exported = await readKey()
    const hasRoutes = exported !== null && exported.includes('walkSeconds')
    if (!hasRoutes) problems.push(`[${theme}] nothing to export — the app stored no routes`)

    await writeKey(null)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_000)
    const wiped = (await page.textContent('body')) ?? ''
    const wipedOk = /Willkommen/.test(wiped)
    findings.push(`[${theme}] after wipe    ${wipedOk ? 'OK  ' : 'MISS'} (onboarding returns)`)
    if (!wipedOk) problems.push(`[${theme}] wipe did not reset the app to onboarding`)

    await writeKey(exported)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1_200)
    const restoredBody = (await page.textContent('body')) ?? ''
    const restoredOk = !/Willkommen/.test(restoredBody) && /Richtung/.test(restoredBody)
    findings.push(`[${theme}] after restore ${restoredOk ? 'OK  ' : 'MISS'} (route survived)`)
    if (!restoredOk) problems.push(`[${theme}] data did not survive wipe and restore`)

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
