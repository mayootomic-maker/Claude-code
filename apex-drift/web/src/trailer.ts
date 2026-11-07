import * as THREE from 'three'
import { LIVERIES } from './data'
import { Renderer, StageView } from './render/view'
import { DT } from './sim/car'
import { FPS, makePlan, type Plan, type RunKey, type Shot } from './trailer/plan'
import { ease, type CamPose, type Rig } from './trailer/cams'
import { Fx } from './trailer/fx'
import { HERO_LIVERY, worldVel, type Run } from './trailer/hero'

/**
 * Offline trailer capture (dev only: trailer.html is not a build input).
 * Driven by scripts/trailer.mjs through Playwright: plan once, then for each
 * shot prepare it and ask for its frames one at a time. Game time advances
 * exactly 1/30 s per frame however long a frame takes to draw, so the footage
 * is smooth even on a software renderer.
 */

const canvas = document.getElementById('gl') as HTMLCanvasElement
const r = new Renderer(canvas, 'high')
// Warm-up frames run the whole frame (particles, tyre marks, camera springs) without drawing it.
let drawing = true
const draw = r.render.bind(r)
r.render = (...args: Parameters<Renderer['render']>) => {
  if (drawing) draw(...args)
}

let plan: Plan | null = null
let cur: { key: RunKey; view: StageView; fx: Fx } | null = null
let shot: Shot | null = null
let lastK = -1
let glass: { m: THREE.Material; o: number }[] = []
const cams: number[][] = []
const out2d = document.createElement('canvas')
const px = new Uint8Array(4)
const timing = { draw: 0, encode: 0, frames: 0 }

function log(s: string): void {
  console.log(`[trailer] ${s}`)
}

