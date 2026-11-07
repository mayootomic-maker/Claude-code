import * as THREE from 'three'
import { clamp } from '../core/math'
import { RALLIES, type RallyDef } from '../data'
import type { CamMode } from '../render/view'
import { DT } from '../sim/car'
import { buildRoute } from '../sim/route'
import { RUN_IN, RUN_OUT } from '../sim/stage'
import { bestRun, slipAngle, speedAt, type HeroReport, type Run, type RunSpec } from './hero'
import { crane, mounted, orbit, post, routePoint, track, Tracks, type CamEnv, type CamFn } from './cams'

/**
 * The trailer's shot list. Nothing is placed by hand on a frame number: each
 * shot asks the recorded runs for a moment (the longest jump, the biggest
 * slide, the first overtake, the water splash, the finish) and frames it from
 * the road geometry there. If the world changes, the moments move with it.
 */

export type RunKey = 'race' | 'snow' | 'savannah' | 'forest' | 'night'

/** xfade transition names, as ffmpeg spells them. */
export type Transition = 'fade' | 'fadeblack' | 'smoothleft' | 'smoothright' | 'hblur' | 'dissolve'

export type AudioView = 'outside' | 'chase' | 'cockpit' | 'bonnet'

export interface Shot {
  name: string
  run: RunKey
  /** Tape time of the first frame, seconds. */
  t0: number
  dur: number
  cam: { kind: 'drive'; mode: CamMode } | { kind: 'free'; fn: CamFn; near?: number }
  audio: AudioView
  /** Into the next shot. */
  out: { type: Transition; dur: number }
  /** Co-driver words, seconds from the start of the shot. */
  voice?: { words: string[]; at: number }[]
  /** Clear the windscreen tint, to see the driver through it. */
  clearGlass?: boolean
  /** Seconds from the start of the shot when the title fades in. */
  title?: number
  /** What the shot shows, for the report. */
  note: string
  /** Story beats inside the shot, seconds from its start: the music hits on them. */
  marks?: { kind: 'go' | 'finish'; at: number }[]
}

/** Tempo of the soundtrack. Transitions are nudged onto its beats, and the launch lands on a downbeat. */
export const BPM = 124
export const FPS = 30

const rally = (id: string, fallback: number): RallyDef => RALLIES.find((r) => r.id === id) ?? RALLIES[fallback % RALLIES.length]

/** Which stage each part of the trailer is filmed on, chosen for its look: biome, weather and time of day. */
export function runSpecs(): Record<RunKey, RunSpec> {
  const kenya = rally('kenya', 1)
  return {
    race: { rally: rally('finland', 0), stageIdx: 3, race: true, style: 'fast' },
    snow: { rally: rally('sweden', 10), stageIdx: 0, race: false, style: 'drift', until: 3000 },
    savannah: { rally: kenya, stageIdx: 2, race: false, style: 'fast', until: featureReach(kenya, 2, 'splash', 1, 2600) },
    forest: { rally: rally('wales', 6), stageIdx: 0, race: false, style: 'fast', until: 2600 },
    night: { rally: rally('monte', 11), stageIdx: 0, race: false, style: 'fast', until: 3000 },
  }
}

/** Distance to simulate so that at least `count` features of a kind are included (plus room after the last). */
function featureReach(r: RallyDef, si: number, kind: 'splash', count: number, min: number): number {
  const st = r.stages[si] ?? r.stages[0]
  const route = buildRoute({ ...r, seed: st.seed, km: st.km + (RUN_IN + RUN_OUT) / 1000 })
  const list = route.features.filter((f) => f.kind === kind).map((f) => f.s1 - RUN_IN)
  const want = list[Math.min(count, list.length) - 1]
  return Math.max(min, want !== undefined ? want + 500 : min)
}

// ------------------------------------------------------------------ analysis

/** Per-step hero telemetry and a claim list, so two shots never reuse the same stretch. */
class Moments {
  readonly n: number
  readonly s: Float32Array
  readonly v: Float32Array
  readonly beta: Float32Array
  readonly air: Uint8Array
  readonly curv: Float32Array
  readonly steer: Float32Array
  private readonly used: [number, number][] = []

