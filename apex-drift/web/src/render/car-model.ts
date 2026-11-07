import * as THREE from 'three'
import { carPhys, type LiveryDef } from '../data'
import { tyreTexture } from './textures'
import { M, Parts, V3, atlasUV, grid, rod, solid, tube } from './car-geo'
import { LAMP, TRIM, lampAtlas, trimAtlas, type Rect } from './car-tex'
import { buildDriver, driverFrame, wheelFrame, type Driver } from './car-driver'
import { FINISH, makeLiveryCanvases, paintLivery, type BodyFrame } from './livery-paint'
import { drawHelmet, drawShirt, helmetTexture, shirtTexture } from './driver-tex'
import { defaultLook, type DriverLook, type Visor } from '../game/paint'

/**
 * Rally cars built from lofted cross-sections. One closed shell runs from
 * nose to tail and includes the glasshouse, so the glass is simply the faces
 * of the shell inside the window openings: nothing can gap between body,
 * pillars and glass, and the cabin is sealed when seen from inside. Lamps,
 * grilles and plates are laid onto the shell by projecting them onto its
 * surface, so they sit in the bodywork rather than float in front of it.
 * Every part is merged per material: a whole car is a few dozen draw calls.
 * All designs are original; none copies a real manufacturer's car.
 */

interface Spec {
  /** Overall length and width (m). */
  L: number
  W: number
  /** Height of the shoulder line (top of the doors) and of the roof. */
  belt: number
  roof: number
  /** Ground clearance under the sills, wheel radius. */
  gc: number
  wheel: number
  /** Bonnet height at the nose and boot height at the tail, as a fraction of belt height. */
  nose: number
  tail: number
  /** From the front, as fractions of L: windscreen base, roof front, roof rear, rear screen base. */
  glass: [number, number, number, number]
  /** Superellipse exponent of the cross-section: 2 = round 60s, 4+ = slab-sided 80s. */
  boxy: number
  /** Extra width over the wheels (box arches). */
  flare: number
  wing: 'none' | 'lip' | 'duck' | 'big'
  lamps: 'round' | 'twin' | 'square' | 'slim'
  pod: boolean
  /** Sloped fastback (rear screen almost flush with the boot) vs. upright hatch. */
  fastback: boolean
  scoop: boolean
}

const SPECS: Record<string, Spec> = {
  piccola: { L: 3.2, W: 1.46, belt: 0.84, roof: 1.34, gc: 0.16, wheel: 0.28, nose: 0.86, tail: 0.86, glass: [0.36, 0.52, 0.86, 0.94], boxy: 2.4, flare: 0, wing: 'none', lamps: 'round', pod: false, fastback: false, scoop: false },
  ventura: { L: 4.2, W: 1.62, belt: 0.86, roof: 1.38, gc: 0.17, wheel: 0.3, nose: 0.92, tail: 0.94, glass: [0.36, 0.47, 0.71, 0.79], boxy: 2.8, flare: 0, wing: 'none', lamps: 'twin', pod: false, fastback: false, scoop: false },
  kestrel: { L: 3.8, W: 1.62, belt: 0.86, roof: 1.37, gc: 0.19, wheel: 0.3, nose: 0.9, tail: 0.95, glass: [0.33, 0.47, 0.88, 0.96], boxy: 3.2, flare: 0.03, wing: 'lip', lamps: 'round', pod: true, fastback: false, scoop: false },
  ruska: { L: 4.1, W: 1.66, belt: 0.9, roof: 1.43, gc: 0.2, wheel: 0.3, nose: 0.97, tail: 0.97, glass: [0.34, 0.44, 0.74, 0.82], boxy: 4.5, flare: 0, wing: 'none', lamps: 'square', pod: true, fastback: false, scoop: false },
  saetta: { L: 3.9, W: 1.74, belt: 0.74, roof: 1.12, gc: 0.15, wheel: 0.31, nose: 0.62, tail: 0.98, glass: [0.42, 0.57, 0.76, 0.9], boxy: 3.6, flare: 0.04, wing: 'duck', lamps: 'slim', pod: true, fastback: true, scoop: true },
  bison: { L: 4.35, W: 1.76, belt: 1.02, roof: 1.66, gc: 0.27, wheel: 0.36, nose: 0.93, tail: 1, glass: [0.3, 0.4, 0.93, 0.98], boxy: 4.2, flare: 0.05, wing: 'none', lamps: 'round', pod: true, fastback: false, scoop: false },
  falco: { L: 3.95, W: 1.8, belt: 0.72, roof: 1.08, gc: 0.15, wheel: 0.32, nose: 0.6, tail: 0.95, glass: [0.38, 0.52, 0.66, 0.92], boxy: 3.8, flare: 0.06, wing: 'duck', lamps: 'slim', pod: true, fastback: true, scoop: true },
  boxer: { L: 4.1, W: 1.82, belt: 0.84, roof: 1.35, gc: 0.18, wheel: 0.32, nose: 0.88, tail: 0.97, glass: [0.34, 0.47, 0.85, 0.95], boxy: 5, flare: 0.1, wing: 'lip', lamps: 'square', pod: true, fastback: false, scoop: true },
  vulcan: { L: 3.85, W: 1.82, belt: 0.84, roof: 1.33, gc: 0.18, wheel: 0.32, nose: 0.86, tail: 0.95, glass: [0.33, 0.47, 0.84, 0.95], boxy: 4.4, flare: 0.1, wing: 'lip', lamps: 'square', pod: true, fastback: false, scoop: true },
  corsaire: { L: 4.35, W: 1.78, belt: 0.86, roof: 1.39, gc: 0.18, wheel: 0.33, nose: 0.88, tail: 0.96, glass: [0.36, 0.47, 0.73, 0.82], boxy: 3.4, flare: 0.07, wing: 'big', lamps: 'slim', pod: false, fastback: false, scoop: true },
  strada: { L: 4.05, W: 1.8, belt: 0.86, roof: 1.4, gc: 0.18, wheel: 0.33, nose: 0.88, tail: 0.95, glass: [0.34, 0.47, 0.86, 0.95], boxy: 3.3, flare: 0.08, wing: 'big', lamps: 'slim', pod: false, fastback: false, scoop: true },
  apex: { L: 4.12, W: 1.9, belt: 0.82, roof: 1.33, gc: 0.17, wheel: 0.34, nose: 0.84, tail: 0.95, glass: [0.35, 0.48, 0.85, 0.96], boxy: 3, flare: 0.13, wing: 'big', lamps: 'slim', pod: false, fastback: false, scoop: true },
}

export interface CarRig {
  root: THREE.Group
  /** Body: pitch and roll are applied here so the wheels stay on the ground. */
  body: THREE.Group
  wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[]
  lights: THREE.Mesh[]
  /** 0 = showroom clean … 1 = caked; colour is the surface's dirt. */
  setDirt(amount: number, color: number): void
  dispose(): void
  /** Turns the steering wheel, the driver's arms and head: road-wheel angle (rad, + left) and lateral g (+ left). */
  steer?(angle: number, lat?: number): void
  /** The driver's eye and the bonnet camera mount, in body space. */
  eye?: THREE.Vector3
  bonnet?: THREE.Vector3
  /** Camera inside the car: hides the driver's head (the camera is in it) and clears the tint from the glass. */
  interior?(on: boolean): void
  /** Repaints the body, wheels and calipers in place: no geometry is rebuilt, so it's cheap enough for a live editor. */
  repaint(lv: LiveryDef): void
  /** Rebuilds the driver with a new look (and name on his helmet). */
  setDriver(look: DriverLook, name?: string): void
  /** Helmet on (always, in a race) or off, to show off his hair in the garage. */
  helmet(on: boolean): void
  /** Glass opacity, 1 = as built; lower to see the driver clearly in the garage. */
  clearGlass(k: number): void
}

export interface CarOpts {
  look?: DriverLook
  /** Printed on the helmet. */
  name?: string
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Piecewise interpolation through (x, y) knots, smoothstepped so the profile never creases. */
function knots(pts: [number, number][]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
        const t = (x - x0) / (x1 - x0)
        return y0 + (y1 - y0) * t * t * (3 - 2 * t)
      }
    }
    return pts[pts.length - 1][1]
  }
}

/**
 * UVs from position and normal into the livery texture's three bands (see
 * livery-paint.ts): the right flank on top, the left flank below it, both
 * reading front-to-back the way you see them, and the top view at the bottom.
 */
