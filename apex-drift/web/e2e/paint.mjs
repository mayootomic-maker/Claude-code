// Screenshots of the paint shop, the driver editor, the redesigned team
// liveries and a custom livery on a stage. Fails on any console or page error.
// Needs a dev server: `npx vite --port 4391` (or PORT=...). Usage:
//   node e2e/paint.mjs                 everything
//   node e2e/paint.mjs liveries        only the team liveries (dev.html turntable)
//   node e2e/paint.mjs app             only the garage screens and the stage
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const PORT = process.env.PORT ?? '4391'
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const only = process.argv[2]
const errors = []
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const watch = (page) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
}
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    await fn()
    console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  } catch (e) {
    errors.push(`${name}: ${e.message}`)
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

if (!only || only === 'liveries') {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  watch(page)
  const shots = [
    ['works', 'strada', '4.4,1.4,4.6'], ['fjord', 'apex', '-4.4,1.5,4.6'], ['sunset', 'kestrel', '4.4,1.5,4.4'],
    ['signal', 'boxer', '4.6,1.6,4.0'], ['midnight', 'corsaire', '4.6,1.5,4.4'], ['petrol', 'vulcan', '-4.6,1.6,4.2'],
    ['glacier', 'falco', '4.6,1.4,4.4'], ['aurora', 'saetta', '4.6,1.4,4.4'], ['rosso', 'ventura', '4.4,1.4,4.6'],
  ]
  for (const [lv, car, cam] of shots) {
    await step(`livery ${lv}`, async () => {
      await page.goto(`${BASE}dev.html?mode=car&car=${car}&livery=${lv}&a=0&spin=0&cam=${cam}&look=0,0.55,0&fov=34`, { timeout: 180000 })
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}paint-after-${lv}.png`, timeout: 600000 })
    })
  }
  await page.close()
}

if (!only || only === 'app') {
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } })
  // SwiftShader draws the physical paint slowly: a click can wait a long time for the next frame.
  page.setDefaultTimeout(600000)
  watch(page)
  // A returning player: tutorial done, a custom paint job on the Kestrel and a customised driver.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('apexdrift.save.v4', JSON.stringify({
      version: 4, name: 'Toni', car: 'kestrel', livery: 'works', xp: 0, credits: 9000, tutorialDone: true,
      owned: { cars: ['kestrel', 'piccola'], liveries: [] },
      customLiveries: [{ id: 'udemo', car: 'kestrel', name: 'Night Fury', pattern: 'shards', base: 0x111a33, stripe: 0x2ec4e6, accent: 0xff4f9a, rim: 0x2ec4e6, finish: 'pearl', num: '27', font: 'italic', sponsor: 'HALCYON', decals: { panel: true, sponsors: true, pinstripe: true, roof: true, bonnet: true }, window: 'Toni' }],
      carLivery: { kestrel: 'udemo' },
      driver: { skin: 0xd99a6c, hair: 'curls', hairColor: 0xb84a1e, moustache: 'walrus', brows: 'arched', glasses: 'aviator', shirt: 0xff5a1f, print: 'palms', printColor: 0x0e7c66, shorts: 0x0b3d91, helmet: { pattern: 'flames', base: 0x111214, secondary: 0xff5a1f, accent: 0xf2b705, finish: 'gloss', visor: 'gold' } },
      settings: { camera: 'chase', quality: 'medium', lang: 'en' }, tier: 'medium',
    }))
  })
  const tap = (sel) => page.locator(sel).first().click()
  const settle = (ms = 2500) => page.waitForTimeout(ms)
  await page.goto(BASE, { timeout: 180000 })
  await step('title to home', async () => {
    await page.waitForSelector('#sting:not(.hidden)', { timeout: 120000 })
    await page.mouse.click(400, 200)
    await page.waitForSelector('#title.live', { timeout: 180000 })
    await page.mouse.click(400, 200)
    await page.waitForSelector('[data-go="garage"]', { timeout: 60000 })
  })
  await step('garage shows the custom livery', async () => {
    await tap('[data-go="garage"]')
    await page.waitForSelector('[data-paint]')
    await settle(6000)
    await page.screenshot({ path: `${OUT}paint-garage.png`, timeout: 600000 })
  })
  await step('paint shop', async () => {
    await tap('[data-paint]')
    await page.waitForSelector('[data-pats]')
    await settle(6000)
    await page.screenshot({ path: `${OUT}paint-shop.png`, timeout: 600000 })
    // Edit live: a new design, colours and finish, dragged round to see the other side.
    await tap('[data-pat="swoosh"]')
    await tap('[data-seg="slot"] [data-v="stripe"]')
    await tap('[data-col="paint"] [data-c="16734751"]')
    await tap('[data-seg="finish"] [data-v="metallic"]')
    await tap('[data-spin]')
    const st = await page.locator('[data-stage]').boundingBox()
    if (st) {
      await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2)
      await page.mouse.down()
      await page.mouse.move(st.x + st.width / 2 - 70, st.y + st.height / 2 - 20, { steps: 6 })
      await page.mouse.up()
    }
    await settle(5000)
    await page.screenshot({ path: `${OUT}paint-shop-edit.png`, timeout: 600000 })
    await tap('[data-savenew]')
    await tap('[data-apply]')
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('apexdrift.save.v4')).customLiveries.length)
    if (n !== 2) throw new Error(`expected 2 saved liveries, found ${n}`)
    await tap('[data-back]')
    await page.waitForSelector('[data-driver]')
  })
  await step('driver editor', async () => {
    await tap('[data-driver]')
    await page.waitForSelector('[data-tog="helmetOn"]')
    await settle(7000)
    await page.screenshot({ path: `${OUT}paint-driver.png`, timeout: 600000 })
    await tap('[data-tog="helmetOn"]')
    // Round to his right a little, so the helmet's sides show.
    const st = await page.locator('[data-stage]').boundingBox()
    if (st) {
      await page.mouse.move(st.x + st.width / 2, st.y + st.height / 3)
      await page.mouse.down()
      await page.mouse.move(st.x + st.width / 2 + 60, st.y + st.height / 3, { steps: 5 })
      await page.mouse.up()
    }
    await settle(5000)
    await page.screenshot({ path: `${OUT}paint-driver-helmet.png`, timeout: 600000 })
    await tap('[data-dsave]')
    await tap('[data-back]')
    await page.waitForSelector('[data-paint]')
    await tap('[data-back]')
  })
  await step('custom livery on a stage, chase camera, against rivals', async () => {
    await tap('[data-go="race"]')
    await tap('[data-r="0"]')
    await tap('[data-k="0"]')
    await tap('[data-race]')
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 600000 })
    await page.waitForFunction(() => window.__app?.race?.phase === 'running', null, { timeout: 240000, polling: 500 })
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(2500)
    await page.keyboard.up('ArrowUp')
    await page.screenshot({ path: `${OUT}paint-race-chase.png`, timeout: 600000 })
  })
  await page.close()
}

await browser.close()
if (errors.length) {
  console.log('\n' + errors.join('\n'))
  process.exit(1)
}
console.log('paint: no errors')
