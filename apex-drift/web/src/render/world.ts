import * as THREE from 'three'
import { clamp, fbm2, noise2, rng, smoothstep } from '../core/math'
import type { RallyDef, StageDef } from '../data'
import { STEP, type Route } from '../sim/route'
import type { Ground } from '../sim/terrain'
import { GeoBuilder, PRIM } from './builder'
import { paceNotes } from '../game/pacenotes'
import { addFlowers, addHouse, addRock, addSpectator, addTree, addTuft, FOOTPRINT, treeFootprint } from './props'
import { detailTexture, roadTexture, type RoadKind } from './textures'

const TILE = 64
const RES = 2
const ROAD_SEG = 120

export interface Quality {
  /** Metres within which terrain tiles and scenery are built. */
  radius: number
  /** Scenery density multiplier. */
  density: number
  shadows: boolean
  aniso: number
}

interface Tile {
  key: number
  cx: number
  cz: number
  group: THREE.Group | null
}

interface Seg {
  i: number
  s0: number
  s1: number
  cx: number
  cz: number
  r: number
  group: THREE.Group | null
}

/**
 * Streams the stage in around the camera: terrain tiles on a world grid (so
 * nothing ever overlaps itself on hairpins) and road segments along the
 * route. Everything solid is placed through one clearance check against the
 * true nearest leg of road.
 */
export class World {
  readonly group = new THREE.Group()
  private readonly tiles = new Map<number, Tile>()
  private readonly segs: Seg[] = []
  private readonly terrainMat: THREE.MeshLambertMaterial
  private readonly propMat: THREE.MeshLambertMaterial
  private readonly roadMat: THREE.MeshLambertMaterial
  private readonly waterMat: THREE.MeshLambertMaterial
  private readonly time = { value: 0 }
  private readonly route: Route
  private readonly noise = noise2(9)
  private readonly snowAll: boolean