  constructor(readonly run: Run) {
    const t = run.tape
    this.n = t.steps
    this.s = new Float32Array(this.n)
    this.v = new Float32Array(this.n)
    this.beta = new Float32Array(this.n)
    this.air = new Uint8Array(this.n)
    this.curv = new Float32Array(this.n)
    this.steer = new Float32Array(this.n)
    for (let k = 0; k < this.n; k++) {
      this.s[k] = t.get(0, 's', k)
      this.v[k] = speedAt(run, 0, k)
      this.beta[k] = slipAngle(run, 0, k)
      this.air[k] = t.get(0, 'airborne', k) ? 1 : 0
      this.curv[k] = run.sim.route.at(this.s[k]).curv
      this.steer[k] = t.get(0, 'steerAngle', k)
    }
  }

  /** Steps the hero is racing on the stage (after the start, before the finish), less a margin. */
  get range(): [number, number] {
    return [this.run.go + 60, this.run.end]
  }

  free(k0: number, k1: number): boolean {
    return !this.used.some(([a, b]) => k0 < b && k1 > a)
  }

  claim(t0: number, dur: number): void {
    this.used.push([Math.floor(t0 / DT) - 30, Math.ceil((t0 + dur) / DT) + 30])
  }

  /** Start step of the unclaimed window of `len` seconds with the highest total score. */
  best(len: number, score: (k: number) => number, from = this.range[0], to = this.range[1]): number {
    const L = Math.round(len / DT)
    const pre = new Float64Array(this.n + 1)
    for (let k = 0; k < this.n; k++) pre[k + 1] = pre[k] + (k >= from && k <= to ? score(k) : -1e3)
    let bestK = from, bestV = -Infinity
    for (let k = Math.max(0, from); k + L < Math.min(this.n, to + 1); k += 3) {
      if (!this.free(k, k + L)) continue
      const v = pre[k + L] - pre[k]
      if (v > bestV) {
        bestV = v
        bestK = k
      }
    }
    return bestK
  }

  /** Airborne spells: [takeoff step, landing step], longest first. */
  jumps(): [number, number][] {
    const out: [number, number][] = []
    for (let k = this.range[0]; k < this.range[1]; k++) {
      if (!this.air[k] || this.air[k - 1]) continue
      let e = k
      while (e < this.n - 1 && this.air[e]) e++
      if (e - k > 12) out.push([k, e])
      k = e
    }
    return out.sort((a, b) => (b[1] - b[0]) * this.v[b[0]] - (a[1] - a[0]) * this.v[a[0]])
  }
}

/** A tape time window clamped into the recording. */
function fit(run: Run, t0: number, dur: number): number {
  return clamp(t0, 0, (run.tape.steps - 2) * DT - dur)
}

// ------------------------------------------------------------------ the list

export interface Plan {
  runs: Record<RunKey, Run>
  reports: HeroReport[]
  shots: Shot[]
}

