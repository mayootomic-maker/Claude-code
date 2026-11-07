import * as THREE from 'three'
import { fbm2, noise2, rng, smoothstep } from '../core/math'
import type { RallyDef, StageDef } from '../data'
import { STEP, type Route } from '../sim/route'
import { asLand, BODY, type Crossing, type Ground, type Land } from '../sim/terrain'
import { CardBuilder, GeoBuilder, PRIM } from './builder'
import { baseFor, bridgeSupports, edgePoint, planSegment, planTile, type DrawnGround, type PlanCtx, type Placed } from './placement'
import { LAKE_BELOW_ROAD, lakeSurface, streamSurface } from './lakes'
import { addAnimal, addBale, addFence, addFlowers, addGrassCards, addHouse, addLandmark, addPole, addRock, addSpectator, addTree, addTuft, crownRadius, treeLook } from './props'
import { FAR_RES, planTileRes, splitAD, Surface, TILE, triHeight } from './surface'
import { barkTexture, detailTexture, foliageAtlas, groundTexture, leafTexture, rockTexture, roadTexture, waterNormals, type RoadKind } from './textures'

const ROAD_SEG = 120
/** Far terrain: chunks of this size on a coarse grid, drawn wherever the detailed tiles aren't. */
const CHUNK = 256
const CRES = FAR_RES
const CN = CHUNK / CRES + 1
const CELLS = CHUNK / CRES
/** Far chunks reach this far from the road. */
const FAR_REACH = 760

export interface Quality {
  /** Metres within which detailed terrain tiles, scenery and road furniture are built. */
  radius: number
  /** Metres within which the coarse far terrain is drawn. */
  far: number
  /** Terrain grid spacing beside the road, in the corridor, and at its back (metres; divisors of 64). */
  terrain: readonly [number, number, number]
  /** Scenery density multiplier. */
  density: number
  shadows: boolean
  aniso: number
  /** Rock, bark and leaf textures on scenery, fine detail and rock on terrain. Off on Low: they cost fill rate. */
  surfaces: boolean
  /** Alpha-tested leaf, needle and grass cards. */
  cards: boolean
  /** Fuller tree models: more tiers and clumps, limbs, root flares. */
  rich: boolean
  /** Distant forest as simple masses on the far terrain. */
  blobs: boolean
  /** Glossy wet tarmac with puddles in the rain. */
  wet: boolean
}

interface Tile {
  key: number
  cx: number
  cz: number
  res: number
  /** Key of the far chunk this tile's cells belong to. */
  chunk: number
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

interface Chunk {
  key: number
  gx: number
  gz: number
  cx: number
  cz: number
  /** Nearest road, metres (for the cheap path when there is none in reach). */
  road: number
  mesh: THREE.Mesh | null
  lake: THREE.Mesh | null
  /** Per cell: start and count of its forest-mass indices, and of its lake indices. */
  blobs: Int32Array | null
  lakes: Int32Array | null
  blobIdx: number[]
  lakeIdx: number[]
  grid: Float32Array | null
  dirty: boolean
}

const tileKey = (gx: number, gz: number): number => (gx + 32768) * 65536 + (gz + 32768)

/**
 * Streams the stage in around the camera. Near the road: detailed terrain
 * tiles on a world grid (so nothing ever overlaps itself on hairpins), each
 * with its scenery merged into a draw call or two, and road segments along the
 * route. Further out: coarse far-terrain chunks with distant forest, which
 * fill in wherever no detailed tile is built, out to the haze and the
 * mountains on the horizon. Everything is placed on the drawn surface.
 */
export class World {
  readonly group = new THREE.Group()
  private readonly tiles = new Map<number, Tile>()
  private readonly chunks = new Map<number, Chunk>()
  private readonly segs: Seg[] = []
  private readonly terrainMat: THREE.MeshLambertMaterial
  private readonly propMat: THREE.MeshLambertMaterial
  private readonly cardMat: THREE.MeshLambertMaterial | null
  private readonly roadMat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial
  private readonly farRoadMat: THREE.MeshLambertMaterial
  private readonly farMat: THREE.MeshLambertMaterial
  private readonly waterMat: THREE.MeshStandardMaterial
  private readonly lakeMat: THREE.MeshStandardMaterial
  private readonly time = { value: 0 }
  private readonly route: Route
  private readonly land: Land
  private readonly surf: Surface
  private readonly noise = noise2(9)
  private readonly snowAll: boolean
  private readonly plan: PlanCtx
  private readonly ridges: THREE.Mesh
  private readonly statics: THREE.Mesh[] = []

