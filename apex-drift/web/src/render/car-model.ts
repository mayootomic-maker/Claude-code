import * as THREE from 'three'
import { carPhys, type LiveryDef } from '../data'

/**
 * Rally cars built from lofted cross-sections: each body is a series of
 * rounded slices along its length, so panels curve the way pressed steel
 * does. Arches, flares, glasshouse, interior and running gear are added on
 * top. All designs are original; none copies a real manufacturer's car.
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
  dispose(): void
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const SIDE_V = 0.6 // livery canvas: top 60% is the side panel, bottom 40% the bonnet/roof strip

/** Piecewise-linear interpolation through (x, y) knots. */
function knots(pts: [number, number][]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
        const t = (x - x0) / (x1 - x0)
        // Smoothstep between knots: no creases where the profile changes slope.
        const s = t * t * (3 - 2 * t)
        return y0 + (y1 - y0) * s
      }
    }
    return pts[pts.length - 1][1]
  }
}

function liveryTexture(lv: LiveryDef, s: Spec): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  const W = 2048, H = 1024, SH = H * SIDE_V
  const base = hex(lv.base), stripe = hex(lv.stripe), accent = hex(lv.accent)
  g.fillStyle = base
  g.fillRect(0, 0, W, H)
  // The side panel is painted once and mirrored for the left side, so it's
  // drawn here in "right side" orientation: x = rear→front, y = roof→sill.
  const side = (draw: () => void) => {
    g.save()
    draw()
    g.restore()
  }
  side(() => {
    switch (lv.pattern) {
      case 'stripes':
        g.fillStyle = stripe
        g.fillRect(0, SH * 0.5, W, 34)
        g.fillRect(0, SH * 0.58, W, 14)
        break
      case 'band':
        g.fillStyle = stripe
        g.fillRect(0, SH * 0.46, W, 90)
        g.fillStyle = accent
        g.fillRect(0, SH * 0.46 + 90, W, 18)
        break
      case 'chevron':
        g.fillStyle = stripe
        g.beginPath()
        g.moveTo(W * 0.25, SH)
        g.lineTo(W * 0.52, SH * 0.3)
        g.lineTo(W * 0.66, SH * 0.3)
        g.lineTo(W * 0.39, SH)
        g.fill()
        g.fillStyle = accent
        g.fillRect(0, SH * 0.86, W, 26)
        break
      case 'split':
        g.fillStyle = stripe
        g.fillRect(0, SH * 0.62, W, SH * 0.38)
        g.fillStyle = accent
        g.fillRect(0, SH * 0.6, W, 18)
        break
      case 'tricolor':
        for (let i = 0; i < 3; i++) {
          g.fillStyle = [stripe, base, accent][i]
          g.fillRect(0, SH * (0.42 + i * 0.13), W, SH * 0.13)
        }
        break
      case 'dots':
        g.fillStyle = stripe
        for (let y = 20; y < H; y += 70) for (let x = (y / 70) % 2 ? 35 : 0; x < W; x += 70) {
          g.beginPath()
          g.arc(x, y, 14, 0, Math.PI * 2)
          g.fill()
        }
        break
    }
    // Panel shut lines and door handles: tiny details, big difference.
    g.strokeStyle = 'rgba(0,0,0,0.38)'
    g.lineWidth = 3
    const xAt = (fracFromFront: number) => W * (1 - fracFromFront)
    const doorF = xAt(s.glass[0] + 0.02), doorR = xAt((s.glass[1] + s.glass[2]) / 2 + 0.05)
    g.beginPath()
    g.moveTo(doorF, SH * 0.04)
    g.lineTo(doorF - 10, SH * 0.88)
    g.moveTo(doorR, SH * 0.04)
    g.lineTo(doorR + 4, SH * 0.82)
    g.moveTo(doorF, SH * 0.88)
    g.lineTo(doorR + 4, SH * 0.86)
    g.stroke()
    g.fillStyle = 'rgba(20,20,22,0.7)'
    g.fillRect(doorR + 40, SH * 0.2, 70, 12)
    // Door roundel with the number.
    const cx = (doorF + doorR) / 2
    g.fillStyle = '#f3f1ea'
    g.beginPath()
    g.ellipse(cx, SH * 0.62, 104, 90, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#16181b'
    g.font = '800 150px "Barlow Condensed", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(lv.num, cx, SH * 0.64)
    // Sponsor on the rear quarter, small decals ahead of the door.
    g.fillStyle = lv.accent === lv.base ? stripe : accent
    g.font = '800 72px "Barlow Condensed", sans-serif'
    g.fillText(lv.sponsor, doorR / 2, SH * 0.62)
    g.font = '700 30px "Barlow Condensed", sans-serif'
    g.fillStyle = 'rgba(20,20,22,0.75)'
    g.fillText('TOMIĆ STUDIOS RALLY TEAM', cx, SH * 0.84)
  })
  // Bonnet and roof strip (y from SH to H, centre line in the middle).
  const mid = SH + (H - SH) / 2
  if (lv.pattern === 'stripes') {
    g.fillStyle = stripe
    g.fillRect(0, mid - 70, W, 46)
    g.fillRect(0, mid + 24, W, 46)
  } else if (lv.pattern === 'band' || lv.pattern === 'split') {
    g.fillStyle = stripe
    g.fillRect(0, mid - 40, W, 80)
  }
  g.save()
  g.translate(W * 0.86, mid)
  g.rotate(Math.PI / 2)
  g.fillStyle = '#f3f1ea'
  g.font = '800 64px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(lv.bonnet ?? lv.sponsor, 0, 0)
  g.restore()
  // Roof number.
  g.save()
  g.translate(W * (1 - (s.glass[1] + s.glass[2]) / 2), mid)
  g.rotate(Math.PI / 2)
  g.fillStyle = '#f3f1ea'
  g.fillRect(-70, -50, 140, 100)
  g.fillStyle = '#16181b'
  g.font = '800 90px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(lv.num, 0, 4)
  g.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** UVs from position and normal: sides sample the side panel (mirrored on the left), tops the bonnet strip. */
function applyUV(g: THREE.BufferGeometry, L: number, H: number, W: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const nx = n.getX(i), ny = n.getY(i)
    let u = (z + L / 2) / L
    let v: number
    if (Math.abs(nx) > ny * 0.9) {
      // Right side (-x) reads rear→front left to right; the left side mirrors it.
      if (nx > 0) u = 1 - u
      v = 1 - (1 - THREE.MathUtils.clamp(y / H, 0, 1)) * SIDE_V
    } else {
      v = (1 - SIDE_V) * (1 - THREE.MathUtils.clamp((x + W / 2) / W, 0, 1))
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * The body shell: rings of a superellipse cross-section along the length.
 * Height, width and shoulder follow profile curves; wheel arches are carved
 * by lifting the sill vertices that sit over each wheel.
 */
function bodyShell(s: Spec, axF: number, axR: number): THREE.BufferGeometry {
  const L = s.L, W = s.W
  const front = L / 2, rear = -L / 2
  const zScreenF = front - s.glass[0] * L, zScreenR = front - s.glass[3] * L
  const top = knots([
    [rear, s.belt * s.tail * 0.62], [rear + 0.12, s.belt * s.tail * 0.96], [rear + 0.35, s.belt * s.tail],
    [zScreenR, s.belt * (s.fastback ? 1.0 : 1.0)], [zScreenF, s.belt], [zScreenF + 0.4, s.belt * (s.nose + (1 - s.nose) * 0.6)],
    [front - 0.25, s.belt * s.nose], [front - 0.05, s.belt * s.nose * 0.88], [front, s.belt * s.nose * 0.6],
  ])
  const bottom = knots([[rear, s.gc + 0.18], [rear + 0.2, s.gc + 0.02], [front - 0.25, s.gc + 0.02], [front, s.gc + 0.16]])
  const flareAt = (z: number) => {
    const d = Math.min(Math.abs(z - axF), Math.abs(z - axR))
    return s.flare * Math.max(0, 1 - (d / (s.wheel + 0.35)) ** 2)
  }
  const half = (z: number) => {
    const end = Math.min(z - rear, front - z)
    const round = Math.sqrt(Math.min(1, end / 0.32)) * 0.22 + 0.78
    return (W / 2 - s.flare) * round + flareAt(z)
  }
  const RING = 36
  const ROWS = 72
  const pos: number[] = []
  const archR = s.wheel + 0.07
  for (let j = 0; j <= ROWS; j++) {
    const z = rear + (L * j) / ROWS
    const y0 = bottom(z), y1 = top(z)
    const ym = (y0 + y1) / 2, hy = (y1 - y0) / 2
    const w = half(z)
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2
      const c = Math.cos(a), sn = Math.sin(a)
      const e = 2 / s.boxy
      let x = w * Math.sign(c) * Math.pow(Math.abs(c), e)
      let y = ym + hy * Math.sign(sn) * Math.pow(Math.abs(sn), e)
      // Tumblehome: the upper half curves inward toward the shoulder.
      if (sn > 0) x *= 1 - 0.07 * sn * sn
      // Arches: over each wheel, sill vertices on the outer side rise to the arch line.
      if (sn < 0.15 && Math.abs(c) > 0.55) {
        for (const wz of [axF, axR]) {
          const dz = z - wz
          if (Math.abs(dz) < archR) {
            const ay = s.wheel + Math.sqrt(archR * archR - dz * dz) + 0.01
            if (y < ay) y = ay
          }
        }
      }
      pos.push(x, y, z)
    }
  }
  const idx: number[] = []
  for (let j = 0; j < ROWS; j++)
    for (let k = 0; k < RING; k++) {
      const a = j * RING + k, b = j * RING + ((k + 1) % RING)
      const c = a + RING, d = b + RING
      idx.push(a, b, d, a, d, c)
    }
  // End caps: a vertex at the centre of the first and last ring.
  const capR = pos.length / 3
  pos.push(0, (bottom(rear) + top(rear)) / 2, rear - 0.01)
  const capF = capR + 1
  pos.push(0, (bottom(front) + top(front)) / 2, front + 0.01)
  for (let k = 0; k < RING; k++) {
    idx.push(capR, ((k + 1) % RING), k)
    const o = ROWS * RING
    idx.push(capF, o + k, o + ((k + 1) % RING))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * The glasshouse: a narrower loft from the shoulder to the roof, with the
 * screens raked. Faces in the pillar zones and on top take the body paint,
 * the rest is glass (material groups 0 = paint, 1 = glass).
 */
function glasshouse(s: Spec, shoulderHalf: (z: number) => number): THREE.BufferGeometry {
  const L = s.L
  const front = L / 2
  const zF0 = front - s.glass[0] * L, zF1 = front - s.glass[1] * L, zR1 = front - s.glass[2] * L, zR0 = front - s.glass[3] * L
  const ROWS = 40
  // Section corners, as (lateral fraction, height fraction): sill of the window, then up to the roof.
  const sect: [number, number][] = [[-0.97, 0], [-0.86, 0.72], [-0.7, 1], [-0.25, 1.04], [0.25, 1.04], [0.7, 1], [0.86, 0.72], [0.97, 0]]
  const pos: number[] = []
  const zs: number[] = []
  for (let j = 0; j <= ROWS; j++) {
    const z = zR0 + ((zF0 - zR0) * j) / ROWS
    zs.push(z)
    // Raked screens: the roof height ramps up from the shoulder at each end.
    const rampF = z > zF1 ? 1 - (z - zF1) / (zF0 - zF1) : 1
    const rampR = z < zR1 ? (z - zR0) / (zR1 - zR0) : 1
    const h = Math.max(0.02, Math.min(rampF, rampR)) * (s.roof - s.belt)
    const w = shoulderHalf(z) * 0.97
    for (const [fx, fy] of sect) {
      const narrow = 1 - 0.18 * fy
      pos.push(fx * w * narrow, s.belt - 0.005 + fy * h, z)
    }
  }
  const N = sect.length
  const idx: number[] = []
  for (let j = 0; j < ROWS; j++)
    for (let k = 0; k < N - 1; k++) {
      const a = j * N + k, b = a + 1, c = a + N, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  void zs
  return g
}

/** Pillar and roof frame: where the glasshouse is painted metal, with the roof as a solid panel. */
function roofAndPillars(s: Spec, shoulderHalf: (z: number) => number): { roof: THREE.BufferGeometry; pillars: [THREE.Vector3, THREE.Vector3][] } {
  const L = s.L, front = L / 2
  const zF0 = front - s.glass[0] * L, zF1 = front - s.glass[1] * L, zR1 = front - s.glass[2] * L, zR0 = front - s.glass[3] * L
  const top = s.belt + 1.045 * (s.roof - s.belt)
  const ROWS = 16, COLS = 10
  const pos: number[] = []
  for (let j = 0; j <= ROWS; j++) {
    const z = zR1 - 0.02 + ((zF1 - zR1 + 0.04) * j) / ROWS
    const w = shoulderHalf(z) * 0.97 * 0.82 * 0.74
    for (let i = 0; i <= COLS; i++) {
      const u = i / COLS * 2 - 1
      // A gentle crown across the roof.
      pos.push(u * w, top + 0.012 - 0.035 * u * u, z)
    }
  }
  const idx: number[] = []
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const a = j * (COLS + 1) + i, b = a + 1, c = a + COLS + 1, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  const roof = new THREE.BufferGeometry()
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  roof.setIndex(idx)
  roof.computeVertexNormals()
  const pillars: [THREE.Vector3, THREE.Vector3][] = []
  const B = (zF1 + zR1) / 2
  for (const side of [1, -1]) {
    // On the glass edge: bottom at 97 % of the glasshouse width, top where the roof begins.
    const at = (z: number, up: boolean) => new THREE.Vector3(side * shoulderHalf(z) * 0.97 * (up ? 0.56 : 0.975), up ? top - 0.06 : s.belt + 0.01, z)
    pillars.push([at(zF0 - 0.02, false), at(zF1, true)])
    pillars.push([at(B, false), at(B, true)])
    pillars.push([at(zR1, true), at(zR0 + 0.02, false)])
  }
  return { roof, pillars }
}

/** A tyre as a lathe: bulging sidewall, rounded shoulder, flat tread. */
function tyreGeo(r: number, w: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []
  const rim = r * 0.66
  const prof: [number, number][] = [[rim, -w * 0.42], [r * 0.9, -w * 0.5], [r * 0.98, -w * 0.44], [r, -w * 0.3], [r, w * 0.3], [r * 0.98, w * 0.44], [r * 0.9, w * 0.5], [rim, w * 0.42]]
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y))
  return new THREE.LatheGeometry(pts, 28).rotateZ(Math.PI / 2)
}

export function buildCar(carId: string, lv: LiveryDef): CarRig {
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

  const tex = liveryTexture(lv, s)
  const paint = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.28, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.12 })
  const bodyColor = new THREE.MeshPhysicalMaterial({ color: lv.base, roughness: 0.28, metalness: 0.1, clearcoat: 0.7 })
  // Tinted rally glass: you glimpse the cage and crew, the windows still read as solid.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x070b0f, roughness: 0.03, metalness: 0.3, transparent: true, opacity: 0.93, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })
  const black = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.75 })
  const satin = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.3 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.15, metalness: 1 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 })
  const rimM = new THREE.MeshStandardMaterial({ color: lv.rim, roughness: 0.35, metalness: 0.55 })
  const disc = new THREE.MeshStandardMaterial({ color: 0x8c8e92, roughness: 0.4, metalness: 0.9 })
  const caliper = new THREE.MeshStandardMaterial({ color: (lv as LiveryDef & { caliper?: number }).caliper ?? 0xd0302a, roughness: 0.4, metalness: 0.2 })
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xfff8ea, emissive: 0xfff1d0, emissiveIntensity: 0.35, roughness: 0.05, transmission: 0, clearcoat: 1 })
  const tailM = new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff2010, emissiveIntensity: 0.35, roughness: 0.2 })
  const amber = new THREE.MeshStandardMaterial({ color: 0xc87a10, emissive: 0xff9a20, emissiveIntensity: 0.15, roughness: 0.2 })
  const cage = new THREE.MeshStandardMaterial({ color: lv.accent === lv.base ? 0x2a2c30 : lv.accent, roughness: 0.4, metalness: 0.4 })
  const seat = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.9 })
  const suit = new THREE.MeshStandardMaterial({ color: lv.stripe, roughness: 0.8 })
  const helmet = new THREE.MeshPhysicalMaterial({ color: lv.base, roughness: 0.2, clearcoat: 1 })
  const visor = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.05, metalness: 0.8 })
  const mats: THREE.Material[] = [paint, bodyColor, glass, black, satin, chrome, rubber, rimM, disc, caliper, lens, tailM, amber, cage, seat, suit, helmet, visor]
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    parent.add(m)
    return m
  }

  // ---- shell and glass
  const shell = bodyShell(s, axF, axR)
  applyUV(shell, L, s.roof, W)
  add(shell, paint, 0, 0, 0)
  const shoulderHalf = (z: number) => {
    const end = Math.min(z - rear, front - z)
    return (W / 2 - s.flare) * (Math.sqrt(Math.min(1, end / 0.32)) * 0.22 + 0.78) * 0.93
  }
  add(glasshouse(s, shoulderHalf), glass, 0, 0, 0)
  const { roof, pillars } = roofAndPillars(s, shoulderHalf)
  applyUV(roof, L, s.roof, W)
  add(roof, paint, 0, 0, 0)
  for (const [a, b] of pillars) {
    const d = b.clone().sub(a)
    const m = add(new THREE.BoxGeometry(0.045, d.length(), 0.055), bodyColor, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  }
  // Dark inner arch liners, so you never see through the body behind a wheel.
  for (const z of [axF, axR]) for (const side of [1, -1]) {
    const liner = new THREE.CylinderGeometry(wr + 0.06, wr + 0.06, 0.32, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2)
    add(liner, black, side * (W / 2 - 0.2), wr, z, 0, 0, 0).material = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 1, side: THREE.DoubleSide })
  }
  add(new THREE.BoxGeometry(W - 0.3, 0.05, L - 0.6), black, 0, s.gc + 0.03, 0)

  // ---- interior: seats, dash, cage, crew in helmets
  const cabinZ = (front - s.glass[1] * L + front - s.glass[2] * L) / 2
  const seatGeo = new THREE.BoxGeometry(0.42, 0.7, 0.12)
  for (const side of [1, -1]) {
    const x = side * W * 0.2
    add(seatGeo, seat, x, s.gc + 0.62, cabinZ - 0.3, -0.12)
    add(new THREE.BoxGeometry(0.42, 0.1, 0.48), seat, x, s.gc + 0.32, cabinZ - 0.08)
    // Crew: race suit, helmet with visor.
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 12), suit, x, s.gc + 0.6, cabinZ - 0.18, -0.15)
    add(new THREE.SphereGeometry(0.15, 16, 12), helmet, x, s.belt + 0.2, cabinZ - 0.12)
    add(new THREE.SphereGeometry(0.152, 16, 8, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.35, Math.PI * 0.25), visor, x, s.belt + 0.2, cabinZ - 0.12)
  }
  add(new THREE.BoxGeometry(W * 0.8, 0.18, 0.3), satin, 0, s.belt - 0.05, front - s.glass[0] * L - 0.25)
  add(new THREE.TorusGeometry(0.17, 0.025, 8, 20), black, W * 0.2, s.belt + 0.04, front - s.glass[0] * L - 0.42, -0.35)
  const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a)
    const m = add(new THREE.CylinderGeometry(0.022, 0.022, d.length(), 8), cage, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  }
  const zB = cabinZ - 0.45, zA = front - s.glass[1] * L + 0.08, cw = W * 0.3, ry = s.roof - 0.1
  for (const side of [1, -1]) {
    tube(new THREE.Vector3(side * cw, s.gc + 0.1, zB), new THREE.Vector3(side * cw, ry, zB))
    tube(new THREE.Vector3(side * cw * 0.95, s.belt, zA - 0.2), new THREE.Vector3(side * cw * 0.9, ry, zA))
    tube(new THREE.Vector3(side * cw * 0.9, ry, zA), new THREE.Vector3(side * cw, ry, zB))
  }
  tube(new THREE.Vector3(-cw, ry, zB), new THREE.Vector3(cw, ry, zB))
  tube(new THREE.Vector3(-cw, s.gc + 0.1, zB), new THREE.Vector3(cw, ry, zB))

  // ---- lights, grille, bumpers
  const lights: THREE.Mesh[] = []
  const noseY = s.belt * s.nose * 0.72
  add(new THREE.BoxGeometry(W * 0.42, 0.12, 0.04), black, 0, noseY - 0.04, front + 0.0)
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(W * 0.4, 0.008, 0.045), satin, 0, noseY - 0.09 + i * 0.022, front + 0.002)
  for (const side of [1, -1]) {
    const x = side * (W / 2 - 0.3)
    const hz = front - 0.03
    if (s.lamps === 'round' || s.lamps === 'twin') {
      const n = s.lamps === 'twin' ? 2 : 1
      for (let k = 0; k < n; k++) {
        const lx = x - side * k * 0.2
        add(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 20).rotateX(Math.PI / 2), chrome, lx, noseY, hz)
        lights.push(add(new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), lens, lx, noseY, hz + 0.012))
      }
    } else {
      const lw = s.lamps === 'slim' ? 0.36 : 0.28, lh = s.lamps === 'slim' ? 0.08 : 0.14
      add(new THREE.BoxGeometry(lw + 0.03, lh + 0.03, 0.03), chrome, x, noseY, hz)
      lights.push(add(new THREE.BoxGeometry(lw, lh, 0.03), lens, x, noseY, hz + 0.008))
    }
    add(new THREE.BoxGeometry(0.1, 0.05, 0.02), amber, side * (W / 2 - 0.12), noseY - 0.12, front - 0.06)
    add(new THREE.BoxGeometry(0.34, 0.12, 0.02), tailM, side * (W / 2 - 0.28), s.belt * s.tail * 0.8, rear + 0.01)
    add(new THREE.BoxGeometry(0.1, 0.12, 0.02), amber, side * (W / 2 - 0.08), s.belt * s.tail * 0.8, rear + 0.03)
    // Mirrors.
    const mz = front - s.glass[0] * L - 0.1
    add(new THREE.BoxGeometry(0.16, 0.09, 0.12), bodyColor, side * (shoulderHalf(mz) + 0.1), s.belt + 0.1, mz)
    add(new THREE.BoxGeometry(0.06, 0.02, 0.03), black, side * (shoulderHalf(mz) + 0.02), s.belt + 0.06, mz)
    // Tow hooks, in safety yellow and red.
    add(new THREE.TorusGeometry(0.04, 0.012, 6, 12), new THREE.MeshStandardMaterial({ color: side > 0 ? 0xf2c037 : 0xd8452f }), side * 0.4, s.gc + 0.22, front + 0.03, 0, Math.PI / 2)
  }
  if (s.pod) {
    add(new THREE.BoxGeometry(1.0, 0.05, 0.06), black, 0, noseY + 0.12, front + 0.05)
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.23
      add(new THREE.CylinderGeometry(0.085, 0.07, 0.1, 16).rotateX(Math.PI / 2), black, x, noseY + 0.2, front + 0.1)
      lights.push(add(new THREE.CircleGeometry(0.075, 18), lens, x, noseY + 0.2, front + 0.152))
    }
  }
  const bumperGeo = new THREE.CapsuleGeometry(0.045, W * 0.84, 4, 10).rotateZ(Math.PI / 2).scale(1, 1.4, 1)
  if (s.lamps === 'round' || s.lamps === 'twin') {
    // Only the classics wear chrome bumpers; later cars have them moulded into the body.
    add(bumperGeo, chrome, 0, s.gc + 0.2, front + 0.02)
    add(bumperGeo, chrome, 0, s.gc + 0.2, rear - 0.02)
  }
  // Sump guard: every rally car runs one.
  add(new THREE.BoxGeometry(W * 0.6, 0.02, 0.8), satin, 0, s.gc + 0.01, front - 0.55, 0.12)
  for (const z of [axF - wr - 0.1, axR - wr - 0.12]) for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(0.26, 0.3, 0.015), black, side * (W / 2 - 0.22), s.gc + 0.02, z)
  }
  // Exhaust, fuel filler, roof vent, antenna, wipers, bonnet scoop, bonnet pins.
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12).rotateX(Math.PI / 2), chrome, W * 0.3, s.gc + 0.08, rear - 0.06)
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 14).rotateZ(Math.PI / 2), chrome, -(W / 2 - 0.02), s.belt - 0.1, axR + 0.3)
  const roofZ = (front - s.glass[1] * L + front - s.glass[2] * L) / 2
  add(new THREE.BoxGeometry(0.3, 0.06, 0.34), black, 0, s.roof + 0.03, roofZ - 0.1)
  add(new THREE.CylinderGeometry(0.005, 0.008, 0.6, 5), black, W * 0.25, s.roof + 0.28, roofZ - 0.4)
  const screenZ = front - s.glass[0] * L
  for (const side of [1, -1]) add(new THREE.BoxGeometry(0.45, 0.012, 0.012), black, side * 0.22, s.belt + 0.03, screenZ - 0.06, 0, side * 0.3)
  if (s.scoop) add(new THREE.BoxGeometry(0.5, 0.06, 0.4), satin, 0, s.belt * (s.nose + (1 - s.nose) * 0.6) + 0.02, screenZ + 0.4)
  for (const side of [1, -1]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), chrome, side * 0.45, s.belt * s.nose * 0.99, front - 0.2)

  // ---- wing
  if (s.wing !== 'none') {
    const zt = s.fastback ? rear + 0.2 : front - s.glass[3] * L - 0.02
    if (s.wing === 'lip') {
      add(new THREE.BoxGeometry(W * 0.78, 0.035, 0.22), paint, 0, s.roof - 0.02, front - s.glass[2] * L - 0.12, -0.15)
    } else if (s.wing === 'duck') {
      add(new THREE.BoxGeometry(W * 0.86, 0.06, 0.28), paint, 0, s.belt * s.tail + 0.04, rear + 0.2, -0.35)
    } else {
      const h = 0.3
      add(new THREE.BoxGeometry(W * 0.94, 0.04, 0.36), paint, 0, s.belt * s.tail + h, Math.max(rear + 0.25, zt - 0.4), -0.06)
      for (const side of [1, -1]) {
        add(new THREE.BoxGeometry(0.03, 0.14, 0.4), black, side * W * 0.47, s.belt * s.tail + h + 0.02, Math.max(rear + 0.25, zt - 0.4))
        add(new THREE.BoxGeometry(0.035, h, 0.14), black, side * W * 0.3, s.belt * s.tail + h / 2, Math.max(rear + 0.25, zt - 0.4))
      }
    }
  }

  // ---- wheels: pivot steers, spin rolls. Tyre, multi-spoke rim, disc and caliper.
  const wheels: CarRig['wheels'] = []
  const tyre = tyreGeo(wr, 0.22)
  const rimFace = new THREE.CylinderGeometry(wr * 0.64, wr * 0.64, 0.02, 24).rotateZ(Math.PI / 2)
  const barrel = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.2, 24, 1, true).rotateZ(Math.PI / 2)
  const spoke = new THREE.BoxGeometry(0.03, wr * 0.56, 0.06)
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12).rotateZ(Math.PI / 2)
  const discGeo = new THREE.CylinderGeometry(wr * 0.52, wr * 0.52, 0.025, 24).rotateZ(Math.PI / 2)
  const caliperGeo = new THREE.BoxGeometry(0.06, 0.12, 0.2)
  const spokes = s.flare > 0.08 ? 6 : 5
  for (const [z, isFront] of [[axF, true], [axR, false]] as const) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group()
      pivot.position.set(side * (W / 2 - 0.15 + s.flare * 0.7), wr, z)
      const spin = new THREE.Group()
      spin.add(new THREE.Mesh(tyre, rubber))
      spin.add(new THREE.Mesh(barrel, black))
      const face = new THREE.Mesh(rimFace, rimM)
      face.position.x = side * 0.085
      face.scale.set(1, 0.35, 0.35)
      spin.add(face)
      for (let k = 0; k < spokes; k++) {
        const sp = new THREE.Mesh(spoke, rimM)
        sp.position.x = side * 0.09
        sp.rotation.x = (k / spokes) * Math.PI * 2
        sp.translateY(wr * 0.3)
        spin.add(sp)
      }
      const h = new THREE.Mesh(hub, chrome)
      h.position.x = side * 0.1
      spin.add(h)
      pivot.add(spin)
      // Brakes don't spin with the wheel, the disc does.
      const d = new THREE.Mesh(discGeo, disc)
      d.position.x = side * 0.02
      spin.add(d)
      const cal = new THREE.Mesh(caliperGeo, caliper)
      cal.position.set(side * 0.04, wr * 0.32, isFront ? -0.08 : 0.08)
      pivot.add(cal)
      root.add(pivot)
      wheels.push({ pivot, spin, front: isFront })
    }
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = o.material !== glass
      o.receiveShadow = false
    }
  })
  // Local origin at road level under the middle of the wheelbase.
  const mid = (axF + axR) / 2
  body.position.z = -mid
  for (const w of wheels) w.pivot.position.z -= mid

  return {
    root, body, wheels, lights,
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material
          if (!Array.isArray(m) && !mats.includes(m)) m.dispose()
        }
      })
      for (const m of mats) m.dispose()
      tex.dispose()
    },
  }
}
