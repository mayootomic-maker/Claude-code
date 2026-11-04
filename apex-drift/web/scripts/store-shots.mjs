// Renders the Play Store screenshots from the real game (HUD and all) and the
// menu artwork from the dev views. Needs the dev server on :5173 (npm run dev).
//   node scripts/store-shots.mjs art      menu cards, title and garage art -> public/img
//   node scripts/store-shots.mjs screens  phone screenshots                -> ../store/screens
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const what = process.argv[2] ?? 'screens'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

async function render(url, out, w, h, settle = 3000) {
  const p = await browser.newPage({ viewport: { width: w, height: h } })
  p.setDefaultTimeout(240000)
  await p.goto(url)
  await p.waitForFunction(() => window.__ready === true)
  await p.waitForTimeout(settle)
  await p.screenshot({ path: out, type: 'jpeg', quality: 86, timeout: 240000 })
  await p.close()
  console.log('wrote', out)
}

if (what === 'art') {
  const img = new URL('../public/img/', import.meta.url).pathname
  // [rally, stage, metres in, livery, car, camera angle]
  const cards = [
    ['finland', 1, 2490, 'works', 'kestrel', -0.7], ['kenya', 2, 2340, 'fjord', 'ruska', 0.6],
    ['portugal', 2, 2160, 'sunset', 'saetta', -0.7], ['estonia', 1, 2700, 'moss', 'bison', 0.6],
    ['sardinia', 2, 3120, 'signal', 'falco', -0.7], ['argentina', 2, 2760, 'rosso', 'boxer', 0.6],
    ['wales', 2, 3240, 'midnight', 'vulcan', -0.7], ['croatia', 2, 2640, 'alpine', 'corsaire', 0.6],
    ['greece', 2, 2820, 'glacier', 'strada', -0.7], ['japan', 1, 2100, 'savanna', 'apex', 0.6],
    ['sweden', 0, 3480, 'kurenai', 'ventura', -0.7], ['monte', 3, 1440, 'graphite', 'piccola', 0.6],
  ]
  for (const [id, s, at, lv, car, ang] of cards)
    await render(`${BASE}/dev.html?mode=card&rally=${id}&s=${s}&at=${at}&livery=${lv}&car=${car}&ang=${ang}`, `${img}c-${id}.jpg`, 960, 540)
  await render(`${BASE}/dev.html?mode=card&rally=finland&s=1&at=900&livery=works&car=kestrel&ang=-0.9&dist=9&fov=36`, `${img}title.jpg`, 1280, 720)
  await render(`${BASE}/dev.html?mode=car&car=saetta&livery=rosso&a=0.8`, `${img}garage.jpg`, 960, 540)
  await render(`${BASE}/dev.html?mode=card&rally=greece&s=3&at=1500&livery=sunset&car=falco&ang=0.9`, `${img}free.jpg`, 960, 540)
  await render(`${BASE}/dev.html?mode=card&rally=finland&s=1&at=900&livery=works&car=kestrel&ang=-0.9&dist=9&fov=30`, `${new URL('../../store/', import.meta.url).pathname}feature-art.jpg`, 1024, 500)
} else {
  const out = new URL('../../store/screens/', import.meta.url).pathname
  mkdirSync(out, { recursive: true })
  // Gameplay with the HUD: drive with the autopilot a little, then capture.
  const shots = [
    ['phone-1-finland', 'r=0&s=1&skip=28'], ['phone-2-sweden-night', 'r=10&s=3&skip=20'],
    ['phone-3-kenya', 'r=1&s=2&skip=35'], ['phone-4-riviera-night', 'r=11&s=0&skip=30'],
    ['phone-5-wales-rain', 'r=6&s=0&skip=25'], ['phone-6-japan', 'r=9&s=1&skip=30'],
  ]
  for (const [name, q] of shots) await render(`${BASE}/dev.html?mode=stage&t=high&hud=1&${q}`, `${out}${name}.jpg`, 1920, 1080, 4000)
}
await browser.close()
