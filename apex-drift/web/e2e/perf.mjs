// Frame-time comparison in the software renderer (SwiftShader): absolute
// numbers mean nothing for a phone GPU, but before/after ratios on the same
// machine show what a change costs. Needs `npx vite --port 4180` running.
//   node e2e/perf.mjs [tier ...]
import { chromium } from 'playwright'

const tiers = process.argv.slice(2).length ? process.argv.slice(2) : ['low', 'medium']
const STAGES = [['finland', 0], ['wales', 6], ['japan', 9], ['monte', 11]]
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 915, height: 412 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
for (const tier of tiers) {
  for (const [name, r] of STAGES) {
    await page.goto(`http://localhost:${process.env.PORT ?? 4180}/dev.html?mode=stage&r=${r}&s=0&t=${tier}&skip=8`, { timeout: 180000 })
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
    await page.waitForTimeout(2500)
    const res = await page.evaluate(async () => {
      const { r, view } = window.__perf
      const world = view.world
      const upd = world.update.bind(world)
      const wt = []
      world.update = (...a) => {
        const t0 = performance.now()
        upd(...a)
        wt.push(performance.now() - t0)
      }
      const ft = []
      let calls = 0, tris = 0, n = 0
      await new Promise((done) => {
        let last = performance.now()
        const end = last + 8000
        const tick = (now) => {
          ft.push(now - last)
          last = now
          calls += r.gl.info.render.calls
          tris += r.gl.info.render.triangles
          n++
          if (now < end) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)]
      return { p50: q(ft, 0.5), p95: q(ft, 0.95), upd50: q(wt, 0.5), updMax: Math.max(...wt), calls: calls / n, tris: tris / n, loaded: world.loaded }
    })
    console.log(`${tier.padEnd(6)} ${name.padEnd(8)} frame p50 ${res.p50.toFixed(1)} p95 ${res.p95.toFixed(1)} ms | world.update p50 ${res.upd50.toFixed(2)} max ${res.updMax.toFixed(1)} ms | ${res.calls.toFixed(0)} draws ${(res.tris / 1000).toFixed(0)}k tris | ${res.loaded} pieces`)
  }
}
await browser.close()
