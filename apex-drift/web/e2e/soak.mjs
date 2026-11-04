// Drives the built game in Chromium at phone landscape size and fails on any
// console error, page error or stuck state. Run after `vite build`:
//   node e2e/soak.mjs            quick: school, one finished stage, every rally loads
//   node e2e/soak.mjs --full     also loads every one of the 48 stages
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const FULL = process.argv.includes('--full')
const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const PORT = 4179
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
await new Promise((r) => setTimeout(r, 2500))

const errors = []
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    await fn()
    console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    errors.push(`${name}: ${e.message}`)
    console.log(`FAIL ${name}: ${e.message}`)
    await page.screenshot({ path: `${OUT}fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => {})
  }
}
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` })
const tap = (sel) => page.locator(sel).first().click()
const inRace = () => page.waitForSelector('#hud:not(.hidden)', { timeout: 180000 })
const phase = () => page.evaluate(() => window.__app?.race?.phase ?? null)
const waitPhase = async (p, ms) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await phase()) === p) return
    await page.waitForTimeout(250)
  }
  throw new Error(`never reached phase ${p} (at ${await phase()})`)
}

/** Steers with the keyboard toward a point down the road, as a player would. */
async function drive(ms) {
  const end = Date.now() + ms
  let held = null
  await page.keyboard.down('KeyW')
  while (Date.now() < end) {
    const p = await phase()
    if (p !== 'running' && p !== 'countdown') break
    const want = await page.evaluate(() => {
      const r = window.__app.race
      const car = r.sim.car, route = r.sim.route
      const a = route.at(car.s + 6 + car.speed * 0.6)
      let e = Math.atan2(a.x - car.x, a.z - car.z) - car.heading
      while (e > Math.PI) e -= 2 * Math.PI
      while (e < -Math.PI) e += 2 * Math.PI
      return e > 0.06 ? 'KeyA' : e < -0.06 ? 'KeyD' : null
    })
    if (want !== held) {
      if (held) await page.keyboard.up(held)
      if (want) await page.keyboard.down(want)
      held = want
    }
    await page.waitForTimeout(60)
  }
  if (held) await page.keyboard.up(held)
  await page.keyboard.up('KeyW')
}

await page.goto(`http://localhost:${PORT}/`)
await step('sting and title', async () => {
  await page.waitForSelector('#sting:not(.hidden)')
  await shot('01-sting')
  await page.mouse.click(400, 200)
  await page.waitForSelector('#title:not(.hidden)')
  await shot('02-title')
})
await step('first run goes to the driving school', async () => {
  await page.mouse.click(400, 200)
  await inRace()
  await shot('03-school-intro')
  await waitPhase('running', 60000)
  await page.waitForSelector('.coach', { timeout: 30000 })
  await shot('04-school-coach')
})
await step('pause, resume and Android back', async () => {
  await page.keyboard.press('Escape')
  await page.waitForSelector('#overlay:not(.hidden) [data-resume]')
  await shot('05-pause')
  const handled = await page.evaluate(() => window.__apexBack())
  if (handled !== true) throw new Error('back during pause was not handled')
  await page.waitForSelector('#overlay.hidden', { state: 'attached' })
})
await step('reset puts the car back on the road', async () => {
  await page.keyboard.press('KeyR')
  const d = await page.evaluate(() => Math.abs(window.__app.race.sim.car.d))
  if (d > 0.5) throw new Error(`car ${d} m off the centre line after reset`)
})
await step('quit to menu', async () => {
  await page.keyboard.press('Escape')
  await tap('[data-quit]')
  await tap('[data-y]')
  await page.waitForSelector('#menu:not(.hidden)')
  await shot('06-home')
})
await step('garage: browse cars and liveries', async () => {
  await tap('[data-go="garage"]')
  await page.waitForSelector('.garage')
  await tap('[data-car="saetta"]')
  await tap('[data-l="fjord"]')
  await shot('07-garage')
  await page.evaluate(() => window.__apexBack())
})
await step('options: every tab, toggle and slider', async () => {
  await tap('[data-go="options"]')
  for (const tab of ['controls', 'audio', 'display', 'gameplay', 'data']) {
    await tap(`[data-tab="${tab}"]`)
    for (const t of await page.locator('[data-tog]').all()) await t.click()
    for (const t of await page.locator('[data-tog]').all()) await t.click()
  }
  await tap('[data-tab="display"]')
  await tap('[data-set="lang"][data-v="de"]')
  await shot('08-options-de')
  await tap('[data-set="lang"][data-v="en"]')
  await tap('[data-tab="data"]')
  await tap('[data-privacy]')
  await page.waitForSelector('#overlay iframe')
  await shot('09-privacy')
  await tap('[data-close]')
  await page.evaluate(() => window.__apexBack())
})
await step('a whole stage, driven to the results screen', async () => {
  await tap('[data-go="free"]')
  await tap('[data-r="0"]')
  await tap('[data-k="3"]')
  await tap('[data-drive]')
  await inRace()
  await waitPhase('running', 90000)
  await drive(20 * 60000)
  await waitPhase('results', 30000)
  await page.waitForSelector('.results')
  await shot('10-results')
  await tap('[data-menu]')
  await page.waitForSelector('#menu:not(.hidden)')
})
const stages = FULL ? Array.from({ length: 12 }, (_, r) => [0, 1, 2, 3].map((s) => [r, s])).flat() : Array.from({ length: 12 }, (_, r) => [r, 0])
for (const [r, s] of stages) {
  await step(`load rally ${r} stage ${s + 1}`, async () => {
    // Unlock everything for the load test by finishing each rally in the save.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('apexdrift.save.v4'))
      raw.finished = ['finland', 'kenya', 'portugal', 'estonia', 'sardinia', 'argentina', 'wales', 'croatia', 'greece', 'japan', 'sweden', 'monte']
      raw.tutorialDone = true
      localStorage.setItem('apexdrift.save.v4', JSON.stringify(raw))
    })
    await page.goto(`http://localhost:${PORT}/`)
    await page.mouse.click(400, 200)
    await page.waitForSelector('#title:not(.hidden)')
    await page.mouse.click(400, 200)
    await page.waitForSelector('#menu:not(.hidden)')
    await tap('[data-go="free"]')
    await tap(`[data-r="${r}"]`)
    await tap(`[data-k="${s}"]`)
    await tap('[data-drive]')
    await inRace()
    await waitPhase('running', 90000)
    await drive(6000)
    await shot(`stage-${String(r).padStart(2, '0')}-${s + 1}`)
  })
}
await browser.close()
server.kill()
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '))
  process.exit(1)
}
console.log('\nsoak passed')
