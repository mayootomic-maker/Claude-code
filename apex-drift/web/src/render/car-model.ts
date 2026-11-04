import * as THREE from 'three'
import { carPhys, type LiveryDef } from '../data'

interface Shape {
  /** Overall length, width, beltline and roof height (m). */
  L: number
  W: number
  belt: number
  roof: number
  /** Ground clearance and wheel radius. */
  gc: number
  wheel: number
  /** Bonnet drop at the nose (m) and tail drop. */
  nose: number
  tail: number
  /** Windscreen base / roof front / roof rear / rear screen base, as fraction of L from the front. */
  screen: [number, number, number, number]
  /** Corner chamfer: round 60s cars are soft, 80s box arches are sharp. */
  bevel: number
  wing: 'none' | 'lip' | 'big'
  lamps: 'round' | 'square' | 'slim'
  arches: number
  pod: boolean
}

const SHAPES: Record<string, Shape> = {
  piccola: { L: 3.15, W: 1.42, belt: 0.82, roof: 1.33, gc: 0.17, wheel: 0.27, nose: 0.14, tail: 0.1, screen: [0.36, 0.5, 0.86, 0.95], bevel: 0.12, wing: 'none', lamps: 'round', arches: 0, pod: false },
  ventura: { L: 4.15, W: 1.6, belt: 0.88, roof: 1.38, gc: 0.18, wheel: 0.3, nose: 0.06, tail: 0.04, screen: [0.36, 0.47, 0.72, 0.8], bevel: 0.08, wing: 'none', lamps: 'round', arches: 0, pod: false },
  kestrel: { L: 3.75, W: 1.6, belt: 0.86, roof: 1.36, gc: 0.19, wheel: 0.3, nose: 0.1, tail: 0.04, screen: [0.33, 0.47, 0.88, 0.97], bevel: 0.07, wing: 'lip', lamps: 'round', arches: 0.02, pod: true },
  ruska: { L: 4.1, W: 1.64, belt: 0.9, roof: 1.42, gc: 0.2, wheel: 0.3, nose: 0.04, tail: 0.02, screen: [0.34, 0.44, 0.74, 0.82], bevel: 0.04, wing: 'none', lamps: 'square', arches: 0, pod: true },
  saetta: { L: 3.9, W: 1.7, belt: 0.76, roof: 1.14, gc: 0.16, wheel: 0.3, nose: 0.28, tail: 0.02, screen: [0.4, 0.56, 0.78, 0.92], bevel: 0.05, wing: 'lip', lamps: 'slim', arches: 0.04, pod: true },
  bison: { L: 4.3, W: 1.72, belt: 1.02, roof: 1.62, gc: 0.28, wheel: 0.36, nose: 0.06, tail: 0.0, screen: [0.3, 0.4, 0.92, 0.98], bevel: 0.05, wing: 'none', lamps: 'round', arches: 0.05, pod: true },
  falco: { L: 3.95, W: 1.78, belt: 0.72, roof: 1.08, gc: 0.15, wheel: 0.31, nose: 0.3, tail: 0.04, screen: [0.36, 0.5, 0.66, 0.9], bevel: 0.04, wing: 'lip', lamps: 'slim', arches: 0.06, pod: true },
  boxer: { L: 4.05, W: 1.8, belt: 0.84, roof: 1.34, gc: 0.18, wheel: 0.32, nose: 0.1, tail: 0.02, screen: [0.34, 0.47, 0.86, 0.96], bevel: 0.03, wing: 'lip', lamps: 'square', arches: 0.1, pod: true },
  vulcan: { L: 3.85, W: 1.78, belt: 0.84, roof: 1.33, gc: 0.18, wheel: 0.32, nose: 0.12, tail: 0.05, screen: [0.33, 0.47, 0.84, 0.95], bevel: 0.05, wing: 'lip', lamps: 'square', arches: 0.1, pod: true },
  corsaire: { L: 4.3, W: 1.76, belt: 0.86, roof: 1.38, gc: 0.18, wheel: 0.32, nose: 0.1, tail: 0.04, screen: [0.36, 0.47, 0.73, 0.82], bevel: 0.06, wing: 'big', lamps: 'slim', arches: 0.07, pod: false },
  strada: { L: 4.05, W: 1.78, belt: 0.86, roof: 1.4, gc: 0.18, wheel: 0.32, nose: 0.12, tail: 0.05, screen: [0.34, 0.47, 0.86, 0.96], bevel: 0.07, wing: 'big', lamps: 'slim', arches: 0.08, pod: false },
  apex: { L: 4.1, W: 1.88, belt: 0.82, roof: 1.32, gc: 0.17, wheel: 0.33, nose: 0.14, tail: 0.05, screen: [0.35, 0.48, 0.85, 0.96], bevel: 0.06, wing: 'big', lamps: 'slim', arches: 0.12, pod: false },
}