function applyUV(g: THREE.BufferGeometry, L: number, H: number, W: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const nx = n.getX(i), ny = n.getY(i)
    let u = (z + L / 2) / L
    let v: number
    const h = THREE.MathUtils.clamp(y / H, 0, 1) / 3
    if (Math.abs(nx) > ny * 0.9) {
      // Right flank (-x): rear at the left of the band. The left flank runs the other way, so it isn't mirrored.
      if (nx > 0) {
        u = 1 - u
        v = 1 / 3 + h
      } else v = 2 / 3 + h
    } else {
      v = (1 / 3) * (1 - THREE.MathUtils.clamp((x + W / 2) / W, 0, 1))
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// ---------------------------------------------------------------------------
// The body profile
// ---------------------------------------------------------------------------

/** Points up each side from the bottom centre to the shoulder. */
const NL = 14
/** Glasshouse stations above the shoulder: ledge, window, rail, roof (see `section`). */
const NU = 15
const NH = NL + NU
const RING = NH * 2

/** Face labels on the shell. */
const PAINT = 0, GLASS = 1, TRIMQ = 2

interface Layout {
  s: Spec
  L: number; W: number; front: number; rear: number
  axF: number; axR: number; archR: number
  zF0: number; zF1: number; zR1: number; zR0: number; zB: number; zQ: number; zRq: number
  rN: number; rT: number
  lowA: number[]
  bottom: (z: number) => number
  shoulder: (z: number) => number
  halfW: (z: number) => number
  cabin: (z: number) => number
  scale: (z: number) => number
}

function layout(s: Spec, axF: number, axR: number): Layout {
  const L = s.L, W = s.W, front = L / 2, rear = -L / 2
  const zF0 = front - s.glass[0] * L, zF1 = front - s.glass[1] * L, zR1 = front - s.glass[2] * L, zR0 = front - s.glass[3] * L
  const archR = s.wheel + 0.075
  const rN = s.boxy < 3 ? 0.26 : 0.2, rT = s.boxy < 3 ? 0.2 : 0.15
  const bottom = knots([[rear, s.gc + 0.08], [rear + 0.5, s.gc + 0.025], [front - 0.55, s.gc + 0.025], [front, s.gc + 0.05]])
  const shoulder = knots([
    [rear, s.belt * s.tail * 0.97], [rear + 0.35, s.belt * s.tail],
    [zR0, s.belt * (s.fastback ? 0.995 : 1)], [zF0, s.belt], [zF0 + 0.4, s.belt * (s.nose + (1 - s.nose) * 0.6)],
    [front - 0.2, s.belt * s.nose], [front, s.belt * s.nose * 0.96],
  ])
  const flareAt = (z: number) => {
    const d = Math.min(Math.abs(z - axF), Math.abs(z - axR))
    return s.flare * Math.max(0, 1 - (d / (archR + 0.32)) ** 2) ** 0.7
  }
  const halfW = (z: number) => {
    const u = (z - (front + rear) / 2) / (L / 2)
    return (W / 2 - s.flare) * (1 - 0.04 * u ** 4) + flareAt(z)
  }
  const zB = (zF1 + zR1) / 2
  const cabin = (z: number) => {
    if (z >= zF0 || z <= zR0) return 0
    // Windscreen and rear screen as gentle curves, not straight ramps.
    if (z > zF1) return 1 - Math.pow((z - zF1) / (zF0 - zF1), 1.25)
    if (z < zR1) {
      const t = (zR1 - z) / (zR1 - zR0)
      return s.fastback ? 1 - Math.pow(t, 0.8) : 1 - Math.pow(t, 1.3)
    }
    return 1
  }
  // The ends round off: the section shrinks toward its bottom centre over
  // the last rN (nose) or rT (tail), a superellipse in plan and side view.
  const P = 2.6
  const scale = (z: number) => {
    if (z > front - rN) return Math.pow(Math.max(0, 1 - Math.pow((z - (front - rN)) / rN, P)), 1 / P)
    if (z < rear + rT) return Math.pow(Math.max(0, 1 - Math.pow((rear + rT - z) / rT, P)), 1 / P)
    return 1
  }
  // Lower-body points spaced evenly by arc length on the superellipse.
  const e = 2 / s.boxy
  const aSh = Math.acos(Math.pow(0.86, s.boxy / 2))
  const dense: [number, number][] = []
  let acc = 0, px = 0, py = -0.4
  for (let i = 0; i <= 400; i++) {
    const a = -Math.PI / 2 + ((aSh + Math.PI / 2) * i) / 400
    const c = Math.cos(a), sn = Math.sin(a)
    const x = Math.pow(Math.abs(c), e), y = 0.4 * Math.sign(sn) * Math.pow(Math.abs(sn), e)
    if (i) acc += Math.hypot(x - px, y - py)
    px = x
    py = y
    dense.push([a, acc])
  }
  const lowA: number[] = []
  for (let k = 0; k <= NL; k++) {
    const target = (acc * k) / NL
    const hit = dense.find(([, l]) => l >= target) ?? dense[dense.length - 1]
    lowA.push(hit[0])
  }
  const zQ = zF1 + (zF0 - zF1) * 0.38
  const zRq = s.fastback ? zR1 + 0.1 : zR1 - (zR1 - zR0) * 0.22
  return { s, L, W, front, rear, axF, axR, archR, zF0, zF1, zR1, zR0, zB, zQ, zRq, rN, rT, lowA, bottom, shoulder, halfW, cabin, scale }
}

/** Half a cross-section at z: NH+1 points from the bottom centre up the left (+x) side to the roof centre. */
function section(B: Layout, z: number): THREE.Vector2[] {
  const s = B.s
  const y0 = B.bottom(z), ysh = B.shoulder(z), w = B.halfW(z)
  const e = 2 / s.boxy
  const S = Math.pow(Math.sin(B.lowA[NL]), e)
  const hy = (ysh - y0) / (1 + S), ym = y0 + hy
  const pts: THREE.Vector2[] = []
  for (let k = 0; k <= NL; k++) {
    const a = B.lowA[k], c = Math.cos(a), sn = Math.sin(a)
    let x = w * Math.pow(Math.abs(c), e)
    const y = ym + hy * Math.sign(sn) * Math.pow(Math.abs(sn), e)
    // Tumblehome: the upper flank curves in toward the shoulder.
    if (sn > 0) x *= 1 - 0.05 * sn * sn
    pts.push(new THREE.Vector2(x, y))
  }
  const P = pts[NL]
  const crown = 0.045
  const hc = Math.max(0, B.cabin(z) * (s.roof - P.y))
  const f = smooth(0, 0.12, hc)
  // Glasshouse stations.
  const Wb = new THREE.Vector2(P.x - 0.03, P.y + 0.012)
  const side = Math.max(0.03, hc * 0.84 - 0.012)
  const Wt = new THREE.Vector2(Wb.x - side * 0.3, Wb.y + side)
  const g = Math.min(1, hc / 0.25)
  const Re = new THREE.Vector2(Wt.x - 0.07 * g, P.y + Math.max(hc, side + 0.02))
  const wl = Wt.clone().sub(Wb), wlen = wl.length()
  const at = (t: number) => Wb.clone().addScaledVector(wl, t)
  const seal = Math.min(0.3, 0.016 / Math.max(1e-3, wlen))
  const Rp = Re.x - 0.022
  const roofY = (x: number) => Re.y + crown * g * (1 - (x / Re.x) ** 2)
  const cab: THREE.Vector2[] = [
    new THREE.Vector2(P.x - 0.012, P.y + 0.008), Wb, at(seal),
    at(seal + (1 - 2 * seal) * 0.25), at(seal + (1 - 2 * seal) * 0.5), at(seal + (1 - 2 * seal) * 0.75), at(1 - seal), Wt,
    new THREE.Vector2(Wt.x - 0.07 * g * 0.3, Wt.y + (Re.y - Wt.y) * 0.75), Re,
    new THREE.Vector2(Rp, roofY(Rp)),
    new THREE.Vector2(Rp * 0.75, roofY(Rp * 0.75)), new THREE.Vector2(Rp * 0.5, roofY(Rp * 0.5)), new THREE.Vector2(Rp * 0.25, roofY(Rp * 0.25)), new THREE.Vector2(0, roofY(0)),
  ]
  for (let u = 1; u <= NU; u++) {
    // Deck: bonnet or boot lid, rounded at the shoulder.
    const v = u / NU
    const deck = new THREE.Vector2(P.x * (1 - v), P.y + crown * Math.pow(1 - (1 - v) ** 2, 0.6))
    pts.push(deck.lerp(cab[u - 1], f))
  }
  const sc = B.scale(z)
  if (sc < 1) for (const q of pts) q.set(q.x * sc, y0 + (q.y - y0) * sc)
  return pts
}

/** Outer x of the section at height y (the widest crossing), or NaN if y misses it. */
function sideX(B: Layout, z: number, y: number): number {
  const h = section(B, z)
  let best = NaN
  for (let k = 0; k < h.length - 1; k++) {
    const a = h[k], b = h[k + 1]
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue
    const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
    if (!(x <= best)) best = x
  }
  return best
}

/** Top surface height at lateral offset x. */
function topY(B: Layout, z: number, x: number): number {
  const h = section(B, z)
  const ax = Math.abs(x)
  let best = -Infinity
  for (let k = 0; k < h.length - 1; k++) {
    const a = h[k], b = h[k + 1]
    if ((a.x - ax) * (b.x - ax) > 0 || a.x === b.x) continue
    best = Math.max(best, a.y + ((ax - a.x) / (b.x - a.x)) * (b.y - a.y))
  }
  return best
}

/** Row positions: dense where the shape changes fast (ends, arches), exact at every window edge. */
function rows(B: Layout): number[] {
  const out: number[] = []
  const dome = (r: number, n: number, sign: 1 | -1, end: number) => {
    const pts: [number, number][] = []
    let acc = 0, pz = 0, ps = 0
    for (let i = 0; i <= 300; i++) {
      const z = end - sign * (r * i) / 300
      const sc = B.scale(z)
      if (i) acc += Math.hypot((r * 1) / 300, (sc - ps) * 0.45)
      pz = z
      ps = sc
      pts.push([pz, acc])
    }
    const zs: number[] = []
    for (let k = 0; k <= n; k++) {
      const target = (acc * k) / n
      zs.push((pts.find(([, l]) => l >= target) ?? pts[pts.length - 1])[0])
    }
    return zs
  }
  const rearZ = dome(B.rT, 14, -1, B.rear)
  const frontZ = dome(B.rN, 18, 1, B.front).reverse()
  const a = B.rear + B.rT, b = B.front - B.rN
  const brk = [a, b, B.zR0, B.zRq, B.zR1, B.zB - 0.04, B.zB + 0.04, B.zF1, B.zQ, B.zF0]
  for (const ax of [B.axF, B.axR]) brk.push(ax - B.archR, ax + B.archR)
  const pts = [...new Set(brk.filter((z) => z >= a && z <= b))].sort((p, q) => p - q)
  const mid: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const z0 = pts[i], z1 = pts[i + 1]
    const nearArch = [B.axF, B.axR].some((ax) => Math.abs((z0 + z1) / 2 - ax) < B.archR + 0.02)
    const n = Math.max(1, Math.ceil((z1 - z0) / (nearArch ? 0.02 : 0.036)))
    for (let k = 0; k < n; k++) mid.push(z0 + ((z1 - z0) * k) / n)
  }
  mid.push(b)
  out.push(...rearZ.slice(0, -1), ...mid.filter((z, i, arr) => i === 0 || z - arr[i - 1] > 0.004), ...frontZ.slice(1))
  return out
}

interface Shell {
  geo: THREE.BufferGeometry
  labels: Uint8Array
}

/**
 * The shell: rings of the section along the length, wheel arches carved by
 * lifting the lower flank over each wheel, faces labelled paint, glass or
 * black trim (window seals, B-pillar, wheel wells).
 */
function shell(B: Layout, zs: number[], wheelX: number, tw: number): Shell {
  const s = B.s
  const pos = new Float32Array(zs.length * RING * 3)
  const lifted = new Uint8Array(zs.length * RING)
  const xIn = wheelX - tw / 2 - 0.035
  zs.forEach((z, j) => {
    const h = section(B, z)
    for (let r = 0; r < RING; r++) {
      const k = r <= NH ? r : RING - r
      const q = h[k]
      const x = r <= NH ? q.x : -q.x
      let y = q.y
      if (k >= 1 && k <= NL && Math.abs(x) > xIn) {
        for (const ax of [B.axF, B.axR]) {
          const dz = z - ax
          if (Math.abs(dz) < B.archR) {
            const ay = s.wheel + Math.sqrt(B.archR * B.archR - dz * dz) + 0.01
            if (y < ay) {
              y = ay
              lifted[j * RING + r] = 1
            }
          }
        }
      }
      pos.set([x, y, z], (j * RING + r) * 3)
    }
  })
  const label = (zm: number, c: number): number => {
    if (c <= NL + 1) return PAINT
    const ws = zm > B.zF1 && zm < B.zF0, rs = zm > B.zR0 && zm < B.zR1
    const sideGlass = zm < B.zQ && zm > B.zRq
    const pillarB = Math.abs(zm - B.zB) < 0.04
    if (c === NL + 2 || c === NL + 7) return sideGlass ? TRIMQ : PAINT
    if (c <= NL + 6) return sideGlass ? (pillarB ? TRIMQ : GLASS) : PAINT
    if (c <= NL + 9) return PAINT
    if (c === NL + 10) return ws || rs ? TRIMQ : PAINT
    return ws || rs ? GLASS : PAINT
  }
  const R = zs.length - 1
  const lab = new Uint8Array(R * RING)
  for (let j = 0; j < R; j++) {
    const zm = (zs[j] + zs[j + 1]) / 2
    for (let r = 0; r < RING; r++) {
      const c = r < NH ? r : RING - 1 - r
      lab[j * RING + r] = label(zm, c)
    }
  }
  // Glass meeting paint across a row boundary gets a black seal.
  const out = lab.slice()
  for (let j = 0; j < R; j++)
    for (let r = 0; r < RING; r++) {
      const i = j * RING + r
      if (lab[i] !== GLASS) continue
      if ((j > 0 && lab[i - RING] !== GLASS) || (j < R - 1 && lab[i + RING] !== GLASS)) out[i] = TRIMQ
    }
  const idx: number[] = []
  const labels: number[] = []
  for (let j = 0; j < R; j++)
    for (let r = 0; r < RING; r++) {
      const a = j * RING + r, b = j * RING + ((r + 1) % RING), c = a + RING, d = b + RING
      let l = out[j * RING + r]
      if (lifted[a] || lifted[b] || lifted[c] || lifted[d]) l = TRIMQ
      idx.push(a, b, d, a, d, c)
      labels.push(l, l)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  applyUV(geo, B.L, s.roof, B.W)
  return { geo, labels: Uint8Array.from(labels) }
}

/** Triangles of the shell subset with one label, sharing the shell's vertices. */
function subset(sh: Shell, l: number): THREE.BufferGeometry {
  const src = sh.geo.index as THREE.BufferAttribute
  const idx: number[] = []
  for (let t = 0; t < sh.labels.length; t++) if (sh.labels[t] === l) idx.push(src.getX(t * 3), src.getX(t * 3 + 1), src.getX(t * 3 + 2))
  const g = new THREE.BufferGeometry()
  for (const n of ['position', 'normal', 'uv']) g.setAttribute(n, sh.geo.getAttribute(n))
  g.setIndex(idx)
  return g
}

/** Ray casts against the shell, for laying parts onto its surface. */
class Caster {
  private readonly p: THREE.BufferAttribute
  private readonly n: THREE.BufferAttribute
  private readonly idx: THREE.BufferAttribute
  private readonly tri = new THREE.Triangle()
  private readonly ray = new THREE.Ray()
  private readonly hit = V3()
  private readonly bary = V3()
  constructor(g: THREE.BufferGeometry) {
    this.p = g.getAttribute('position') as THREE.BufferAttribute
    this.n = g.getAttribute('normal') as THREE.BufferAttribute
    this.idx = g.index as THREE.BufferAttribute
  }

  /** Triangles within r of a point, so a decal's many rays test only nearby faces. */
  near(c: THREE.Vector3, r: number): number[] {
    const out: number[] = []
    const v = V3()
    for (let t = 0; t < this.idx.count / 3; t++) {
      v.fromBufferAttribute(this.p, this.idx.getX(t * 3))
      if (v.distanceToSquared(c) < r * r) out.push(t)
    }
    return out
  }

  cast(o: THREE.Vector3, d: THREE.Vector3, tris?: number[]): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    this.ray.set(o, d)
    let best = Infinity, bt = -1
    const a = V3(), b = V3(), c = V3()
    const n = tris ? tris.length : this.idx.count / 3
    for (let i = 0; i < n; i++) {
      const t = tris ? tris[i] : i
      a.fromBufferAttribute(this.p, this.idx.getX(t * 3))
      b.fromBufferAttribute(this.p, this.idx.getX(t * 3 + 1))
      c.fromBufferAttribute(this.p, this.idx.getX(t * 3 + 2))
      const h = this.ray.intersectTriangle(a, b, c, false, this.hit)
      if (h) {
        const dist = h.distanceTo(o)
        if (dist < best) {
          best = dist
          bt = t
        }
      }
    }
    if (bt < 0) return null
    const ia = this.idx.getX(bt * 3), ib = this.idx.getX(bt * 3 + 1), ic = this.idx.getX(bt * 3 + 2)
    a.fromBufferAttribute(this.p, ia)
    b.fromBufferAttribute(this.p, ib)
    c.fromBufferAttribute(this.p, ic)
    const p = o.clone().addScaledVector(d, best)
    this.tri.set(a, b, c).getBarycoord(p, this.bary)
    const nn = V3()
      .addScaledVector(V3().fromBufferAttribute(this.n, ia), this.bary.x)
      .addScaledVector(V3().fromBufferAttribute(this.n, ib), this.bary.y)
      .addScaledVector(V3().fromBufferAttribute(this.n, ic), this.bary.z)
      .normalize()
    return { p, n: nn }
  }
}

/** An outline in a decal's (u, v) plane, metres, for an angle round it. */
type Outline = (t: number) => [number, number]
const superEllipse = (a: number, b: number, n: number, slant = 0, taper = 0): Outline => (t) => {
  const c = Math.cos(t), s = Math.sin(t)
  const u = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)
  const v = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (1 + taper * (u / a))
  return [u, v + slant * u]
}

