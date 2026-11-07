// Renders fixed camera shots through dev.html, for before/after comparisons of
// the look. Needs `npx vite --port 4180` running. Usage:
//   node e2e/shots.mjs <out-folder> [name=query ...]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const DEFAULT = {
  'sweden-lake': 'mode=card&rally=sweden&s=0&at=6320&ang=1.2&dist=12&h=4&fov=55',
  'kenya-splash': 'mode=card&rally=kenya&s=0&at=515&ang=0.4&dist=9&h=2.2&fov=50',
  'finland-road': 'mode=card&rally=finland&s=0&at=900&ang=0.5&dist=8&h=1.8',
  'wales-forest': 'mode=card&rally=wales&s=0&at=700&ang=0.6&dist=7.5&h=1.6',
  'monte-tarmac': 'mode=card&rally=monte&s=1&at=800&ang=0.7&dist=7.5&h=1.6',
  'greece-rock': 'mode=card&rally=greece&s=0&at=1200&ang=0.8&dist=8&h=2',
  'car-close': 'mode=car&car=apex&livery=works&a=0.7&dist=6',
  'car-retro': 'mode=car&car=kestrel&livery=rosso&a=2.4&dist=6',
}
const pairs = process.argv.slice(3).length ? process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2)) : Object.entries(DEFAULT)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()))
for (const [name, q] of pairs) {
  await page.goto(`http://localhost:${process.env.PORT ?? 4180}/dev.html?t=high&${q}`, { timeout: 120000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 })
  console.log('shot', name)
}
await browser.close()