export interface CarRig {
  root: THREE.Group
  /** Body: pitch and roll are applied here so the wheels stay on the ground. */
  body: THREE.Group
  wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[]
  lights: THREE.Mesh[]
  dispose(): void
}

const col = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** Paints the livery: side panel on the top half of the canvas, bonnet/roof on the bottom. */
function liveryTexture(lv: LiveryDef): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  const W = 1024, S = 300 // side panel height
  g.fillStyle = col(lv.base)
  g.fillRect(0, 0, W, 512)
  const stripe = col(lv.stripe), accent = col(lv.accent)
  // Side panel (y 0..S, top = roofline, x = rear→front).
  switch (lv.pattern) {
    case 'stripes':
      g.fillStyle = stripe
      g.fillRect(0, S * 0.55, W, 18)
      g.fillRect(0, S * 0.62, W, 8)
      g.fillStyle = stripe
      g.fillRect(0, S + 212 / 2 - 60, W, 34)
      g.fillRect(0, S + 212 / 2 + 26, W, 34)
      break
    case 'band':
      g.fillStyle = stripe
      g.fillRect(0, S * 0.5, W, 46)
      g.fillStyle = accent
      g.fillRect(0, S * 0.5 + 46, W, 10)
      break
    case 'chevron':
      g.fillStyle = stripe
      g.beginPath()
      g.moveTo(W * 0.3, S)
      g.lineTo(W * 0.55, S * 0.35)
      g.lineTo(W * 0.68, S * 0.35)
      g.lineTo(W * 0.43, S)
      g.fill()
      g.fillStyle = accent
      g.fillRect(0, S * 0.86, W, 14)
      break
    case 'split':
      g.fillStyle = stripe
      g.fillRect(0, S * 0.62, W, S * 0.38)
      g.fillStyle = accent
      g.fillRect(0, S * 0.6, W, 10)
      break
    case 'tricolor':
      for (let i = 0; i < 3; i++) {
        g.fillStyle = [stripe, col(lv.base), accent][i]
        g.fillRect(0, S * (0.45 + i * 0.12), W, S * 0.12)
      }
      break
    case 'dots':
      g.fillStyle = stripe
      for (let y = 20; y < 512; y += 46) for (let x = (y / 46) % 2 ? 23 : 0; x < W; x += 46) {
        g.beginPath()
        g.arc(x, y, 9, 0, Math.PI * 2)
        g.fill()
      }
      break
  }
  // Door roundel with the number.
  g.fillStyle = '#f3f1ea'
  g.beginPath()
  g.arc(W * 0.52, S * 0.52, 58, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#16181b'
  g.font = '800 82px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(lv.num, W * 0.52, S * 0.54)
  // Sponsor along the sill, and on the bonnet.
  g.fillStyle = col(lv.accent === lv.base ? lv.stripe : lv.accent)
  g.font = '800 44px "Barlow Condensed", sans-serif'
  g.fillText(lv.sponsor, W * 0.5, S * 0.84)
  g.save()
  g.translate(W * 0.84, S + 106)
  g.rotate(-Math.PI / 2)
  g.fillStyle = '#f3f1ea'
  g.font = '800 40px "Barlow Condensed", sans-serif'
  g.fillText(lv.bonnet ?? lv.sponsor, 0, 0)
  g.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function buildCar(carId: string, lv: LiveryDef): CarRig {
  const s = SHAPES[carId] ?? SHAPES.kestrel
  const p = carPhys(carId)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const L = s.L, W = s.W
  const wb = p.a + p.b
  const front = L / 2, rear = -L / 2
  // Axle positions relative to the body centre; keep overhangs plausible.
  const axF = Math.min(front - 0.55, p.a * (L * 0.5 / Math.max(wb * 0.62, 1)))
  const axR = -Math.min(-rear - 0.5, wb - axF)
  const wr = s.wheel, gc = s.gc

  const tex = liveryTexture(lv)
  const paint = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.18 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.08, metalness: 0.6 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.25, metalness: 0.9 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 })
  const rimM = new THREE.MeshStandardMaterial({ color: lv.rim, roughness: 0.35, metalness: 0.6 })
  const head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.4, roughness: 0.2 })
  const tailM = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2010, emissiveIntensity: 0.3, roughness: 0.3 })
  const mats = [paint, dark, glass, chrome, rubber, rimM, head, tailM]

  // ---- lower body: side profile with wheel-arch notches, extruded across the width.
  const shape = new THREE.Shape()
  const archR = wr + 0.06 + s.arches * 0.4
  shape.moveTo(rear, gc + 0.05)
  shape.lineTo(axR - archR, gc + 0.05)
  shape.absarc(axR, wr, archR, Math.PI, 0, true)
  shape.lineTo(axF - archR, gc + 0.05)
  shape.absarc(axF, wr, archR, Math.PI, 0, true)
  shape.lineTo(front, gc + 0.05)
  shape.lineTo(front + 0.02, gc + 0.38)
  shape.lineTo(front - 0.06, s.belt - s.nose)
  const screenF = front - s.screen[0] * L
  const screenR = front - s.screen[3] * L
  shape.lineTo(screenF + 0.25, s.belt - s.nose * 0.25)
  shape.lineTo(screenF, s.belt)
  shape.lineTo(screenR, s.belt)
  shape.lineTo(rear + 0.04, s.belt - s.tail)
  shape.lineTo(rear, gc + 0.3)
  shape.closePath()
  const bev = Math.min(0.08, s.bevel * 0.8)
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: W - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 2, curveSegments: 10 })
  orient(bodyGeo, W - bev * 2)
  tumblehome(bodyGeo, s.belt - 0.15, 0.08)
  liveryUV(bodyGeo, L, s.roof, W)
  const bodyMesh = new THREE.Mesh(bodyGeo, paint)
  body.add(bodyMesh)

  // ---- glasshouse and roof.
  const gw = W * 0.84
  const cab = new THREE.Shape()
  const roofF = front - s.screen[1] * L, roofR = front - s.screen[2] * L
  cab.moveTo(screenF - 0.02, s.belt - 0.02)
  cab.lineTo(roofF, s.roof - 0.04)
  cab.lineTo(roofR, s.roof - 0.04)
  cab.lineTo(screenR + 0.02, s.belt - 0.02)
  cab.closePath()
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: gw, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 })
  orient(cabGeo, gw)
  body.add(new THREE.Mesh(cabGeo, glass))
  const roofShape = new THREE.Shape()
  roofShape.moveTo(roofF + 0.04, s.roof - 0.06)
  roofShape.lineTo(roofF - 0.02, s.roof + 0.01)
  roofShape.lineTo(roofR + 0.02, s.roof + 0.01)
  roofShape.lineTo(roofR - 0.03, s.roof - 0.06)
  roofShape.closePath()
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: gw + 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 })
  orient(roofGeo, gw + 0.04)
  liveryUV(roofGeo, L, s.roof, W)
  body.add(new THREE.Mesh(roofGeo, paint))
  // B-pillars in body colour so the glass reads as windows, not a black blob.
  // (The A-pillar is slanted with the windscreen; an upright box there pokes
  // through the glass, so it's left to the glass shape itself.)
  for (const z of [(roofF + roofR) / 2 - 0.05]) {
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.03, s.roof - s.belt, 0.09), paint)
      pillar.position.set(side * (gw / 2 + 0.02), (s.roof + s.belt) / 2 - 0.02, z)
      body.add(pillar)
    }
  }
  // Roof vent: every rally car of the era has one.
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.36), dark)
  vent.position.set(0, s.roof + 0.04, (roofF + roofR) / 2)
  body.add(vent)

  // ---- lights.
  const lights: THREE.Mesh[] = []
  for (const side of [1, -1]) {
    const x = side * (W / 2 - 0.28)
    let hl: THREE.Mesh
    if (s.lamps === 'round') {
      hl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16).rotateX(Math.PI / 2), head)
      hl.position.set(x, s.belt - s.nose - 0.08, front + bev + 0.01)
    } else {
      hl = new THREE.Mesh(new THREE.BoxGeometry(s.lamps === 'slim' ? 0.36 : 0.26, s.lamps === 'slim' ? 0.07 : 0.14, 0.05), head)
      hl.position.set(x, s.belt - s.nose - 0.08, front + bev + 0.01)
    }
    body.add(hl)
    lights.push(hl)
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.04), tailM)
    tl.position.set(side * (W / 2 - 0.25), s.belt - s.tail - 0.12, rear - bev - 0.01)
    body.add(tl)
  }
  if (s.pod) {
    // Four-lamp pod for night stages.
    for (let i = 0; i < 4; i++) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 14).rotateX(Math.PI / 2), head)
      lamp.position.set((i - 1.5) * 0.2, s.belt - s.nose * 0.6 + 0.08, front + bev - 0.05)
      body.add(lamp)
      lights.push(lamp)
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.05), dark)
    bar.position.set(0, s.belt - s.nose * 0.6 + 0.02, front + bev - 0.07)
    body.add(bar)
  }

  // ---- bumpers, mudflaps, wing, exhaust.
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.14, 0.12), s.lamps === 'round' ? chrome : dark)
  bumperF.position.set(0, gc + 0.16, front + 0.02)
  const bumperR = bumperF.clone()
  bumperR.position.z = rear - 0.02
  body.add(bumperF, bumperR)
  for (const z of [axF - archR - 0.04, axR - archR - 0.04]) for (const side of [1, -1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.02), dark)
    flap.position.set(side * (W / 2 - 0.2), gc + 0.02, z)
    body.add(flap)
  }
  if (s.wing !== 'none') {
    const span = s.wing === 'big' ? W * 0.92 : W * 0.8
    const h = s.wing === 'big' ? 0.22 : 0.04
    const plank = new THREE.Mesh(new THREE.BoxGeometry(span, 0.04, s.wing === 'big' ? 0.3 : 0.18), paint)
    const roofEnd = front - s.screen[3] * L
    plank.position.set(0, s.belt - s.tail + h + 0.05, Math.max(rear + 0.18, roofEnd - 0.2))
    if (s.wing === 'lip') plank.position.set(0, s.roof - 0.02, roofR - 0.08)
    body.add(plank)
    if (s.wing === 'big') for (const side of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.14), dark)
      post.position.set(side * span * 0.35, s.belt - s.tail + h / 2 + 0.03, plank.position.z)
      body.add(post)
    }
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10).rotateX(Math.PI / 2), chrome)
  pipe.position.set(W * 0.3, gc + 0.06, rear - 0.05)
  body.add(pipe)
  // Dark underside so nothing behind the arches reads as a hole.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.06, L - 0.3), dark)
  floor.position.set(0, gc + 0.04, 0)
  body.add(floor)

  // ---- wheels: pivot steers, spin rolls.
  const wheels: CarRig['wheels'] = []
  const tyreGeo = new THREE.CylinderGeometry(wr, wr, 0.22, 20, 1).rotateZ(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(wr * 0.64, wr * 0.64, 0.235, 14, 1).rotateZ(Math.PI / 2)
  const spokeGeo = new THREE.BoxGeometry(0.02, wr * 1.1, 0.06)
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8).rotateZ(Math.PI / 2)
  for (const [z, isFront] of [[axF, true], [axR, false]] as const) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group()
      pivot.position.set(side * (W / 2 - 0.16 + s.arches * 0.2), wr, z)
      const spin = new THREE.Group()
      spin.add(new THREE.Mesh(tyreGeo, rubber))
      spin.add(new THREE.Mesh(rimGeo, rimM))
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(spokeGeo, rimM)
        sp.position.x = side * 0.12
        sp.rotation.x = (k / 5) * Math.PI
        spin.add(sp)
      }
      const hub = new THREE.Mesh(hubGeo, chrome)
      spin.add(hub)
      pivot.add(spin)
      root.add(pivot)
      wheels.push({ pivot, spin, front: isFront })
    }
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })
  // The car's local origin is at road level under the centre of the wheelbase.
  const mid = (axF + axR) / 2
  body.position.z = -mid
  for (const w of wheels) w.pivot.position.z -= mid

  return {
    root, body, wheels, lights,
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      for (const m of mats) m.dispose()
      tex.dispose()
    },
  }
}

