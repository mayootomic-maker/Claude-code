import * as THREE from 'three'

/**
 * Accumulates many small primitives into one non-indexed geometry with
 * per-vertex colour and a sway weight, so a whole tile of scenery is one draw
 * call. Normals are per face: the low-poly shapes stay crisp instead of the
 * melted look smooth normals give merged boxes.
 */
export class GeoBuilder {
  private pos: number[] = []
  private nor: number[] = []
  private col: number[] = []
  private sway: number[] = []
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly v = new THREE.Vector3()
  private readonly n = new THREE.Vector3()
  private readonly nm = new THREE.Matrix3()
  private readonly c = new THREE.Color()

  get empty(): boolean {
    return this.pos.length === 0
  }

  /**
   * Add `geo` scaled, rotated (yaw, then optional tilt) and moved to (x,y,z).
   * `swayBase`/`swayTop` set how much the wind moves the bottom and top.
   */
  add(
    geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, yaw = 0, tiltX = 0, tiltZ = 0, swayBase = 0, swayTop = 0, jitter = 0, rand = Math.random,
  ): void {
    const g = geo.index ? geo.toNonIndexed() : geo
    const p = g.getAttribute('position') as THREE.BufferAttribute
    this.e.set(tiltX, yaw, tiltZ, 'YXZ')
    this.q.setFromEuler(this.e)
    this.m.compose(this.v.set(x, y, z), this.q, new THREE.Vector3(sx, sy, sz))
    this.nm.getNormalMatrix(this.m)
    this.c.setHex(color)
    if (jitter) this.c.offsetHSL((rand() - 0.5) * jitter * 0.05, (rand() - 0.5) * jitter * 0.1, (rand() - 0.5) * jitter * 0.12)
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < p.count; i++) {
      minY = Math.min(minY, p.getY(i))
      maxY = Math.max(maxY, p.getY(i))
    }
    const span = maxY - minY || 1
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(this.m)
      b.fromBufferAttribute(p, i + 1).applyMatrix4(this.m)
      c.fromBufferAttribute(p, i + 2).applyMatrix4(this.m)
      this.n.subVectors(c, b).cross(this.v.subVectors(a, b)).normalize()
      for (let k = 0; k < 3; k++) {
        const w = k === 0 ? a : k === 1 ? b : c
        this.pos.push(w.x, w.y, w.z)
        this.nor.push(this.n.x, this.n.y, this.n.z)
        // Slight per-vertex shade toward the base: cheap ambient occlusion.
        const h = (p.getY(i + k) - minY) / span
        const ao = 0.72 + 0.28 * h
        this.col.push(this.c.r * ao, this.c.g * ao, this.c.b * ao)
        this.sway.push(swayBase + (swayTop - swayBase) * h)
      }
    }
    if (g !== geo) g.dispose()
  }

  /** Raw triangle with explicit colour; used by ribbons (walls, banks). */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, color: THREE.Color): void {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), c = new THREE.Vector3(cx, cy, cz)
    this.n.subVectors(c, b).cross(this.v.subVectors(a, b)).normalize()
    for (const w of [a, b, c]) {
      this.pos.push(w.x, w.y, w.z)
      this.nor.push(this.n.x, this.n.y, this.n.z)
      this.col.push(color.r, color.g, color.b)
      this.sway.push(0)
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    this.tri(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, color)
    this.tri(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, color)
  }

  /** Both windings: ribbons (rails, walls, banks) are seen from either side. */
  quad2(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    this.quad(a, b, c, d, color)
    this.quad(a, d, c, b, color)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1))
    g.computeBoundingSphere()
    return g
  }
}

/** Shared primitive shapes, built once. */
export const PRIM = {
  cone: new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0),
  cone5: new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 6, 1).translate(0, 0.5, 0),
  cylTaper: new THREE.CylinderGeometry(0.7, 1, 1, 6, 1).translate(0, 0.5, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  boxC: new THREE.BoxGeometry(1, 1, 1),
  prism: (() => {
    // Gable roof: base 1x1 at y=0, apex ridge along X at y=1.
    const tri = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)])
    return new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2)
  })(),
}