export function makePlan(log: (s: string) => void): Plan {
  const specs = runSpecs()
  const runs = {} as Record<RunKey, Run>
  const reports: HeroReport[] = []
  for (const key of Object.keys(specs) as RunKey[]) {
    const t0 = performance.now()
    log(`run ${key}: ${specs[key].rally.name} / ${specs[key].rally.stages[specs[key].stageIdx].name}`)
    const { run, report } = bestRun(specs[key], log)
    runs[key] = run
    reports.push(report)
    log(`  hero ${report.heroTime.toFixed(2)} s, pro ${report.proTime.toFixed(2)} s, top rung ${report.topTime.toFixed(2)} s over ${report.metres} m (${((performance.now() - t0) / 1000).toFixed(1)} s)`)
  }
  const shots: Shot[] = []
  // One claim list for the race across both acts, so the finish never reuses a stretch from the start.
  const raceM = new Moments(runs.race)
  const env = (k: RunKey): CamEnv => ({ run: runs[k], tracks: new Tracks(runs[k]) })
  const add = (s: Shot, m: Moments) => {
    s.t0 = fit(m.run, s.t0, s.dur)
    m.claim(s.t0, s.dur)
    shots.push(s)
  }

  // ---- Act 1: the race start, Finland at sunset -------------------------
  {
    const e = env('race'), r = runs.race, m = raceM
    const go = r.go * DT
    const start = r.sim.start
    const front = routePoint(e, start - 6)
    const gridMid = routePoint(e, start - 12.5, 0, 0.7)
    // Drone over the grid as the countdown runs, settling low in front of the field.
    add({
      name: 'grid-drone', run: 'race', t0: go - 4.7, dur: 4.4,
      cam: { kind: 'free', fn: crane(e, routePoint(e, start + 30, 7, 17), routePoint(e, start + 10, -2.2, 1.9), () => gridMid.clone().lerp(front, 0.2), [46, 52]) },
      audio: 'outside', out: { type: 'fade', dur: 0.12 },
      voice: [{ words: ['3'], at: 1.7 }, { words: ['2'], at: 2.7 }, { words: ['1'], at: 3.7 }],
      note: 'drone over the four-car grid during the countdown',
    }, m)
    // Low by the start gantry as the field launches past.
    // Just off the verge ahead of the grid, the field coming at the lens and past it.
    const launchCam = routePoint(e, start + 16, r.sim.route.half + 1.1, 0.75)
    const centroid = (t: number) => {
      const p = new THREE.Vector3()
      for (let i = 0; i < r.cars.length; i++) p.add(e.tracks.pos(i, t, 0.15))
      return p.multiplyScalar(1 / r.cars.length).add(new THREE.Vector3(0, 0.7, 0))
    }
    add({
      name: 'launch-low', run: 'race', t0: go - 0.3, dur: 3.2,
      cam: { kind: 'free', fn: crane(e, launchCam, launchCam.clone().add(new THREE.Vector3(0, 0.15, 0)), centroid, [54, 58], 0.4) },
      audio: 'outside', out: { type: 'fade', dur: 0.4 },
      voice: [{ words: ['go'], at: 0.3 }], marks: [{ kind: 'go', at: 0.3 }],
      note: 'low static at the start line, the field launches past',
    }, m)
    add({
      name: 'pack-chase', run: 'race', t0: go + 2.9, dur: 3.4,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [0.15, 15, 7.5], to: [0.35, 9, 3.4], fov: [50, 56], refT: go + 4, follow: 1 }) },
      audio: 'chase', out: { type: 'smoothleft', dur: 0.35 },
      note: 'helicopter chase behind the pack, the hero starting from the back',
    }, m)
    // Overtakes: the hero's distance along the road passing a rival's.
    const passes: { k: number; ci: number; side: number }[] = []
    for (let ci = 1; ci < r.cars.length; ci++) {
      for (let k = r.go + 120; k < r.end; k++) {
        const a = r.tape.get(0, 's', k - 1) - r.tape.get(ci, 's', k - 1)
        const b = r.tape.get(0, 's', k) - r.tape.get(ci, 's', k)
        if (a < 0 && b >= 0) passes.push({ k, ci, side: Math.sign(r.tape.get(0, 'd', k) - r.tape.get(ci, 'd', k)) || 1 })
      }
    }
    passes.sort((a, b) => a.k - b.k)
    log(`  race: ${passes.length} overtakes at ${passes.map((p) => (p.k * DT).toFixed(1)).join(', ')} s; hero place ${r.place}`)
    const p1 = passes.find((p) => p.k * DT > go + 7.5) ?? passes[0]
    if (p1) {
      add({
        name: 'overtake-track', run: 'race', t0: p1.k * DT - 2.1, dur: 3.8,
        cam: { kind: 'free', fn: track(e, { ci: 0, pair: p1.ci, from: [p1.side * 4.6, 0.9, -8], to: [p1.side * 4.2, 1.5, 3.5], lookAhead: 0.5, fov: [46, 54] }) },
        audio: 'outside', out: { type: 'fade', dur: 0.4 },
        note: `wheel-to-wheel: the hero passes ${r.names[p1.ci]}, tracking alongside`,
      }, m)
    }
    // Contact between the hero and a rival, if the race had any; otherwise the next pass from the helicopter.
    let bump = -1
    for (let k = r.go; k < r.end && bump < 0; k++) {
      if (r.tape.get(0, 'impact', k) < 0.8) continue
      for (let ci = 1; ci < r.cars.length; ci++) {
        const d = Math.hypot(r.tape.get(0, 'x', k) - r.tape.get(ci, 'x', k), r.tape.get(0, 'z', k) - r.tape.get(ci, 'z', k))
        if (d < 5 && m.free(k - 150, k + 60)) bump = k
      }
    }
    const p2 = passes.find((p) => m.free(p.k - 150, p.k + 60))
    const k2 = bump >= 0 ? bump : p2 ? p2.k : m.best(3.2, (k) => m.v[k]) + 100
    log(`  race: contact ${bump >= 0 ? `at ${(bump * DT).toFixed(1)} s` : 'none'}`)
    add({
      name: bump >= 0 ? 'contact-heli' : 'overtake-heli', run: 'race', t0: k2 * DT - 1.8, dur: 3.2,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [0.9, 17, 10], to: [1.5, 12, 6], fov: [44, 48], refT: k2 * DT, follow: 0.8 }) },
      audio: 'outside', out: { type: 'hblur', dur: 0.3 },
      note: bump >= 0 ? 'helicopter: door-to-door contact with a rival' : 'helicopter: another overtake',
    }, m)
    // On the bonnet, closing on a rival ahead.
    const behind = (k: number) => {
      let best = 0
      for (let ci = 1; ci < r.cars.length; ci++) {
        const gap = r.tape.get(ci, 's', k) - r.tape.get(0, 's', k)
        if (gap > 5 && gap < 28) best = Math.max(best, 1 - Math.abs(gap - 12) / 16)
      }
      return best
    }
    const kb = m.best(3.0, behind)
    add({
      name: 'race-bonnet', run: 'race', t0: kb * DT, dur: 3.0,
      cam: { kind: 'drive', mode: 'bonnet' }, audio: 'bonnet', out: { type: 'fadeblack', dur: 1.0 },
      note: 'bonnet camera, closing on a rival',
    }, m)
  }

  // ---- Act 2: the rallies --------------------------------------------------
  {
    // Sweden: snow, drifting.
    const e = env('snow'), r = runs.snow, m = new Moments(r)
    const slide = (k: number) => (m.v[k] > 9 ? Math.max(0, Math.abs(m.beta[k]) - 0.1) * m.v[k] : 0)
    const d1 = m.best(4.2, slide) * DT
    add({
      name: 'snow-drone', run: 'snow', t0: d1, dur: 4.2,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [-1.2, 40, 34], to: [-0.55, 15, 11], fov: [50, 46], refT: d1 + 2.1, follow: 0.35, sigma: 0.7 }) },
      audio: 'outside', out: { type: 'fade', dur: 0.5 },
      note: 'Sweden, snow: aerial descent onto a long handbrake drift',
    }, m)
    // Not where the road runs between snow walls: from the roadside the wall fills the frame.
    const walled = (x: number) => r.sim.route.narrow.some((nr) => x > nr.s0 - 60 && x < nr.s1 + 60)
    const k2 = m.best(3.4, (k) => (walled(m.s[k] + 18) ? 0 : slide(k)))
    const mid2 = k2 + Math.round(2.1 / DT)
    // Stand on the outside of the corner the car is sliding through.
    const c2 = m.curv[mid2] || m.curv[k2 + 60]
    add({
      name: 'snow-tele', run: 'snow', t0: k2 * DT, dur: 3.4,
      cam: { kind: 'free', fn: post(e, { ci: 0, s: m.s[mid2] + 18, side: c2 > 0 ? -1 : 1, back: 8, h: 3.6, frame: 15 }) },
      audio: 'outside', out: { type: 'hblur', dur: 0.3 },
      note: 'roadside telephoto from the outside of a drift, snow spray',
    }, m)
    const k3 = m.best(3.4, slide)
    add({
      name: 'snow-cockpit', run: 'snow', t0: k3 * DT, dur: 3.4,
      cam: { kind: 'drive', mode: 'cockpit' }, audio: 'cockpit', out: { type: 'fadeblack', dur: 0.9 },
      note: 'cockpit: hands on the wheel, countersteering, camera shake',
    }, m)
  }
  {
    // Kenya: savannah at golden hour, the water splash.
    const e = env('savannah'), r = runs.savannah, m = new Moments(r)
    const straight = (k: number) => (Math.abs(m.curv[k]) < 1 / 350 ? m.v[k] : 0)
    const ks = m.best(3.4, straight)
    const sEnd = m.s[Math.min(m.n - 1, ks + Math.round(3.4 / DT))]
    add({
      name: 'savannah-tele', run: 'savannah', t0: ks * DT, dur: 3.4,
      cam: { kind: 'free', fn: post(e, { ci: 0, s: sEnd + 55, side: 1, back: 0.5, h: 1.2, frame: 9, lead: 2 }) },
      audio: 'outside', out: { type: 'fade', dur: 0.4 },
      note: 'Kenya, golden hour: long lens head-on down a fast straight',
    }, m)
    const splash = r.sim.route.features.find((f) => f.kind === 'splash' && f.s0 > r.sim.start + 50 && f.s1 < m.s[r.end])
    let kw = -1
    if (splash) for (let k = r.go; k < r.end && kw < 0; k++) if (m.s[k] >= splash.s0) kw = k
    if (splash && kw > 0) {
      const sc = splash.s0 + 9
      add({
        name: 'splash-low', run: 'savannah', t0: kw * DT - 1.7, dur: 3.0,
        cam: { kind: 'free', fn: post(e, { ci: 0, s: sc, side: m.curv[kw] > 0 ? -1 : 1, edge: true, h: 0.6, fov: [50, 42], lookUp: 0.5 }) },
        audio: 'outside', out: { type: 'smoothright', dur: 0.35 },
        voice: [{ words: ['watersplash'], at: 0.15 }],
        note: 'low by the water splash as the car charges through',
      }, m)
    } else log('  savannah: no water splash on the simulated stretch; skipped')
    const kd = m.best(3.0, (k) => (m.v[k] > 14 ? Math.abs(m.steer[k]) * 3 + m.v[k] * 0.02 : 0))
    add({
      name: 'driver-closeup', run: 'savannah', t0: kd * DT, dur: 3.0,
      cam: {
        kind: 'free', near: 0.05,
        fn: mounted(
          (g) => g.eye.clone().add(new THREE.Vector3(-g.eye.x * 0.6, -0.04, 2.45)),
          (g) => g.eye.clone().add(new THREE.Vector3(0, -0.1, 0)),
          36,
        ),
      },
      audio: 'outside', clearGlass: true, out: { type: 'fade', dur: 0.4 },
      note: 'the driver through the windscreen: helmet, arms working the wheel',
    }, m)
    const ko = m.best(3.6, (k) => (Math.abs(m.curv[k]) < 1 / 200 ? m.v[k] : 0))
    add({
      name: 'savannah-orbit', run: 'savannah', t0: ko * DT, dur: 3.6,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [0.5, 7.5, 1.3], to: [2.4, 7.5, 1.9], fov: [46, 46], refT: ko * DT + 1.8, follow: 1, sigma: 0.35 }) },
      audio: 'outside', out: { type: 'fadeblack', dur: 0.9 },
      note: 'tracking orbit round the car at speed',
    }, m)
  }
  {
    // Wales: forest in the rain.
    const e = env('forest'), m = new Moments(runs.forest)
    const kf = m.best(3.0, (k) => m.v[k])
    add({
      name: 'rain-bonnet', run: 'forest', t0: kf * DT, dur: 3.0,
      cam: { kind: 'drive', mode: 'bonnet' }, audio: 'bonnet', out: { type: 'fade', dur: 0.4 },
      note: 'Wales, rain: bonnet camera flat out between the trees',
    }, m)
    const kc = m.best(3.4, (k) => Math.min(1 / 25, Math.abs(m.curv[k])) * m.v[k])
    const sp = m.s[kc] + 40 + Math.min(55, m.v[kc] * 1.5)
    add({
      name: 'rain-trackside', run: 'forest', t0: kc * DT, dur: 3.4,
      cam: { kind: 'free', fn: post(e, { ci: 0, s: sp, side: m.curv[kc] > 0 ? -1 : 1, h: 1.7, frame: 11 }) },
      audio: 'outside', out: { type: 'smoothleft', dur: 0.3 },
      note: 'trackside in the forest, zooming out as the car arrives',
    }, m)
    const kw = m.best(2.6, (k) => m.v[k])
    add({
      name: 'rain-wheel', run: 'forest', t0: kw * DT, dur: 2.6,
      cam: {
        kind: 'free', near: 0.1,
        fn: mounted(() => new THREE.Vector3(1.28, 0.42, -0.55), () => new THREE.Vector3(0.75, 0.3, 9), 68),
      },
      audio: 'outside', out: { type: 'fadeblack', dur: 1.0 },
      note: 'low wheel-arch camera, spray off the tyres',
    }, m)
  }
  {
    // Riviera Alps: tarmac mountain road at night, headlights.
    const e = env('night'), m = new Moments(runs.night)
    const kh = m.best(4.0, (k) => Math.min(1 / 15, Math.abs(m.curv[k])))
    add({
      name: 'night-heli', run: 'night', t0: kh * DT, dur: 4.0,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [1.1, 24, 22], to: [0.45, 17, 15], fov: [46, 42], refT: kh * DT + 2, follow: 0.6, sigma: 0.6 }) },
      audio: 'outside', out: { type: 'fade', dur: 0.5 },
      note: 'Riviera Alps at night: helicopter over the hairpins, headlights on the tarmac',
    }, m)
    const kn = m.best(3.0, (k) => m.v[k])
    add({
      name: 'night-near', run: 'night', t0: kn * DT, dur: 3.0,
      cam: { kind: 'drive', mode: 'near' }, audio: 'chase', out: { type: 'hblur', dur: 0.3 },
      note: 'close chase camera on the mountain road',
    }, m)
    const kt = m.best(3.0, (k) => m.v[k] * 0.5 + Math.abs(m.curv[k]) * 200)
    add({
      name: 'night-front', run: 'night', t0: kt * DT, dur: 3.0,
      cam: { kind: 'free', fn: track(e, { ci: 0, from: [1.3, 0.75, -8.5], to: [0.9, 0.85, -6.5], lookAhead: 0, lookUp: 0.55, fov: [44, 48] }) },
      audio: 'outside', out: { type: 'fadeblack', dur: 1.0 },
      note: 'low front tracking shot into the headlights',
    }, m)
  }

  // ---- Act 3: back to the race: the jumps, the lake, the finish -----------
  {
    // Finland's crests: the hero flat out over the jumps it can take flat.
    const e = env('race'), m = raceM
    const js = m.jumps()
    log(`  jumps: ${js.length} airborne spells, longest ${js.length ? ((js[0][1] - js[0][0]) * DT).toFixed(2) : 0} s`)
    const pick = () => {
      const j = js.find(([a, b]) => m.free(a - 100, b + 80))
      if (j) return j
      const k = m.best(3, (q) => m.v[q])
      return [k + 90, k + 100] as [number, number]
    }
    const [a1, b1] = pick()
    // A camera that pans to follow the car away ends the shot on whatever stands beside it (a tree,
    // a marker post): this one holds on the flight, turning only a little toward the car.
    const flight = routePoint(e, (m.s[a1] + m.s[b1]) / 2, 0, 1.6)
    const lowCam = routePoint(e, m.s[a1] + 8, e.run.sim.route.half + 1.6, 1.3)
    add({
      name: 'jump-low', run: 'race', t0: a1 * DT - 1.6, dur: 3.0,
      cam: { kind: 'free', fn: crane(e, lowCam, lowCam, (t) => flight.clone().lerp(e.tracks.pos(0, t, 0.14).add(new THREE.Vector3(0, 0.9, 0)), 0.4), [56, 52], 1.1) },
      audio: 'outside', out: { type: 'fade', dur: 0.3 },
      voice: [{ words: ['jump'], at: 0.1 }],
      note: 'Finland: low beyond the biggest crest, the car flies over it toward the lens',
    }, m)
    const [a2] = pick()
    add({
      name: 'jump-side', run: 'race', t0: a2 * DT - 1.3, dur: 3.0,
      cam: { kind: 'free', fn: track(e, { ci: 0, from: [9, 1.0, -3], to: [9, 1.5, 2.5], lookAhead: 1, fov: [40, 44] }) },
      audio: 'outside', out: { type: 'fade', dur: 0.4 },
      note: 'side tracking over a jump: the landing loads the suspension',
    }, m)
    const [a3] = pick()
    add({
      name: 'jump-chase', run: 'race', t0: a3 * DT - 1.6, dur: 3.0,
      cam: { kind: 'drive', mode: 'chase' }, audio: 'chase', out: { type: 'fade', dur: 0.4 },
      note: 'chase camera over a crest, the landing kick',
    }, m)
  }
  {
    const e = env('race'), r = runs.race, m = raceM
    const ground = r.sim.ground
    // Somewhere along the run with a lake in view, before the run-in to the finish.
    const lake = (k: number) => {
      if (k % 30) return 0
      const x = r.tape.get(0, 'x', k), z = r.tape.get(0, 'z', k)
      let n = 0
      for (let a = 0; a < 8; a++) for (const d of [25, 45, 70]) if (ground.water(x + Math.sin(a) * d, z + Math.cos(a) * d) !== null) n++
      return n * 30 + m.v[k] * 0.5
    }
    const kl = m.best(4.0, lake, r.go + Math.round(20 / DT), r.end - Math.round(9 / DT))
    add({
      name: 'lake-drone', run: 'race', t0: kl * DT, dur: 4.0,
      cam: { kind: 'free', fn: orbit(e, { ci: 0, from: [1.5, 26, 22], to: [1.05, 14, 15], fov: [48, 44], refT: kl * DT + 2, follow: 0.5, sigma: 0.7 }) },
      audio: 'outside', out: { type: 'fade', dur: 0.5 },
      voice: [{ words: ['flyingfinish'], at: 2.6 }],
      note: 'Finland: drone along the lakeshore, the hero leading',
    }, m)
    const fin = r.end * DT
    add({
      name: 'finish-tele', run: 'race', t0: fin - 2.7, dur: 3.4,
      cam: { kind: 'free', fn: post(e, { ci: 0, s: r.sim.finish + 62, side: 1, back: -0.5, h: 2.0, frame: 13, lead: 1 }) },
      audio: 'outside', out: { type: 'fade', dur: 0.6 }, marks: [{ kind: 'finish', at: 2.7 }],
      note: 'telephoto at the finish gantry as the hero takes the win',
    }, m)
    const tOut = fin + 0.5
    const target = (t: number) => {
      const c = e.tracks.pos(0, t, 0.4).add(new THREE.Vector3(0, 0.8, 0))
      const u = clamp((t - tOut) / 5.6, 0, 1)
      const sky = routePoint(e, r.sim.finish + 260, 0, 60)
      return c.lerp(sky, u * u * 0.55)
    }
    const c0 = e.tracks.pos(0, tOut, 0.4)
    const f0 = e.tracks.dir(0, tOut)
    const l0 = new THREE.Vector3(f0.z, 0, -f0.x)
    add({
      name: 'outro-rise', run: 'race', t0: tOut, dur: 6.0,
      cam: {
        kind: 'free',
        fn: crane(e, c0.clone().addScaledVector(f0, 7).addScaledVector(l0, 4).add(new THREE.Vector3(0, 1.4, 0)),
          c0.clone().addScaledVector(f0, 46).addScaledVector(l0, 16).add(new THREE.Vector3(0, 26, 0)), target, [50, 56]),
      },
      audio: 'outside', out: { type: 'fade', dur: 0 }, title: 2.2,
      voice: [{ words: ['wellDone'], at: 1.6 }],
      note: 'crane up and away over the finish into the sky; title',
    }, m)
  }
  snapToBeats(shots)
  return { runs, reports, shots }
}

