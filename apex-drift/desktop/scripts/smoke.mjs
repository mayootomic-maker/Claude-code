// Launches the packaged-to-be desktop app and plays through the start of the
// game with keyboard and mouse only, failing on any console or page error.
// Needs a display: in CI it runs under xvfb-run. Run `npm run copy-web` first.
import { _electron as electron } from 'playwright'

const errors = []
// APEX_EXE tests a packaged build instead of the source folder.
const flags = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
const exe = process.env.APEX_EXE
const app = await electron.launch(exe ? { executablePath: exe, args: flags } : { args: ['.', ...flags] })
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    errors.push(`${name}: ${e.message}`)
    console.log(`FAIL ${name}: ${e.message}`)
  }
}
const phase = () => page.evaluate(() => window.__app?.race?.phase ?? null)

await step('opens on the studio sting', async () => {
  await page.waitForSelector('#sting:not(.hidden)', { timeout: 60000 })
  if (!(await page.evaluate(() => window.ApexNative?.desktop === true))) throw new Error('desktop bridge missing')
})
await step('keyboard starts the game and the school', async () => {
  await page.keyboard.press('Enter')
  await page.waitForSelector('#title:not(.hidden)')
  await page.keyboard.press('Enter')
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 180000 })
  const end = Date.now() + 240000
  while ((await phase()) !== 'running') {
    if (Date.now() > end) {
      throw new Error(`stuck at ${await phase()}`)
    }
    await page.waitForTimeout(250)
  }
})
await step('engine sound runs', async () => {
  const state = await page.evaluate(() => window.__app?.audio?.ctx?.state ?? 'none')
  if (state !== 'running') throw new Error(`audio context is ${state}`)
})
await step('Esc pauses, settings open in the pause menu, Esc goes back', async () => {
  await page.keyboard.press('Escape')
  await page.click('[data-settings]')
  await page.click('[data-tab="audio"]')
  await page.waitForSelector('[data-pause-settings] [data-range="music"]')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#overlay [data-resume]')
  await page.click('[data-resume]')
  await page.waitForSelector('#overlay.hidden', { state: 'attached' })
})
await step('quit tile closes the app', async () => {
  await page.keyboard.press('Escape')
  await page.click('[data-quit]')
  await page.click('[data-y]')
  await page.waitForSelector('[data-go="exit"]')
  const closed = app.waitForEvent('close')
  await page.click('[data-go="exit"]')
  await closed
})
if (errors.length) {
  await app.close().catch(() => {})
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '))
  process.exit(1)
}
console.log('\ndesktop smoke passed')