interface DecalOpts {
  /** Outline, its half extents (for UVs) and a horizontal flip for mirrored lamps. */
  shape: Outline
  half: [number, number]
  flip?: boolean
  mat: THREE.Material
  uv?: Rect
  color?: number
  lift?: number
  /** A raised rim round the outline: width, height, material and colour. */
  bezel?: { w: number; h: number; mat: THREE.Material; color: number }
}

/**
 * Lays a patch onto the shell: cast from `from` along `dir` to find the spot,
 * then project a polar grid of the outline onto the surface. The patch hugs
 * the panel exactly, and its optional bezel rises from below the paint, so a
 * lamp reads as set into the body with a lip round it, never as a floating disc.
 */
function decal(cast: Caster, parts: Parts, from: THREE.Vector3, dir: THREE.Vector3, o: DecalOpts): { c: THREE.Vector3; n: THREE.Vector3 } | null {
  const hit = cast.cast(from, dir)
  if (!hit) return null
  const C = hit.p, N = hit.n
  const ref = Math.abs(N.y) > 0.85 ? V3(0, 0, 1) : V3(0, 1, 0)
  const U = ref.clone().cross(N).normalize()
  const Vv = N.clone().cross(U).normalize()
  const size = Math.max(o.half[0], o.half[1])
  const tris = cast.near(C, size * 1.3 + 0.08)
  const SEG = 28, RINGS = 3
  const proj = (u: number, v: number, lift: number) => {
    const org = C.clone().addScaledVector(U, u).addScaledVector(Vv, v).addScaledVector(N, 0.3)
    const h = cast.cast(org, N.clone().negate(), tris)
    return h ? h.p.addScaledVector(h.n, lift) : C.clone().addScaledVector(U, u).addScaledVector(Vv, v).addScaledVector(N, lift)
  }
  const lift = o.lift ?? 0.003
  const rows: THREE.Vector3[][] = []
  const uvs: [number, number][][] = []
  for (let i = 0; i <= RINGS; i++) {
    const r = i / RINGS
    const row: THREE.Vector3[] = [], urow: [number, number][] = []
    for (let j = 0; j <= SEG; j++) {
      const [u, v] = o.shape((j / SEG) * Math.PI * 2)
      row.push(proj(u * r, v * r, lift))
      const fu = 0.5 + ((o.flip ? -u : u) * r) / (2 * o.half[0]), fv = 0.5 + (v * r) / (2 * o.half[1])
      const R = o.uv
      urow.push(R ? [R.u0 + (R.u1 - R.u0) * fu, R.v0 + (R.v1 - R.v0) * fv] : [fu, fv])
    }
    rows.push(row)
    uvs.push(urow)
  }
  parts.add(o.mat, grid(rows, (i, j) => uvs[i][j]), undefined, o.color)
  if (o.bezel) {
    const bz = o.bezel
    const ring = (grow: number, l: number) => {
      const row: THREE.Vector3[] = []
      for (let j = 0; j <= SEG; j++) {
        const [u, v] = o.shape((j / SEG) * Math.PI * 2)
        const len = Math.hypot(u, v) || 1
        const k = 1 + grow / len
        row.push(proj(u * k, v * k, l))
      }
      return row
    }
    parts.add(bz.mat, grid([ring(0, lift - 0.002), ring(0, lift + bz.h), ring(bz.w, lift + bz.h * 0.6), ring(bz.w + 0.004, -0.004)]), undefined, bz.color)
  }
  return { c: C, n: N }
}

/** A tyre as a lathe: bulging sidewall, rounded shoulder, flat tread. */
function tyreGeo(r: number, w: number): THREE.BufferGeometry {
  const rim = r * 0.68
  const prof: [number, number][] = [[rim, -w * 0.42], [r * 0.88, -w * 0.5], [r * 0.97, -w * 0.45], [r, -w * 0.32], [r, w * 0.32], [r * 0.97, w * 0.45], [r * 0.88, w * 0.5], [rim, w * 0.42]]
  return new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 32).rotateZ(Math.PI / 2)
}

