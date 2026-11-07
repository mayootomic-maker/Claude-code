// Drives the built game in Chromium at phone landscape size and fails on any
// console error, page error or stuck state. Run after `vite build`:
//   node e2e/soak.mjs            quick: school, one finished stage, every rally loads
//   node e2e/soak.mjs --full     also loads every one of the 48 stages
//   node e2e/soak.mjs --desktop  a 1280x720 window with mouse and keyboard, no touch
//   node e2e/soak.mjs --single   the one-file build (npm run single), opened from disk
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const FULL = process.argv.includes('--full')
const DESKTOP = process.argv.includes('--desktop')
const SINGLE = process.argv.includes('--single')
const OUT = new URL(process.argv.includes('--desktop') ? './out/desktop/' : process.argv.includes('--single') ? './out/single/' : './out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const PORT = 4179
const URL_ = SINGLE ? new URL('../dist-single/apex-drift.html', import.meta.url).href : `http://localhost:${PORT}/`
const server = SINGLE ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
if (server) await new Promise((r) => setTimeout(r, 2500))

const errors = []
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1280, height: 720 } } : { viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()} ${m.location().url ?? ''}`)
  // The fallback engine is for browsers without worklets; on Chromium it means the real one failed to load.
  if (m.text().includes('engine worklet unavailable')) errors.push(`engine sound fell back: ${m.text()}`)
})
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

// SwiftShader draws a desktop-sized window several times slower than a phone
// screen; start on Low so the run measures the game, not the software renderer.
if (DESKTOP) await page.addInitScript(() => {
  if (!localStorage.getItem('apexdrift.save.v4')) localStorage.setItem('apexdrift.save.v4', JSON.stringify({ settings: { quality: 'low' } }))
})
await page.goto(URL_)
await step('sting and title', async () => {
  await page.waitForSelector('#sting:not(.hidden)')
  await shot('01-sting')
  await page.mouse.click(400, 200)
  await page.waitForSelector('#title:not(.hidden)')
  // The live stage behind the logo builds in the background; give it a moment.
  await page.waitForSelector('#title.live', { timeout: 120000 })
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
  await tap('[data-settings]')
  await tap('[data-tab="display"]')
  await page.waitForSelector('[data-pause-settings] [data-set="camera"]')
  await shot('05b-pause-settings')
  // Back from the settings lands on the pause menu, not the stage.
  await page.keyboard.press('Escape')
  await page.waitForSelector('#overlay:not(.hidden) [data-resume]')
  const handled = await page.evaluate(() => window.__apexBack())
  if (handled !== true) throw new Error('back during pause was not handled')
  await page.waitForSelector('#overlay.hidden', { state: 'attached' })
})
await step('reset puts the car back on the road', async () => {
  await page.keyboard.press('KeyR')
  const d = await page.evaluate(() => Math.abs(window.__app.race.sim.car.d))
  if (d > 0.5) throw new Error(`car ${d} m off the centre line after reset`)
})
await step('photo mode: orbit, zoom, take a photo, back to pause', async () => {
  await page.keyboard.press('Escape')
  await tap('[data-photo]')
  await page.waitForSelector('#photobar')
  const box = await page.locator('#gl').boundingBox()
  await page.mouse.move(box.width / 2, box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.width / 2 + 160, box.height / 2 - 40, { steps: 6 })
  await page.mouse.up()
  await tap('[data-zoom="1"]')
  await page.waitForTimeout(400)
  await shot('05c-photo')
  const download = page.waitForEvent('download', { timeout: 20000 })
  await tap('[data-shoot]')
  const d = await download
  if (!/\.png$/.test(d.suggestedFilename())) throw new Error(`photo saved as ${d.suggestedFilename()}`)
  await page.keyboard.press('Escape')
  await page.waitForSelector('#overlay:not(.hidden) [data-resume]')
  await tap('[data-resume]')
})
await step('quit to menu', async () => {
  await page.keyboard.press('Escape')
  await tap('[data-quit]')
  await tap('[data-y]')
  await page.waitForSelector('#menu:not(.hidden)')
  // Let the menu's entrance animation settle so the shot shows the finished screen.
  await page.waitForTimeout(700)
  await shot('06-home')
})
await step('garage: browse cars and liveries', async () => {
  await tap('[data-go="garage"]')
  await page.waitForSelector('.garage')
  await tap('[data-car="saetta"]')
  await tap('[data-l="fjord"]')
  await page.waitForTimeout(500)
  await shot('07-garage')
  await page.evaluate(() => window.__apexBack())
})
if (DESKTOP) await step('desktop: keyboard guide, Esc steps back', async () => {
  await tap('[data-go="options"]')
  await page.waitForSelector('.keymap')
  await shot('07b-keys')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-go="options"]')
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
  await page.waitForTimeout(400)
  await shot('08-options-de')
  await tap('[data-set="lang"][data-v="en"]')
  await tap('[data-tab="data"]')
  await tap('[data-privacy]')
  await page.waitForSelector('#overlay iframe')
  await shot('09-privacy')
  await tap('[data-close]')
  await page.evaluate(() => window.__apexBack())
})
await step('daily stage loads and drives', async () => {
  await tap('[data-go="daily"]')
  await inRace()
  await waitPhase('running', 90000)
  await drive(5000)
  await shot('09b-daily')
  await page.keyboard.press('Escape')
  await tap('[data-quit]')
  await tap('[data-y]')
  await page.waitForSelector('#menu:not(.hidden)')
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
  await page.waitForTimeout(900)
  await shot('10-results')
  await tap('[data-replay]')
  await page.waitForSelector('#replaybar')
  await page.waitForTimeout(4000)
  await shot('11-replay')
  await tap('[data-rspeed]')
  await page.waitForTimeout(3000)
  await shot('12-replay-later')
  if ((await phase()) !== 'replay') throw new Error(`replay ended early (at ${await phase()})`)
  await page.keyboard.press('Escape')
  await page.waitForSelector('#overlay:not(.hidden) .results')
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
    await page.goto(URL_)
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
server?.kill()
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '))
  process.exit(1)
}
console.log('\nsoak passed')
