import * as THREE from 'three'
import { M, Parts, V3, grid, rod, sweep, tube } from './car-geo'
import { defaultLook, type DriverLook } from '../game/paint'
import { mix } from './livery-paint'

/**
 * The driver: a cheerful chap in a flower shirt and shorts, bare arms, no
 * race suit, no gloves, no neck brace, but a proper full-face rally helmet
 * with a flip-up iridium visor, intercom boom mic, vents and a rear spoiler.
 * The arms reach the wheel by two-bone IK each frame, so his hands stay on
 * the rim however far it's turned.
 */

export interface DriverMats {
  skin: THREE.Material
  shirt: THREE.Material
  matte: THREE.Material
  gloss: THREE.Material
  metal: THREE.Material
  helmet: THREE.Material
  visor: THREE.Material
}

/** The steering wheel's centre and plane: e1 points to the driver's left, e2 up the rim, n back at the driver. */
export interface WheelFrame { centre: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; n: THREE.Vector3; radius: number }

export interface DriverFrame {
  torso: THREE.Matrix4
  shoulders: [THREE.Vector3, THREE.Vector3]
  neck: THREE.Vector3
  head: THREE.Vector3
  eye: THREE.Vector3
}

const UPPER = 0.28, FORE = 0.27

/** Where the joints sit for a hip point, a recline (rad) and a torso length. */
export function driverFrame(hip: THREE.Vector3, recline: number, torso: number): DriverFrame {
  const t = M(hip.x, hip.y, hip.z, -recline)
  const at = (x: number, y: number, z: number) => V3(x, y, z).applyMatrix4(t)
  const neck = at(0, torso * 0.97, 0.01)
  // Drivers hold their head upright whatever the seat angle.
  const head = neck.clone().add(V3(0, 0.17, 0.035))
  return { torso: t, shoulders: [at(0.185, torso * 0.86, 0), at(-0.185, torso * 0.86, 0)], neck, head, eye: head.clone().add(V3(0, 0.02, 0.09)) }
}

// Helmet shell: an ellipsoid parameterised round a forward axis tilted down,
// so the eyeport is an exact ring of the mesh rather than a jagged cut.
const HX = 0.148, HY = 0.152, HZ = 0.168, TILT = 0.2, BX = 0.8, BY = 0.5
const eyeEdge = (a: number) => 1 / Math.sqrt((Math.cos(a) / BX) ** 2 + (Math.sin(a) / BY) ** 2)
function hdir(beta: number, alpha: number): THREE.Vector3 {
  const d = V3(Math.sin(beta) * Math.cos(alpha), Math.sin(beta) * Math.sin(alpha), Math.cos(beta))
  const y = d.y * Math.cos(TILT) - d.z * Math.sin(TILT), z = d.y * Math.sin(TILT) + d.z * Math.cos(TILT)
  return d.set(d.x, y, z)
}
function hpoint(d: THREE.Vector3, k = 1): THREE.Vector3 {
  // The chin bar juts forward, the lower back tucks in toward the neck.
  const chin = d.y < -0.2 && d.z > 0 ? Math.min(1, (-d.y - 0.2) * 2.5) * d.z * 0.03 : 0
  const tuck = d.y < -0.3 && d.z < 0 ? (-d.y - 0.3) * 0.02 : 0
  return V3(d.x * HX * k, d.y * HY * k, d.z * HZ * k + chin * k + tuck)
}
const NA = 40, NB = 14
function helmetGrid(k: number, from: (a: number) => number, to: (a: number) => number, rings: number): THREE.BufferGeometry {
  const rows: THREE.Vector3[][] = []
  const dirs: THREE.Vector3[][] = []
  for (let i = 0; i <= rings; i++) {
    const row: THREE.Vector3[] = [], drow: THREE.Vector3[] = []
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2
      const b = from(a) + (to(a) - from(a)) * (i / rings)
      const d = hdir(b, a)
      row.push(hpoint(d, k))
      drow.push(d)
    }
    rows.push(row)
    dirs.push(drow)
  }
  return grid(rows, (i, j) => {
    const d = dirs[i][j]
    return [0.5 + 0.5 * d.x, (Math.atan2(d.y, d.z) + Math.PI) / (Math.PI * 2)]
  })
}