  constructor(
    ground: Ground,
    private readonly rally: RallyDef,
    private readonly stage: StageDef,
    private readonly q: Quality,
    private readonly start: number,
    private readonly finish: number,
    private readonly labels: { start: string; finish: string } = { start: 'START', finish: 'FINISH' },
  ) {
    this.land = asLand(ground)
    this.route = ground.route
    this.snowAll = rally.surface === 'snow' || stage.weather === 'snow'
    this.plan = { route: this.route, ground, rally, seed: stage.seed, noise: this.noise, snowAll: this.snowAll }
    this.surf = new Surface(this.land, (gx, gz) => this.tiles.get(tileKey(gx, gz))?.res ?? CRES)
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
          // Far away the fine texture only averages out; fade it to its mean so distant hills don't shimmer.
          det = mix(det, 0.78, smoothstep(150.0, 600.0, vDist));
          diffuseColor.rgb *= det * 1.28;
        #endif`)
    }
    const surfU = { tRock: rockT, tBark: { value: barkTexture(q.aniso) }, tLeaf: { value: leafTexture(q.aniso) }, tGrain: { value: detail } }
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true })
    if (q.surfaces) this.propMat.defines = { SURFACES: '' }
    const sway = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      sh.uniforms.uTime = this.time
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Wind: a slow sway, phase-shifted across the world so trees don't move in lockstep.
          float ph = position.x * 0.07 + position.z * 0.05;
          transformed.x += sin(uTime * 1.3 + ph) * aSway * 0.12;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * aSway * 0.08;`)
    }
    this.propMat.onBeforeCompile = (sh) => {
      sway(sh)
      Object.assign(sh.uniforms, surfU)
      sh.vertexShader = sh.vertexShader
        .replace('uniform float uTime;', 'uniform float uTime;\nattribute float aSurf;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vSurf;')
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
    // Foliage cards: cut out by alpha. With multisampling, alpha-to-coverage
    // turns the hard cut-out edge into a soft one at no extra cost.
    this.cardMat = q.cards ? new THREE.MeshLambertMaterial({ vertexColors: true, map: foliageAtlas(q.aniso), alphaTest: 0.42, side: THREE.DoubleSide, alphaToCoverage: true }) : null
    if (this.cardMat)
      this.cardMat.onBeforeCompile = (sh) => {
        sway(sh)
        // Double-sided cards keep their crown normal on both faces: flipped, the
        // back of every leaf and blade would be lit from underneath, i.e. black.
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );')
      }
    const kind = roadKind(rally)
    const roadMap = roadTexture(kind, roadBase(rally), q.aniso)
    this.roadMat = stage.weather === 'rain' && q.wet ? wetRoad(roadMap, kind === 'tarmac') : new THREE.MeshLambertMaterial({ map: roadMap, color: stage.weather === 'rain' ? 0xb4b4b4 : 0xffffff })
    // A constant depth nudge only: a slope-scaled one would pull it over the real road at grazing angles.
    this.farRoadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 })
    this.farMat = new THREE.MeshLambertMaterial({ vertexColors: true })
    // Still water mirrors the sky: low roughness picks up the environment map.
    // Ripples scroll slowly (see update); vertex alpha fades the shore.
    const ripples = waterNormals(q.aniso)
    // Winter lakes are frozen: pale, matt ice with only a hint of surface relief.
    this.lakeMat = this.snowAll
      ? new THREE.MeshStandardMaterial({ color: 0xc4d4dc, roughness: 0.32, metalness: 0.05, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.08, 0.08), depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: 0x1f3a44, roughness: 0.05, metalness: 0.55, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false })
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x4d6560, roughness: 0.12, metalness: 0.3, transparent: true, vertexColors: true, normalMap: ripples, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false })
    this.planTiles()
    this.planChunks()
    this.planSegments()
    this.ridges = this.horizon()
    this.group.add(this.ridges)
    for (const cr of this.land.crossings) this.addStatic(this.stream(cr), this.waterMat, 2)
    this.addStatic(this.farRoad(), this.farRoadMat, 0)
  }

  /** The drawn terrain, for anything that has to sit on it (soft props, the camera). */
  get surface(): DrawnGround {
    return this.surf
  }

  private addStatic(g: THREE.BufferGeometry, mat: THREE.Material, order: number): void {
    const m = new THREE.Mesh(g, mat)
    m.renderOrder = order
    this.statics.push(m)
    this.group.add(m)
  }

  /** Called every frame; builds at most `budget` pieces so a frame never stalls. */
  update(cam: THREE.Vector3, dt: number, budget = 2): void {
    this.time.value += dt
    const rip = this.lakeMat.normalMap
    if (rip && !this.snowAll) rip.offset.set(this.time.value * 0.012, this.time.value * 0.007)
    const wrip = this.waterMat.normalMap
    if (wrip) wrip.offset.set(this.time.value * 0.012, this.time.value * 0.007)
    // Distant ridges ring the camera, wherever on a long stage it is, their
    // feet a little below it so they never sink out of view on a climb.
    this.ridges.position.set(cam.x, cam.y - 40, cam.z)
    // Tiles reach a little beyond the road radius so any furniture that is
    // built always stands on detailed ground.
    const tr = this.q.radius + 24
    const r2 = this.q.radius * this.q.radius, t2 = tr * tr
    const drop2 = (this.q.radius + 120) ** 2, tdrop2 = (tr + 120) ** 2
    const want: { d: number; build: () => void }[] = []
    for (const t of this.tiles.values()) {
      const d2 = (t.cx - cam.x) ** 2 + (t.cz - cam.z) ** 2
      if (t.group && d2 > tdrop2) {
        dispose(t.group)
        this.group.remove(t.group)
        t.group = null
        this.dirty(t.chunk)
      } else if (!t.group && d2 < t2) want.push({ d: d2, build: () => this.buildTile(t) })
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
    // Far terrain: one chunk a frame (more while prewarming), nearest first.
    const f2 = (this.q.far + CHUNK * 0.7) ** 2, fdrop2 = (this.q.far + CHUNK * 0.7 + 200) ** 2
    let best: Chunk | null = null, bestD = Infinity
    for (const c of this.chunks.values()) {
      const d2 = (c.cx - cam.x) ** 2 + (c.cz - cam.z) ** 2
      if (c.mesh && d2 > fdrop2) this.dropChunk(c)
      else if (!c.mesh && d2 < f2 && d2 < bestD) {
        best = c
        bestD = d2
      }
    }
    if (best) this.buildChunk(best)
    for (const c of this.chunks.values()) if (c.dirty && c.mesh) this.indexChunk(c)
  }

  /** Everything around a point, built synchronously: used behind the loading screen. */
  prewarm(cam: THREE.Vector3): void {
    for (let i = 0; i < 600; i++) {
      const before = this.loaded
      this.update(cam, 0, 8)
      if (this.loaded === before) break
    }
  }

  get loaded(): number {
    let n = 0
    for (const t of this.tiles.values()) if (t.group) n++
    for (const s of this.segs) if (s.group) n++
    for (const c of this.chunks.values()) if (c.mesh) n++
    return n
  }

  dispose(): void {
    for (const t of this.tiles.values()) if (t.group) dispose(t.group)
    for (const s of this.segs) if (s.group) dispose(s.group)
    for (const c of this.chunks.values()) this.dropChunk(c)
    for (const m of this.statics) m.geometry.dispose()
    this.ridges.geometry.dispose()
    ;(this.ridges.material as THREE.Material).dispose()
    this.group.clear()
    this.terrainMat.dispose()
    this.propMat.dispose()
    this.cardMat?.dispose()
    this.roadMat.dispose()
    this.farRoadMat.dispose()
    this.farMat.dispose()
    this.waterMat.dispose()
    this.lakeMat.dispose()
  }

  // ---------------------------------------------------------------- planning

  private planTiles(): void {
    for (const [key, res] of planTileRes(this.route, this.land.edge, this.q.terrain)) {
      const gx = Math.floor(key / 65536) - 32768, gz = (key % 65536) - 32768
      this.tiles.set(key, { key, cx: (gx + 0.5) * TILE, cz: (gz + 0.5) * TILE, res, chunk: tileKey(Math.floor((gx * TILE) / CHUNK), Math.floor((gz * TILE) / CHUNK)), group: null })
    }
  }

  private planChunks(): void {
    for (let i = 0; i < this.route.n; i += 16) {
      const x = this.route.x[i], z = this.route.z[i]
      for (let gx = Math.floor((x - FAR_REACH) / CHUNK); gx <= Math.floor((x + FAR_REACH) / CHUNK); gx++)
        for (let gz = Math.floor((z - FAR_REACH) / CHUNK); gz <= Math.floor((z + FAR_REACH) / CHUNK); gz++) {
          const cx = (gx + 0.5) * CHUNK, cz = (gz + 0.5) * CHUNK
          const d = Math.hypot(Math.max(0, Math.abs(x - cx) - CHUNK / 2), Math.max(0, Math.abs(z - cz) - CHUNK / 2))
          if (d > FAR_REACH) continue
          const key = tileKey(gx, gz)
          const c = this.chunks.get(key)
          if (!c) this.chunks.set(key, { key, gx, gz, cx, cz, road: d, mesh: null, lake: null, blobs: null, lakes: null, blobIdx: [], lakeIdx: [], grid: null, dirty: false })
          else c.road = Math.min(c.road, d)
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

  /** Vertex colour of the ground: grass, dry patches, forest floor, verge, rock on steep faces, snow. */
  private terrainColor(c: THREE.Color, x: number, z: number, h: number, slope: number, d: number, wet: boolean, far: number): void {
    const pal = this.rally.palette
    const c2 = tmpC
    const mixN = fbm2(this.noise, x / 40, z / 40, 3) * 0.5 + 0.5
    c.setHex(pal.grassA).lerp(c2.setHex(pal.grassB), mixN)
    const dry = smoothstep(0.55, 0.85, fbm2(this.noise, x / 120 + 7, z / 120, 2) * 0.5 + 0.5)
    c.lerp(c2.setHex(pal.dry), dry * 0.6)
    const forest = smoothstep(14, 40, d) * this.rally.trees.density
    c.lerp(c2.setHex(pal.forest), forest * 0.55 * mixN)
    // Far away the forest itself is the colour of the land: dark canopy where it's thick.
    if (far > 0) {
      const clump = smoothstep(-0.25, 0.15, fbm2(this.noise, x / 70, z / 70, 2))
      c.lerp(c2.setHex(pal.forest).multiplyScalar(0.8), far * Math.min(1, this.rally.trees.density) * clump * 0.75)
    }
    c.lerp(c2.setHex(pal.soil), (1 - smoothstep(this.land.edge, this.land.edge + 3.5, d)) * 0.7)
    c.lerp(c2.setHex(pal.verge), (1 - smoothstep(this.land.edge + 1, this.land.edge + 6, d)) * 0.5)
    c.lerp(c2.setHex(mixN > 0.5 ? pal.rock : pal.rock2), smoothstep(0.55, 0.95, slope))
    const snowLine = this.rally.snowLine ?? 9999
    const snow = this.snowAll ? 1 - smoothstep(0.7, 1.1, slope) * 0.6 : smoothstep(snowLine - 30, snowLine + 30, h)
    c.lerp(c2.setHex(pal.snow), snow)
    if (wet) c.lerp(c2.setHex(0xb8a77e), 0.6)
  }

  private buildTile(t: Tile): void {
    const g = new THREE.Group()
    const res = t.res
    const n = TILE / res + 1, N = n + 2
    const x0 = t.cx - TILE / 2, z0 = t.cz - TILE / 2
    // One ring of samples beyond the tile: normals then come out the same on
    // both sides of a tile border, so there is no lighting seam between tiles.
    const H = new Float32Array(N * N)
    const dist = new Float32Array(n * n)
    const wet = new Uint8Array(n * n)
    for (let j = -1; j <= n; j++)
      for (let i = -1; i <= n; i++) {
        const x = x0 + i * res, z = z0 + j * res
        const inside = i >= 0 && j >= 0 && i < n && j < n
        if (inside) {
          const s = this.land.sample(x, z)
          H[(j + 1) * N + i + 1] = s.mesh
          dist[j * n + i] = s.dist
          wet[j * n + i] = s.water !== null ? 1 : 0
          this.surf.remember(x, z, s.mesh)
        } else H[(j + 1) * N + i + 1] = this.surf.vertex(x, z)
      }
    const hgt = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hgt[j * n + i] = H[(j + 1) * N + i + 1]
    const plan = planTile(this.plan, t.cx, t.cz, t.key, this.q.density)
    // Props read heights from this tile's own triangles; footprints that reach
    // over the edge ask the shared surface, which agrees with the neighbour.
    const local: DrawnGround = {
      height: (x, z) => {
        const fx = (x - x0) / res, fz = (z - z0) / res
        if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return this.surf.height(x, z)
        const i = Math.floor(fx), j = Math.floor(fz), k = j * n + i
        return triHeight(hgt[k], hgt[k + 1], hgt[k + n], hgt[k + n + 1], fx - i, fz - j)
      },
      low(x, z, r) {
        let m = this.height(x, z)
        for (let k = 0; r > 0 && k < 6; k++) m = Math.min(m, this.height(x + Math.cos((k * Math.PI) / 3) * r, z + Math.sin((k * Math.PI) / 3) * r))
        return m
      },
      high(x, z, r) {
        let m = this.height(x, z)
        for (let k = 0; r > 0 && k < 6; k++) m = Math.max(m, this.height(x + Math.cos((k * Math.PI) / 3) * r, z + Math.sin((k * Math.PI) / 3) * r))
        return m
      },
    }
    const cnt = n * n + 4 * n
    const pos = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2)
    const c = new THREE.Color()
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, K = (j + 1) * N + i + 1
        const x = x0 + i * res, z = z0 + j * res
        const hx = H[K + 1] - H[K - 1], hz = H[K + N] - H[K - N]
        const slope = Math.hypot(hx, hz) / (2 * res)
        const l = Math.hypot(hx, 2 * res, hz)
        nor[k * 3] = -hx / l
        nor[k * 3 + 1] = (2 * res) / l
        nor[k * 3 + 2] = -hz / l
        pos[k * 3] = x
        pos[k * 3 + 1] = hgt[k]
        pos[k * 3 + 2] = z
        uv[k * 2] = x / 5
        uv[k * 2 + 1] = z / 5
        this.terrainColor(c, x, z, hgt[k], slope, dist[k], wet[k] === 1, 0)
        col[k * 3] = c.r
        col[k * 3 + 1] = c.g
        col[k * 3 + 2] = c.b
      }
    // Contact shade under trees, rocks and buildings: the ground where their
    // shadow and the forest floor would be, darker than the open grass.
    for (const p of plan) {
      const rad = p.kind === 'tree' ? Math.min(5, crownRadius(p.sub, p.size) * 0.75) : p.kind === 'rock' ? p.size * 1.7 : p.kind === 'house' ? 8.5 : p.kind === 'shrub' ? 1.6 : 0
      if (!rad) continue
      const i0 = Math.max(0, Math.floor((p.x - rad - x0) / res)), i1 = Math.min(n - 1, Math.ceil((p.x + rad - x0) / res))
      const j0 = Math.max(0, Math.floor((p.z - rad - z0) / res)), j1 = Math.min(n - 1, Math.ceil((p.z + rad - z0) / res))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(x0 + i * res - p.x, z0 + j * res - p.z) / rad
          if (d >= 1) continue
          const k = (j * n + i) * 3
          const f = 1 - 0.38 * (1 - d) * (1 - d)
          col[k] *= f
          col[k + 1] *= f
          col[k + 2] *= f
        }
    }
    const idx: number[] = []
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1
        if (splitAD(hgt[a], hgt[b], hgt[cc], hgt[d])) idx.push(a, cc, d, a, d, b)
        else idx.push(a, cc, b, b, cc, d)
      }
    // Skirts down from all four edges: where a neighbour is coarser or finer,
    // or is far terrain, the hairline crack between them is covered.
    const drop = 0.6 + res * 0.6
    let sv = n * n
    const edgeRow = (verts: number[]) => {
      const base = sv
      for (const k of verts) {
        pos[sv * 3] = pos[k * 3]
        pos[sv * 3 + 1] = pos[k * 3 + 1] - drop
        pos[sv * 3 + 2] = pos[k * 3 + 2]
        for (let q = 0; q < 3; q++) {
          nor[sv * 3 + q] = nor[k * 3 + q]
          col[sv * 3 + q] = col[k * 3 + q]
        }
        uv[sv * 2] = uv[k * 2]
        uv[sv * 2 + 1] = uv[k * 2 + 1] + drop / 5
        sv++
      }
      for (let q = 0; q < verts.length - 1; q++) {
        const a = verts[q], b = verts[q + 1], a2 = base + q, b2 = base + q + 1
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2)
      }
    }
    const row = (f: (q: number) => number) => Array.from({ length: n }, (_, q) => f(q))
    edgeRow(row((q) => q))
    edgeRow(row((q) => (n - 1) * n + q))
    edgeRow(row((q) => q * n))
    edgeRow(row((q) => q * n + n - 1))
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeBoundingSphere()
    const mesh = new THREE.Mesh(geo, this.terrainMat)
    mesh.receiveShadow = this.q.shadows
    g.add(mesh)
    this.scatter(g, plan, local)
    // Lake surface: only the cells that touch a lake, always below the road.
    const lake = lakeSurface(this.land, x0, z0, n, res, hgt)
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
    this.dirty(t.chunk)
  }

  private scatter(g: THREE.Group, plan: Placed[], ground: DrawnGround): void {
    const b = new GeoBuilder()
    const cards = this.cardMat ? new CardBuilder() : null
    const pal = this.rally.palette
    for (const p of plan) {
      const r = rng(p.seed)
      const { y, bottom } = baseFor(p, ground)
      if (p.kind === 'tree' || p.kind === 'shrub') addTree(b, p.sub, p.x, y, p.z, r, p.size, cards, this.q.rich)
      else if (p.kind === 'rock') addRock(b, p.x, y, p.z, p.size, p.sub === 'a' ? pal.rock : pal.rock2, r)
      else if (p.kind === 'house') addHouse(b, p.sub, p.x, y, p.z, p.yaw, r, bottom)
      else if (p.kind === 'animal') addAnimal(b, p.sub, p.x, y, p.z, p.yaw, r)
      else if (p.kind === 'flowers') addFlowers(b, p.x, y, p.z, r)
      else if (p.kind === 'tuft') {
        // Grass cards on High only: cut-out quads filling the verge near the camera are heavy on a phone's fill rate.
        if (cards && this.q.rich) addGrassCards(cards, p.x, y, p.z, p.sub === 'a' ? pal.grassA : pal.dry, r)
        else addTuft(b, p.x, y, p.z, p.sub === 'a' ? pal.grassA : pal.dry, r)
      }
    }
    if (!b.empty) {
      const m = new THREE.Mesh(b.build(), this.propMat)
      m.castShadow = this.q.shadows
      m.receiveShadow = this.q.shadows
      g.add(m)
    }
    if (cards && this.cardMat && !cards.empty) {
      // Cards don't cast: the shadow map would see whole quads, not their cut-out leaves.
      const m = new THREE.Mesh(cards.build(), this.cardMat)
      m.receiveShadow = this.q.shadows
      g.add(m)
    }
  }

  // ---------------------------------------------------------------- far terrain

  private dirty(chunk: number): void {
    const c = this.chunks.get(chunk)
    if (c) c.dirty = true
  }

  private dropChunk(c: Chunk): void {
    for (const m of [c.mesh, c.lake]) {
      if (!m) continue
      m.geometry.dispose()
      this.group.remove(m)
    }
    c.mesh = c.lake = null
    c.grid = null
    c.blobs = c.lakes = null
    c.blobIdx = []
    c.lakeIdx = []
  }

  /**
   * A far-terrain chunk: a 16 m grid with skirts, distant forest as simple
   * masses, and lakes. Built once; which of its cells are drawn changes as
   * detailed tiles come and go (see indexChunk), which only rewrites indices.
   */
  private buildChunk(c: Chunk): void {
    const x0 = c.gx * CHUNK, z0 = c.gz * CHUNK
    const N = CN + 2
    const H = new Float32Array(N * N)
    const dist = new Float32Array(CN * CN), wet = new Uint8Array(CN * CN), lakeL = new Float32Array(CN * CN), roadY = new Float32Array(CN * CN)
    for (let j = -1; j <= CN; j++)
      for (let i = -1; i <= CN; i++) {
        const x = x0 + i * CRES, z = z0 + j * CRES
        const inside = i >= 0 && j >= 0 && i < CN && j < CN
        if (inside) {
          const s = this.land.sample(x, z)
          H[(j + 1) * N + i + 1] = s.mesh
          dist[j * CN + i] = s.dist
          wet[j * CN + i] = s.water !== null ? 1 : 0
          lakeL[j * CN + i] = s.lake ?? NaN
          roadY[j * CN + i] = s.roadY ?? Infinity
        } else H[(j + 1) * N + i + 1] = this.land.mesh(x, z)
      }
    const hgt = new Float32Array(CN * CN)
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) hgt[j * CN + i] = H[(j + 1) * N + i + 1]
    const pos: number[] = [], col: number[] = [], nor: number[] = [], uv: number[] = []
    const cc = new THREE.Color()
    const drop = 6
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < CN; j++)
        for (let i = 0; i < CN; i++) {
          const k = j * CN + i, K = (j + 1) * N + i + 1
          const x = x0 + i * CRES, z = z0 + j * CRES
          const hx = H[K + 1] - H[K - 1], hz = H[K + N] - H[K - N]
          const l = Math.hypot(hx, 2 * CRES, hz)
          pos.push(x, hgt[k] - (pass ? drop : 0), z)
          nor.push(-hx / l, (2 * CRES) / l, -hz / l)
          uv.push(x / 5, z / 5 + (pass ? drop / 5 : 0))
          this.terrainColor(cc, x, z, hgt[k], Math.hypot(hx, hz) / (2 * CRES), dist[k], wet[k] === 1, smoothstep(30, 120, dist[k]))
          // Skirts keep the surface colour: a darker skirt peeking at a seam reads as a crack.
          col.push(cc.r, cc.g, cc.b)
        }
    // Distant forest: cones and domes, enough to give far hillsides texture.
    const blobs = new Int32Array(CELLS * CELLS * 2)
    const blobIdx: number[] = []
    if (this.q.blobs && this.rally.trees.density > 0.05) {
      const kinds = Object.entries(this.rally.trees.mix).filter(([k, w]) => w > 0 && k !== 'macchia' && k !== 'thornbush' && k !== 'pampas')
      const wsum = kinds.reduce((a, [, w]) => a + w, 0)
      const r = rng(c.key ^ this.stage.seed)
      for (let cj = 0; cj < CELLS; cj++)
        for (let ci = 0; ci < CELLS; ci++) {
          const start = blobIdx.length
          const k0 = cj * CN + ci
          const mean = Math.min(3.6, this.rally.trees.density * 3.4) * this.q.density
          for (let m = 0; m < 4 && kinds.length; m++) {
            if (r() > mean / 4) continue
            const fx = r(), fz = r()
            const x = x0 + (ci + fx) * CRES, z = z0 + (cj + fz) * CRES
            if (fbm2(this.noise, x / 70, z / 70, 2) < -0.15) continue
            const dd = Math.min(dist[k0], dist[k0 + 1], dist[k0 + CN], dist[k0 + CN + 1])
            if (dd < this.land.edge + 14 || wet[k0] || wet[k0 + 1] || wet[k0 + CN] || wet[k0 + CN + 1]) continue
            const y = triHeight(hgt[k0], hgt[k0 + 1], hgt[k0 + CN], hgt[k0 + CN + 1], fx, fz)
            const hs = Math.abs(hgt[k0 + 1] - hgt[k0]) + Math.abs(hgt[k0 + CN] - hgt[k0])
            if (hs > CRES * 1.4) continue
            let pick = r() * wsum, kind = kinds[0][0]
            for (const [kk, w] of kinds) if ((pick -= w) <= 0) {
              kind = kk
              break
            }
            const look = treeLook(kind)
            blob(pos, nor, col, uv, blobIdx, x, y, z, 10 + r() * 8, look.conifer, look.leaf, r)
          }
          blobs[(cj * CELLS + ci) * 2] = start
          blobs[(cj * CELLS + ci) * 2 + 1] = blobIdx.length - start
        }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex([])
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.cx, hgt[(CN >> 1) * CN + (CN >> 1)], c.cz), CHUNK * 0.75 + 200)
    // Far terrain: vertex colour only (the detail texture would average out at this range anyway), and
    // drawn after the detailed world so the depth test throws away whatever it covers before shading.
    c.mesh = new THREE.Mesh(geo, this.farMat)
    c.mesh.renderOrder = 1
    c.mesh.receiveShadow = false
    c.grid = hgt
    c.blobs = blobs
    c.blobIdx = blobIdx
    // Lakes on the far terrain: per cell, so a detailed tile's own lake can take over its cells.
    const lakes = new Int32Array(CELLS * CELLS * 2)
    const lp: number[] = [], lu: number[] = [], lc: number[] = [], li: number[] = []
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const k0 = cj * CN + ci
        const ks = [k0, k0 + 1, k0 + CN, k0 + CN + 1]
        const start = li.length
        if (ks.some((k) => !Number.isNaN(lakeL[k]))) {
          const v0 = lp.length / 3
          for (const k of ks) {
            const x = x0 + (k % CN) * CRES, z = z0 + Math.floor(k / CN) * CRES
            const wl = lakeL[k]
            lp.push(x, Math.min(roadY[k] - LAKE_BELOW_ROAD, Number.isNaN(wl) ? hgt[k] - 0.6 : wl), z)
            lu.push(x / 9, z / 9)
            lc.push(1, 1, 1, Number.isNaN(wl) ? 0 : 0.93)
          }
          li.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3)
        }
        lakes[(cj * CELLS + ci) * 2] = start
        lakes[(cj * CELLS + ci) * 2 + 1] = li.length - start
      }
    if (li.length) {
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3))
      lg.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2))
      lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 4))
      lg.setAttribute('normal', new THREE.Float32BufferAttribute(lp.map((_, q) => (q % 3 === 1 ? 1 : 0)), 3))
      lg.setIndex([])
      lg.boundingSphere = geo.boundingSphere.clone()
      c.lake = new THREE.Mesh(lg, this.lakeMat)
      c.lake.renderOrder = 1
      c.lakes = lakes
      c.lakeIdx = li
      this.group.add(c.lake)
    }
    this.group.add(c.mesh)
    this.indexChunk(c)
  }

  /** Which cells of a chunk are drawn: every one not covered by a built detailed tile. */
  private indexChunk(c: Chunk): void {
    c.dirty = false
    if (!c.mesh || !c.grid) return
    const hgt = c.grid
    const x0 = c.gx * CHUNK, z0 = c.gz * CHUNK
    const per = TILE / CRES
    const hidden = new Uint8Array(CELLS * CELLS)
    for (let tj = 0; tj < CHUNK / TILE; tj++)
      for (let ti = 0; ti < CHUNK / TILE; ti++) {
        const t = this.tiles.get(tileKey(Math.floor(x0 / TILE) + ti, Math.floor(z0 / TILE) + tj))
        if (!t?.group) continue
        for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) hidden[(tj * per + j) * CELLS + ti * per + i] = 1
      }
    const idx: number[] = []
    const lidx: number[] = []
    const S = CN * CN
    const skirt = (a: number, b: number) => idx.push(a, a + S, b, b, a + S, b + S, a, b, a + S, b, b + S, a + S)
    for (let cj = 0; cj < CELLS; cj++)
      for (let ci = 0; ci < CELLS; ci++) {
        const cell = cj * CELLS + ci
        if (hidden[cell]) continue
        const a = cj * CN + ci, b = a + 1, cc = a + CN, d = cc + 1
        if (splitAD(hgt[a], hgt[b], hgt[cc], hgt[d])) idx.push(a, cc, d, a, d, b)
        else idx.push(a, cc, b, b, cc, d)
        // Skirts wherever this cell meets a detailed tile or the chunk's edge.
        if (cj === 0 || hidden[cell - CELLS]) skirt(a, b)
        if (cj === CELLS - 1 || hidden[cell + CELLS]) skirt(cc, d)
        if (ci === 0 || hidden[cell - 1]) skirt(a, cc)
        if (ci === CELLS - 1 || hidden[cell + 1]) skirt(b, d)
        if (c.blobs) for (let q = 0; q < c.blobs[cell * 2 + 1]; q++) idx.push(c.blobIdx[c.blobs[cell * 2] + q])
        if (c.lakes) for (let q = 0; q < c.lakes[cell * 2 + 1]; q++) lidx.push(c.lakeIdx[c.lakes[cell * 2] + q])
      }
    c.mesh.geometry.setIndex(idx)
    if (c.lake) c.lake.geometry.setIndex(lidx)
  }

  // ---------------------------------------------------------------- water

  /**
   * A stream or river crossing the road: a strip down the middle of its
   * channel at the channel's own level, following the land downhill on
   * either side. Its edges fade out and tuck under the banks.
   */
  private stream(cr: Crossing): THREE.BufferGeometry {
    const s = streamSurface(cr, (x, z) => this.surf.height(x, z))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(s.uv, 2))
    g.setAttribute('color', new THREE.BufferAttribute(s.col, 4))
    g.setIndex(s.idx)
    g.computeVertexNormals()
    return g
  }

  /**
   * The whole road as one cheap ribbon a little under the real one, so it
   * shows winding across the far terrain beyond the detailed corridor.
   */
  private farRoad(): THREE.BufferGeometry {
    const pts: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = []
    const base = new THREE.Color(roadBase(this.rally)).multiplyScalar(this.rally.surface === 'snow' ? 0.95 : 0.9)
    const half = this.route.half
    for (let s = 0, k = 0; s <= this.route.length; s += 8, k++) {
      const a = this.route.at(s)
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      for (const o of [half, -half]) {
        pts.push(a.x + lx * o, a.y - 0.14, a.z + lz * o)
        col.push(base.r, base.g, base.b)
        nor.push(0, 1, 0)
      }
      if (k) idx.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    return g
  }

  // ---------------------------------------------------------------- road

  private buildSeg(sg: Seg): void {
    const g = new THREE.Group()
    const route = this.route
    const half = route.half
    const edge = this.land.edge
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
    const onBridge: boolean[] = []
    for (let k = 0; k < n; k++) {
      const s = Math.min(sg.s1, sg.s0 + k * STEP)
      const a = route.at(s)
      onBridge.push(!!route.featureAt(s, 'bridge'))
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
      // No shoulders over a gorge: the bridge deck has its own edges.
      if (onBridge[k] || onBridge[k + 1]) continue
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
    for (const f of route.features) if (f.kind === 'bridge' && f.s0 >= sg.s0 && f.s0 < sg.s1) this.bridge(b, f.s0, f.s1)
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
    sg.group = g
    this.group.add(g)
  }

  /** What stands at the road edge on this side at s: the rally's own edge, or walls through a narrow section. */
  private edgeKind(s: number, up: boolean): string {
    const e = this.rally.edge
    if (!this.land.narrowAt(s)) return up ? e.up : e.down
    if (this.rally.surface === 'snow') return 'snowbank'
    if (up && (e.up === 'rockwall' || e.up === 'mosswall')) return e.up
    return this.rally.surface === 'asphalt' && !up ? 'rail' : 'stonewall'
  }

  /** Rails, rock walls, stone walls and snowbanks, always just outside where the car is held. */
  private edges(b: GeoBuilder, sg: Seg): void {
    const route = this.route
    const rail = new THREE.Color(0xb9bcc0), post = new THREE.Color(0x6a6d70)
    const rock = new THREE.Color(this.rally.palette.rock), moss = new THREE.Color(0x56664a)
    const snow = new THREE.Color(this.rally.palette.snow)
    const stone = new THREE.Color(this.rally.biome === 'wales' ? 0x77746c : this.rally.biome === 'med' || this.rally.biome === 'iberia' ? 0xa49a88 : 0x8e8a82)
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const surf = this.surf
    for (let s = sg.s0; s < sg.s1; s += 4) {
      const s2 = Math.min(sg.s1, s + 4)
      if (route.featureAt(s, 'bridge') || route.featureAt(s2, 'bridge')) continue
      const a = route.at(s), c = route.at(s2)
      for (const side of [1, -1] as const) {
        // Which side climbs? Compare natural ground a few metres out.
        const lx = Math.cos(a.heading) * side, lz = -Math.sin(a.heading) * side
        const out = this.land.natural(a.x + lx * 14, a.z + lz * 14) - a.y
        const kind = this.edgeKind(s, out > 0.8)
        // One body-width beyond where the car's centre is held, so the car never sinks into it.
        const e0 = edgePoint(this.plan, s, side), e1 = edgePoint(this.plan, s2, side)
        if (!e0 || !e1) continue
        const lx2 = Math.cos(c.heading) * side, lz2 = -Math.sin(c.heading) * side
        const p0 = v(e0.x, a.y, e0.z), p1 = v(e1.x, c.y, e1.z)
        // The ground under each end, as drawn: posts and wall footings reach it.
        const g0 = surf.height(p0.x, p0.z), g1 = surf.height(p1.x, p1.z)
        if (kind === 'rail') {
          const y0 = a.y + 0.55, y1 = c.y + 0.55
          b.quad2(v(p0.x, y0, p0.z), v(p1.x, y1, p1.z), v(p1.x, y1 + 0.3, p1.z), v(p0.x, y0 + 0.3, p0.z), rail)
          const bot = Math.min(a.y, g0) - 0.5
          b.add(PRIM.box, post.getHex(), p0.x, bot, p0.z, 0.12, a.y + 0.9 - bot, 0.12, a.heading)
        } else if (kind === 'stonewall') {
          // A dry-stone wall: inner face, coped top and outer face, continuous
          // from step to step, with its footing below the lower of road and ground.
          const h0 = 0.95 + this.noise(p0.x * 0.3, p0.z * 0.3) * 0.15, h1 = 0.95 + this.noise(p1.x * 0.3, p1.z * 0.3) * 0.15
          const t = 0.55
          const f0 = Math.min(a.y, g0, surf.height(p0.x + lx * t, p0.z + lz * t)) - 0.35
          const f1 = Math.min(c.y, g1, surf.height(p1.x + lx2 * t, p1.z + lz2 * t)) - 0.35
          const i0b = v(p0.x, f0, p0.z), i1b = v(p1.x, f1, p1.z)
          const i0t = v(p0.x, a.y + h0, p0.z), i1t = v(p1.x, c.y + h1, p1.z)
          const o0t = v(p0.x + lx * t, a.y + h0 - 0.05, p0.z + lz * t), o1t = v(p1.x + lx2 * t, c.y + h1 - 0.05, p1.z + lz2 * t)
          const o0b = v(p0.x + lx * t, f0, p0.z + lz * t), o1b = v(p1.x + lx2 * t, f1, p1.z + lz2 * t)
          const col = stone.clone().multiplyScalar(0.85 + this.noise(p0.x * 0.5, p0.z * 0.5) * 0.15)
          b.surface = 1
          b.quad2(i0b, i1b, i1t, i0t, col)
          b.quad2(i0t, i1t, o1t, o0t, col.clone().multiplyScalar(1.08))
          b.quad2(o0t, o1t, o1b, o0b, col)
          // Close the wall where it starts or stops, so its end is never an open box.
          if (this.edgeKind(s - 4, out > 0.8) !== 'stonewall' || !edgePoint(this.plan, s - 4, side)) b.quad2(i0b, i0t, o0t, o0b, col)
          if (this.edgeKind(s2 + 4, out > 0.8) !== 'stonewall' || !edgePoint(this.plan, s2 + 4, side) || s2 >= sg.s1) b.quad2(i1b, i1t, o1t, o1b, col)
          b.surface = 0
        } else if (kind === 'rockwall' || kind === 'mosswall') {
          const ROWS = 7
          // A cut rock face: rows stepping back and up, each vertex pushed
          // by noise in world space so neighbouring segments join seamlessly.
          const moss2 = kind === 'mosswall'
          const H = moss2 ? 2.2 : 4.5 + this.noise(s / 23, side * 3) * 2.5
          const face = (p: THREE.Vector3, a2: { heading: number; y: number }, gy: number, ox: number, oz: number) => {
            const rows: THREE.Vector3[] = []
            for (let k = 0; k <= ROWS; k++) {
              const f = k / ROWS
              const jag = this.noise(p.x * 0.35 + k * 1.7, p.z * 0.35) * 0.9 + this.noise(p.x * 1.3 + k * 3.1, p.z * 1.3) * 0.35
              const off = 0.15 + f * f * 2.2 + jag * 0.7 + (k % 2) * 0.3
              // The foot of the face starts below whichever is lower, road or ground.
              const y0 = Math.min(a2.y, gy) - 0.4
              rows.push(v(p.x + ox * off, y0 + f * (a2.y + H - y0) + jag * 0.35 * f, p.z + oz * off))
            }
            return rows
          }
          const r0 = face(p0, a, g0, lx, lz), r1 = face(p1, c, g1, lx2, lz2)
          b.surface = moss2 ? 3 : 1
          for (let k = 0; k < ROWS; k++) {
            const shade = 0.7 + this.noise(p0.x * 0.2 + k, p0.z * 0.2) * 0.28 + (k / ROWS) * 0.2
            const col = (moss2 ? moss : k === ROWS - 1 && this.rally.palette.forest ? rock.clone().lerp(new THREE.Color(this.rally.palette.forest), 0.35) : rock).clone().multiplyScalar(shade)
            b.quad2(r0[k], r1[k], r1[k + 1], r0[k + 1], col)
          }
          b.surface = 1
          if (!moss2 && this.noise(s / 3, side * 9) > 0.35) b.add(PRIM.dodeca, rock.getHex(), p0.x + lx * 0.6, Math.min(a.y, g0) - 0.2, p0.z + lz * 0.6, 0.7, 0.5, 0.7, s, 0.3, 0.2, 0, 0, 1.2, Math.random)
          b.surface = 0
        } else if (kind === 'snowbank') {
          const hgt = 0.9 + this.noise(s / 7, side * 5) * 0.3
          const mid0 = v(p0.x + lx * 0.6, a.y + hgt, p0.z + lz * 0.6), mid1 = v(p1.x + lx2 * 0.6, c.y + hgt, p1.z + lz2 * 0.6)
          const in0 = v(p0.x - lx * 0.3, a.y - 0.1, p0.z - lz * 0.3), in1 = v(p1.x - lx2 * 0.3, c.y - 0.1, p1.z - lz2 * 0.3)
          // The outer foot settles onto the ground as drawn, whichever way it falls.
          const ox0 = p0.x + lx * 2.2, oz0 = p0.z + lz * 2.2, ox1 = p1.x + lx2 * 2.2, oz1 = p1.z + lz2 * 2.2
          const o0 = v(ox0, surf.height(ox0, oz0) - 0.15, oz0), o1 = v(ox1, surf.height(ox1, oz1) - 0.15, oz1)
          b.quad2(in0, in1, mid1, mid0, snow)
          b.quad2(mid0, mid1, o1, o0, snow)
        } else if (Math.round(s) % 24 === 0) {
          // Soft edge: a white marker post just beyond the drivable verge.
          const bot = g0 - 0.3
          b.add(PRIM.box, 0xf3f1ea, p0.x, bot, p0.z, 0.14, g0 + 1.1 - bot, 0.14, a.heading)
          b.add(PRIM.box, 0x1d1f22, p0.x, g0 + 0.75, p0.z, 0.15, 0.22, 0.15, a.heading)
        }
      }
    }
  }

  /** Chevrons before tight corners, crowds at the good spots, start and finish gantries. */
  private furniture(b: GeoBuilder, sg: Seg): void {
    const route = this.route
    for (const p of planSegment(this.plan, sg.s0, sg.s1, sg.i, this.start, this.finish, this.q.density)) {
      const { y, bottom } = baseFor(p, this.surf)
      if (p.kind === 'board') {
        const ry = route.at(route.closest(p.x, p.z)?.s ?? 0).y
        const bot = Math.min(y, ry) - 0.4
        b.add(PRIM.box, 0x3a3a3a, p.x, bot, p.z, 0.08, ry + 1.5 - bot, 0.08, p.yaw)
        b.add(PRIM.boxC, p.sub === 'y' ? 0xf2c037 : 0x1c1d20, p.x, ry + 1.2, p.z, 0.9, 0.55, 0.05, p.yaw)
      } else if (p.kind === 'spectator') addSpectator(b, p.x, y, p.z, p.yaw, rng(p.seed))
      else if (p.kind === 'landmark') addLandmark(b, p.sub, p.x, y, p.z, p.yaw, rng(p.seed))
      else if (p.kind === 'house') addHouse(b, p.sub, p.x, y, p.z, p.yaw, rng(p.seed), bottom)
      else if (p.kind === 'fence' && p.x2 !== undefined && p.z2 !== undefined) addFence(b, p.x, y, p.z, p.x2, this.surf.low(p.x2, p.z2, 0.08), p.z2, this.rally.biome === 'wales' ? 0x7d7a72 : 0x8a6a4a)
      else if (p.kind === 'bale') addBale(b, p.x, y, p.z, p.yaw)
      else if (p.kind === 'pole') addPole(b, p.x, y, p.z, p.yaw)
    }
    for (const [s, color] of [[this.start, 0x2e8c55], [this.finish, 0xd8452f]] as const) {
      if (s < sg.s0 || s >= sg.s1) continue
      const a = route.at(s)
      const lim = this.land.limitAt(s) + BODY + 0.6
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      for (const side of [1, -1]) {
        const px = a.x + lx * lim * side, pz = a.z + lz * lim * side
        const bot = Math.min(a.y, this.surf.low(px, pz, 0.25)) - 0.5
        b.add(PRIM.box, 0x30343a, px, bot, pz, 0.35, a.y + 5.1 - bot, 0.35, a.heading)
      }
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
    const w = (this.land.limitAt(s) + BODY + 0.6) * 2 * 0.7
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
   * A stone bridge: one continuous deck slab with parapets, stone abutments
   * running down into both banks and piers standing on the gorge floor.
   * Every face is a ribbon along the road, so a curved bridge has no gaps.
   */
  private bridge(b: GeoBuilder, s0: number, s1: number): void {
    const route = this.route
    const half = route.half
    const stone = new THREE.Color(0x8e8a82), dark = new THREE.Color(0x6a665f), cap = new THREE.Color(0xa29e95)
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const W = half + 0.65
    b.surface = 1
    let prev: THREE.Vector3[] | null = null
    for (let s = s0 - 3; s <= s1 + 3 + 1e-6; s += 2) {
      const a = route.at(s)
      const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
      const P = (o: number, y: number) => v(a.x + lx * o, a.y + y, a.z + lz * o)
      // Cross-section, left to right: outer parapet foot, parapet top, inner parapet, deck edge... and the slab's underside.
      const sec = [P(W, -1.15), P(W, 0.85), P(half + 0.3, 0.85), P(half + 0.3, 0.0), P(-half - 0.3, 0.0), P(-half - 0.3, 0.85), P(-W, 0.85), P(-W, -1.15)]
      // The parapets' ends are closed; the slab's ends sit in the abutments.
      const ends = () => {
        b.quad2(P(W, 0), sec[1], sec[2], sec[3], stone)
        b.quad2(sec[4], sec[5], sec[6], P(-W, 0), stone)
      }
      if (prev) {
        for (let k = 0; k < sec.length; k++) {
          const col = k === 1 || k === 5 ? cap : k === 7 ? dark : stone
          b.quad2(prev[k], sec[k], sec[(k + 1) % sec.length], prev[(k + 1) % sec.length], col)
        }
      } else ends()
      if (s + 2 > s1 + 3 + 1e-6) ends()
      prev = sec
    }
    // Abutments down into both banks and piers on the gorge floor, each reaching below the lowest ground under it.
    for (const sp of bridgeSupports(route, this.surf, s0, s1, this.land.water)) {
      if (sp.kind !== 'pier') b.add(PRIM.box, stone.getHex(), sp.x, sp.bottom, sp.z, sp.across, sp.top - sp.bottom, sp.along, sp.yaw, 0, 0, 0, 0, 0.5, Math.random)
      // Long across the road, along the flow of the water; thin along the road. The primitive's radius is half its size.
      else b.add(PRIM.taper8, stone.getHex(), sp.x, sp.bottom, sp.z, sp.across / 2, sp.top - sp.bottom, sp.along / 2, sp.yaw)
    }
    b.surface = 0
  }

  /**
   * Distant mountain ranges in three layers, jagged and shaded from dark
   * forested foothills up to bare rock and, where the region has them, snow
   * caps, lit from the side the sun is on. The haze turns them blue.
   */
  private horizon(): THREE.Mesh {
    const pts: number[] = [], cols: number[] = [], haze: number[] = [], idx: number[] = []
    const seg = 320
    const n2 = noise2(this.stage.seed + 3)
    const rel = this.rally.relief
    const snowy = ['alpine', 'andes', 'nordic_snow', 'japan'].includes(this.rally.biome)
    const flat = this.rally.biome === 'savannah' || this.rally.biome === 'nordic'
    const amp = flat ? 90 : THREE.MathUtils.clamp(rel.amp * 2.2, 180, 680)
    const pal = this.rally.palette
    const cForest = new THREE.Color(pal.forest).multiplyScalar(0.75)
    const cRock = new THREE.Color(pal.rock).multiplyScalar(0.9)
    const cSnow = new THREE.Color(0xf2f4f7)
    const ridged = (x: number, y: number) => {
      let v = 0, a = 1, f = 1, w = 1
      for (let o = 0; o < 6; o++) {
        let s = 1 - Math.abs(n2(x * f, y * f))
        s *= s * w
        w = Math.min(1, s * 1.8)
        v += a * s
        a *= 0.5
        f *= 2.1
      }
      return v / 1.2
    }
    const sunAz = 0.8
    let off = 0
    for (let layer = 0; layer < 3; layer++) {
      const R = 1350 + layer * 380
      const h0 = amp * (0.3 + layer * 0.4)
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        const peak = Math.pow(Math.min(1.2, ridged(Math.cos(a) * 6.5 + layer * 7, Math.sin(a) * 6.5)), 2)
        const h = h0 * (0.18 + peak)
        // Faces toward one side of the ring are lit, the other in shade: the
        // ranges get relief instead of being flat cut-outs.
        const slope = Math.pow(Math.min(1.2, ridged(Math.cos(a + 0.01) * 6.5 + layer * 7, Math.sin(a + 0.01) * 6.5)), 2) - peak
        const lit = THREE.MathUtils.clamp(0.95 + slope * 12 * Math.cos(a - sunAz), 0.85, 1.08)
        const x = Math.cos(a) * R, z = Math.sin(a) * R
        const rows: [number, THREE.Color][] = [
          [-260, cForest],
          [h * 0.35, cForest.clone().lerp(cRock, 0.35)],
          [h * 0.7, cForest.clone().lerp(cRock, 0.85)],
          [h, snowy && peak > 0.45 ? cSnow : cRock.clone().lerp(cSnow, snowy ? 0.25 : 0)],
        ]
        rows.forEach(([y, c], row) => {
          pts.push(x, y, z)
          const k = y > h * 0.5 ? lit : 1
          cols.push(c.r * k, c.g * k, c.b * k)
          // Haze by range, not by the camera's height fog: that thins looking
          // up, so the tall far range would come out darker than the near
          // one in front of it and hang from the sky as dark teeth.
          haze.push(0.5 + layer * 0.14 - row * 0.03)
        })
        if (i) for (let k = 0; k < 3; k++) {
          const p0 = off + (i - 1) * 4 + k, p1 = off + i * 4 + k
          idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1)
        }
      }
      off += (seg + 1) * 4
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    g.setAttribute('aHaze', new THREE.Float32BufferAttribute(haze, 1))
    g.setIndex(idx)
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHaze;\nvarying float vHaze;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHaze = aHaze;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHaze;')
        .replace('#include <fog_fragment>', '#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, vHaze);\n#endif')
    }
    const m = new THREE.Mesh(g, mat)
    m.frustumCulled = false
    // After the terrain: only the sky gaps between hills pay for it.
    m.renderOrder = 2
    return m
  }
}

const tmpC = new THREE.Color()

/** A distant tree as a cone (conifer) or a dome (broadleaf): a handful of triangles. */
function blob(pos: number[], nor: number[], col: number[], uv: number[], idx: number[], x: number, y: number, z: number, h: number, conifer: boolean, leaf: number, r: () => number): void {
  const c = tmpC.setHex(leaf).offsetHSL(0, (r() - 0.5) * 0.06, (r() - 0.5) * 0.08 - 0.03)
  const v0 = pos.length / 3
  const rad = conifer ? h * 0.38 : h * 0.46
  const push = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, shade: number) => {
    pos.push(px, py, pz)
    const l = Math.hypot(nx, ny, nz) || 1
    nor.push(nx / l, ny / l, nz / l)
    col.push(c.r * shade, c.g * shade, c.b * shade)
    uv.push(px / 5, pz / 5)
  }
  const rot = r() * 6
  push(x, y + h, z, 0, 1, 0, 1.05)
  if (conifer) {
    // Base ring sunk into the ground, so the mass grows out of it.
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2
      push(x + Math.cos(a) * rad, y - 0.8, z + Math.sin(a) * rad, Math.cos(a), 0.5, Math.sin(a), 0.6)
    }
    for (let k = 0; k < 5; k++) idx.push(v0, v0 + 1 + ((k + 1) % 5), v0 + 1 + k)
  } else {
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2
      push(x + Math.cos(a) * rad, y + h * 0.45, z + Math.sin(a) * rad, Math.cos(a), 0.3, Math.sin(a), 0.85)
    }
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2 + 0.6
      // A broad foot sunk into the ground: a narrow one made the mass look like a box floating over the hill.
      push(x + Math.cos(a) * rad * 0.9, y - 0.8, z + Math.sin(a) * rad * 0.9, Math.cos(a), 0.1, Math.sin(a), 0.6)
    }
    for (let k = 0; k < 5; k++) {
      const m0 = v0 + 1 + k, m1 = v0 + 1 + ((k + 1) % 5), b0 = v0 + 6 + k, b1 = v0 + 6 + ((k + 1) % 5)
      idx.push(v0, m1, m0, m0, m1, b0, m1, b1, b0)
    }
  }
}

/**
 * Tarmac in the rain: a physically lit surface whose roughness drops in
 * puddles and the wet racing line, so it mirrors the sky and the headlights.
 */
function wetRoad(map: THREE.Texture, tarmac: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: tarmac ? 0.42 : 0.6, metalness: 0, envMapIntensity: 1.1 })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoadW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRoadW;
        float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }
        float puddle = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Puddles gather in hollows: two scales of noise, thresholded into pools.
        puddle = smoothstep(0.58, 0.7, rn(vRoadW.xz * 0.28) * 0.7 + rn(vRoadW.xz * 1.1) * 0.3);
        diffuseColor.rgb *= mix(0.62, 0.38, puddle);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.05, puddle);`)
  }
  return m
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