/** Where each shot starts on the finished timeline, seconds. */
export function timeline(shots: readonly { dur: number; out: { dur: number } }[]): number[] {
  const at: number[] = []
  let t = 0
  for (const s of shots) {
    at.push(t)
    t += s.dur - s.out.dur
  }
  return at
}

/**
 * Cut on the music: every transition after the launch is moved, by less than
 * half a beat, so its midpoint falls on a beat of a grid anchored on the
 * launch. Shot lengths and transitions are whole frames.
 */
function snapToBeats(shots: Shot[]): void {
  const frames = (x: number) => Math.round(x * FPS) / FPS
  for (const s of shots) {
    s.dur = frames(s.dur)
    s.out.dur = frames(s.out.dur)
  }
  const launch = shots.findIndex((s) => s.marks?.some((m) => m.kind === 'go'))
  if (launch < 0) return
  const beat = 60 / BPM
  const anchor = () => timeline(shots)[launch] + (shots[launch].marks?.find((m) => m.kind === 'go')?.at ?? 0)
  const a = anchor()
  for (let i = launch; i < shots.length - 1; i++) {
    const at = timeline(shots)
    const mid = at[i] + shots[i].dur - shots[i].out.dur / 2
    const want = a + Math.round((mid - a) / beat) * beat
    shots[i].dur = frames(Math.max(1.5, shots[i].dur + want - mid))
  }
}