export interface Driver {
  group: THREE.Group
  head: THREE.Group
  eye: THREE.Vector3
  /** wheelTurn: steering wheel angle (rad, + anticlockwise as the driver sees it); lat: lateral g, + to the left; look: head yaw. */
  pose(wheelTurn: number, lat: number, look: number): void
  /** Helmet on, or off to show his hair. */
  helmet(on: boolean): void
}

export function buildDriver(f: DriverFrame, torso: number, wheel: WheelFrame, mats: DriverMats, belt: number, lk: DriverLook = defaultLook()): Driver {
  const { skin, shirt, matte, gloss, metal, helmet, visor } = mats
  const group = new THREE.Group()
  const p = new Parts()
  const T = f.torso
  const SKIN = lk.skin, SHORTS = lk.shorts
  const tl = torso

  // ---- torso: barrel chest, proud belly, flower shirt
  const prof: [number, number][] = [[0.001, 0], [0.15, 0.01], [0.175, 0.1], [0.168, 0.24], [0.17, 0.34], [0.158, 0.43], [0.115, 0.49], [0.06, 0.52], [0.001, 0.53]]
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, (y * tl) / 0.52)), 20)
  p.add(shirt, lathe, T.clone().multiply(M(0, 0, 0, 0, 0, 0, 1.12, 1, 0.78)))
  p.add(shirt, new THREE.SphereGeometry(0.13, 16, 12), T.clone().multiply(M(0, tl * 0.2, 0.07, 0, 0, 0, 1.1, 1, 0.95)))
  // Open collar: a V of bare chest and a soft rolled collar.
  p.add(skin, new THREE.SphereGeometry(0.06, 12, 8), T.clone().multiply(M(0, tl * 0.9, 0.085, 0, 0, 0, 1, 1.3, 0.5)), SKIN)
  p.add(shirt, new THREE.TorusGeometry(0.068, 0.018, 6, 16), T.clone().multiply(M(0, tl * 0.97, 0.01, Math.PI / 2 - 0.25)))
  for (const s of f.shoulders) p.add(shirt, new THREE.SphereGeometry(0.072, 12, 10), M(s.x, s.y, s.z))
  // Harness: shoulder straps over the shirt to a buckle on the belly, and lap belts.
  const strapSection: [number, number][] = [[-0.024, -0.004], [0.024, -0.004], [0.024, 0.004], [-0.024, 0.004]]
  const strap = (pts: THREE.Vector3[], axis: (q: THREE.Vector3) => THREE.Vector3) => {
    const curve = new THREE.CatmullRomCurve3(pts)
    const path = curve.getPoints(14)
    const up = path.map((q) => axis(q))
    const across = path.map((_, i) => {
      const t = curve.getTangent(i / 14)
      return up[i].clone().cross(t).normalize()
    })
    p.add(matte, sweep(path, across, up, strapSection), undefined, belt)
  }
  const spine = (q: THREE.Vector3) => {
    const local = q.clone().applyMatrix4(T.clone().invert())
    const c = V3(0, Math.min(local.y, tl * 0.8), 0).applyMatrix4(T)
    return q.clone().sub(c).normalize()
  }
  for (const s of [1, -1]) {
    const pts = [[0.1, tl + 0.06, -0.2], [0.11, tl * 0.97 + 0.03, -0.04], [0.1, tl * 0.84, 0.13], [0.075, tl * 0.5, 0.165], [0.02, tl * 0.22, 0.2]].map(([x, y, z]) => V3(s * x, y, z).applyMatrix4(T))
    strap(pts, spine)
    const lap = [[0.19, 0.02, -0.02], [0.17, 0.06, 0.1], [0.08, tl * 0.16, 0.19], [0.015, tl * 0.2, 0.205]].map(([x, y, z]) => V3(s * x, y, z).applyMatrix4(T))
    strap(lap, spine)
  }
  p.add(metal, new THREE.CylinderGeometry(0.045, 0.045, 0.014, 18).rotateX(Math.PI / 2), T.clone().multiply(M(0, tl * 0.21, 0.205)), 0xd8dadd)

  // ---- legs: shorts, bare shins, bright trainers
  for (const s of [1, -1]) {
    const hipJ = V3(s * 0.1, 0.06, 0.03).applyMatrix4(T)
    const knee = hipJ.clone().add(V3(s * 0.04, 0.12, 0.4))
    const ankle = knee.clone().add(V3(s * 0.01, -0.3, 0.17))
    p.add(matte, rod(hipJ, knee, 0.078, 12, 0.07), undefined, SHORTS)
    p.add(skin, new THREE.SphereGeometry(0.052, 10, 8), M(knee.x, knee.y, knee.z), SKIN)
    p.add(skin, rod(knee, ankle, 0.045, 10, 0.038), undefined, SKIN)
    p.add(gloss, new THREE.SphereGeometry(0.06, 12, 8), M(ankle.x, ankle.y - 0.02, ankle.z + 0.06, 0, 0, 0, 0.8, 0.6, 1.6), 0xe8402a)
    p.add(gloss, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), M(ankle.x, ankle.y - 0.05, ankle.z + 0.05, 0, 0, 0, 1, 1, 1.9), 0xf2f0ea)
  }
  // Neck, up into the helmet.
  p.add(skin, rod(f.neck.clone().add(V3(0, -0.03, 0)), f.neck.clone().add(V3(0, 0.12, 0.02)), 0.052, 12), undefined, SKIN)
  p.build(group, false, true)

  // ---- arms: two segments each, oriented every frame
  const seg = (build: (q: Parts) => void) => {
    const g = new THREE.Group()
    const q = new Parts()
    build(q)
    q.build(g, false, true)
    group.add(g)
    return g
  }
  const arms = f.shoulders.map((_, i) => {
    const left = i === 0
    const upper = seg((q) => {
      q.add(shirt, new THREE.CylinderGeometry(0.064, 0.07, UPPER * 0.6, 14, 1).translate(0, UPPER * 0.3, 0))
      q.add(skin, new THREE.CylinderGeometry(0.044, 0.05, UPPER * 0.55, 12).translate(0, UPPER * 0.72, 0), undefined, SKIN)
      q.add(skin, new THREE.SphereGeometry(0.045, 10, 8).translate(0, UPPER, 0), undefined, SKIN)
    })
    const fore = seg((q) => {
      q.add(skin, new THREE.CylinderGeometry(0.034, 0.044, FORE, 12).translate(0, FORE / 2, 0), undefined, SKIN)
      // Fist round the rim, thumb on top.
      q.add(skin, new THREE.SphereGeometry(0.046, 12, 10), M(0, FORE + 0.035, 0, 0, 0, 0, 0.85, 1.15, 0.95), SKIN)
      q.add(skin, new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), M(left ? -0.03 : 0.03, FORE + 0.05, 0.03, 0.6, 0, left ? 0.5 : -0.5), SKIN)
      // A chunky gold watch, the only jewellery a rally driver needs.
      if (left) {
        q.add(metal, new THREE.CylinderGeometry(0.041, 0.041, 0.022, 14).translate(0, FORE * 0.9, 0), undefined, 0xd8b04a)
        q.add(gloss, new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12).rotateZ(Math.PI / 2).translate(0.04, FORE * 0.9, 0), undefined, 0x222428)
      }
    })
    return { upper, fore, left }
  })

  // ---- head: pivots at the top of the neck
  const head = new THREE.Group()
  const pivot = f.neck.clone().add(V3(0, 0.08, 0.02))
  head.position.copy(pivot)
  group.add(head)
  const hc = f.head.clone().sub(pivot)
  const H = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => M(hc.x + x, hc.y + y, hc.z + z, rx, ry, rz, sx, sy, sz)
  // Face, helmet and hair are separate groups so the garage can take the helmet off.
  const face = new THREE.Group(), helmetGroup = new THREE.Group(), hairGroup = new THREE.Group()
  head.add(face, helmetGroup, hairGroup)
  hairGroup.visible = false
  const hq = new Parts()
  const hair = new Parts()
  const HAIR = lk.hairColor, BROW = mix(lk.hairColor, 0x000000, 0.25)
  // Face: round, rosy and delighted.
  hq.add(skin, new THREE.SphereGeometry(0.112, 20, 16), H(0, -0.012, 0, 0, 0, 0, 1, 1, 1.12), SKIN)
  for (const s of [1, -1]) {
    hq.add(skin, new THREE.SphereGeometry(0.03, 10, 8), H(s * 0.056, -0.03, 0.094), mix(SKIN, 0xe0505a, 0.3))
    hq.add(gloss, new THREE.SphereGeometry(0.027, 14, 10), H(s * 0.037, 0.012, 0.106, 0, 0, 0, 1, 1.1, 0.8), 0xf8f6ee)
    // Pupils that don't quite agree on where to look.
    hq.add(gloss, new THREE.SphereGeometry(0.012, 10, 8), H(s * 0.033 + (s > 0 ? 0.004 : -0.002), s > 0 ? 0.017 : 0.01, 0.127, 0, 0, 0, 1, 1, 0.6), 0x16110c)
    // Eyebrows.
    if (lk.brows === 'bushy') hq.add(matte, new THREE.CapsuleGeometry(0.009, 0.034, 4, 8), H(s * 0.04, 0.042, 0.113, 0, 0, Math.PI / 2 + s * 0.28), BROW)
    else if (lk.brows === 'thin') hq.add(matte, new THREE.CapsuleGeometry(0.0045, 0.032, 4, 6), H(s * 0.04, 0.04, 0.114, 0, 0, Math.PI / 2 + s * 0.12), BROW)
    else if (lk.brows === 'arched') hq.add(matte, tube([V3(s * 0.018, 0.036, 0.118), V3(s * 0.038, 0.054, 0.114), V3(s * 0.062, 0.04, 0.1)].map((v) => v.add(hc)), 0.006, 10, 6), undefined, BROW)
    // Moustache.
    if (lk.moustache === 'handlebar') hq.add(matte, tube([V3(0, -0.034, 0.142), V3(s * 0.03, -0.042, 0.137), V3(s * 0.058, -0.046, 0.12), V3(s * 0.074, -0.03, 0.104), V3(s * 0.068, -0.016, 0.106), V3(s * 0.06, -0.022, 0.112)].map((v) => v.add(hc)), 0.0085, 20, 6), undefined, HAIR)
    else if (lk.moustache === 'walrus') hq.add(matte, new THREE.SphereGeometry(0.03, 12, 8), H(s * 0.028, -0.046, 0.132, 0.2, 0, s * 0.35, 1.25, 0.8, 0.6), HAIR)
  }
  if (lk.moustache === 'pencil') hq.add(matte, new THREE.CapsuleGeometry(0.0035, 0.06, 4, 6), H(0, -0.034, 0.143, 0, 0, Math.PI / 2), HAIR)
  else if (lk.moustache === 'chevron') hq.add(matte, new THREE.SphereGeometry(0.03, 12, 8), H(0, -0.036, 0.137, 0, 0, 0, 1.55, 0.55, 0.6), HAIR)
  if (lk.brows === 'mono') hq.add(matte, new THREE.CapsuleGeometry(0.009, 0.09, 4, 8), H(0, 0.045, 0.116, 0, 0, Math.PI / 2), BROW)
  hq.add(skin, new THREE.SphereGeometry(0.027, 12, 10), H(0, -0.012, 0.137, 0, 0, 0, 1, 0.9, 1.1), mix(SKIN, 0xd06060, 0.18))
  // Glasses, worn under the helmet because of course they are.
  if (lk.glasses === 'aviator') {
    for (const s of [1, -1]) {
      hq.add(gloss, new THREE.SphereGeometry(0.03, 14, 10), H(s * 0.038, 0.006, 0.136, 0, 0, 0, 1.05, 0.9, 0.22), 0x2f4a3a)
      hq.add(metal, new THREE.TorusGeometry(0.03, 0.0025, 4, 20), H(s * 0.038, 0.006, 0.137, 0, 0, 0, 1.05, 0.9, 1), 0xd8b04a)
    }
    hq.add(metal, new THREE.CapsuleGeometry(0.002, 0.018, 2, 4), H(0, 0.026, 0.142, 0, 0, Math.PI / 2), 0xd8b04a)
  } else if (lk.glasses === 'round') {
    for (const s of [1, -1]) hq.add(metal, new THREE.TorusGeometry(0.024, 0.0028, 4, 20), H(s * 0.037, 0.012, 0.134), 0x2a2b2f)
    hq.add(metal, new THREE.CapsuleGeometry(0.002, 0.016, 2, 4), H(0, 0.016, 0.138, 0, 0, Math.PI / 2), 0x2a2b2f)
  } else if (lk.glasses === 'shutter') {
    for (let k = 0; k < 5; k++) hq.add(gloss, new THREE.BoxGeometry(0.13, 0.004, 0.006), H(0, 0.03 - k * 0.011, 0.138), lk.printColor)
    for (const s of [1, -1]) hq.add(gloss, new THREE.BoxGeometry(0.004, 0.05, 0.006), H(s * 0.065, 0.008, 0.136), lk.printColor)
  }
  // Hair: hidden by the helmet, except a mullet, which no helmet can contain.
  const cap = (r: number, sy = 1) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(-0.45).scale(1, sy, 1.1)
  if (lk.hair === 'mullet') {
    hair.add(matte, cap(0.119), H(0, -0.004, -0.004), HAIR)
    for (const [x, y, z] of [[0, -0.1, -0.11], [0.04, -0.12, -0.1], [-0.04, -0.12, -0.1], [0, -0.16, -0.1]]) hq.add(matte, new THREE.SphereGeometry(0.04, 10, 8), H(x, y, z, 0.3, 0, 0, 1, 1.4, 0.7), HAIR)
  } else if (lk.hair === 'curls') {
    for (let i = 0; i < 34; i++) {
      const a = i * 2.4, e = 0.15 + (i / 34) * 1.25
      const d = V3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a) - 0.25).normalize()
      if (d.z > 0.75 && d.y < 0.5) continue
      hair.add(matte, new THREE.SphereGeometry(0.032, 8, 6), H(d.x * 0.118, d.y * 0.118 - 0.005, d.z * 0.12), HAIR)
    }
  } else if (lk.hair === 'quiff') {
    hair.add(matte, cap(0.116), H(0, -0.004, -0.004), HAIR)
    hair.add(matte, new THREE.SphereGeometry(0.05, 14, 10), H(0, 0.1, 0.07, -0.5, 0, 0, 1.1, 0.8, 1.5), HAIR)
  } else if (lk.hair === 'mop') {
    hair.add(matte, cap(0.124, 1.05), H(0, -0.002, -0.004), HAIR)
    hair.add(matte, new THREE.SphereGeometry(0.06, 14, 8), H(0, 0.07, 0.085, 0.3, 0, 0, 1.6, 0.55, 0.8), HAIR)
  } else if (lk.hair === 'buzz') {
    hair.add(matte, cap(0.1135), H(0, -0.006, -0.004), HAIR)
  }
  // A grin from ear to ear: dark mouth, a row of teeth, a bit of tongue.
  hq.add(gloss, new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), H(0, -0.058, 0.118, 0, 0, 0, 1, 0.6, 0.35), 0x4a0d0d)
  hq.add(gloss, new THREE.CylinderGeometry(0.046, 0.046, 0.012, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84), H(0, -0.062, 0.104, 0, 0, 0, 1, 1, 0.5), 0xf6f3ea)
  hq.add(gloss, new THREE.SphereGeometry(0.018, 10, 8), H(0, -0.074, 0.122, 0, 0, 0, 1.2, 0.6, 0.8), 0xd0607a)

  const hm = new Parts()
  // Helmet shell, inner liner, eyeport rubber.
  const shell = helmetGrid(1, eyeEdge, () => Math.PI, NB)
  hm.add(helmet, shell, H(0, 0, 0))
  hm.add(matte, helmetGrid(0.93, eyeEdge, () => Math.PI, NB), H(0, 0, 0), 0x2a2b2f)
  const rim: THREE.Vector3[] = []
  for (let j = 0; j < 36; j++) {
    const a = (j / 36) * Math.PI * 2
    rim.push(hpoint(hdir(eyeEdge(a), a), 0.985).add(hc))
  }
  hm.add(matte, tube(rim, 0.009, 72, 6, true), undefined, 0x121214)
  // Flip-up iridium visor, raised so you can see his face; pivots on both sides.
  const vis = helmetGrid(1.045, () => 0, (a) => eyeEdge(a) * 1.12, 8)
  hm.add(visor, vis, H(0, 0, 0).multiply(M(0, 0, 0, -1.0)))
  for (const s of [1, -1]) {
    hm.add(matte, new THREE.CylinderGeometry(0.024, 0.024, 0.012, 16).rotateZ(Math.PI / 2), H(s * HX * 1.04, -0.012, 0.01), 0x16171a)
    hm.add(metal, new THREE.CylinderGeometry(0.008, 0.008, 0.016, 8).rotateZ(Math.PI / 2), H(s * HX * 1.06, -0.012, 0.01), 0xc8ccd0)
    // Crown vents.
    const vd = V3(s * 0.24, 0.92, 0.3).normalize()
    const vp = hpoint(vd).add(hc)
    const vm = new THREE.Matrix4().compose(vp, new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), vd), V3(1, 1, 1))
    hm.add(gloss, new THREE.BoxGeometry(0.036, 0.022, 0.06), vm, 0x1b1c1f)
    hm.add(matte, new THREE.BoxGeometry(0.026, 0.024, 0.008), vm.clone().multiply(M(0, 0, 0.026)), 0x050505)
  }
  // Rear aero spoiler with end fins.
  {
    const d = V3(0, 0.5, -0.87).normalize()
    const sp = hpoint(d).add(hc)
    const m = new THREE.Matrix4().compose(sp, new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d), V3(1, 1, 1))
    hm.add(gloss, new THREE.BoxGeometry(0.15, 0.03, 0.05), m.clone().multiply(M(0, 0.006, -0.012, 0.35)), 0x1b1c1f)
    for (const s of [1, -1]) hm.add(gloss, new THREE.BoxGeometry(0.008, 0.045, 0.06), m.clone().multiply(M(s * 0.075, 0.01, -0.01, 0.35)), 0x1b1c1f)
  }
  // Chin vent, intercom jack and the boom mic in front of that grin.
  {
    const d = V3(0, -0.62, 0.79).normalize()
    const cp = hpoint(d).add(hc)
    const m = new THREE.Matrix4().compose(cp, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), d), V3(1, 1, 1))
    hm.add(matte, new THREE.BoxGeometry(0.06, 0.022, 0.014), m, 0x0b0b0c)
    const jack = hpoint(V3(0.96, -0.28, 0.05).normalize()).add(hc)
    hm.add(metal, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10).rotateZ(Math.PI / 2), M(jack.x, jack.y, jack.z), 0x9a9ea4)
    const mic = [jack, hc.clone().add(V3(0.13, -0.08, 0.1)), hc.clone().add(V3(0.085, -0.088, 0.15)), hc.clone().add(V3(0.035, -0.078, 0.158))]
    hm.add(matte, tube(mic, 0.0045, 24, 6), undefined, 0x1a1a1c)
    hm.add(matte, new THREE.SphereGeometry(0.018, 10, 8), M(mic[3].x, mic[3].y, mic[3].z, 0, 0, 0, 1.2, 1, 1), 0x121212)
    // Coiled cord from the jack down to the shoulder.
    const coil: THREE.Vector3[] = []
    const a = jack.clone().add(V3(0.01, -0.02, 0)), b = hc.clone().add(V3(0.15, -0.3, -0.06))
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      const c = a.clone().lerp(b, t)
      const w = i * 0.9
      coil.push(c.add(V3(Math.cos(w) * 0.009, 0, Math.sin(w) * 0.009)))
    }
    hm.add(matte, tube(coil, 0.0025, 120, 4), undefined, 0x101012)
  }
  hq.build(face, false, true)
  hm.build(helmetGroup, false, true)
  hair.build(hairGroup, false, true)

  const tmp = V3(), dir = V3(), pole = V3(), elbow = V3(), wrist = V3()
  const qUp = V3(0, 1, 0)
  const place = (g: THREE.Group, from: THREE.Vector3, to: THREE.Vector3) => {
    g.position.copy(from)
    g.quaternion.setFromUnitVectors(qUp, dir.subVectors(to, from).normalize())
  }

  return {
    group, head, eye: f.eye,
    helmet(on) {
      helmetGroup.visible = on
      hairGroup.visible = !on
    },
    pose(turn, lat, look) {
      arms.forEach(({ upper, fore, left }, i) => {
        const s = f.shoulders[i]
        const phi = left ? 0.12 - turn : Math.PI - 0.12 - turn
        const grip = wheel.centre.clone()
          .addScaledVector(wheel.e1, Math.cos(phi) * wheel.radius)
          .addScaledVector(wheel.e2, Math.sin(phi) * wheel.radius)
          .addScaledVector(wheel.n, 0.02)
        // Wrist sits back from the grip, toward the shoulder.
        wrist.copy(grip).addScaledVector(tmp.subVectors(s, grip).normalize(), 0.05)
        const d = Math.min(UPPER + FORE - 0.005, Math.max(0.12, s.distanceTo(wrist)))
        dir.subVectors(wrist, s).normalize()
        const cosA = (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
        // Elbows hang down and out.
        pole.set(left ? 0.6 : -0.6, -1, -0.15)
        pole.addScaledVector(dir, -pole.dot(dir)).normalize()
        elbow.copy(s).addScaledVector(dir, UPPER * cosA).addScaledVector(pole, UPPER * sinA)
        place(upper, s, elbow)
        const end = elbow.clone().add(tmp.subVectors(wrist, elbow).normalize().multiplyScalar(FORE))
        place(fore, elbow, end)
      })
      head.rotation.set(0, look, lat, 'YXZ')
    },
  }
}

/** The steering wheel's orthonormal frame for a centre and a column tilt (rad from vertical). */
export function wheelFrame(centre: THREE.Vector3, tilt: number, radius: number): WheelFrame {
  return { centre, radius, e1: V3(1, 0, 0), e2: V3(0, Math.cos(tilt), Math.sin(tilt)), n: V3(0, Math.sin(tilt), -Math.cos(tilt)) }
}