function viewFor(key: RunKey): { view: StageView; fx: Fx; run: Run } {
  if (!plan) throw new Error('plan first')
  const run = plan.runs[key]
  if (cur?.key === key) return { ...cur, run }
  if (cur) {
    cur.fx.dispose()
    cur.view.dispose()
    cur = null
  }
  const t0 = performance.now()
  const view = new StageView(run.sim, r, LIVERIES.find((l) => l.id === HERO_LIVERY) ?? LIVERIES[0])
  view.resize(innerWidth, innerHeight)
  const look = run.spec.rally.stages[run.spec.stageIdx].look
  if (look === 'sunset') sunsetGrade(view)
  if (look === 'night') nightGrade(view)
  // Fx draws the dust behind every car, the hero's too.
  view.dustOn = false
  const fx = new Fx(view.scene, run, view.atmos)
  fx.setViewport(canvas.height)
  cur = { key, view, fx }
  log(`built ${key} in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  return { view, fx, run }
}

/**
 * The sunset look is tuned for play, where the low sun behind the driver
 * lights the road ahead. The trailer's cameras look every way, often into
 * the sun with the scene in its own shadow, and there the game's grade (cool
 * shadows, a purple sky fill) comes out dark and violet. For the film: more
 * exposure, warm shadows, and a sky fill that carries the sunset's colour.
 */
function sunsetGrade(view: StageView): void {
  const a = view.atmos
  a.exposure *= 1.2
  a.grade = { ...a.grade, lift: [0.03, 0.018, 0.008], gain: [1.1, 1.0, 0.85], saturation: 1.08, contrast: 1.1, vignette: 0.34, shadowTint: [0.008, 0.0, -0.006], highTint: [0.032, 0.012, -0.018] }
  view.scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) {
      o.color.lerp(new THREE.Color(0xd9a27c), 0.6)
      o.groundColor.lerp(new THREE.Color(0x6b4a33), 0.5)
      o.intensity *= 1.2
    }
  })
}

/**
 * At night the game lights the road ahead of the player and little else. The
 * trailer's helicopter and roadside cameras see the whole valley, so the
 * moonlight fill is raised to where the land reads as shapes in blue.
 */
function nightGrade(view: StageView): void {
  view.atmos.exposure *= 1.15
  view.scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) o.intensity *= 1.7
  })
}

function rig(view: StageView): Rig {
  return { body: view.car.body, eye: view.car.eye ?? new THREE.Vector3(0.36, 1.05, -0.2), bonnet: view.car.bonnet ?? new THREE.Vector3(0, 0.95, 1.2) }
}

/** Draws (or, during warm-up, only advances) the frame at tape time t. */
function step(t: number, u: number): void {
  if (!shot || !cur || !plan) return
  const run = plan.runs[shot.run]
  const { view, fx } = cur
  const kf = t / DT
  const k = Math.max(1, Math.ceil(kf - 1e-6))
  run.tape.restore(run.cars, k, lastK < 0 || lastK >= k ? k : lastK + 1)
  lastK = k
  const alpha = 1 - (k - kf)
  const dt = 1 / FPS
  fx.update(dt)
  if (shot.cam.kind === 'drive') {
    view.camMode = shot.cam.mode
    if (drawing) view.world.prewarm(view.car.root.position)
    view.frame(alpha, dt, 'drive')
  } else {
    view.syncCar(alpha)
    const p: CamPose = shot.cam.fn(t, u, rig(view))
    view.setShot(p.pos, p.look, p.fov)
    if (p.roll) view.camera.rotateZ(p.roll)
    if (drawing) view.world.prewarm(p.pos)
    view.frame(alpha, dt, 'fixed')
  }
}

function title(alpha: number): string {
  const w = canvas.width, h = canvas.height
  out2d.width = w
  out2d.height = h
  const g = out2d.getContext('2d')
  if (!g) throw new Error('no 2d context')
  g.drawImage(canvas, 0, 0)
  const a = ease(alpha)
  g.save()
  g.globalAlpha = a
  g.translate(w / 2, h * 0.47)
  g.scale(1.06 - 0.06 * a, 1.06 - 0.06 * a)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = h * 0.03
  g.fillStyle = '#ffffff'
  const size = Math.round(h * 0.17)
  g.font = `italic 900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`
  const text = 'APEX DRIFT'
  // Hand-spaced letters: canvas letterSpacing is not everywhere yet.
  const gap = size * 0.08
  const widths = [...text].map((c) => g.measureText(c).width)
  const total = widths.reduce((s, x) => s + x, 0) + gap * (text.length - 1)
  let x = -total / 2
  ;[...text].forEach((c, i) => {
    g.fillText(c, x + widths[i] / 2, 0)
    x += widths[i] + gap
  })
  g.shadowBlur = 0
  g.fillStyle = '#e8432f'
  g.fillRect(-total / 2, size * 0.62, total * a, Math.max(2, size * 0.045))
  g.restore()
  return out2d.toDataURL('image/jpeg', 0.95)
}

const api = {
  /** Simulates every run, finds the moments and returns the shot list. Takes a minute or two. */
  plan(): unknown {
    const lines: string[] = []
    plan = makePlan((s) => {
      lines.push(s)
      log(s)
    })
    const p = plan
    return {
      log: lines,
      reports: p.reports,
      runs: Object.fromEntries((Object.keys(p.runs) as RunKey[]).map((k) => [k, { cars: p.runs[k].carIds, names: p.runs[k].names, stage: `${p.runs[k].spec.rally.name} / ${p.runs[k].spec.rally.stages[p.runs[k].spec.stageIdx].name}`, weather: p.runs[k].spec.rally.stages[p.runs[k].spec.stageIdx].weather, look: p.runs[k].spec.rally.stages[p.runs[k].spec.stageIdx].look, surface: p.runs[k].spec.rally.surface }])),
      shots: p.shots.map((s) => ({ name: s.name, run: s.run, t0: s.t0, dur: s.dur, frames: Math.round(s.dur * FPS), out: s.out, audio: s.audio, voice: s.voice ?? [], title: s.title ?? null, note: s.note, marks: s.marks ?? [], cam: s.cam.kind === 'drive' ? s.cam.mode : 'free' })),
    }
  },

  /** Builds the stage if needed and runs four seconds of warm-up so dust, tyre marks and camera springs are settled. */
  prepare(i: number): void {
    if (!plan) throw new Error('plan first')
    for (const g of glass) (g.m as THREE.Material & { opacity: number }).opacity = g.o
    glass = []
    shot = plan.shots[i]
    const { view } = viewFor(shot.run)
    view.outsideNear = shot.cam.kind === 'free' ? (shot.cam.near ?? 0.8) : 0.8
    if (shot.clearGlass) {
      view.car.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.transparent && m.opacity > 0.4 && m.opacity < 0.7) {
            glass.push({ m, o: m.opacity })
            m.opacity = 0.12
          }
        }
      })
    }
    cams.length = 0
    lastK = -1
    // The last warm-up frame is drawn and thrown away: it builds the scenery in view and compiles its shaders.
    const warm = Math.round(4 * FPS)
    for (let f = warm; f > 0; f--) {
      drawing = f === 1
      step(shot.t0 - f / FPS, 0)
      if (f === warm && shot.cam.kind === 'drive') view.snapCamera()
    }
    drawing = true
  },

  /** Renders frame f of the prepared shot and returns it as a JPEG data URL. */
  frame(f: number): string {
    if (!shot) throw new Error('prepare first')
    const u = shot.dur > 0 ? f / Math.max(1, Math.round(shot.dur * FPS) - 1) : 0
    const t = shot.t0 + f / FPS
    const a = performance.now()
    step(t, u)
    // Reading a pixel waits for the GPU (here, SwiftShader) to finish, so draw and encode are timed apart.
    r.gl.getContext().readPixels(0, 0, 1, 1, r.gl.getContext().RGBA, r.gl.getContext().UNSIGNED_BYTE, px)
    const b = performance.now()
    timing.draw += b - a
    const c = cur?.view.camera
    if (c) {
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion)
      const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion)
      cams.push([t, c.position.x, c.position.y, c.position.z, fw.x, fw.y, fw.z, rt.x, rt.y, rt.z])
    }
    if (shot.title !== undefined && t - shot.t0 >= shot.title) return title(Math.min(1, (t - shot.t0 - shot.title) / 1.4))
    const url = canvas.toDataURL('image/jpeg', 0.94)
    timing.encode += performance.now() - b
    timing.frames++
    return url
  },

  /** Profiling aid: ms per frame advancing without drawing, drawing, without shadow updates, and a bare scene render. */
  bench(n: number): Record<string, number> {
    if (!shot || !cur) throw new Error('prepare first')
    const sh = shot, view = cur.view
    const gl = r.gl.getContext()
    const time = (fn: () => void) => {
      const a = performance.now()
      for (let i = 0; i < n; i++) fn()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return Math.round((performance.now() - a) / n)
    }
    let f = 0
    const adv = () => step(sh.t0 + f++ / FPS, 0)
    drawing = false
    const noDraw = time(adv)
    drawing = true
    const full = time(adv)
    r.gl.shadowMap.autoUpdate = false
    const noShadow = time(adv)
    r.gl.shadowMap.autoUpdate = true
    const raw = time(() => r.gl.render(view.scene, view.camera))
    const info = r.gl.info.render
    return { noDraw, full, noShadow, raw, calls: info.calls, tris: info.triangles }
  },

  /** Milliseconds spent drawing and encoding since the last call. */
  timing(): { draw: number; encode: number; frames: number } {
    const t = { ...timing }
    timing.draw = timing.encode = timing.frames = 0
    return t
  },

  /**
   * What the sound is built from, for the shot just rendered: every car's
   * state at every physics step (from a second before the shot, so the engine
   * synth has settled) and the camera at every frame.
   */
  telemetry(i: number): unknown {
    if (!plan) throw new Error('plan first')
    const s = plan.shots[i]
    const run = plan.runs[s.run]
    const t = run.tape
    const k0 = Math.max(0, Math.floor((s.t0 - 1) / DT)), k1 = Math.min(t.steps - 1, Math.ceil((s.t0 + s.dur) / DT) + 2)
    const cars = run.cars.map((_, ci) => {
      const rows: (number | string)[][] = []
      for (let k = k0; k <= k1; k++) {
        const v = worldVel(run, ci, k)
        rows.push([
          k * DT, t.get(ci, 'x', k), t.get(ci, 'y', k), t.get(ci, 'z', k), v.x, v.z,
          t.get(ci, 'rpm', k), t.get(ci, 'throttleOut', k), t.get(ci, 'engineLoad', k), t.get(ci, 'gear', k), t.get(ci, 'shifting', k),
          t.get(ci, 'boost', k), t.surface(ci, k), t.get(ci, 'slipR', k), t.get(ci, 'wheelSpin', k), t.get(ci, 'airborne', k),
          t.get(ci, 'impact', k), t.get(ci, 'landed', k), k >= run.go ? 1 : 0,
        ].map((x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)))
      }
      return { id: run.carIds[ci], rows }
    })
    return {
      fields: ['t', 'x', 'y', 'z', 'vx', 'vz', 'rpm', 'throttle', 'load', 'gear', 'shifting', 'boost', 'surface', 'slip', 'spin', 'air', 'impact', 'landed', 'live'],
      t0: s.t0, dur: s.dur, audio: s.audio, weather: run.spec.rally.stages[run.spec.stageIdx].weather,
      cars, cams: cams.map((c) => c.map((x) => Math.round(x * 1000) / 1000)),
    }
  },
}

;(window as unknown as { __trailer: typeof api }).__trailer = api
