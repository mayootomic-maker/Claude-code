import * as THREE from 'three'
import { LIVERIES, RALLIES } from './data'
import { Showcase } from './render/showcase'
import { GeoBuilder } from './render/builder'
import { addAnimal } from './render/props'
import { rng } from './core/math'
import { Hud } from './ui/hud'
import { CoDriver } from './game/codriver'
import { paceNotes } from './game/pacenotes'
import { stageMedals } from './game/career'
import './styles.css'
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
if (q.get('mode') === 'zoo') {
  // Every animal in a row, for checking their shapes.
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true })
  gl.setSize(innerWidth, innerHeight, false)
  gl.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x9ec4e8)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  sun.position.set(5, 10, 6)
  scene.add(sun)
  const b = new GeoBuilder()
  const kinds = ['zebra', 'giraffe', 'moose', 'reindeer', 'sheep', 'cow', 'goat', 'deer', 'horse']
  kinds.forEach((k, i) => addAnimal(b, k, (i - 4) * 3.2, 0, 0, 1.2, rng(i + 3)))
  scene.add(new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true })))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 20).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7a9a5a }))
  scene.add(floor)
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200)
  cam.position.set(0, 4, 17)
  cam.lookAt(0, 1, 0)
  gl.render(scene, cam)
  w.__ready = true
} else if (q.get('mode') === 'car') {
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
  if (q.has('el')) {
    const el = (Number(q.get('el')) * Math.PI) / 180, d = Number(q.get('dist') ?? 8.5)
    sc.camera.position.set(0, 0.6 + Math.sin(el) * d, Math.cos(el) * d)
    sc.camera.lookAt(0, 0.6, 0)
  }
  let last = performance.now()
  const loop = (n: number) => {
    sc.render((n - last) / 1000)
    last = n
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  w.__ready = true
} else if (q.get('mode') === 'card') {
  // Menu art: the car parked on a good corner, framed from a low three-quarter angle.
  const rally = RALLIES.find((x) => x.id === q.get('rally')) ?? RALLIES[0]
  const stage = rally.stages[Number(q.get('s') ?? 0)]
  const r = new Renderer(canvas, (q.get('t') as Tier) ?? 'high')
  const sim = new StageSim({ rally, stage, car: q.get('car') ?? 'kestrel', difficulty: 'driver' })
  const view = new StageView(sim, r, LIVERIES.find((l) => l.id === q.get('livery')) ?? LIVERIES[0])
  view.resize(innerWidth, innerHeight)
  const at = Number(q.get('at') ?? 400)
  sim.car.place(at)
  view.syncCar(1)
  const a = sim.route.at(at)
  const ang = a.heading + Number(q.get('ang') ?? 0.75)
  const dist = Number(q.get('dist') ?? 7.5)
  view.camera.position.set(a.x + Math.sin(ang) * dist, a.y + Number(q.get('h') ?? 1.5), a.z + Math.cos(ang) * dist)
  view.camera.lookAt(a.x, a.y + 0.8, a.z)
  view.camera.fov = Number(q.get('fov') ?? 40)
  view.camera.updateProjectionMatrix()
  view.prewarm(view.camera.position)
  ;(window as unknown as { __perf: unknown }).__perf = { r, view, sim }
  let last = performance.now()
  const loop = (now: number) => {
    view.frame(1, Math.min(0.1, (now - last) / 1000), 'fixed')
    last = now
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
  if (q.has('nohorizon')) view.world.group.children[0].visible = false
  if (q.has('nosky')) view.scene.children[0].visible = false
  for (let i = 0; i < Number(q.get('skip') ?? 0) * 60; i++) sim.step(autopilot(sim, 0.85))
  view.syncCar(1)
  view.snapCamera()
  view.prewarm()
  // For e2e/perf.mjs: frame times, draw calls and world streaming cost.
  ;(window as unknown as { __perf: unknown }).__perf = { r, view, sim }
  // Optional HUD, exactly as in the game, for store screenshots.
  let hud: Hud | null = null
  let cd: CoDriver | null = null
  const gold = stageMedals(rally, Number(q.get('s') ?? 0), 'driver').gold
  if (q.has('hud')) {
    document.body.classList.add('touch')
    const root = document.createElement('section')
    root.id = 'hud'
    document.body.appendChild(root)
    hud = new Hud(root, false)
    hud.setStage(`${rally.name} · ${stage.name}`, sim)
    cd = new CoDriver(paceNotes(sim.route, sim.start, sim.finish), 'full')
    cd.seek(sim.car.s)
  }
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
    if (hud && cd) {
      hud.update(sim, gold)
      hud.showNote(cd.upcoming(sim.car.s))
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  w.__ready = true
}
