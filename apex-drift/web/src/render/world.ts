import * as THREE from 'three'
import { fbm2, noise2, rng, smoothstep } from '../core/math'
import type { RallyDef, StageDef } from '../data'
import { STEP, type Route } from '../sim/route'
import { BODY, type Ground } from '../sim/terrain'
import { GeoBuilder, PRIM } from './builder'
import { edgePoint, planSegment, planTile, TILE, type PlanCtx } from './placement'
import { lakeSurface } from './lakes'
import { addAnimal, addBale, addFence, addFlowers, addHouse, addLandmark, addPole, addRock, addSpectator, addTree, addTuft } from './props'
import { barkTexture, detailTexture, groundTexture, leafTexture, rockTexture, roadTexture, waterNormals, type RoadKind } from './textures'

const RES = 2
const ROAD_SEG = 120

export interface Quality {
  /** Metres within which terrain tiles and scenery are built. */
  radius: number
  /** Scenery density multiplier. */
  density: number
  shadows: boolean
  aniso: number
  /** Rock, bark and leaf textures on scenery, fine detail and rock on terrain. Off on Low: they cost fill rate. */
  surfaces: boolean
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
  private readonly waterMat: THREE.MeshStandardMaterial
  private readonly lakeMat: THREE.MeshStandardMaterial
  private readonly time = { value: 0 }
  private readonly route: Route
  private readonly noise = noise2(9)
  private readonly snowAll: boolean
  private readonly plan: PlanCtx
  private readonly ridges: THREE.Mesh