  constructor(
    private readonly ground: Ground,
    private readonly rally: RallyDef,
    private readonly stage: StageDef,
    private readonly q: Quality,
    private readonly start: number,
    private readonly finish: number,
  ) {
    this.route = ground.route
    this.snowAll = rally.surface === 'snow' || stage.weather === 'snow'
    const detail = detailTexture(q.aniso)
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail })
    this.terrainMat.onBeforeCompile = (sh) => {
      // Terrain UVs are world XZ; the detail map multiplies around 1.0 so it
      // adds texture without darkening the palette.
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          diffuseColor.rgb *= texture2D(map, vMapUv).rgb * 1.28;
        #endif`)
    }
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true })
    this.propMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Wind: a slow sway, phase-shifted across the world so trees don't move in lockstep.
          float ph = position.x * 0.07 + position.z * 0.05;
          transformed.x += sin(uTime * 1.3 + ph) * aSway * 0.12;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * aSway * 0.08;`)
    }
    const kind = roadKind(rally)
    this.roadMat = new THREE.MeshLambertMaterial({ map: roadTexture(kind, roadBase(rally), q.aniso) })
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x4f6b70, transparent: true, opacity: 0.78, depthWrite: false })
    this.planTiles()
    this.planSegments()
    this.group.add(this.horizon())
  }

  /** Called every frame; builds at most `budget` pieces so a frame never stalls. */
  update(cam: THREE.Vector3, dt: number, budget = 2): void {
    this.time.value += dt
    const r2 = this.q.radius * this.q.radius
    const drop2 = (this.q.radius + 120) ** 2
    const want: { d: number; build: () => void }[] = []
    for (const t of this.tiles.values()) {
      const d2 = (t.cx - cam.x) ** 2 + (t.cz - cam.z) ** 2
      if (t.group && d2 > drop2) {
        dispose(t.group)
        this.group.remove(t.group)
        t.group = null
      } else if (!t.group && d2 < r2) want.push({ d: d2, build: () => this.buildTile(t) })
    }
    for (const sg of this.segs) {
      const d2 = (sg.cx - cam.x) ** 2 + (sg.cz - cam.z) ** 2 - sg.r * sg.r
      if (sg.group && d2 > drop2) {
        dispose(sg.group)
        this.group.remove(sg.group)
        sg.group = null
      } else if (!sg.group && d2 < r2) want.push({ d: d2 - 1e4, build: () => this.buildSeg(sg) })
    }
    want.sort((a, b) => a.d - b.d)
    for (let i = 0; i < Math.min(budget, want.length); i++) want[i].build()
  }

  /** Everything around a point, built synchronously: used behind the loading screen. */
  prewarm(cam: THREE.Vector3): void {
    for (let i = 0; i < 400; i++) {
      const before = this.loaded
      this.update(cam, 0, 8)
      if (this.loaded === before) break
    }
  }

  get loaded(): number {
    let n = 0
    for (const t of this.tiles.values()) if (t.group) n++
    for (const s of this.segs) if (s.group) n++
    return n
  }

  dispose(): void {
    for (const t of this.tiles.values()) if (t.group) dispose(t.group)
    for (const s of this.segs) if (s.group) dispose(s.group)
    this.group.clear()
    this.terrainMat.dispose()
    this.propMat.dispose()
    this.roadMat.dispose()
    this.waterMat.dispose()
  }

  // ---------------------------------------------------------------- planning

  private planTiles(): void {
    const reach = 150
    for (let i = 0; i < this.route.n; i += 4) {
      const x = this.route.x[i], z = this.route.z[i]
      for (let gx = Math.floor((x - reach) / TILE); gx <= Math.floor((x + reach) / TILE); gx++)
        for (let gz = Math.floor((z - reach) / TILE); gz <= Math.floor((z + reach) / TILE); gz++) {
          const key = (gx + 32768) * 65536 + (gz + 32768)
          if (!this.tiles.has(key)) this.tiles.set(key, { key, cx: (gx + 0.5) * TILE, cz: (gz + 0.5) * TILE, group: null })
        }
    }
  }

  private planSegments(): void {
    for (let s0 = 0, i = 0; s0 < this.route.length; s0 += ROAD_SEG, i++) {
      const s1 = Math.min(this.route.length, s0 + ROAD_SEG)
      const a = this.route.at((s0 + s1) / 2)
      let r = 0
      for (let s = s0; s <= s1; s += 10) {
        const p = this.route.at(s)
        r = Math.max(r, Math.hypot(p.x - a.x, p.z - a.z))
      }
      this.segs.push({ i, s0, s1, cx: a.x, cz: a.z, r: r + 20, group: null })
    }
  }

  // ---------------------------------------------------------------- terrain

  private buildTile(t: Tile): void {
    const g = new THREE.Group()
    const n = TILE / RES + 1
    const x0 = t.cx - TILE / 2, z0 = t.cz - TILE / 2
    const pos = new Float32Array(n * n * 3)
    const col = new Float32Array(n * n * 3)
    const uv = new Float32Array(n * n * 2)
    const pal = this.rally.palette
    const c = new THREE.Color(), c2 = new THREE.Color()
    const hgt = new Float32Array(n * n)
    const dist = new Float32Array(n * n)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = x0 + i * RES, z = z0 + j * RES
        const cl = this.route.closest(x, z, 600)
        const d = cl ? cl.dist : 999
        let h = this.ground.height(x, z)
        // Under the road ribbon the terrain is pushed down so it can never
        // poke through the surface between grid points.
        if (d < this.ground.edge + 0.6) h -= 0.35
        const k = j * n + i
        hgt[k] = h
        dist[k] = d
        pos[k * 3] = x
        pos[k * 3 + 1] = h
        pos[k * 3 + 2] = z
        uv[k * 2] = x / 5
        uv[k * 2 + 1] = z / 5
      }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        const x = x0 + i * RES, z = z0 + j * RES
        const d = dist[k]
        const hx = hgt[j * n + Math.min(n - 1, i + 1)] - hgt[j * n + Math.max(0, i - 1)]
        const hz = hgt[Math.min(n - 1, j + 1) * n + i] - hgt[Math.max(0, j - 1) * n + i]
        const slope = Math.hypot(hx, hz) / (2 * RES)
        const mixN = fbm2(this.noise, x / 40, z / 40, 3) * 0.5 + 0.5
        c.setHex(pal.grassA).lerp(c2.setHex(pal.grassB), mixN)
        const dry = smoothstep(0.55, 0.85, fbm2(this.noise, x / 120 + 7, z / 120, 2) * 0.5 + 0.5)
        c.lerp(c2.setHex(pal.dry), dry * 0.6)
        const forest = smoothstep(14, 40, d) * this.rally.trees.density
        c.lerp(c2.setHex(pal.forest), forest * 0.55 * mixN)
        c.lerp(c2.setHex(pal.soil), (1 - smoothstep(this.ground.edge, this.ground.edge + 3.5, d)) * 0.7)
        c.lerp(c2.setHex(pal.verge), (1 - smoothstep(this.ground.edge + 1, this.ground.edge + 6, d)) * 0.5)
        c.lerp(c2.setHex(mixN > 0.5 ? pal.rock : pal.rock2), smoothstep(0.55, 0.95, slope))
        const snowLine = this.rally.snowLine ?? 9999
        const snow = this.snowAll ? 1 - smoothstep(0.7, 1.1, slope) * 0.6 : smoothstep(snowLine - 30, snowLine + 30, hgt[k])
        c.lerp(c2.setHex(pal.snow), snow)
        col[k * 3] = c.r
        col[k * 3 + 1] = c.g
        col[k * 3 + 2] = c.b
      }
    const idx: number[] = []
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1
        // Split each quad along the diagonal that follows the terrain better.
        if (Math.abs(hgt[a] - hgt[d]) < Math.abs(hgt[b] - hgt[cc])) idx.push(a, cc, d, a, d, b)
        else idx.push(a, cc, b, b, cc, d)
      }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, this.terrainMat)
    mesh.receiveShadow = this.q.shadows
    g.add(mesh)
    const props = this.scatter(t)
    if (props) g.add(props)
    t.group = g
    this.group.add(g)
  }

  /** True when a solid object of radius `r` at (x,z) can never be touched or seen intersecting the road. */
  private clear(x: number, z: number, r: number): { ok: boolean; s: number; d: number } {
    const c = this.route.closest(x, z, 600)
    if (!c) return { ok: true, s: 0, d: 999 }
    const limit = this.ground.limitAt(c.s)
    return { ok: c.dist - r > limit + 1.5, s: c.s, d: c.dist }
  }

  private scatter(t: Tile): THREE.Mesh | null {
    const b = new GeoBuilder()
    const r = rng(t.key ^ this.stage.seed)
    const area = TILE * TILE
    const dens = this.q.density
    const kinds = Object.entries(this.rally.trees.mix).filter(([, w]) => w > 0)
    const wsum = kinds.reduce((a, [, w]) => a + w, 0)
    const pick = (): string => {
      let x = r() * wsum
      for (const [k, w] of kinds) if ((x -= w) <= 0) return k
      return kinds[0][0]
    }
    const pal = this.rally.palette
    const trees = Math.round((area / 90) * this.rally.trees.density * dens)
    for (let i = 0; i < trees; i++) {
      const x = t.cx + (r() - 0.5) * TILE, z = t.cz + (r() - 0.5) * TILE
      const kind = pick()
      const cl = this.clear(x, z, treeFootprint(kind))
      if (!cl.ok) continue
      // Thinner right next to the road, so the view opens up.
      if (r() > this.rally.trees.near + smoothstep(10, 40, cl.d) * (1 - this.rally.trees.near)) continue
      // Clumps: skip where the low-frequency noise says "meadow".
      if (fbm2(this.noise, x / 70, z / 70, 2) < -0.15 && r() < 0.7) continue
      addTree(b, kind, x, this.ground.natural(x, z), z, r, 0.85 + r() * 0.35)
    }
    const rocks = Math.round((area / 900) * this.rally.rocks * dens)
    for (let i = 0; i < rocks; i++) {
      const x = t.cx + (r() - 0.5) * TILE, z = t.cz + (r() - 0.5) * TILE
      const size = 0.5 + r() * 1.4
      if (!this.clear(x, z, size).ok) continue
      addRock(b, x, this.ground.natural(x, z), z, size, r() < 0.5 ? pal.rock : pal.rock2, r)
    }
    const bushes = Math.round((area / 500) * this.rally.bushes * dens)
    for (let i = 0; i < bushes; i++) {
      const x = t.cx + (r() - 0.5) * TILE, z = t.cz + (r() - 0.5) * TILE
      if (!this.clear(x, z, FOOTPRINT.shrub).ok) continue
      addTree(b, this.rally.biome === 'savannah' ? 'thornbush' : this.rally.biome === 'andes' ? 'pampas' : 'macchia', x, this.ground.natural(x, z), z, r, 0.7)
    }
    // Grass tufts may sit on the drivable verge: they are soft, the car can pass through them.
    if (this.rally.grass > 0 && !this.snowAll) {
      const tufts = Math.round((area / 60) * this.rally.grass * dens)
      for (let i = 0; i < tufts; i++) {
        const x = t.cx + (r() - 0.5) * TILE, z = t.cz + (r() - 0.5) * TILE
        const c = this.route.closest(x, z, 300)
        if (c && c.dist < this.ground.edge + 0.8) continue
        const y = this.ground.height(x, z)
        // Wildflowers gather in the lusher patches of meadow.
        if (r() < 0.12 && fbm2(this.noise, x / 25, z / 25, 2) > 0.1) addFlowers(b, x, y, z, r)
        else addTuft(b, x, y, z, r() < 0.5 ? pal.grassA : pal.dry, r)
      }
    }
    // A farmhouse or two, set back from the road and facing it.
    if (r() < 0.12 * dens) {
      const x = t.cx + (r() - 0.5) * TILE * 0.6, z = t.cz + (r() - 0.5) * TILE * 0.6
      const cl = this.clear(x, z, FOOTPRINT.house)
      if (cl.ok && cl.d < 60) {
        const a = this.route.at(cl.s)
        addHouse(b, this.rally.houses, x, this.ground.natural(x, z), z, a.heading + (r() < 0.5 ? 0 : Math.PI), r)
      }
    }
    if (b.empty) return null
    const m = new THREE.Mesh(b.build(), this.propMat)
    m.castShadow = this.q.shadows
    m.receiveShadow = this.q.shadows
    return m
  }

  // ---------------------------------------------------------------- road

  private buildSeg(sg: Seg): void {
    const g = new THREE.Group()
    const route = this.route
    const half = route.half
    const edge = this.ground.edge
    const n = Math.ceil((sg.s1 - sg.s0) / STEP) + 1
    // Road surface: 3 columns across (left edge, centre, right edge).
    const rp: number[] = [], ruv: number[] = [], ri: number[] = []
    // Shoulders and skirts share the terrain material.
    const sp: number[] = [], sc: number[] = [], suv: number[] = [], si: number[] = []
    const verge = new THREE.Color(this.rally.palette.verge)
    const soil = new THREE.Color(this.rally.palette.soil)
    if (this.snowAll) verge.lerp(new THREE.Color(this.rally.palette.snow), 0.7)
    const cols = [-edge - 0.6, -edge, -half, half, edge, edge + 0.6]
    const drop = [-0.7, -0.1, 0, 0, -0.1, -0.7]
    for (let k = 0; k < n; k++) {
      const s = Math.min(sg.s1, sg.s0 + k * STEP)
      const a = route.at(s)
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      const y = a.y + 0.03
      // Right to left, matching the shoulder columns, so both face up.
      for (const off of [-half, 0, half]) {
        rp.push(a.x + lx * off, y, a.z + lz * off)
        ruv.push(0.5 - off / (2 * half), s / (2 * half))
      }
      for (let c = 0; c < cols.length; c++) {
        const off = cols[c]
        sp.push(a.x + lx * off, y + drop[c], a.z + lz * off)
        const col = Math.abs(off) <= half ? soil : verge
        sc.push(col.r, col.g, col.b)
        suv.push((a.x + lx * off) / 5, (a.z + lz * off) / 5)
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let c = 0; c < 2; c++) {
        const a = k * 3 + c, b = a + 1, cc = a + 3, d = cc + 1
        ri.push(a, cc, b, b, cc, d)
      }
      for (let c = 0; c < cols.length - 1; c++) {
        if (c === 2) continue // the road surface itself
        const a = k * cols.length + c, b = a + 1, cc = a + cols.length, d = cc + 1
        si.push(a, cc, b, b, cc, d)
      }
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2))
    rg.setIndex(ri)
    rg.computeVertexNormals()
    const road = new THREE.Mesh(rg, this.roadMat)
    road.receiveShadow = this.q.shadows
    g.add(road)
    const sgeo = new THREE.BufferGeometry()
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    sgeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3))
    sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2))
    sgeo.setIndex(si)
    sgeo.computeVertexNormals()
    // The shoulder is flat. Its outer vertices are shared with the steep skirt,
    // and averaged normals there tip the shoulder away from a low sun and paint
    // a dark stripe beside the road; keep everything but the skirt bottoms upright.
    const nrm = sgeo.getAttribute('normal') as THREE.BufferAttribute
    for (let k = 0; k < n; k++) for (let c = 1; c < cols.length - 1; c++) nrm.setXYZ(k * cols.length + c, 0, 1, 0)
    const sh = new THREE.Mesh(sgeo, this.terrainMat)
    sh.receiveShadow = this.q.shadows
    g.add(sh)

    const b = new GeoBuilder()
    this.edges(b, sg)
    this.furniture(b, sg)
    if (!b.empty) {
      const m = new THREE.Mesh(b.build(), this.propMat)
      m.castShadow = this.q.shadows
      m.receiveShadow = this.q.shadows
      g.add(m)
    }
    for (const f of route.features) {
      if (f.s1 < sg.s0 || f.s0 > sg.s1) continue
      if (f.kind === 'splash') g.add(this.water(f.s0, f.s1, half + 2, -0.12))
      if (f.kind === 'bridge' && f.s0 >= sg.s0) g.add(this.bridge(f.s0, f.s1))
    }
    sg.group = g
    this.group.add(g)
  }

  /** Rails, rock walls and snowbanks, always just outside where the car is held. */
  private edges(b: GeoBuilder, sg: Seg): void {
    const route = this.route
    const e = this.rally.edge
    const rail = new THREE.Color(0xb9bcc0), post = new THREE.Color(0x6a6d70)
    const rock = new THREE.Color(this.rally.palette.rock), moss = new THREE.Color(0x56664a)
    const snow = new THREE.Color(this.rally.palette.snow)
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    for (let s = sg.s0; s < sg.s1; s += 4) {
      const s2 = Math.min(sg.s1, s + 4)
      if (route.featureAt(s, 'bridge')) continue
      const a = route.at(s), c = route.at(s2)
      for (const side of [1, -1]) {
        // Which side climbs? Compare natural ground a few metres out.
        const lx = Math.cos(a.heading) * side, lz = -Math.sin(a.heading) * side
        const out = this.ground.natural(a.x + lx * 14, a.z + lz * 14) - a.y
        const up = out > 0.8
        const kind = up ? e.up : e.down
        const lim = this.ground.limitAt(s) + 0.25
        const lx2 = Math.cos(c.heading) * side, lz2 = -Math.sin(c.heading) * side
        const p0 = v(a.x + lx * lim, a.y, a.z + lz * lim), p1 = v(c.x + lx2 * lim, c.y, c.z + lz2 * lim)
        if (kind === 'rail') {
          const y0 = a.y + 0.55, y1 = c.y + 0.55
          const q0 = v(p0.x, y0, p0.z), q1 = v(p1.x, y1, p1.z)
          const q2 = v(p1.x, y1 + 0.3, p1.z), q3 = v(p0.x, y0 + 0.3, p0.z)
          b.quad2(q0, q1, q2, q3, rail)
          b.add(PRIM.box, post.getHex(), p0.x, a.y - 0.6, p0.z, 0.12, 1.5, 0.12, a.heading)
        } else if (kind === 'rockwall' || kind === 'mosswall') {
          const hgt = kind === 'mosswall' ? 1.6 : 3.2 + this.noise(s / 9, side) * 1.6
          const lean = 0.6
          const t0 = v(p0.x + lx * lean, a.y + hgt, p0.z + lz * lean), t1 = v(p1.x + lx2 * lean, c.y + hgt, p1.z + lz2 * lean)
          const b0 = v(p0.x, a.y - 0.3, p0.z), b1 = v(p1.x, c.y - 0.3, p1.z)
          const col = kind === 'mosswall' ? moss : rock.clone().multiplyScalar(0.85 + this.noise(s / 5, 3) * 0.2)
          b.quad2(b0, b1, t1, t0, col)
        } else if (kind === 'snowbank') {
          const hgt = 0.9 + this.noise(s / 7, side * 5) * 0.3
          const mid0 = v(p0.x + lx * 0.6, a.y + hgt, p0.z + lz * 0.6), mid1 = v(p1.x + lx2 * 0.6, c.y + hgt, p1.z + lz2 * 0.6)
          const in0 = v(p0.x - lx * 0.3, a.y - 0.1, p0.z - lz * 0.3), in1 = v(p1.x - lx2 * 0.3, c.y - 0.1, p1.z - lz2 * 0.3)
          const o0 = v(p0.x + lx * 2.2, a.y + 0.2, p0.z + lz * 2.2), o1 = v(p1.x + lx2 * 2.2, c.y + 0.2, p1.z + lz2 * 2.2)
          b.quad2(in0, in1, mid1, mid0, snow)
          b.quad2(mid0, mid1, o1, o0, snow)
        } else if (Math.round(s) % 24 === 0) {
          // Soft edge: a white marker post just beyond the drivable verge.
          b.add(PRIM.box, 0xf3f1ea, p0.x, a.y - 0.2, p0.z, 0.14, 1.3, 0.14, a.heading)
          b.add(PRIM.box, 0x1d1f22, p0.x, a.y + 0.75, p0.z, 0.15, 0.22, 0.15, a.heading)
        }
      }
    }
  }

  /** Chevrons before tight corners, crowds at the good spots, start and finish gantries. */
  private furniture(b: GeoBuilder, sg: Seg): void {
    const route = this.route
    const r = rng(sg.i * 7919 + this.stage.seed)
    for (const note of paceNotes(route, this.start, this.finish)) {
      if (note.s < sg.s0 || note.s >= sg.s1) continue
      if (note.kind === 'corner' && note.grade <= 2) {
        // Boards on the outside of the corner, facing oncoming traffic.
        const outside = note.dir === 'left' ? -1 : 1
        for (let k = 0; k < 4; k++) {
          const s = note.s + k * 7
          const a = route.at(s)
          const lim = this.ground.limitAt(s) + 0.6
          const lx = Math.cos(a.heading) * outside, lz = -Math.sin(a.heading) * outside
          const x = a.x + lx * lim, z = a.z + lz * lim
          b.add(PRIM.box, 0x3a3a3a, x, a.y - 0.3, z, 0.08, 1.4, 0.08, a.heading)
          b.add(PRIM.boxC, k % 2 ? 0xf2c037 : 0x1c1d20, x, a.y + 1.2, z, 0.9, 0.55, 0.05, a.heading + Math.PI)
        }
      }
      if ((note.kind === 'corner' && note.grade <= 2 && r() < this.rally.spectators * 0.55) || (note.kind === 'jump' && r() < 0.9)) {
        // Fans stand on the inside of the corner, set back and slightly uphill.
        const inside = note.kind === 'corner' ? (note.dir === 'left' ? 1 : -1) : r() < 0.5 ? 1 : -1
        const count = 6 + Math.floor(r() * 12 * this.q.density)
        for (let k = 0; k < count; k++) {
          const s = note.s + (r() - 0.3) * 30
          const a = route.at(s)
          const off = this.ground.limitAt(s) + 3 + r() * 6
          const lx = Math.cos(a.heading) * inside, lz = -Math.sin(a.heading) * inside
          const x = a.x + lx * off, z = a.z + lz * off
          if (!this.clear(x, z, FOOTPRINT.spectator).ok) continue
          addSpectator(b, x, this.ground.natural(x, z), z, Math.atan2(a.x - x, a.z - z), r)
        }
      }
    }
    for (const [s, color] of [[this.start, 0x2e8c55], [this.finish, 0xd8452f]] as const) {
      if (s < sg.s0 || s >= sg.s1) continue
      const a = route.at(s)
      const lim = this.ground.limitAt(s) + 0.6
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      for (const side of [1, -1]) b.add(PRIM.box, 0x30343a, a.x + lx * lim * side, a.y - 0.5, a.z + lz * lim * side, 0.35, 5.6, 0.35, a.heading)
      b.add(PRIM.boxC, color, a.x, a.y + 4.9, a.z, lim * 2 + 0.6, 0.9, 0.3, a.heading + Math.PI / 2)
      b.add(PRIM.boxC, 0xf3f1ea, a.x, a.y + 4.9, a.z, lim * 2 * 0.7, 0.45, 0.34, a.heading + Math.PI / 2)
    }
  }

  private water(s0: number, s1: number, w: number, dy: number): THREE.Mesh {
    const pts: number[] = [], idx: number[] = []
    const n = Math.ceil((s1 - s0) / STEP) + 1
    for (let k = 0; k < n; k++) {
      const a = this.route.at(Math.min(s1, s0 + k * STEP))
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      const base = this.ground.height(a.x, a.z)
      pts.push(a.x + lx * w, base + 0.3 + dy, a.z + lz * w, a.x - lx * w, base + 0.3 + dy, a.z - lz * w)
      if (k) idx.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, this.waterMat)
    m.renderOrder = 2
    return m
  }

  private bridge(s0: number, s1: number): THREE.Group {
    const g = new THREE.Group()
    const b = new GeoBuilder()
    const half = this.route.half
    const stone = 0x8e8a82
    for (let s = s0; s <= s1; s += 2) {
      const a = this.route.at(s)
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      for (const side of [1, -1]) {
        const x = a.x + lx * (half + 0.3) * side, z = a.z + lz * (half + 0.3) * side
        b.add(PRIM.box, stone, x, a.y - 0.6, z, 0.5, 1.5, 2.05, a.heading)
      }
      b.add(PRIM.box, 0x6a665f, a.x, a.y - 1.2, a.z, half * 2 + 1, 1.15, 2.05, a.heading)
    }
    const mid = this.route.at((s0 + s1) / 2)
    b.add(PRIM.cylTaper, stone, mid.x, mid.y - 9, mid.z, 1.4, 8, 1.4, mid.heading)
    g.add(new THREE.Mesh(b.build(), this.propMat))
    g.add(this.water(s0 - 16, s1 + 16, half + 22, -7.4))
    return g
  }

  /** Distant layered ridges: the horizon is never empty, and fog does the rest. */
  private horizon(): THREE.Mesh {
    const pts: number[] = [], cols: number[] = [], idx: number[] = []
    const seg = 96
    const base = this.route.y.reduce((a, b) => a + b, 0) / this.route.n
    const cx = this.route.x.reduce((a, b) => a + b, 0) / this.route.n
    const cz = this.route.z.reduce((a, b) => a + b, 0) / this.route.n
    const n2 = noise2(this.stage.seed + 3)
    const amp = clamp(this.rally.relief.amp, 40, 260)
    const c = new THREE.Color()
    for (let layer = 0; layer < 2; layer++) {
      const R = 1100 + layer * 300
      const tone = new THREE.Color(this.rally.palette.forest).lerp(new THREE.Color(this.rally.palette.rock), 0.3 + layer * 0.3)
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        const h = base + amp * (0.4 + layer * 0.5) * (0.5 + fbm2(n2, Math.cos(a) * 3 + layer * 9, Math.sin(a) * 3, 3))
        const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R
        pts.push(x, base - 120, z, x, h, z)
        c.copy(tone)
        cols.push(c.r, c.g, c.b, c.r * 1.05, c.g * 1.05, c.b * 1.05)
        const o = layer * (seg + 1) * 2
        if (i) idx.push(o + (i - 1) * 2, o + i * 2, o + (i - 1) * 2 + 1, o + (i - 1) * 2 + 1, o + i * 2, o + i * 2 + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
    m.frustumCulled = false
    return m
  }
}

function roadKind(r: RallyDef): RoadKind {
  if (r.surface === 'asphalt') return 'tarmac'
  if (r.surface === 'snow') return 'snow'
  if (r.biome === 'savannah') return 'red'
  return 'gravel'
}

function roadBase(r: RallyDef): number {
  if (r.surface === 'asphalt') return 0x55565a
  if (r.surface === 'snow') return 0xe4e8ec
  return r.gravel?.[0] ?? r.palette.verge
}

function dispose(g: THREE.Object3D): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose()
  })
}
