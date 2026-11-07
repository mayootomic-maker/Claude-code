import * as THREE from 'three'
import { clamp, lerp, noise2 } from '../core/math'
import { BODY } from '../sim/terrain'
import { DT } from '../sim/car'
import type { Run } from './hero'

/**
 * Camera moves for the trailer. Every camera is a pure function of time on a
 * run's tape, so a frame can be rendered in any order and twice gives the same
 * picture. Targets come from a zero-phase smoothed copy of each car's path: a
 * camera that follows the raw physics position inherits every bump and
 * jitters; one that follows the smoothed path glides, while the car itself
 * still visibly works over the road under it.
 */

export interface CamPose {
  pos: THREE.Vector3
  look: THREE.Vector3
  fov: number
  /** Dutch angle, radians. */
  roll: number
}

/** The hero's body transform at the frame being drawn, for cameras mounted on the car. */
export interface Rig {
  body: THREE.Object3D
  eye: THREE.Vector3
  bonnet: THREE.Vector3
}

export type CamFn = (t: number, u: number, rig: Rig) => CamPose

/** Smooth start and stop with zero acceleration at both ends: no bump at a cut or at rest. */
export const ease = (u: number): number => {
  const x = clamp(u, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
/** Ease out only: a move that is already travelling when the shot opens (continuity from the last shot). */
export const easeOut = (u: number): number => 1 - (1 - clamp(u, 0, 1)) ** 3

const shakeNoise = noise2(77)

export class Tracks {
  private readonly cache = new Map<string, Float32Array[]>()
  constructor(readonly run: Run) {}

  /** Gaussian-smoothed x, y, z of car `ci`, sigma in seconds. */
  private smooth(ci: number, sigma: number): Float32Array[] {
    const key = `${ci}:${sigma}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const t = this.run.tape
    const n = t.steps
    const raw = ['x', 'y', 'z'].map((k) => {
      const a = new Float32Array(n)
      for (let i = 0; i < n; i++) a[i] = t.get(ci, k, i)
      return a
    })
    const sd = sigma / DT
    const r = Math.ceil(sd * 3)
    const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sd * sd)))
    const out = raw.map((a) => {
      const o = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let sum = 0, ws = 0
        for (let j = -r; j <= r; j++) {
          const k = i + j
          if (k < 0 || k >= n) continue
          sum += a[k] * w[j + r]
          ws += w[j + r]
        }
        o[i] = sum / ws
      }
      return o
    })
    this.cache.set(key, out)
    return out
  }

  /** Smoothed position of car `ci` at time `t` (seconds on the tape). */
  pos(ci: number, t: number, sigma = 0.18, out = new THREE.Vector3()): THREE.Vector3 {
    const [x, y, z] = this.smooth(ci, sigma)
    const f = clamp(t / DT, 0, x.length - 1.001)
    const i = Math.floor(f), u = f - i
    return out.set(lerp(x[i], x[i + 1], u), lerp(y[i], y[i + 1], u), lerp(z[i], z[i + 1], u))
  }

  /** Direction of travel of car `ci`, from its smoothed path (stable through a slide). */
  dir(ci: number, t: number, sigma = 0.35): THREE.Vector3 {
    const a = this.pos(ci, t - 0.15, sigma), b = this.pos(ci, t + 0.15, sigma)
    const d = b.sub(a)
    d.y = 0
    if (d.lengthSq() < 1e-4) {
      const h = this.run.tape.get(ci, 'heading', t / DT)
      return new THREE.Vector3(Math.sin(h), 0, Math.cos(h))
    }
    return d.normalize()
  }

  /** Distance along the route of car `ci`. */
  s(ci: number, t: number): number {
    return this.run.tape.get(ci, 's', t / DT)
  }
}

export interface CamEnv {
  run: Run
  tracks: Tracks
}

const ground = (e: CamEnv, x: number, z: number): number => e.run.sim.ground.height(x, z)
/** Distance from the centreline that scenery placement keeps free of trees, rocks and walls. */
export const clearAt = (e: CamEnv, s: number): number => e.run.sim.ground.limitAt(s) + BODY + 0.8
const leftOf = (h: number) => new THREE.Vector3(Math.cos(h), 0, -Math.sin(h))
const fwdOf = (h: number) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h))

/**
 * Keeps a low camera out of the scenery: within the cleared strip either side
 * of the road while it is below the treetops, and always above the ground.
 */
function keepClear(e: CamEnv, p: THREE.Vector3, min: number): THREE.Vector3 {
  const route = e.run.sim.route
  const c = route.closest(p.x, p.z, 400)
  const g = ground(e, p.x, p.z)
  if (c && p.y - g < 14) {
    const lim = clearAt(e, c.s)
    if (Math.abs(c.d) > lim) {
      const a = route.at(c.s)
      const d = Math.sign(c.d) * lim
      p.x = a.x + Math.cos(a.heading) * d
      p.z = a.z - Math.sin(a.heading) * d
    }
  }
  p.y = Math.max(p.y, ground(e, p.x, p.z) + min)
  return p
}

/** A slow, small handheld/helicopter drift: a few centimetres and a fraction of a degree. */
function drift(t: number, amount: number, seed: number): { x: number; y: number; roll: number } {
  return {
    x: shakeNoise(t * 0.7, seed) * amount,
    y: shakeNoise(seed, t * 0.6) * amount * 0.7,
    roll: shakeNoise(t * 0.5 + 9, seed + 3) * amount * 0.012,
  }
}

// ------------------------------------------------------------------ moves

export interface TrackOpts {
  ci: number
  /** Offsets in the car's direction-of-travel frame at the start and end of the shot: side (+ left), up, back. */
  from: [number, number, number]
  to: [number, number, number]
  lookAhead?: number
  lookUp?: number
  fov: [number, number]
  /** Look at the midpoint of this car and `ci`, for two cars side by side. */
  pair?: number
  roll?: number
  handheld?: number
  min?: number
}

/** A camera car or crane travelling with the subject, its offset easing from one framing to another. */
export function track(e: CamEnv, o: TrackOpts): CamFn {
  return (t, u) => {
    const k = ease(u)
    const c = e.tracks.pos(o.ci, t, 0.3)
    const look = e.tracks.pos(o.ci, t, 0.12)
    if (o.pair !== undefined) {
      c.lerp(e.tracks.pos(o.pair, t, 0.3), 0.5)
      look.lerp(e.tracks.pos(o.pair, t, 0.12), 0.5)
    }
    const f = e.tracks.dir(o.ci, t, 0.5)
    const l = new THREE.Vector3(f.z, 0, -f.x)
    const side = lerp(o.from[0], o.to[0], k), up = lerp(o.from[1], o.to[1], k), back = lerp(o.from[2], o.to[2], k)
    const pos = c.clone().addScaledVector(l, side).addScaledVector(f, -back)
    pos.y += up
    const h = drift(t, o.handheld ?? 0.03, o.ci * 7 + 1)
    pos.addScaledVector(l, h.x)
    pos.y += h.y
    keepClear(e, pos, o.min ?? 0.35)
    look.addScaledVector(f, o.lookAhead ?? 1.5)
    look.y += o.lookUp ?? 0.6
    return { pos, look, fov: lerp(o.fov[0], o.fov[1], k), roll: (o.roll ?? 0) + h.roll }
  }
}

export interface PostOpts {
  ci: number
  /** Where along the route the camera stands. */
  s: number
  /** +1 left of the road, -1 right. */
  side: number
  /** Extra distance beyond the cleared strip, metres (negative stands closer to the road). */
  back?: number
  h: number
  /** Width of the scene to keep in frame, metres: a long lens far away, opening up as the car arrives. */
  frame?: number
  fov?: [number, number]
  /** Pan target leads the car by this many metres along its travel. */
  lead?: number
  lookUp?: number
  handheld?: number
}

/** A camera on a tripod by the road: it pans with the car and, with `frame`, zooms to hold its size. */
export function post(e: CamEnv, o: PostOpts): CamFn {
  const route = e.run.sim.route
  const a = route.at(o.s)
  const off = Math.max(route.half + 1.2, clearAt(e, o.s) + (o.back ?? 0)) * o.side
  const base = new THREE.Vector3(a.x + Math.cos(a.heading) * off, 0, a.z - Math.sin(a.heading) * off)
  base.y = ground(e, base.x, base.z) + o.h
  return (t, u) => {
    const look = e.tracks.pos(o.ci, t, 0.14)
    look.addScaledVector(e.tracks.dir(o.ci, t), o.lead ?? 0)
    look.y += o.lookUp ?? 0.7
    const h = drift(t, o.handheld ?? 0.012, 5)
    const pos = base.clone()
    pos.x += h.x
    pos.y += h.y
    let fov: number
    if (o.frame) {
      const d = pos.distanceTo(look)
      fov = clamp((2 * Math.atan(o.frame / 2 / d) * 180) / Math.PI, 7, 62)
    } else {
      const f = o.fov ?? [40, 40]
      fov = lerp(f[0], f[1], ease(u))
    }
    return { pos, look, fov, roll: h.roll }
  }
}

export interface OrbitOpts {
  ci: number
  /** Angle from straight behind the car, radians, + to its left; distance and height, start and end. */
  from: [number, number, number]
  to: [number, number, number]
  fov: [number, number]
  lookUp?: number
  /** Reference heading: the direction of travel at this time, so the sweep is not dragged round by every bend. */
  refT: number
  /** Follow the car's heading after all: 1 locks the angle to the car, 0 to the reference. */
  follow?: number
  min?: number
  sigma?: number
  handheld?: number
}

/** Drone and orbit moves: a sweep around the subject at a distance and height that ease between two framings. */
export function orbit(e: CamEnv, o: OrbitOpts): CamFn {
  const ref = e.tracks.dir(o.ci, o.refT, 0.8)
  const refH = Math.atan2(ref.x, ref.z)
  return (t, u) => {
    const k = ease(u)
    const c = e.tracks.pos(o.ci, t, o.sigma ?? 0.45)
    const look = e.tracks.pos(o.ci, t, 0.15)
    let h0 = refH
    if (o.follow) {
      const d = e.tracks.dir(o.ci, t, 0.8)
      const hc = Math.atan2(d.x, d.z)
      let dh = hc - refH
      while (dh > Math.PI) dh -= 2 * Math.PI
      while (dh < -Math.PI) dh += 2 * Math.PI
      h0 = refH + dh * o.follow
    }
    const dist = lerp(o.from[1], o.to[1], k), hgt = lerp(o.from[2], o.to[2], k)
    // Angle measured from straight behind, + toward the car's left.
    const a = lerp(o.from[0], o.to[0], k)
    const rel = fwdOf(h0).multiplyScalar(-Math.cos(a)).addScaledVector(leftOf(h0), Math.sin(a))
    const pos = c.clone().addScaledVector(rel, dist)
    pos.y += hgt
    const hh = drift(t, o.handheld ?? 0.05, 11)
    pos.x += hh.x
    pos.y += hh.y
    keepClear(e, pos, o.min ?? 0.5)
    look.y += o.lookUp ?? 0.6
    return { pos, look, fov: lerp(o.fov[0], o.fov[1], k), roll: hh.roll }
  }
}

/** Mounted on the car: offset and aim in the body frame (x left, y up, z forward), so it rides every bump. */
export function mounted(posBody: (r: Rig) => THREE.Vector3, lookBody: (r: Rig) => THREE.Vector3, fov: number): CamFn {
  return (_t, _u, rig) => {
    rig.body.updateMatrixWorld(true)
    const pos = posBody(rig).applyMatrix4(rig.body.matrixWorld)
    const look = lookBody(rig).applyMatrix4(rig.body.matrixWorld)
    return { pos, look, fov, roll: 0 }
  }
}

/** A fixed point in the world easing to another, looking at a moving target: crane and drone reveals over a scene. */
export function crane(e: CamEnv, from: THREE.Vector3, to: THREE.Vector3, target: (t: number) => THREE.Vector3, fov: [number, number], min = 1): CamFn {
  return (t, u) => {
    const k = ease(u)
    const pos = from.clone().lerp(to, k)
    const h = drift(t, 0.06, 21)
    pos.x += h.x
    pos.y += h.y
    keepClear(e, pos, min)
    return { pos, look: target(t), fov: lerp(fov[0], fov[1], k), roll: h.roll }
  }
}

/** Ground point of the route at `s`, offset `d` to the left. */
export function routePoint(e: CamEnv, s: number, d = 0, up = 0): THREE.Vector3 {
  const a = e.run.sim.route.at(s)
  const p = new THREE.Vector3(a.x + Math.cos(a.heading) * d, 0, a.z - Math.sin(a.heading) * d)
  p.y = ground(e, p.x, p.z) + up
  return p
}