/** Extrude geometry is built in the profile plane; turn it so length runs along +Z and width is centred. */
function orient(g: THREE.BufferGeometry, depth: number): void {
  g.rotateY(-Math.PI / 2)
  g.translate(depth / 2, 0, 0)
}

/** Pull the upper body in toward the centre line: a slab-sided car looks like a box. */
function tumblehome(g: THREE.BufferGeometry, from: number, amount: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    if (y > from) p.setX(i, p.getX(i) * (1 - Math.min(amount, (y - from) * 0.35)))
  }
  p.needsUpdate = true
  g.computeVertexNormals()
}

/**
 * Side faces sample the top part of the livery canvas by (length, height);
 * upward faces sample the bottom part by (length, width). The left side is
 * mirrored so numbers and sponsors read correctly on both sides.
 */
function liveryUV(g: THREE.BufferGeometry, L: number, H: number, W: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = new Float32Array(p.count * 2)
  const SIDE = 300 / 512
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const nx = n.getX(i), ny = n.getY(i)
    let u = (z + L / 2) / L
    let v: number
    if (Math.abs(nx) >= Math.abs(ny)) {
      if (nx > 0) u = 1 - u
      v = 1 - (1 - Math.min(1, Math.max(0, y / H))) * SIDE
    } else {
      v = (1 - SIDE) * (1 - (x + W / 2) / W)
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}