/** Paint with dirt that builds from the sills up, and a plain dark inside where the shell is seen from the cabin. */
function dirtShader(m: THREE.MeshPhysicalMaterial, dirt: { value: number }, dirtCol: { value: THREE.Color }, inside: boolean): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = dirt
    sh.uniforms.uDirtCol = dirtCol
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal; uniform float uDirt; uniform vec3 uDirtCol;
        float dh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        float dn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dh(i), dh(i + vec3(1,0,0)), f.x), mix(dh(i + vec3(0,1,0)), dh(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh(i + vec3(0,0,1)), dh(i + vec3(1,0,1)), f.x), mix(dh(i + vec3(0,1,1)), dh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float blot = dn(vLocal * 6.0) * 0.6 + dn(vLocal * 17.0) * 0.4;
        float low = 1.0 - smoothstep(0.15, 0.95, vLocal.y);
        float dirtAmt = clamp(uDirt * (low * 1.3 + 0.15) - (1.0 - blot) * 0.55, 0.0, 0.92);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDirtCol, dirtAmt);
        ${inside ? 'if (!gl_FrontFacing) { diffuseColor.rgb = vec3(0.035, 0.036, 0.04); dirtAmt = 1.0; }' : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, dirtAmt);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
        material.clearcoat *= 1.0 - dirtAmt;
        #endif`)
  }
}

const VISOR: Record<Visor, { color: number; metal: number; irid: number; ior: number; opacity: number }> = {
  iridium: { color: 0x1a2a40, metal: 0.9, irid: 1, ior: 1.6, opacity: 0.92 },
  gold: { color: 0xd8a530, metal: 1, irid: 0.25, ior: 1.3, opacity: 0.95 },
  smoke: { color: 0x15171a, metal: 0.4, irid: 0, ior: 1.3, opacity: 0.85 },
  rainbow: { color: 0x5a3ab0, metal: 0.95, irid: 1, ior: 2.2, opacity: 0.94 },
  clear: { color: 0xdfe8f0, metal: 0, irid: 0, ior: 1.3, opacity: 0.22 },
}