  constructor(
    private readonly ground: Ground,
    private readonly rally: RallyDef,
    private readonly stage: StageDef,
    private readonly q: Quality,
    private readonly start: number,
    private readonly finish: number,
    private readonly labels: { start: string; finish: string } = { start: 'START', finish: 'FINISH' },
  ) {
    this.route = ground.route
    this.snowAll = rally.surface === 'snow' || stage.weather === 'snow'
    this.plan = { route: this.route, ground, rally, seed: stage.seed, noise: this.noise, snowAll: this.snowAll }
    const detail = detailTexture(q.aniso)
    const rockT = { value: rockTexture(q.aniso) }
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTexture(q.aniso) })
    if (q.surfaces) this.terrainMat.defines = { SURFACES: '' }
    this.terrainMat.onBeforeCompile = (sh) => {
      sh.uniforms.tRock = rockT
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vDist;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWN = normalize(mat3(modelMatrix) * objectNormal);
          vDist = -mvPosition.z;`)
      // Terrain UVs are world XZ / 5. The ground map averages ~0.78, so ×1.28
      // adds texture without shifting the palette. Up close a second, finer
      // scale (2.6 m) joins the 8 m one so neither tiles visibly, far away a 60 m scale breaks up
      // the flat colour, and steep faces turn to rock projected from the side.
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRock;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vDist;')
        .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          float det = texture2D(map, vMapUv * 0.6).r;
          #ifdef SURFACES
            // Only near and steep pixels pay for the extra samples.
            if (vDist < 50.0) det = mix(mix(det, texture2D(map, vMapUv * 1.9 + 0.37).r, 0.5), det, smoothstep(15.0, 50.0, vDist));
            float dMacro = texture2D(map, vMapUv * 0.083 + 0.11).r;
            det *= 0.82 + dMacro * 0.23;
            float steep = 1.0 - smoothstep(0.6, 0.85, vWN.y);
            if (steep > 0.0) {
              vec3 an = abs(vWN);
              vec2 ruv = an.x > an.z ? vWP.zy : vWP.xy;
              float rk = mix(texture2D(tRock, ruv * 0.11).r, texture2D(tRock, ruv * 0.37).r, 0.35) * 1.28;
              diffuseColor.rgb *= mix(1.0, rk, steep);
            }
          #endif
          diffuseColor.rgb *= det * 1.28;
        #endif`)
    }
    const surfU = { tRock: rockT, tBark: { value: barkTexture(q.aniso) }, tLeaf: { value: leafTexture(q.aniso) }, tGrain: { value: detail } }
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true })
    if (q.surfaces) this.propMat.defines = { SURFACES: '' }
    this.propMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time
      Object.assign(sh.uniforms, surfU)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nattribute float aSurf;\nuniform float uTime;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vSurf;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Wind: a slow sway, phase-shifted across the world so trees don't move in lockstep.
          float ph = position.x * 0.07 + position.z * 0.05;
          transformed.x += sin(uTime * 1.3 + ph) * aSway * 0.12;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * aSway * 0.08;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWN = normalize(mat3(modelMatrix) * objectNormal);
          vSurf = aSurf;`)
      // The surface texture is projected along the face's main axis: scenery is
      // flat-shaded, so a face never straddles two projections.
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRock;\nuniform sampler2D tBark;\nuniform sampler2D tLeaf;\nuniform sampler2D tGrain;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vSurf;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          #ifdef SURFACES
            vec3 an = abs(vWN);
            vec2 puv = an.y > max(an.x, an.z) ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy);
            float tx;
            if (vSurf < 0.5) tx = mix(1.0, texture2D(tGrain, puv * 0.7).r * 1.28, 0.45);
            else if (vSurf < 1.5) tx = mix(texture2D(tRock, puv * 0.2).r, texture2D(tRock, puv * 0.7).r, 0.4) * 1.28;
            else if (vSurf < 2.5) tx = texture2D(tBark, vec2(puv.x * 1.6, puv.y * 0.45)).r * 1.28;
            else tx = texture2D(tLeaf, puv * 0.55).r * 1.28;
            diffuseColor.rgb *= tx;
          #endif`)
    }
    const kind = roadKind(rally)
    this.roadMat = new THREE.MeshLambertMaterial({ map: roadTexture(kind, roadBase(rally), q.aniso) })
    // Still water mirrors the sky: low roughness picks up the environment map.
    // Ripples scroll slowly (see update); vertex alpha fades the shore.
    const ripples = waterNormals(q.aniso)
    // Winter lakes are frozen: pale, matt ice with only a hint of surface relief.
    this.lakeMat = this.snowAll
      ? new THREE.MeshStandardMaterial({ color: 0xc4d4dc, roughness: 0.32, metalness: 0.05, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.08, 0.08), depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: 0x1f3a44, roughness: 0.05, metalness: 0.55, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false })
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x4d6560, roughness: 0.12, metalness: 0.3, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false })
    this.planTiles()
    this.planSegments()
    this.ridges = this.horizon()
    this.group.add(this.ridges)
  }

  /** Called every frame; builds at most `budget` pieces so a frame never stalls. */
  update(cam: THREE.Vector3, dt: number, budget = 2): void {
    this.time.value += dt
    const rip = this.lakeMat.normalMap
    if (rip && !this.snowAll) rip.offset.set(this.time.value * 0.012, this.time.value * 0.007)
    // Distant ridges ring the camera, wherever on a long stage it is.
    this.ridges.position.set(cam.x, 0, cam.z)
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
    this.lakeMat.dispose()
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
        if (this.ground.water(x, z) !== null) c.lerp(c2.setHex(0xb8a77e), 0.6)
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
    // Lake surface: only the cells that touch a lake, always below the road.
    const lake = lakeSurface(this.ground, x0, z0, n, RES)
    if (lake) {
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.BufferAttribute(lake.pos, 3))
      lg.setAttribute('uv', new THREE.BufferAttribute(lake.uv, 2))
      lg.setAttribute('color', new THREE.BufferAttribute(lake.col, 4))
      lg.setIndex(lake.idx)
      lg.computeVertexNormals()
      const sheet = new THREE.Mesh(lg, this.lakeMat)
      sheet.renderOrder = 1
      g.add(sheet)
    }
    t.group = g
    this.group.add(g)
  }

  private scatter(t: Tile): THREE.Mesh | null {
    const b = new GeoBuilder()
    const pal = this.rally.palette
    for (const p of planTile(this.plan, t.cx, t.cz, t.key, this.q.density)) {
      const r = rng(p.seed)
      if (p.kind === 'tree' || p.kind === 'shrub') addTree(b, p.sub, p.x, this.ground.natural(p.x, p.z), p.z, r, p.size)
      else if (p.kind === 'rock') addRock(b, p.x, this.ground.natural(p.x, p.z), p.z, p.size, p.sub === 'a' ? pal.rock : pal.rock2, r)
      else if (p.kind === 'house') addHouse(b, p.sub, p.x, this.ground.natural(p.x, p.z), p.z, p.yaw, r)
      else if (p.kind === 'animal') addAnimal(b, p.sub, p.x, this.ground.natural(p.x, p.z), p.z, p.yaw, r)
      else if (p.kind === 'flowers') addFlowers(b, p.x, this.ground.height(p.x, p.z), p.z, r)
      else if (p.kind === 'tuft') addTuft(b, p.x, this.ground.height(p.x, p.z), p.z, p.sub === 'a' ? pal.grassA : pal.dry, r)
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
    for (const [gs, text, color] of [[this.start, this.labels.start, '#2e8c55'], [this.finish, this.labels.finish, '#d8452f']] as const) {
      if (gs < sg.s0 || gs >= sg.s1) continue
      g.add(this.bannerText(gs, text, color))
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
        // One body-width beyond where the car's centre is held, so the car never sinks into it.
        const e0 = edgePoint(this.plan, s, side as 1 | -1), e1 = edgePoint(this.plan, s2, side as 1 | -1)
        if (!e0 || !e1) continue
        const lx2 = Math.cos(c.heading) * side, lz2 = -Math.sin(c.heading) * side
        const p0 = v(e0.x, a.y, e0.z), p1 = v(e1.x, c.y, e1.z)
        if (kind === 'rail') {
          const y0 = a.y + 0.55, y1 = c.y + 0.55
          const q0 = v(p0.x, y0, p0.z), q1 = v(p1.x, y1, p1.z)
          const q2 = v(p1.x, y1 + 0.3, p1.z), q3 = v(p0.x, y0 + 0.3, p0.z)
          b.quad2(q0, q1, q2, q3, rail)
          b.add(PRIM.box, post.getHex(), p0.x, a.y - 0.6, p0.z, 0.12, 1.5, 0.12, a.heading)
        } else if (kind === 'rockwall' || kind === 'mosswall') {
          const ROWS = 7
          // A cut rock face: five rows stepping back and up, each vertex pushed
          // by noise in world space so neighbouring segments join seamlessly.
          const moss2 = kind === 'mosswall'
          const H = moss2 ? 2.2 : 4.5 + this.noise(s / 23, side * 3) * 2.5
          const face = (p: THREE.Vector3, a2: { heading: number; y: number }, ox: number, oz: number) => {
            const rows: THREE.Vector3[] = []
            // Seven rows: ledges and overhangs at different heights, pushed by two
            // scales of world-space noise so the face reads as broken rock.
            for (let k = 0; k <= ROWS; k++) {
              const f = k / ROWS
              const jag = this.noise(p.x * 0.35 + k * 1.7, p.z * 0.35) * 0.9 + this.noise(p.x * 1.3 + k * 3.1, p.z * 1.3) * 0.35
              const out = 0.15 + f * f * 2.2 + jag * 0.7 + (k % 2) * 0.3
              rows.push(v(p.x + ox * out, a2.y - 0.4 + f * (H + 0.4) + jag * 0.35 * f, p.z + oz * out))
            }
            return rows
          }
          const r0 = face(p0, a, lx, lz), r1 = face(p1, c, lx2, lz2)
          b.surface = moss2 ? 3 : 1
          for (let k = 0; k < ROWS; k++) {
            const shade = 0.7 + this.noise(p0.x * 0.2 + k, p0.z * 0.2) * 0.28 + (k / ROWS) * 0.2
            const col = (moss2 ? moss : k === ROWS - 1 && this.rally.palette.forest ? rock.clone().lerp(new THREE.Color(this.rally.palette.forest), 0.35) : rock).clone().multiplyScalar(shade)
            b.quad2(r0[k], r1[k], r1[k + 1], r0[k + 1], col)
          }
          b.surface = 1
          if (!moss2 && this.noise(s / 3, side * 9) > 0.35) b.add(PRIM.dodeca, rock.getHex(), p0.x + lx * 0.6, a.y - 0.2, p0.z + lz * 0.6, 0.7, 0.5, 0.7, s, 0.3, 0.2, 0, 0, 1.2, Math.random)
          b.surface = 0
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
    for (const p of planSegment(this.plan, sg.s0, sg.s1, sg.i, this.start, this.finish, this.q.density)) {
      const y = this.ground.natural(p.x, p.z)
      if (p.kind === 'board') {
        const ry = route.at(route.closest(p.x, p.z)?.s ?? 0).y
        b.add(PRIM.box, 0x3a3a3a, p.x, Math.min(y, ry) - 0.3, p.z, 0.08, Math.abs(ry - y) + 1.6, 0.08, p.yaw)
        b.add(PRIM.boxC, p.sub === 'y' ? 0xf2c037 : 0x1c1d20, p.x, ry + 1.2, p.z, 0.9, 0.55, 0.05, p.yaw)
      } else if (p.kind === 'spectator') addSpectator(b, p.x, y, p.z, p.yaw, rng(p.seed))
      else if (p.kind === 'landmark') addLandmark(b, p.sub, p.x, y, p.z, p.yaw, rng(p.seed))
      else if (p.kind === 'house') addHouse(b, p.sub, p.x, y, p.z, p.yaw, rng(p.seed))
      else if (p.kind === 'fence' && p.x2 !== undefined && p.z2 !== undefined) addFence(b, p.x, y, p.z, p.x2, this.ground.natural(p.x2, p.z2), p.z2, this.rally.biome === 'wales' ? 0x7d7a72 : 0x8a6a4a)
      else if (p.kind === 'bale') addBale(b, p.x, y, p.z, p.yaw)
      else if (p.kind === 'pole') addPole(b, p.x, y, p.z, p.yaw)
    }
    for (const [s, color] of [[this.start, 0x2e8c55], [this.finish, 0xd8452f]] as const) {
      if (s < sg.s0 || s >= sg.s1) continue
      const a = route.at(s)
      const lim = this.ground.limitAt(s) + BODY + 0.6
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      for (const side of [1, -1]) b.add(PRIM.box, 0x30343a, a.x + lx * lim * side, a.y - 0.5, a.z + lz * lim * side, 0.35, 5.6, 0.35, a.heading)
      // Yaw = heading: the box's X axis then runs across the road, so the banner spans it.
      b.add(PRIM.boxC, color, a.x, a.y + 4.9, a.z, lim * 2 + 0.6, 0.9, 0.3, a.heading)
      b.add(PRIM.boxC, 0xf3f1ea, a.x, a.y + 4.9, a.z, lim * 2 * 0.7, 0.45, 0.34, a.heading)
    }
  }

  /** Lettering on both faces of a gantry banner. */
  private bannerText(s: number, text: string, color: string): THREE.Group {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 96
    const g2 = c.getContext('2d')
    const grp = new THREE.Group()
    if (!g2) return grp
    g2.fillStyle = '#f3f1ea'
    g2.fillRect(0, 0, 1024, 96)
    g2.fillStyle = color
    g2.font = '800 72px "Barlow Condensed", sans-serif'
    g2.textAlign = 'center'
    g2.textBaseline = 'middle'
    g2.fillText(text.toUpperCase(), 512, 52)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const a = this.route.at(s)
    const w = (this.ground.limitAt(s) + BODY + 0.6) * 2 * 0.7
    const mat = new THREE.MeshLambertMaterial({ map: tex })
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.45), mat)
      // Face oncoming cars on one side and the departing view on the other.
      m.position.set(a.x + Math.sin(a.heading) * 0.18 * side, a.y + 4.9, a.z + Math.cos(a.heading) * 0.18 * side)
      m.rotation.y = a.heading + (side < 0 ? Math.PI : 0)
      if (side > 0) m.userData.ownsMaterial = true
      grp.add(m)
    }
    return grp
  }

  /**
   * A ford or the river under a bridge: level across, with soft edges that
   * stop at the bank instead of hanging over ground that falls away.
   */
  private water(s0: number, s1: number, w: number, dy: number): THREE.Mesh {
    const pts: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
    const half = this.route.half
    const across = [-w, -half, 0, half, w]
    const n = Math.ceil((s1 - s0) / STEP) + 1
    for (let k = 0; k < n; k++) {
      const s = Math.min(s1, s0 + k * STEP)
      const a = this.route.at(s)
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      const level = this.ground.height(a.x, a.z) + 0.3 + dy
      // Ends of a ford thin out where the road climbs out of the dip.
      const endFade = Math.min(1, Math.min(s - s0, s1 - s) / 4)
      for (const o of across) {
        const x = a.x + lx * o, z = a.z + lz * o
        const outer = Math.abs(o) === w
        const y = outer ? Math.min(level, this.ground.height(x, z) - 0.05) : level
        pts.push(x, y, z)
        uv.push(x / 6, z / 6)
        col.push(1, 1, 1, outer ? 0 : 0.88 * endFade)
      }
      if (k) {
        const c = across.length
        for (let j = 0; j < c - 1; j++) {
          const p = (k - 1) * c + j, q = k * c + j
          idx.push(p, q, p + 1, p + 1, q, q + 1)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
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
    b.surface = 1
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

  /**
   * Distant mountain ranges in three layers, jagged and shaded from dark
   * forested foothills up to bare rock and, where the region has them,
   * snow caps. Fog and the grade turn them into soft blue silhouettes.
   */
  private horizon(): THREE.Mesh {
    const pts: number[] = [], cols: number[] = [], idx: number[] = []
    const seg = 160
    const base = this.route.y.reduce((a, b) => a + b, 0) / this.route.n
    const n2 = noise2(this.stage.seed + 3)
    const rel = this.rally.relief
    const snowy = ['alpine', 'andes', 'nordic_snow', 'japan'].includes(this.rally.biome)
    const flat = this.rally.biome === 'savannah' || this.rally.biome === 'nordic'
    const amp = flat ? 60 : THREE.MathUtils.clamp(rel.amp * 1.6, 120, 520)
    const pal = this.rally.palette
    const cForest = new THREE.Color(pal.forest).multiplyScalar(0.8)
    const cRock = new THREE.Color(pal.rock)
    const cSnow = new THREE.Color(0xf2f4f7)
    const ridged = (x: number, y: number) => {
      let v = 0, a = 1, f = 1
      for (let o = 0; o < 5; o++) {
        v += a * (1 - Math.abs(n2(x * f, y * f)))
        a *= 0.5
        f *= 2.1
      }
      return v / 1.9
    }
    let off = 0
    for (let layer = 0; layer < 3; layer++) {
      const R = 900 + layer * 350
      const h0 = amp * (0.35 + layer * 0.45)
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        const peak = Math.pow(ridged(Math.cos(a) * 2.2 + layer * 7, Math.sin(a) * 2.2), 2.2)
        const h = base + h0 * (0.25 + peak)
        const x = Math.cos(a) * R, z = Math.sin(a) * R
        const rows: [number, THREE.Color][] = [
          [base - 150, cForest],
          [base + (h - base) * 0.45, cForest.clone().lerp(cRock, 0.6)],
          [h, snowy && peak > 0.5 ? cSnow : cRock.clone().lerp(cSnow, snowy ? 0.2 : 0)],
        ]
        for (const [y, c] of rows) {
          pts.push(x, y, z)
          cols.push(c.r, c.g, c.b)
        }
        if (i) for (let k = 0; k < 2; k++) {
          const p0 = off + (i - 1) * 3 + k, p1 = off + i * 3 + k
          idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1)
        }
      }
      off += (seg + 1) * 3
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
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    // Most materials are shared and disposed with the world; a few meshes own theirs.
    if (o.userData.ownsMaterial) {
      const m = o.material as THREE.MeshLambertMaterial
      m.map?.dispose()
      m.dispose()
    }
  })
}
