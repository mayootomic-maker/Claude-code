import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Geometry plumbing for the car and its driver: hundreds of small parts are
 * collected per material and merged, so a whole car is a few dozen draw calls
 * rather than a few hundred.
 */

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
/** Translation, Euler rotation (XYZ) and scale as one matrix. */
export function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz))
  return new THREE.Matrix4().compose(V3(x, y, z), _q.clone(), V3(sx, sy, sz))
}

/** A matrix that takes +Y onto the segment a→b, with the origin at a. */
export function along(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const d = b.clone().sub(a)
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize())
  return new THREE.Matrix4().compose(a, q, V3(1, 1, 1))
}

/** A cylinder from a to b. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, r2 = r): THREE.BufferGeometry {
  const len = a.distanceTo(b)
  return new THREE.CylinderGeometry(r2, r, len, seg, 1).translate(0, len / 2, 0).applyMatrix4(along(a, b))
}

/** A tube along a smooth curve through the points. */
export function tube(pts: THREE.Vector3[], r: number, seg = 24, radial = 8, closed = false): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), seg, r, radial, closed)
}

/** Remap a geometry's UVs (0..1) into a rectangle of an atlas. */
export function atlasUV(g: THREE.BufferGeometry, r: { u0: number; v0: number; u1: number; v1: number }): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i))
  return g
}

/**
 * Builds a mesh from a grid of points (rows × cols), quads between them. With
 * `closeCols`, the last column joins the first (a tube); `uv` gives each point
 * a texture coordinate.
 */
export function grid(rows: THREE.Vector3[][], uv?: (i: number, j: number) => [number, number], closeCols = false): THREE.BufferGeometry {
  const R = rows.length, C = rows[0].length
  const pos: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) {
      const p = rows[i][j]
      pos.push(p.x, p.y, p.z)
      const t = uv ? uv(i, j) : [j / Math.max(1, C - 1), i / Math.max(1, R - 1)]
      uvs.push(t[0], t[1])
    }
  const cc = closeCols ? C : C - 1
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < cc; j++) {
      const j1 = (j + 1) % C
      const a = i * C + j, b = i * C + j1, c = (i + 1) * C + j, d = (i + 1) * C + j1
      idx.push(a, c, b, b, c, d)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Sweeps a closed 2D section (a = across, b = up) along a path, with the
 * section's "across" axis given per point; caps both ends so the part is a
 * closed solid with no open edge to see into.
 */
export function sweep(path: THREE.Vector3[], across: THREE.Vector3[], up: THREE.Vector3[], section: [number, number][]): THREE.BufferGeometry {
  return solid(path.map((p, i) => section.map(([a, b]) => p.clone().addScaledVector(across[i], a).addScaledVector(up[i], b))))
}

/**
 * Rows of a closed section (each row a loop of points) as one solid: the
 * loops are skinned and both ends capped, so there is no open edge to see into.
 */
export function solid(rows: THREE.Vector3[][]): THREE.BufferGeometry {
  const body = grid(rows, undefined, true)
  const caps: THREE.BufferGeometry[] = [body]
  for (const [row, flip] of [[rows[0], true], [rows[rows.length - 1], false]] as const) {
    const c = row.reduce((s, p) => s.add(p), V3()).multiplyScalar(1 / row.length)
    const pos = [c.x, c.y, c.z]
    for (const p of row) pos.push(p.x, p.y, p.z)
    const idx: number[] = []
    for (let k = 0; k < row.length; k++) {
      const a = 1 + k, b = 1 + ((k + 1) % row.length)
      if (flip) idx.push(0, a, b)
      else idx.push(0, b, a)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((row.length + 1) * 2), 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    caps.push(g)
  }
  const out = mergeGeometries(caps.map(clean), false)
  for (const g of caps) g.dispose()
  if (!out) throw new Error('solid: merge failed')
  return out
}

/** Keeps only position, normal and uv, and makes the geometry indexed, so anything can merge with anything. */
function clean(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const p = src.getAttribute('position')
  g.setAttribute('position', p)
  if (!src.getAttribute('normal')) src.computeVertexNormals()
  g.setAttribute('normal', src.getAttribute('normal'))
  g.setAttribute('uv', src.getAttribute('uv') ?? new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2))
  g.setIndex(src.index ? src.index : Array.from({ length: p.count }, (_, i) => i))
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex)
  return g
}

const _c = new THREE.Color()

/**
 * Collects parts per material and merges them. Materials with vertex colours
 * take a colour per part, so one material serves every plastic, fabric or
 * metal of a similar finish.
 */
export class Parts {
  private readonly lists = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4, color = 0xffffff): void {
    const g = clean(geo).clone()
    if (m) g.applyMatrix4(m)
    if (mat.vertexColors) {
      _c.setHex(color)
      const n = g.getAttribute('position').count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r
        col[i * 3 + 1] = _c.g
        col[i * 3 + 2] = _c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    g.clearGroups()
    let list = this.lists.get(mat)
    if (!list) this.lists.set(mat, (list = []))
    list.push(g)
  }

  /** One mesh per material under `parent`. */
  build(parent: THREE.Object3D, cast = true, receive = false): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    for (const [mat, list] of this.lists) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (!g) throw new Error('Parts: merge failed')
      if (list.length > 1) for (const x of list) x.dispose()
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, mat)
      mesh.castShadow = cast
      mesh.receiveShadow = receive
      parent.add(mesh)
      out.push(mesh)
    }
    this.lists.clear()
    return out
  }

  triangles(): number {
    let n = 0
    for (const list of this.lists.values()) for (const g of list) n += (g.index?.count ?? 0) / 3
    return n
  }
}