export function buildCar(carId: string, lv: LiveryDef, opts: CarOpts = {}): CarRig {
  const s = SPECS[carId] ?? SPECS.kestrel
  const p = carPhys(carId)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const L = s.L, W = s.W
  const front = L / 2, rear = -L / 2
  const wb = p.a + p.b
  const axF = Math.min(front - s.wheel - 0.32, wb * 0.5 + 0.05)
  const axR = axF - Math.min(wb, L - 0.9)
  const wr = s.wheel
  const B = layout(s, axF, axR)
  const { zF0, zF1, zR1, zR0 } = B
  const Y0 = (z: number) => B.bottom(z)
  const SX = (z: number, y: number) => sideX(B, z, y)
  const TY = (z: number, x: number) => topY(B, z, x)

  // ---- materials
  const frame: BodyFrame = { L, roof: s.roof, belt: s.belt, gc: s.gc, halfW: W / 2, axF, axR, archR: B.archR, zF0, zF1, zR1, zR0 }
  const cv = makeLiveryCanvases()
  paintLivery(cv, lv, frame)
  const tex = new THREE.CanvasTexture(cv.color)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  // Roughness in green, metalness in blue: vinyl decals stay satin on any paint.
  const maskTex = new THREE.CanvasTexture(cv.mask)
  const glassTex = new THREE.CanvasTexture(cv.glass)
  glassTex.colorSpace = THREE.SRGBColorSpace
  const dirt = { value: 0 }
  const dirtCol = { value: new THREE.Color(0x8a7458) }
  const paint = new THREE.MeshPhysicalMaterial({ map: tex, roughnessMap: maskTex, metalnessMap: maskTex, roughness: 1, metalness: 1, side: THREE.DoubleSide })
  const bodyColor = new THREE.MeshPhysicalMaterial({ color: lv.base, side: THREE.DoubleSide })
  const finishPaint = (l: LiveryDef) => {
    const f = FINISH[l.finish ?? 'gloss']
    for (const m of [paint, bodyColor]) {
      m.clearcoat = f.clearcoat
      m.clearcoatRoughness = f.ccRough
      m.iridescence = f.irid
      m.iridescenceIOR = 1.45
    }
    bodyColor.roughness = f.rough
    bodyColor.metalness = f.metal
    bodyColor.color.setHex(l.base)
  }
  finishPaint(lv)
  dirtShader(paint, dirt, dirtCol, true)
  dirtShader(bodyColor, dirt, dirtCol, false)
  // White glass tinted by its map: the tint, the sunstrip and the window name are all painted.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: glassTex, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 1, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })
  let glassK = 1
  const vc = (roughness: number, metalness: number) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, side: THREE.DoubleSide })
  const matte = vc(0.85, 0), gloss = vc(0.32, 0), satin = vc(0.4, 0.55), metal = vc(0.22, 1)
  // Rims and calipers carry the livery's colours as a material tint, so a repaint reaches them.
  const rimMat = vc(0.38, 0.6)
  rimMat.color.setHex(lv.rim)
  const calMat = new THREE.MeshStandardMaterial({ roughness: 0.32 })
  const rubber = new THREE.MeshStandardMaterial({ map: tyreTexture(4), roughness: 0.92 })
  const lens = new THREE.MeshPhysicalMaterial({ map: lampAtlas(), emissiveMap: lampAtlas(), emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 })
  const trim = new THREE.MeshStandardMaterial({ map: trimAtlas(), roughness: 0.55, metalness: 0.2 })
  const skin = vc(0.55, 0)
  let look = opts.look ?? defaultLook()
  let name = opts.name ?? ''
  const shirtTex = shirtTexture(look)
  const shirt = new THREE.MeshStandardMaterial({ map: shirtTex, roughness: 0.8, side: THREE.DoubleSide })
  const helmTex = helmetTexture(look.helmet, name, lv.num)
  const helmet = new THREE.MeshPhysicalMaterial({ map: helmTex, side: THREE.DoubleSide })
  const visor = new THREE.MeshPhysicalMaterial({ roughness: 0.05, transparent: true, side: THREE.DoubleSide })
  const dressHelmet = () => {
    const f = FINISH[look.helmet.finish]
    helmet.roughness = Math.max(0.12, f.rough)
    helmet.metalness = f.metal * 0.8
    helmet.clearcoat = f.clearcoat
    helmet.clearcoatRoughness = f.ccRough
    helmet.iridescence = f.irid
    const v = VISOR[look.helmet.visor]
    visor.color.setHex(v.color)
    visor.metalness = v.metal
    visor.iridescence = v.irid
    visor.iridescenceIOR = v.ior
    visor.opacity = v.opacity
  }
  dressHelmet()
  const mats: THREE.Material[] = [paint, bodyColor, glass, matte, gloss, satin, metal, rimMat, calMat, rubber, lens, trim, skin, shirt, helmet, visor]
  const accent = lv.accent === lv.base ? lv.stripe : lv.accent
  calMat.color.setHex(accent)
  const BLACK = 0x111214, CHROME = 0xd8dadd

  const ext = new Parts()
  const cab = new Parts()

  // ---- wheels' place in the body, then the shell around them
  const tw = 0.21 + s.flare * 0.3
  const lipOut = 0.03 + s.flare * 0.35
  const wheelX = SX(axF, wr) + lipOut - 0.02 - tw / 2
  const zs = rows(B)
  const sh = shell(B, zs, wheelX, tw)
  ext.add(paint, subset(sh, PAINT))
  ext.add(glass, subset(sh, GLASS))
  ext.add(matte, subset(sh, TRIMQ), undefined, 0x0b0b0c)
  const cast = new Caster(sh.geo)

  // ---- arches: a flared lip swept round each opening, mudflap behind each wheel
  const lipMat = s.flare > 0.05 ? bodyColor : matte
  for (const ax of [axF, axR]) for (const side of [1, -1]) {
    const R = B.archR + 0.004
    const rowsL: THREE.Vector3[][] = []
    const N = 30
    const sec: [number, number][] = [[-0.035, 0.05], [lipOut * 0.5, 0.046], [lipOut, 0.02], [lipOut, -0.004], [lipOut - 0.014, -0.02], [-0.045, -0.016]]
    if (side < 0) sec.reverse()
    for (let i = 0; i <= N; i++) {
      const t = -0.14 + ((Math.PI + 0.28) * i) / N
      const z = ax + R * Math.cos(t), y = wr + R * Math.sin(t)
      const xs = SX(z, Math.max(y, Y0(z) + 0.02)) || SX(ax, wr)
      const rad = V3(0, Math.sin(t), Math.cos(t))
      rowsL.push(sec.map(([a, b]) => V3(side * (xs + a), y, z).addScaledVector(rad, b)))
    }
    ext.add(lipMat, solid(rowsL), undefined, 0x151517)
    // Mudflap with its mounting strip.
    const zf = ax - B.archR - 0.025
    const top = Y0(zf) + 0.035, bot = 0.075
    const fw = tw + 0.05
    const flap = atlasUV(new THREE.BoxGeometry(fw, top - bot, 0.008), TRIM.flap)
    ext.add(trim, flap, M(side * (wheelX - 0.005), (top + bot) / 2, zf, 0.05))
    ext.add(matte, new THREE.BoxGeometry(fw + 0.01, 0.03, 0.03), M(side * (wheelX - 0.005), top - 0.01, zf + 0.01), BLACK)
  }
  // Sill skirts between the arches.
  for (const side of [1, -1]) {
    const z0 = axR + B.archR + 0.03, z1 = axF - B.archR - 0.03
    const sec: [number, number][] = [[-0.06, 0.06], [0.0, 0.065], [0.026, 0.025], [0.03, -0.02], [0.0, -0.035], [-0.06, -0.03]]
    if (side < 0) sec.reverse()
    const rowsS: THREE.Vector3[][] = []
    for (let i = 0; i <= 10; i++) {
      const z = z0 + ((z1 - z0) * i) / 10
      const y = Y0(z) + 0.035
      const xs = SX(z, y)
      rowsS.push(sec.map(([a, b]) => V3(side * (xs + a), y + b, z)))
    }
    ext.add(matte, solid(rowsS), undefined, 0x17181a)
  }

  // ---- nose: lamps, grille, plate, splitter or chrome bumpers
  const classic = s.lamps === 'round' || s.lamps === 'twin'
  const hwF = B.halfW(front - B.rN)
  const yN0 = Y0(front), yNs = B.shoulder(front - B.rN)
  const lampY = yN0 + 0.66 * (yNs - yN0)
  const fwd = V3(0, 0, -1), back = V3(0, 0, 1)
  const lights: THREE.Mesh[] = []
  const blackBezel = { w: 0.016, h: 0.007, mat: matte, color: 0x0d0d0f }
  const chromeBezel = { w: 0.014, h: 0.008, mat: metal, color: CHROME }
  for (const side of [1, -1]) {
    const lx = side * hwF * 0.6
    const flip = side < 0
    const o = side
    if (s.lamps === 'round' || s.lamps === 'twin') {
      const n = s.lamps === 'twin' ? 2 : 1
      const r = n === 2 ? 0.066 : 0.082
      for (let k = 0; k < n; k++) {
        const x = lx + side * (n === 2 ? (k ? -0.08 : 0.07) : 0)
        decal(cast, ext, V3(x, lampY, front + 1), fwd, { shape: superEllipse(r, r, 2), half: [r, r], mat: lens, uv: LAMP.round, bezel: chromeBezel })
      }
    } else if (s.lamps === 'square') {
      decal(cast, ext, V3(lx, lampY, front + 1), fwd, { shape: superEllipse(0.125, 0.07, 6), half: [0.125, 0.07], mat: lens, uv: LAMP.rect, flip, bezel: blackBezel })
    } else {
      decal(cast, ext, V3(lx, lampY + 0.01, front + 1), fwd, { shape: superEllipse(0.17, 0.045, 4, 0.12 * o, -0.25 * o), half: [0.17, 0.065], mat: lens, uv: LAMP.slim, flip, bezel: blackBezel })
    }
    // Side repeater on the front wing.
    decal(cast, ext, V3(side * 2, B.shoulder(axF + B.archR + 0.1) - 0.12, axF + B.archR + 0.12), V3(-side, 0, 0), { shape: superEllipse(0.032, 0.013, 2), half: [0.032, 0.013], mat: lens, uv: LAMP.amber, bezel: { w: 0.006, h: 0.004, mat: matte, color: BLACK } })
    // Tail lamps.
    const yR0 = Y0(rear), yRs = B.shoulder(rear + B.rT)
    const tx = side * B.halfW(rear + B.rT) * 0.62
    const ty = yR0 + 0.72 * (yRs - yR0)
    const tflip = side > 0
    if (classic || s.lamps === 'square') decal(cast, ext, V3(tx, ty, rear - 1), back, { shape: superEllipse(0.15, 0.062, 6), half: [0.15, 0.062], mat: lens, uv: LAMP.tailClassic, flip: tflip, bezel: classic ? chromeBezel : blackBezel })
    else decal(cast, ext, V3(tx, ty, rear - 1), back, { shape: superEllipse(0.17, 0.042, 4, -0.1 * side, 0.2 * side), half: [0.17, 0.06], mat: lens, uv: LAMP.tail, flip: tflip, bezel: blackBezel })
    // Tow strap: a loop of webbing half sunk into the bumper.
    for (const [z, d, x, col] of [[front + 1, fwd, side * 0.34, side > 0 ? 0xe02a1a : null], [rear - 1, back, side * 0.3, side < 0 ? 0xf2c037 : null]] as const) {
      if (col === null) continue
      const h = cast.cast(V3(x, Y0(z > 0 ? front : rear) + 0.07, z), d)
      if (!h) continue
      const c = h.p.addScaledVector(h.n, 0.02)
      const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(1, 0, 0)), V3(1, 1, 1))
      ext.add(matte, new THREE.TorusGeometry(0.038, 0.008, 6, 18), m.multiply(M(0, 0, 0, 0, 0, 0, 1, 0.7, 1.6)), col)
    }
  }
  // Grille and intakes.
  if (classic || s.lamps === 'square') {
    const gw = Math.max(0.12, hwF * 0.6 - (classic ? 0.11 : 0.15) - 0.05)
    decal(cast, ext, V3(0, lampY - 0.01, front + 1), fwd, { shape: superEllipse(gw, 0.06, 6), half: [gw, 0.06], mat: trim, uv: TRIM.honey, bezel: classic ? chromeBezel : blackBezel })
    decal(cast, ext, V3(0, yN0 + 0.15, front + 1), fwd, { shape: superEllipse(0.16, 0.04, 8), half: [0.16, 0.04], mat: trim, uv: TRIM.plate, lift: 0.006, bezel: blackBezel })
  } else {
    decal(cast, ext, V3(0, lampY, front + 1), fwd, { shape: superEllipse(hwF * 0.6 - 0.22, 0.024, 6), half: [hwF * 0.6 - 0.22, 0.024], mat: trim, uv: TRIM.slats, bezel: blackBezel })
    decal(cast, ext, V3(0, yN0 + 0.13, front + 1), fwd, { shape: superEllipse(0.36, 0.075, 5, 0, -0.15), half: [0.36, 0.075], mat: trim, uv: TRIM.honey, bezel: blackBezel })
    for (const side of [1, -1]) decal(cast, ext, V3(side * hwF * 0.66, yN0 + 0.11, front + 1), fwd, { shape: superEllipse(0.1, 0.05, 4), half: [0.1, 0.05], mat: trim, uv: TRIM.honey, bezel: blackBezel })
    decal(cast, ext, V3(0, yN0 + 0.13, front + 1), fwd, { shape: superEllipse(0.16, 0.04, 8), half: [0.16, 0.04], mat: trim, uv: TRIM.plate, lift: 0.012 })
  }
  // Rear plate, fuel filler, bonnet vents.
  decal(cast, ext, V3(0, Y0(rear) + 0.42 * (B.shoulder(rear + B.rT) - Y0(rear)), rear - 1), back, { shape: superEllipse(0.16, 0.04, 8), half: [0.16, 0.04], mat: trim, uv: TRIM.plate, flip: true, bezel: blackBezel })
  decal(cast, ext, V3(-2, B.shoulder(axR + 0.4) - 0.1, axR + B.archR + 0.12), V3(1, 0, 0), { shape: superEllipse(0.048, 0.048, 2), half: [0.048, 0.048], mat: trim, uv: TRIM.filler, bezel: { w: 0.008, h: 0.004, mat: metal, color: CHROME } })
  if (s.scoop) for (const side of [1, -1]) {
    decal(cast, ext, V3(side * 0.26, 3, zF0 + 0.3), V3(0, -1, 0), { shape: superEllipse(0.1, 0.12, 5), half: [0.1, 0.12], mat: trim, uv: TRIM.slats, bezel: blackBezel })
  }

  // Splitter under the nose, diffuser under the tail, or chrome bumpers on the classics.
  const outline = (y: number, z0: number, end: 'f' | 'r') => {
    const pts: THREE.Vector2[] = []
    for (const z of zs) {
      if (end === 'f' ? z < z0 : z > z0) continue
      const x = SX(z, y)
      if (Number.isFinite(x)) pts.push(new THREE.Vector2(x, z))
    }
    return end === 'f' ? pts : pts.reverse()
  }
  if (classic) {
    for (const end of ['f', 'r'] as const) {
      const y = Y0(end === 'f' ? front : rear) + 0.075
      const ol = outline(y, end === 'f' ? front - 0.5 : rear + 0.45, end)
      const pts: THREE.Vector3[] = []
      for (const q of ol) pts.push(V3(q.x, y, q.y))
      const path = [...pts, ...pts.slice().reverse().map((v) => V3(-v.x, y, v.z))]
      // Offset outward in plan.
      const off = path.map((v, i) => {
        const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)]
        const t = V3(b.x - a.x, 0, b.z - a.z).normalize()
        const nrm = V3(t.z, 0, -t.x)
        const c = V3(0, y, end === 'f' ? front - 0.8 : rear + 0.8)
        if (nrm.dot(v.clone().sub(c)) < 0) nrm.negate()
        return v.clone().addScaledVector(nrm, 0.035)
      })
      ext.add(metal, tube(off, 0.03, 64, 10), undefined, CHROME)
      for (const v of [off[0], off[off.length - 1]]) ext.add(metal, new THREE.SphereGeometry(0.03, 10, 8), M(v.x, v.y, v.z), CHROME)
      for (const x of [0.4, -0.4]) {
        const h = cast.cast(V3(x, y, end === 'f' ? front + 1 : rear - 1), end === 'f' ? fwd : back)
        if (h) ext.add(metal, rod(h.p.clone().addScaledVector(h.n, -0.03), h.p.clone().addScaledVector(h.n, 0.045), 0.012), undefined, 0x7a7d82)
      }
    }
    ext.add(satin, new THREE.BoxGeometry(W * 0.55, 0.012, 0.7), M(0, Y0(front - 0.5) - 0.004, front - 0.5, 0.04), 0x55585d)
  } else {
    const plate = (end: 'f' | 'r') => {
      const y = Y0(end === 'f' ? front : rear) + 0.01
      const ol = outline(y, end === 'f' ? front - 0.6 : rear + 0.45, end)
      const sh2 = new THREE.Shape()
      const pts = ol.map((q) => new THREE.Vector2(q.x + 0.03, q.y))
      const tip = end === 'f' ? front + 0.05 : rear - 0.02
      const lastX = pts[pts.length - 1]?.x ?? 0.3
      const all = [...pts, new THREE.Vector2(lastX * 0.9, tip), new THREE.Vector2(-lastX * 0.9, tip), ...pts.slice().reverse().map((q) => new THREE.Vector2(-q.x, q.y))]
      all.forEach((q, i) => (i ? sh2.lineTo(q.x, q.y) : sh2.moveTo(q.x, q.y)))
      const g = new THREE.ExtrudeGeometry(sh2, { depth: 0.022, bevelEnabled: false, curveSegments: 1 }).rotateX(Math.PI / 2).translate(0, y + 0.006, 0)
      ext.add(matte, g, undefined, 0x101113)
      return y
    }
    plate('f')
    const yd = plate('r')
    for (const x of [-0.42, -0.14, 0.14, 0.42]) ext.add(matte, new THREE.BoxGeometry(0.012, 0.075, 0.38), M(x, yd - 0.03, rear + 0.24), 0x101113)
  }
  // Exhaust out under the rear bumper, right-hand side.
  {
    const ex = -B.halfW(rear + 0.3) * 0.5, ey = Y0(rear) + 0.06
    const h = cast.cast(V3(ex, ey + 0.02, rear - 1), back)
    const tz = (h ? h.p.z : rear + 0.05) - 0.05
    ext.add(metal, rod(V3(ex, ey, tz + 0.35), V3(ex, ey, tz), 0.034, 12), undefined, 0x4a4643)
    ext.add(metal, new THREE.CylinderGeometry(0.05, 0.046, 0.11, 18, 1, true).rotateX(Math.PI / 2), M(ex, ey, tz - 0.02), 0xb9b3a8)
    ext.add(matte, new THREE.CircleGeometry(0.044, 16).rotateY(Math.PI), M(ex, ey, tz + 0.01), 0x050505)
  }

  // ---- glasshouse fittings: mirrors, wipers, antenna, roof scoop
  for (const side of [1, -1]) {
    const zm = zF0 - 0.1
    const ym = B.shoulder(zm) - 0.02
    const base = V3(side * SX(zm, ym), ym, zm)
    const head = base.clone().add(V3(side * 0.14, 0.09, -0.03))
    ext.add(matte, rod(base.clone().add(V3(-side * 0.02, 0, 0)), head, 0.016, 8, 0.013), undefined, BLACK)
    ext.add(bodyColor, new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI), M(head.x + side * 0.03, head.y, head.z, 0, 0, 0, 0.09, 0.052, 0.062))
    ext.add(metal, new THREE.CylinderGeometry(1, 1, 0.004, 20).rotateX(Math.PI / 2), M(head.x + side * 0.03, head.y, head.z - 0.058, 0, 0, 0, 0.078, 0.044, 1), 0x7d8792)
  }
  {
    const wz = zF0 - 0.05
    for (const [x0, x1] of [[0.38, -0.1], [-0.06, -0.54]]) {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 6; i++) {
        const t = i / 6
        const x = x0 + (x1 - x0) * t, z = wz - 0.06 * t
        pts.push(V3(x, TY(z, x) + 0.012, z))
      }
      ext.add(matte, tube(pts, 0.0055, 12, 5), undefined, BLACK)
      ext.add(matte, new THREE.CylinderGeometry(0.014, 0.016, 0.02, 10), M(pts[0].x, pts[0].y - 0.004, pts[0].z), BLACK)
    }
    const az = zR1 + 0.15
    ext.add(matte, rod(V3(-0.25, TY(az, -0.25) - 0.01, az), V3(-0.25, TY(az, -0.25) + 0.42, az - 0.08), 0.004, 5, 0.002), undefined, BLACK)
    if (s.scoop) {
      // Roof vent scoop feeding the cabin, sitting on the roof crown.
      const z0 = zF1 - 0.08
      const sec: [number, number][] = [[0, -0.025], [0, 0.05], [-0.04, 0.058], [-0.25, 0.012], [-0.27, -0.025]]
      const rowsR: THREE.Vector3[][] = []
      for (let i = 0; i <= 8; i++) {
        const x = -0.13 + (0.26 * i) / 8
        rowsR.push(sec.map(([dz, dh]) => V3(x, TY(z0 + dz, x) + dh, z0 + dz)))
      }
      ext.add(matte, solid(rowsR), undefined, 0x17181b)
      ext.add(trim, atlasUV(new THREE.PlaneGeometry(0.22, 0.04), TRIM.mesh), M(0, TY(z0, 0) + 0.024, z0 + 0.002))
    }
  }
  // Bonnet pins with their safety clips.
  for (const side of [1, -1]) {
    const z = front - B.rN - 0.08, x = side * hwF * 0.55
    const y = TY(z, x)
    ext.add(matte, new THREE.CylinderGeometry(0.022, 0.024, 0.008, 14), M(x, y, z), BLACK)
    ext.add(metal, new THREE.CylinderGeometry(0.007, 0.007, 0.03, 8), M(x, y + 0.014, z), CHROME)
    ext.add(metal, new THREE.TorusGeometry(0.016, 0.0028, 5, 14), M(x, y + 0.006, z - 0.012, Math.PI / 2 - 0.15), CHROME)
  }

  // ---- wings
  const lip = (z0: number, sec: [number, number][], xs: number, follow: boolean) => {
    const rowsW: THREE.Vector3[][] = []
    const n = 14
    for (let i = 0; i <= n; i++) {
      const x = -xs + (2 * xs * i) / n
      rowsW.push(sec.map(([dz, dh]) => V3(x, (follow ? TY(z0 + dz, x) : TY(z0, x)) + dh, z0 + dz)))
    }
    ext.add(bodyColor, solid(rowsW))
  }
  if (s.wing === 'lip') {
    const xs = (section(B, zR1)[NL + 10]?.x ?? W * 0.35) * 0.94
    lip(zR1 + 0.03, [[0.02, -0.02], [0.02, 0.006], [-0.04, 0.026], [-0.15, 0.0], [-0.15, -0.012], [-0.05, -0.022]], xs, false)
  } else if (s.wing === 'duck') {
    const xs = B.halfW(rear + 0.3) * 0.82
    lip(rear, [[0.55, -0.03], [0.55, 0.002], [0.25, 0.02], [0.08, 0.075], [0.04, 0.075], [0.04, -0.03]], xs, true)
  } else if (s.wing === 'big') {
    const hatch = zR0 - rear < 0.5
    const zw = hatch ? zR0 + 0.02 : rear + 0.32
    const yw = hatch ? s.roof - 0.02 : TY(zw, 0) + 0.26
    const span = W / 2 - 0.03, chord = 0.32
    const foil: [number, number][] = [[0.5, 0], [0.42, 0.022], [0.2, 0.034], [-0.1, 0.026], [-0.5, 0.004], [-0.5, -0.006], [-0.1, -0.008], [0.3, -0.012]]
    const ang = -0.12
    const wingRows = (zc: number, yc: number, c: number, a: number, sp: number) => {
      const rr: THREE.Vector3[][] = []
      for (let i = 0; i <= 2; i++) {
        const x = -sp + sp * i
        rr.push(foil.map(([u, v]) => {
          const zz = u * c, yy = v * c * 1.4
          return V3(x, yc + zz * Math.sin(a) + yy * Math.cos(a), zc + zz * Math.cos(a) - yy * Math.sin(a))
        }))
      }
      return rr
    }
    ext.add(bodyColor, solid(wingRows(zw, yw, chord, ang, span)))
    if (carId === 'apex') ext.add(matte, solid(wingRows(zw - 0.17, yw + 0.06, 0.16, -0.45, span)), undefined, 0x16171a)
    ext.add(matte, new THREE.BoxGeometry(span * 2, 0.022, 0.006), M(0, yw + 0.02, zw - chord * 0.5), 0x101112)
    for (const side of [1, -1]) {
      ext.add(trim, atlasUV(new THREE.BoxGeometry(0.008, 0.2, chord + 0.12), TRIM.carbon), M(side * (span + 0.004), yw - 0.02, zw - 0.02))
      const px = side * 0.34, pz = zw + 0.04
      const yb = TY(pz, px)
      ext.add(satin, new THREE.BoxGeometry(0.012, yw - yb + 0.04, 0.07), M(px, (yw + yb) / 2 - 0.01, pz, -0.15), 0x222326)
    }
  }

  // ---- light pod: bonnet pod on the modern cars, a lamp bar on brackets on the older ones
  const spot = (c: THREE.Vector3, r: number, depth: number) => {
    const prof: [number, number][] = [[0.001, -depth], [r * 0.55, -depth], [r * 0.95, -depth * 0.55], [r * 1.04, -0.004], [r * 1.04, 0.006]]
    const lathe = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 20).rotateX(Math.PI / 2)
    ext.add(matte, lathe, M(c.x, c.y, c.z), BLACK)
    ext.add(metal, new THREE.TorusGeometry(r * 1.0, r * 0.08, 6, 24), M(c.x, c.y, c.z + 0.004), CHROME)
    ext.add(lens, atlasUV(new THREE.CircleGeometry(r * 0.97, 24), LAMP.spot), M(c.x, c.y, c.z - 0.002))
  }
  if (s.pod && s.lamps === 'slim') {
    const z0 = front - B.rN - 0.04
    const sec: [number, number][] = [[0, -0.035], [0, 0.075], [-0.025, 0.092], [-0.2, 0.035], [-0.22, -0.035]]
    const rowsP: THREE.Vector3[][] = []
    for (let i = 0; i <= 12; i++) {
      const x = -0.4 + (0.8 * i) / 12
      rowsP.push(sec.map(([dz, dh]) => V3(x, TY(z0 + dz, x) + dh, z0 + dz)))
    }
    ext.add(matte, solid(rowsP), undefined, 0x141517)
    for (const x of [-0.29, -0.097, 0.097, 0.29]) spot(V3(x, TY(z0, x) + 0.036, z0 + 0.012), 0.036, 0.03)
    for (const x of [-0.37, 0.37]) ext.add(metal, new THREE.BoxGeometry(0.03, 0.02, 0.05), M(x, TY(z0 - 0.1, x) + 0.005, z0 - 0.1), 0x8a8d92)
  } else if (s.pod) {
    const yc = Math.max(yN0 + 0.2, lampY - 0.13)
    const yBar = yc - 0.12
    const hb = cast.cast(V3(0, yc, front + 1), fwd)
    const zc = (hb ? hb.p.z : front) + 0.16
    const xs = [-0.52, -0.18, 0.18, 0.52].map((k) => k * hwF)
    for (const x of xs) {
      spot(V3(x, yc, zc), 0.075, 0.1)
      ext.add(satin, rod(V3(x, yBar, zc - 0.05), V3(x, yc - 0.06, zc - 0.05), 0.012), undefined, 0x2a2b2e)
    }
    const bx = hwF * 0.62
    ext.add(satin, rod(V3(-bx, yBar, zc - 0.05), V3(bx, yBar, zc - 0.05), 0.016, 10), undefined, 0x2a2b2e)
    for (const x of [-bx, bx]) ext.add(satin, new THREE.SphereGeometry(0.016, 8, 6), M(x, yBar, zc - 0.05), 0x2a2b2e)
    for (const x of [-0.3 * hwF, 0.3 * hwF]) {
      const h = cast.cast(V3(x, yBar, front + 1), fwd)
      if (h) ext.add(satin, rod(V3(x, yBar, zc - 0.05), h.p.clone().addScaledVector(h.n, -0.04), 0.014, 8), undefined, 0x2a2b2e)
    }
  }

  // ---- cabin: seats, dash, cage, door cards, levers
  const hipY = Y0(B.zB) + 0.16
  const avail = s.roof - 0.07 - 0.16 - 0.17 - hipY
  const tl = THREE.MathUtils.clamp(avail / Math.cos(0.28), 0.34, 0.5)
  const rec = Math.acos(THREE.MathUtils.clamp(avail / tl, 0.5, Math.cos(0.28)))
  const dxS = W * 0.2
  const hipZ = zF1 - 0.42 + tl * 0.97 * Math.sin(rec) - 0.035
  const fr = driverFrame(V3(dxS, hipY, hipZ), rec, tl)
  const frP = driverFrame(V3(-dxS, hipY, hipZ), rec, tl)
  const sm = fr.shoulders[0].clone().add(fr.shoulders[1]).multiplyScalar(0.5)
  const wc = sm.clone().add(V3(0, -0.06, 0.42))
  const wf = wheelFrame(wc, 0.38, 0.165)
  const SEAT = 0x1d2026
  for (const f of [fr, frP]) {
    const T = f.torso
    cab.add(matte, new THREE.BoxGeometry(0.44, 0.09, 0.46), T.clone().multiply(M(0, -0.06, 0.16, rec + 0.1)), SEAT)
    for (const sx of [1, -1]) {
      cab.add(matte, new THREE.BoxGeometry(0.07, 0.12, 0.44), T.clone().multiply(M(sx * 0.21, -0.01, 0.16, rec + 0.1)), SEAT)
      cab.add(matte, new THREE.BoxGeometry(0.075, tl * 1.0, 0.17), T.clone().multiply(M(sx * 0.215, tl * 0.48, -0.06, 0, sx * 0.3)), SEAT)
      cab.add(matte, new THREE.BoxGeometry(0.05, 0.16, 0.13), T.clone().multiply(M(sx * 0.19, tl + 0.13, -0.1, 0, sx * 0.3)), SEAT)
    }
    cab.add(matte, new THREE.BoxGeometry(0.44, tl + 0.26, 0.075), T.clone().multiply(M(0, (tl + 0.26) / 2 - 0.02, -0.15)), SEAT)
    cab.add(matte, new THREE.BoxGeometry(0.1, tl * 0.7, 0.012), T.clone().multiply(M(0, tl * 0.55, -0.11)), accent)
  }
  // Passenger's harness lying on the empty seat.
  for (const sx of [1, -1]) cab.add(matte, new THREE.BoxGeometry(0.045, tl * 0.8, 0.008), frP.torso.clone().multiply(M(sx * 0.09, tl * 0.5, -0.1)), 0xc8231c)
  // Dashboard, extruded across the cabin.
  const zDash = wc.z + 0.09
  const yDash = B.shoulder(zDash) - 0.01
  const xi = SX(zDash, yDash - 0.06) - 0.035
  {
    const sh2 = new THREE.Shape()
    const pts: [number, number][] = [[zF0 + 0.02, B.shoulder(zF0) - 0.03], [zDash + 0.04, yDash + 0.02], [zDash, yDash - 0.02], [zDash, yDash - 0.2], [zDash + 0.12, yDash - 0.34], [zF0 + 0.05, yDash - 0.36]]
    pts.forEach(([z, y], i) => (i ? sh2.lineTo(z, y) : sh2.moveTo(z, y)))
    cab.add(matte, new THREE.ExtrudeGeometry(sh2, { depth: xi * 2, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(xi, 0, 0), undefined, 0x1a1b1e)
    // Gauge binnacle in front of the driver, switch panel in the middle, trip meter for the co-driver.
    cab.add(matte, new THREE.CylinderGeometry(0.13, 0.13, 0.13, 16, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M(dxS, yDash, zDash + 0.06), 0x151618)
    cab.add(trim, atlasUV(new THREE.PlaneGeometry(0.24, 0.12), TRIM.gauges), M(dxS, yDash + 0.03, zDash + 0.1, -0.25, Math.PI))
    cab.add(matte, new THREE.BoxGeometry(0.24, 0.32, 0.26), M(0, yDash - 0.2, zDash + 0.06), 0x1c1d20)
    cab.add(trim, atlasUV(new THREE.PlaneGeometry(0.22, 0.06), TRIM.switches), M(0, yDash - 0.12, zDash - 0.072, 0, Math.PI))
    cab.add(matte, new THREE.BoxGeometry(0.14, 0.06, 0.08), M(-dxS, yDash + 0.04, zDash + 0.02, 0.3), 0x18191b)
    cab.add(trim, atlasUV(new THREE.PlaneGeometry(0.12, 0.045), TRIM.trip), M(-dxS, yDash + 0.045, zDash - 0.022, 0.3, Math.PI))
    // Floor, tunnel, levers, extinguisher.
    const yF = Y0(B.zB) + 0.035
    const fx = SX(B.zB, yF + 0.05) - 0.06
    cab.add(trim, atlasUV(new THREE.BoxGeometry(fx * 2, 0.02, zF0 - zR1), TRIM.tread), M(0, yF, (zF0 + zR1) / 2))
    cab.add(matte, new THREE.BoxGeometry(0.26, 0.16, zDash - (hipZ - 0.4)), M(0, yF + 0.08, (zDash + hipZ - 0.4) / 2), 0x1b1c1f)
    const lever = V3(dxS - 0.25, yF + 0.16, hipZ + 0.42)
    cab.add(metal, rod(lever, lever.clone().add(V3(0, 0.32, -0.1)), 0.009), undefined, 0xb0b4b8)
    cab.add(gloss, new THREE.SphereGeometry(0.028, 12, 8), M(lever.x, lever.y + 0.33, lever.z - 0.1), 0x111111)
    const hb = V3(dxS - 0.27, yF + 0.16, hipZ + 0.22)
    cab.add(metal, rod(hb, hb.clone().add(V3(0, 0.42, -0.2)), 0.011), undefined, 0xc0c4c8)
    cab.add(matte, rod(hb.clone().add(V3(0, 0.34, -0.16)), hb.clone().add(V3(0, 0.46, -0.22)), 0.018), undefined, 0x111111)
    cab.add(gloss, new THREE.CylinderGeometry(0.05, 0.05, 0.34, 14).rotateX(Math.PI / 2), M(0, yF + 0.22, hipZ - 0.15), 0xc8231c)
    // Door cards with pull straps.
    for (const side of [1, -1]) {
      const zc = (B.zB + zF0) / 2 - 0.05, len = zF0 - B.zB - 0.2
      const y0 = yF + 0.14, y1 = B.shoulder(zc) - 0.05, yc = (y0 + y1) / 2
      // The flank curves in toward the sill: keep the card inside it everywhere.
      let xd = Infinity
      for (const z of [zc - len / 2, zc, zc + len / 2]) for (const y of [y0, yc, y1]) xd = Math.min(xd, SX(z, y) - 0.035)
      cab.add(trim, atlasUV(new THREE.BoxGeometry(0.012, y1 - y0, len), TRIM.carbon), M(side * xd, yc, zc))
      cab.add(matte, new THREE.BoxGeometry(0.01, 0.025, 0.2), M(side * (xd - 0.012), yc + 0.06, zc), accent)
    }
  }
  // Roll cage: main hoop behind the seats, A-pillar bars, roof bars with a cross, door bars.
  {
    const CAGE = lv.accent === lv.base ? 0x2a2c30 : lv.accent
    const r = 0.021
    const inX = (z: number, y: number, m = 0.06) => SX(z, y) - m
    const yF = Y0(B.zB) + 0.05
    const roofIn = (z: number, x: number) => TY(z, x) - 0.055
    const zH = hipZ - 0.24
    const hcH = s.roof - B.shoulder(zH)
    const hoopSide = (sd: number) => [V3(sd * inX(zH, yF + 0.06), yF, zH), V3(sd * inX(zH, B.shoulder(zH) - 0.05), B.shoulder(zH) - 0.05, zH), V3(sd * inX(zH, B.shoulder(zH) + hcH * 0.55), B.shoulder(zH) + hcH * 0.55, zH)]
    const corner = (z: number, sd: number) => {
      const x = (section(B, z)[NL + 10]?.x ?? 0.5) - 0.07
      return V3(sd * x, roofIn(z, x), z)
    }
    const cL = corner(zH, 1), cR = corner(zH, -1)
    cab.add(gloss, tube([...hoopSide(1), cL, cR, ...hoopSide(-1).reverse()], r, 60, 7), undefined, CAGE)
    const zA = zF1 - 0.04
    const aL = corner(zA, 1), aR = corner(zA, -1)
    for (const [sd, top] of [[1, aL], [-1, aR]] as const) {
      const pts = [V3(sd * inX(zF0 - 0.12, yF + 0.1), yF + 0.06, zF0 - 0.12), V3(sd * inX(zF0 - 0.14, B.shoulder(zF0) - 0.05), B.shoulder(zF0) - 0.05, zF0 - 0.14)]
      for (const t of [0.35, 0.7]) {
        const z = zF0 + (zA - zF0) * t
        const y = B.shoulder(z) + B.cabin(z) * (s.roof - B.shoulder(z)) * 0.82 - 0.04
        pts.push(V3(sd * inX(z, Math.min(y, s.roof - 0.1), 0.07), y, z))
      }
      pts.push(top)
      cab.add(gloss, tube(pts, r, 30, 7), undefined, CAGE)
      cab.add(gloss, rod(top, sd > 0 ? cL : cR, r, 7), undefined, CAGE)
      // Door bars: an X across each door opening.
      const zd0 = zF0 - 0.2, zd1 = zH
      const xd = (z: number, y: number) => sd * (inX(z, y, 0.075))
      const yLo = yF + 0.16, yHi = B.shoulder(zd0) - 0.08
      cab.add(gloss, rod(V3(xd(zd0, yLo), yLo, zd0), V3(xd(zd1, yHi), yHi, zd1), r * 0.9, 7), undefined, CAGE)
      cab.add(gloss, rod(V3(xd(zd0, yHi), yHi, zd0), V3(xd(zd1, yLo), yLo, zd1), r * 0.9, 7), undefined, CAGE)
      // Rear stays down to the floor behind.
      const zs0 = Math.max(zR0 + 0.25, zH - 0.75)
      cab.add(gloss, rod(sd > 0 ? cL : cR, V3(sd * inX(zs0, yF + 0.15, 0.1), yF + 0.12, zs0), r * 0.9, 7), undefined, CAGE)
    }
    cab.add(gloss, rod(aL, cR, r * 0.9, 7), undefined, CAGE)
    cab.add(gloss, rod(aR.clone().add(V3(0, -0.012, 0)), cL.clone().add(V3(0, -0.012, 0)), r * 0.9, 7), undefined, CAGE)
    cab.add(gloss, rod(aL, aR, r, 7), undefined, CAGE)
    const hb = fr.shoulders[0].y + 0.04
    cab.add(gloss, rod(V3(inX(zH, hb), hb, zH), V3(-inX(zH, hb), hb, zH), r * 0.9, 7), undefined, CAGE)
    cab.add(gloss, rod(hoopSide(1)[0], cR, r * 0.9, 7), undefined, CAGE)
  }

  // ---- steering wheel and driver
  const steering = new THREE.Group()
  steering.position.copy(wc)
  steering.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wf.e1, wf.e2, wf.n.clone().negate()))
  body.add(steering)
  const wheelSpin = new THREE.Group()
  steering.add(wheelSpin)
  {
    const col = new Parts()
    col.add(matte, new THREE.CylinderGeometry(0.03, 0.035, 0.34, 10).rotateX(Math.PI / 2), M(0, 0, 0.2), 0x161719)
    col.add(matte, new THREE.BoxGeometry(0.1, 0.07, 0.12), M(0, -0.02, 0.12), 0x161719)
    col.build(steering, false, true)
    const sw = new Parts()
    sw.add(matte, new THREE.TorusGeometry(0.165, 0.017, 10, 40), undefined, 0x1a1a1c)
    sw.add(gloss, new THREE.TorusGeometry(0.165, 0.0175, 10, 4, 0.16), M(0, 0, 0, 0, 0, Math.PI / 2 - 0.08), 0xf2c037)
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const e = V3(Math.cos(a) * 0.155, Math.sin(a) * 0.155, 0)
      sw.add(satin, rod(V3(0, 0, 0.055), e, 0.012, 6, 0.016), undefined, 0x2b2d31)
    }
    sw.add(satin, new THREE.CylinderGeometry(0.05, 0.055, 0.05, 16).rotateX(Math.PI / 2), M(0, 0, 0.055), 0x2b2d31)
    sw.add(metal, new THREE.CylinderGeometry(0.028, 0.028, 0.02, 14).rotateX(Math.PI / 2), M(0, 0, 0.026), 0xb8bcc2)
    sw.add(gloss, new THREE.CylinderGeometry(0.009, 0.009, 0.01, 8).rotateX(Math.PI / 2), M(0.04, 0.03, 0.03), 0xd8231c)
    sw.add(gloss, new THREE.CylinderGeometry(0.009, 0.009, 0.01, 8).rotateX(Math.PI / 2), M(-0.04, 0.03, 0.03), 0x2aa84a)
    sw.build(wheelSpin, false, true)
  }
  const driverMats = { skin, shirt, matte, gloss, metal, helmet, visor }
  let driver: Driver = buildDriver(fr, tl, wf, driverMats, 0xc8231c, look)
  body.add(driver.group)
  driver.pose(0, 0, 0)
  let helmetOn = true
  let lastPose: [number, number, number] = [0, 0, 0]

  // ---- wheels: pivot steers, spin rolls; one set of geometry shared by all four
  const wheels: CarRig['wheels'] = []
  const wheelGeos: THREE.BufferGeometry[] = []
  const wheelMeshes = (() => {
    const w = new Parts()
    w.add(rubber, tyreGeo(wr, tw))
    const rr = wr * 0.68
    w.add(rimMat, new THREE.CylinderGeometry(rr * 0.97, rr * 0.97, tw * 0.82, 28, 1, true).rotateZ(Math.PI / 2))
    w.add(rimMat, new THREE.TorusGeometry(rr * 0.985, 0.012, 6, 32).rotateY(Math.PI / 2), M(tw * 0.41, 0, 0))
    const spokes = s.flare > 0.06 ? 7 : 5
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2
      for (const off of spokes === 7 ? [-0.11, 0.11] : [0]) {
        const aa = a + off
        const hub = V3(tw * 0.2, Math.sin(aa) * 0.058, Math.cos(aa) * 0.058)
        const out = V3(tw * 0.38, Math.sin(aa + off * 0.2) * (rr - 0.012), Math.cos(aa + off * 0.2) * (rr - 0.012))
        w.add(rimMat, rod(hub, out, spokes === 7 ? 0.0105 : 0.017, 6, spokes === 7 ? 0.008 : 0.013))
      }
    }
    w.add(rimMat, new THREE.CylinderGeometry(0.065, 0.07, 0.045, 18).rotateZ(Math.PI / 2), M(tw * 0.2, 0, 0))
    w.add(metal, new THREE.CylinderGeometry(0.03, 0.034, 0.03, 12).rotateZ(Math.PI / 2), M(tw * 0.24, 0, 0), 0xc0c4c8)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      w.add(metal, new THREE.CylinderGeometry(0.009, 0.009, 0.022, 6).rotateZ(Math.PI / 2), M(tw * 0.235, Math.sin(a) * 0.045, Math.cos(a) * 0.045), 0x9a9ea4)
    }
    w.add(metal, new THREE.CylinderGeometry(wr * 0.56, wr * 0.56, 0.026, 32).rotateZ(Math.PI / 2), M(-0.005, 0, 0), 0x8a8c90)
    w.add(metal, new THREE.TorusGeometry(wr * 0.4, 0.006, 4, 32).rotateY(Math.PI / 2), M(0.012, 0, 0), 0x5a5c60)
    w.add(metal, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 18).rotateZ(Math.PI / 2), M(0.03, 0, 0), 0x45474b)
    const g = new THREE.Group()
    const meshes = w.build(g, true, false)
    for (const m of meshes) wheelGeos.push(m.geometry)
    return meshes
  })()
  const calGeo = new THREE.TorusGeometry(wr * 0.47, 0.03, 6, 10, 0.95).rotateY(Math.PI / 2)
  wheelGeos.push(calGeo)
  for (const [z, isFront] of [[axF, true], [axR, false]] as const) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group()
      pivot.position.set(side * wheelX, wr, z)
      const spin = new THREE.Group()
      spin.scale.x = side
      for (const m of wheelMeshes) {
        const c = new THREE.Mesh(m.geometry, m.material)
        c.castShadow = true
        spin.add(c)
      }
      pivot.add(spin)
      const cal = new THREE.Mesh(calGeo, calMat)
      cal.position.x = side * 0.02
      // Calipers sit behind the axle, high: the classic gravel-car look through the spokes.
      cal.rotation.x = isFront ? 2.1 : 1.0
      cal.scale.x = side
      pivot.add(cal)
      root.add(pivot)
      wheels.push({ pivot, spin, front: isFront })
    }
  }

  // ---- assemble
  const extMeshes = ext.build(body, true, false)
  for (const m of extMeshes) {
    if (m.material === glass) m.castShadow = false
    if (m.material === paint) m.receiveShadow = true
    if (m.material === lens) lights.push(m)
  }
  cab.build(body, false, true)
  // Local origin at road level under the middle of the wheelbase.
  const mid = (axF + axR) / 2
  body.position.z = -mid
  for (const w of wheels) w.pivot.position.z -= mid

  const steerMax = p.steerMax || 0.52
  const zb = zF0 + 0.25
  const bonnet = V3(0, TY(zb, 0) + 0.085, zb)
  sh.geo.dispose()
  return {
    root, body, wheels, lights,
    eye: driver.eye.clone(),
    bonnet,
    setDirt(amount, color) {
      dirt.value = amount
      dirtCol.value.setHex(color)
    },
    steer(angle, lat = 0) {
      const turn = THREE.MathUtils.clamp(angle / steerMax, -1.2, 1.2) * 1.75
      wheelSpin.rotation.z = -turn
      lastPose = [turn, THREE.MathUtils.clamp(lat, -2, 2) * 0.09, THREE.MathUtils.clamp(angle / steerMax, -1, 1) * 0.35]
      driver.pose(...lastPose)
    },
    interior(on) {
      driver.head.visible = !on
      // Inside, the tint all but goes: the sunstrip still shows across the top of the screen.
      glassK = on ? 0.25 : 1
      glass.opacity = glassK
    },
    repaint(l) {
      paintLivery(cv, l, frame)
      tex.needsUpdate = true
      maskTex.needsUpdate = true
      glassTex.needsUpdate = true
      finishPaint(l)
      rimMat.color.setHex(l.rim)
      calMat.color.setHex(l.accent === l.base ? l.stripe : l.accent)
      drawHelmet(helmTex.image as HTMLCanvasElement, look.helmet, name, l.num)
      helmTex.needsUpdate = true
      lv = l
    },
    setDriver(next, nextName) {
      look = next
      if (nextName !== undefined) name = nextName
      body.remove(driver.group)
      driver.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      driver = buildDriver(fr, tl, wf, driverMats, 0xc8231c, look)
      driver.helmet(helmetOn)
      body.add(driver.group)
      driver.pose(...lastPose)
      drawShirt(shirtTex.image as HTMLCanvasElement, look)
      shirtTex.needsUpdate = true
      drawHelmet(helmTex.image as HTMLCanvasElement, look.helmet, name, lv.num)
      helmTex.needsUpdate = true
      dressHelmet()
    },
    helmet(on) {
      helmetOn = on
      driver.helmet(on)
    },
    clearGlass(k) {
      glass.opacity = glassK * k
    },
    dispose() {
      const shared = new Set(wheelGeos)
      root.traverse((o) => {
        if (o instanceof THREE.Mesh && !shared.has(o.geometry)) o.geometry.dispose()
      })
      for (const g of shared) g.dispose()
      for (const m of mats) m.dispose()
      for (const t of [tex, maskTex, glassTex, helmTex, shirtTex]) t.dispose()
    },
  }
}
