import * as THREE from 'three'
import { LIVERIES, RALLIES } from './data'
import { Showcase } from './render/showcase'
import { Renderer, StageView, type Tier } from './render/view'
import { DT } from './sim/car'
import { autopilot, StageSim } from './sim/stage'

/**
 * Dev-only views for checking the renderer and making store art. Not part
 * of the production build (vite builds index.html only).
 *   ?mode=stage&r=0&s=0&skip=20&t=medium   drive with the autopilot
 *   ?mode=car&car=kestrel&livery=works&a=0.6  turntable
 */
const q = new URLSearchParams(location.search)
const canvas = document.getElementById('gl') as HTMLCanvasElement
const w = window as unknown as { __ready: boolean }
if (q.get('mode') === 'car') {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true })
  gl.setPixelRatio(Math.min(2, devicePixelRatio))
  gl.setSize(innerWidth, innerHeight, false)
  gl.shadowMap.enabled = true
  gl.outputColorSpace = THREE.SRGBColorSpace
  const sc = new Showcase(gl)
  sc.setCar(q.get('car') ?? 'kestrel', LIVERIES.find((l) => l.id === q.get('livery')) ?? LIVERIES[0])
  sc.angle = Number(q.get('a') ?? 0.6)
  sc.spin = Number(q.get('spin') ?? 0)
  sc.resize(innerWidth, innerHeight)
  let last = performance.now()
  const loop = (n: number) => {
    sc.render((n - last) / 1000)
    last = n
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  w.__ready = true
} else {
  const rally = RALLIES[Number(q.get('r') ?? 0)]
  const stage = rally.stages[Number(q.get('s') ?? 0)]
  const r = new Renderer(canvas, (q.get('t') as Tier) ?? 'medium')
  const sim = new StageSim({ rally, stage, car: q.get('car') ?? 'kestrel', difficulty: 'driver' })
  const view = new StageView(sim, r, LIVERIES.find((l) => l.id === q.get('livery')) ?? LIVERIES[0])
  view.resize(innerWidth, innerHeight)
  for (let i = 0; i < Number(q.get('skip') ?? 0) * 60; i++) sim.step(autopilot(sim, 0.85))
  view.syncCar(1)
  view.snapCamera()
  view.prewarm()
  let acc = 0, last = performance.now()
  const still = q.has('still')
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    acc += still ? 0 : dt
    while (acc >= DT) {
      sim.step(autopilot(sim, 0.85))
      acc -= DT
    }
    view.frame(acc / DT, dt, q.get('cam') === 'orbit' ? 'orbit' : 'drive')
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  w.__ready = true
}
