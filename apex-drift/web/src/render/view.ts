import * as THREE from 'three'
import { clamp, damp, lerp, rng, wrapAngle } from '../core/math'
import { LIVERIES, type LiveryDef } from '../data'
import type { Pose } from '../sim/car'
import type { StageSim } from '../sim/stage'
import { atmosphere, cloudCover, skyDome, sunDirection, type Atmos } from './atmosphere'
import { buildCar, type CarRig } from './car-model'
import { GradePass } from './post'
import { World, type Quality } from './world'
import { planSoft, type Soft } from './placement'
import { ghostPose, type Ghost } from '../game/ghost'
import { noise2 } from '../core/math'

export type Tier = 'low' | 'medium' | 'high'
export type CamMode = 'chase' | 'near' | 'bonnet'

/**
 * Graphics tiers. `radius` is the detailed world around the camera, `far` the
 * coarse far terrain out to the haze; `bloom` is how many blur levels the
 * film pass gets (0: none, and no film pass at all on Low).
 */
const TIERS: Record<Tier, Quality & { post: boolean; bloom: number; samples: number; pixel: number; maxPixels: number; shadowMap: number; propShadows: boolean }> = {
  low: { radius: 240, far: 560, terrain: [2, 4, 4], density: 0.5, shadows: false, aniso: 1, surfaces: false, cards: false, rich: false, blobs: false, wet: false, post: false, bloom: 0, samples: 0, pixel: 0.8, maxPixels: 1.0e6, shadowMap: 0, propShadows: false },
  medium: { radius: 340, far: 720, terrain: [2, 2, 4], density: 0.8, shadows: true, aniso: 4, surfaces: true, cards: true, rich: false, blobs: false, wet: true, post: true, bloom: 1, samples: 2, pixel: 1, maxPixels: 2.1e6, shadowMap: 1024, propShadows: false },
  high: { radius: 440, far: 1250, terrain: [1, 2, 4], density: 1, shadows: true, aniso: 8, surfaces: true, cards: true, rich: true, blobs: true, wet: true, post: true, bloom: 2, samples: 4, pixel: 1.5, maxPixels: 3.7e6, shadowMap: 2048, propShadows: true },
}

/** Owns the WebGL context for the app's lifetime; stages come and go. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  tier: Tier
  /** 0.6..1 of the tier's pixel ratio, adjusted from frame times. */
  scale = 1
  private grade: GradePass | null = null
  private frames: number[] = []

  constructor(readonly canvas: HTMLCanvasElement, tier: Tier) {
    this.tier = tier
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.shadowMap.type = THREE.PCFShadowMap
    // Counted per frame (scene + shadow + grade passes), not per render call.
    this.gl.info.autoReset = false
    this.apply()
  }

  setTier(t: Tier): void {
    this.tier = t
    this.scale = 1
    this.apply()
  }

  get spec() {
    return TIERS[this.tier]
  }

  private apply(): void {
    const t = TIERS[this.tier]
    this.gl.shadowMap.enabled = t.shadowMap > 0
    this.gl.toneMapping = t.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    this.grade?.dispose()
    this.grade = null
    this.resize()
  }

  resize(): void {
    const t = TIERS[this.tier]
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight
    // A cap on rendered pixels, not just on pixel ratio: a 4K monitor or a
    // large window would otherwise cost several times a phone's fill rate.
    const budget = Math.sqrt(t.maxPixels / Math.max(1, w * h))
    const pr = Math.min(devicePixelRatio || 1, t.pixel, budget) * this.scale
    this.gl.setPixelRatio(pr)
    this.gl.setSize(w, h, false)
    if (t.post) {
      const W = Math.round(w * pr), H = Math.round(h * pr)
      if (!this.grade) this.grade = new GradePass(W, H, t.samples, t.bloom)
      else this.grade.setSize(W, H)
    }
  }

  /**
   * Dynamic resolution: if the slowest frames are over budget, render fewer
   * pixels; if there's headroom, creep back up. Keeps 60 fps on hot phones.
   */
  sample(ms: number): void {
    this.frames.push(ms)
    if (this.frames.length < 90) return
    const sorted = [...this.frames].sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)]
    this.frames.length = 0
    const before = this.scale
    if (p90 > 19) this.scale = Math.max(0.6, this.scale - 0.1)
    else if (p90 < 13) this.scale = Math.min(1, this.scale + 0.05)
    if (this.scale !== before) this.resize()
  }

  /** Where the sun is on screen, for the shafts in the grade pass. */
  /** 0..1 speed streak strength. */
  speedBlur(v: number): void {
    this.grade?.setSpeed(this.tier === 'low' ? 0 : v)
  }

  sun(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, a: Atmos): void {
    if (!this.grade) return
    const p = cam.position.clone().addScaledVector(dir, 1000).project(cam)
    const facing = cam.getWorldDirection(new THREE.Vector3()).dot(dir)
    const on = a.sunEl > -1 && facing > 0 && Math.abs(p.x) < 1.6 && Math.abs(p.y) < 1.6 ? Math.min(1, a.sunI / 2.5) * Math.min(1, facing * 3) : 0
    this.grade.setSun(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, on, new THREE.Color(a.sun), this.tier === 'high' || this.tier === 'medium')
  }

  render(scene: THREE.Scene, cam: THREE.Camera, a: Atmos, time: number): void {
    this.gl.info.reset()
    if (this.grade) {
      this.grade.setGrade(a.grade, a.exposure)
      this.gl.setRenderTarget(this.grade.target)
      this.gl.render(scene, cam)
      this.grade.render(this.gl, time)
    } else {
      this.gl.toneMappingExposure = a.exposure
      this.gl.setRenderTarget(null)
      this.gl.render(scene, cam)
    }
  }
}

interface Dust {
  points: THREE.Points
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  size: Float32Array
  next: number
}

/** Everything that draws one stage. */
export class StageView {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.8, 2400)
  readonly atmos: Atmos
  readonly world: World
  readonly car: CarRig
  private readonly sun: THREE.DirectionalLight
  private readonly sky: THREE.Mesh
  private readonly sunDir: THREE.Vector3
  private readonly pose: Pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0 }
  private readonly dust: Dust
  private readonly weather: THREE.Points | null
  private readonly headlights: THREE.SpotLight | null
  camMode: CamMode = 'chase'
  /** Knock-over props: one instanced mesh per kind, and each prop's flight state. */
  private readonly soft: { item: Soft; mesh: THREE.InstancedMesh; i: number; y: number; vx: number; vy: number; vz: number; spin: number; rx: number; rz: number; hit: boolean }[] = []
  private readonly softMeshes: THREE.InstancedMesh[] = []
  /** Set when the car knocks something over this frame, for sound and haptics. */
  softHits = 0
  /** Landing dust: decays from 1 to 0 after a big landing. */
  private burst = 0
  private ghost: { rig: CarRig; data: Ghost } | null = null
  private dirt = 0
  /** Tyre marks: one ribbon buffer, two quads (rear wheels) written per step of travel. */
  private marks: { mesh: THREE.Mesh; pos: Float32Array; col: Float32Array; next: number; last: (THREE.Vector3 | null)[] } | null = null

  /** A translucent copy of the car that replays your best run. */
  setGhost(g: Ghost, livery: LiveryDef): void {
    const rig = buildCar(g.car, livery)
    rig.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = false
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        m.transparent = true
        m.opacity = 0.32
        m.depthWrite = false
      }
    })
    rig.root.visible = false
    this.scene.add(rig.root)
    this.ghost = { rig, data: g }
  }

  updateGhost(t: number): void {
    const g = this.ghost
    if (!g) return
    const p = ghostPose(g.data, t)
    g.rig.root.visible = !!p
    if (!p) return
    g.rig.root.position.set(p.x, p.y, p.z)
    g.rig.root.rotation.set(0, p.heading, 0)
    // Fade it out when it's right on top of you, so it never blocks the view.
    const d = Math.hypot(p.x - this.pose.x, p.z - this.pose.z)
    g.rig.root.visible = d > 3
  }
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private camVel = new THREE.Vector3()
  private camRel = new THREE.Vector3(0, 2.3, -6.4)
  private fov = 60
  private time = 0
  shake = 1

  constructor(readonly sim: StageSim, readonly r: Renderer, livery: LiveryDef = LIVERIES[0], labels?: { start: string; finish: string }) {
    const { rally, stage } = sim.setup
    this.atmos = atmosphere(stage.look, stage.weather)
    const a = this.atmos
    const spec = r.spec
    this.scene.fog = new THREE.FogExp2(a.fog, a.fogDensity)
    // The sky travels with the camera; stages run for kilometres and the dome is 1.8 km across.
    this.sky = skyDome(a, cloudCover(stage.look, stage.weather))
    this.scene.add(this.sky)
    // Sky fill is generous: shaded forest should read as deep green, never as black.
    this.scene.add(new THREE.HemisphereLight(a.skyTop, a.ground, a.hemiI * 1.35))
    this.sunDir = sunDirection(a)
    this.sun = new THREE.DirectionalLight(a.sun, a.sunI)
    this.sun.castShadow = spec.shadowMap > 0
    if (spec.shadowMap) {
      // A tight box that follows the car: sharp shadows where you look, nothing wasted elsewhere.
      this.sun.shadow.mapSize.set(spec.shadowMap, spec.shadowMap)
      const sc = this.sun.shadow.camera
      sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 220
      this.sun.shadow.bias = -0.0008
      this.sun.shadow.normalBias = 0.04
      // PCF spreads its taps by the radius: softer shadow edges where the map has the resolution for it.
      this.sun.shadow.radius = spec.shadowMap >= 2048 ? 2.2 : 1.4
    }
    this.scene.add(this.sun, this.sun.target)
    // Environment for the car paint: the sky itself, prefiltered once per stage.
    const pm = new THREE.PMREMGenerator(r.gl)
    const envScene = new THREE.Scene()
    envScene.add(skyDome(a, cloudCover(stage.look, stage.weather)))
    const env = pm.fromScene(envScene, 0.04)
    this.scene.environment = env.texture
    this.scene.environmentIntensity = a.lights ? 0.25 : 0.7
    pm.dispose()

    this.world = new World(sim.ground, rally, stage, { ...spec, shadows: spec.propShadows }, sim.start, sim.finish, labels)
    this.scene.add(this.world.group)
    this.car = buildCar(sim.setup.car, livery)
    this.scene.add(this.car.root)
    if (!spec.shadowMap) this.car.root.traverse((o) => (o.castShadow = false))
    this.headlights = a.lights ? this.makeHeadlights() : null
    // Tarmac in the rain throws up spray instead of dust.
    this.dust = this.makeDust(stage.weather === 'rain' && rally.surface === 'asphalt' ? 0xd4dadf : rally.surface === 'snow' ? 0xf4f6f8 : rally.biome === 'savannah' ? 0xc0764a : rally.surface === 'asphalt' ? 0xc8c8c8 : (rally.gravel?.[0] ?? 0xb8a58a))
    this.weather = stage.weather === 'rain' || stage.weather === 'snow' ? this.makeWeather(stage.weather) : null
    this.makeSoft()
    this.makeMarks()
    this.syncCar(1)
    this.snapCamera()
  }

  dispose(): void {
    if (this.marks) {
      this.marks.mesh.geometry.dispose()
      ;(this.marks.mesh.material as THREE.Material).dispose()
    }
    this.ghost?.rig.dispose()
    for (const m of this.softMeshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.world.dispose()
    this.car.dispose()
    this.scene.environment?.dispose()
    this.dust.points.geometry.dispose()
    ;(this.dust.points.material as THREE.Material).dispose()
    if (this.weather) {
      this.weather.geometry.dispose()
      ;(this.weather.material as THREE.Material).dispose()
    }
  }

  /** Builds the scenery around the start before the countdown, behind the loading screen. */
  prewarm(at?: THREE.Vector3): void {
    this.world.prewarm(at ?? this.camPos)
    this.r.gl.compile(this.scene, this.camera)
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h
    // Portrait-ish screens get a wider view so the road ahead stays visible.
    this.fov = w / h < 1.4 ? 70 : 60
    this.camera.updateProjectionMatrix()
  }

  /**
   * Set during a replay: the car follows this recorded pose instead of the
   * simulation, and dust is kicked up at the recorded speed.
   */
  override: (Pose & { speed: number }) | null = null

  syncCar(alpha: number): void {
    const o = this.override
    const p = o ? this.copyPose(o) : this.sim.car.pose(alpha, this.pose)
    const root = this.car.root
    root.position.set(p.x, p.y, p.z)
    root.rotation.set(0, p.heading, 0)
    this.car.body.rotation.set(p.pitch, 0, p.roll, 'YXZ')
    this.car.body.position.y = 0.02
    for (const w of this.car.wheels) {
      w.pivot.rotation.y = w.front ? p.steer : 0
      w.spin.rotation.x = p.spin
    }
  }

  private copyPose(o: Pose): Pose {
    const p = this.pose
    p.x = o.x; p.y = o.y; p.z = o.z; p.heading = o.heading; p.pitch = o.pitch; p.roll = o.roll; p.steer = o.steer; p.spin = o.spin
    return p
  }

  /** Points the camera from outside (replay director, photo mode); draw with frame(..., 'fixed'). */
  setShot(pos: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, fov: number): void {
    this.camPos.set(pos.x, pos.y, pos.z)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(look.x, look.y, look.z)
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }

  /** Per frame: interpolate the car, move the camera, stream the world, draw. */
  frame(alpha: number, dt: number, mode: 'drive' | 'intro' | 'orbit' | 'fixed', introT = 0): void {
    this.time += dt
    this.syncCar(alpha)
    if (mode === 'intro') this.introCamera(introT)
    else if (mode === 'orbit') this.orbitCamera(dt)
    else if (mode === 'drive') this.chaseCamera(dt)
    this.world.update(mode === 'fixed' ? this.camera.position : this.camPos, dt, 2)
    const cp = this.car.root.position
    this.sun.position.set(cp.x + this.sunDir.x * 100, cp.y + this.sunDir.y * 100, cp.z + this.sunDir.z * 100)
    this.sun.target.position.copy(cp)
    this.sky.position.copy(this.camera.position)
    ;(this.sky.material as THREE.ShaderMaterial).uniforms.time.value = this.time
    this.updateSoft(dt)
    this.updateMarks()
    this.updateDirt(dt)
    this.updateDust(dt)
    this.updateWeather(dt)
    if (this.headlights) this.headlights.intensity = 60
    this.r.sun(this.camera, this.sunDir, this.atmos)
    this.r.speedBlur(mode === 'drive' && this.camMode !== 'bonnet' ? THREE.MathUtils.clamp((this.sim.car.speed - 22) / 25, 0, 1) * this.shake : 0)
    this.r.render(this.scene, this.camera, this.atmos, this.time)
  }

  private chaseCamera(dt: number): void {
    const p = this.pose
    const car = this.sim.car
    const speed = car.speed
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading)
    // Follow the direction of travel a little, not just the nose, so slides read as slides.
    const travel = Math.atan2(fx * car.vx + Math.cos(p.heading) * car.vy, fz * car.vx - Math.sin(p.heading) * car.vy)
    const look = speed > 3 ? p.heading + wrapAngle(travel - p.heading) * 0.35 : p.heading
    const lx = Math.sin(look), lz = Math.cos(look)
    const [dist, height, ahead] = this.camMode === 'chase' ? [6.4, 2.3, 4] : this.camMode === 'near' ? [4.6, 1.6, 4] : [-0.2, 1.15, 12]
    const want = new THREE.Vector3(p.x - lx * dist, p.y + height, p.z - lz * dist)
    if (this.camMode === 'bonnet') {
      this.camPos.set(p.x + fx * 0.3, p.y + height, p.z + fz * 0.3)
      this.camLook.set(p.x + fx * ahead, p.y + 0.9, p.z + fz * ahead)
    } else {
      // Critically damped spring on the offset from the car, not on the world
      // position: a world-space spring falls further behind the faster you go.
      const k = 30, c = 2 * Math.sqrt(k)
      const rel = this.camRel
      const wantRel = want.sub(this.car.root.position)
      const ax = (wantRel.x - rel.x) * k - this.camVel.x * c
      const ay = (wantRel.y - rel.y) * k - this.camVel.y * c
      const az = (wantRel.z - rel.z) * k - this.camVel.z * c
      this.camVel.x += ax * dt; this.camVel.y += ay * dt; this.camVel.z += az * dt
      rel.addScaledVector(this.camVel, dt)
      this.camPos.copy(this.car.root.position).add(rel)
      const g = this.sim.ground.height(this.camPos.x, this.camPos.z) + 0.9
      if (this.camPos.y < g) this.camPos.y = g
      this.camLook.set(p.x + fx * ahead, p.y + 1.0, p.z + fz * ahead)
    }
    // Gentle shake on rough surfaces and landings only.
    const rough = (car.offRoad ? 0.5 : car.surface === 'rough' ? 0.25 : car.surface === 'gravel' ? 0.06 : 0.02) * clamp(speed / 30, 0, 1)
    const land = car.events.landed > 2 ? 0.25 : 0
    if (car.events.landed > 3) {
      this.camera.fov += Math.min(8, car.events.landed)
      this.burst = 1
    }
    const amt = (rough + land) * this.shake
    this.camera.position.copy(this.camPos)
    if (amt > 0) {
      this.camera.position.x += (Math.random() - 0.5) * amt * 0.12
      this.camera.position.y += (Math.random() - 0.5) * amt * 0.12
    }
    this.camera.lookAt(this.camLook)
    const fovT = this.fov + clamp(speed / 40, 0, 1) * 9
    this.camera.fov = damp(this.camera.fov, fovT, 3, dt)
    this.camera.updateProjectionMatrix()
  }

  /** Pre-stage flyover: sweep down the first part of the stage toward the car on the line. */
  private introCamera(t: number): void {
    const route = this.sim.route
    const u = clamp(t, 0, 1)
    const e = u * u * (3 - 2 * u)
    const s = lerp(this.sim.start + 220, this.sim.start + 6, e)
    const a = route.at(s)
    const side = Math.sin(u * 2.4) * 9
    const lx = Math.cos(a.heading), lz = -Math.sin(a.heading)
    const h = lerp(26, 3, e)
    this.camPos.set(a.x + lx * side, a.y + h, a.z + lz * side)
    const c = this.car.root.position
    this.camLook.set(lerp(a.x + Math.sin(a.heading) * 30, c.x, e), lerp(a.y, c.y + 1, e), lerp(a.z + Math.cos(a.heading) * 30, c.z, e))
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    this.camera.fov = this.fov
    this.camera.updateProjectionMatrix()
    if (u >= 1) this.snapCamera()
  }

  private orbitCamera(dt: number): void {
    const c = this.car.root.position
    const ang = this.time * 0.25
    const want = new THREE.Vector3(c.x + Math.sin(ang) * 8, c.y + 2.6, c.z + Math.cos(ang) * 8)
    this.camPos.lerp(want, 1 - Math.exp(-dt * 2))
    const g = this.sim.ground.height(this.camPos.x, this.camPos.z) + 1
    if (this.camPos.y < g) this.camPos.y = g
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(c.x, c.y + 0.8, c.z)
  }

  snapCamera(): void {
    const p = this.pose
    this.camRel.set(-Math.sin(p.heading) * 6.4, 2.3, -Math.cos(p.heading) * 6.4)
    this.camPos.set(p.x, p.y, p.z).add(this.camRel)
    this.camVel.set(0, 0, 0)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(p.x + Math.sin(p.heading) * 4, p.y + 1, p.z + Math.cos(p.heading) * 4)
  }

  private static readonly MARKS = 1600

  private makeMarks(): void {
    const N = StageView.MARKS
    const pos = new Float32Array(N * 6 * 3)
    const col = new Float32Array(N * 6 * 4)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 4))
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    this.scene.add(mesh)
    this.marks = { mesh, pos, col, next: 0, last: [null, null] }
  }

  /**
   * Rear tyres leave marks: black streaks on tarmac only when sliding,
   * spinning or locked; darker ruts on loose surfaces all the time. Old marks
   * are overwritten in a ring, so memory stays flat on a long stage.
   */
  private updateMarks(): void {
    const mk = this.marks
    if (!mk) return
    const car = this.sim.car
    const loose = !['asphalt', 'wet', 'ice'].includes(car.surface)
    const sliding = car.slipR > 0.14 || car.wheelSpin > 0.3
    const on = !car.airborne && car.speed > 1 && (loose || sliding)
    const strength = loose ? 0.22 + (sliding ? 0.2 : 0) : Math.min(0.55, 0.25 + car.slipR)
    const tone = loose ? (car.surface === 'snow' ? [0.55, 0.58, 0.62] : [0.18, 0.14, 0.1]) : [0.04, 0.04, 0.045]
    for (let w = 0; w < 2; w++) {
      const wheel = this.car.wheels.filter((x) => !x.front)[w]
      if (!wheel) continue
      const p = wheel.pivot.getWorldPosition(new THREE.Vector3())
      p.y = this.sim.ground.height(p.x, p.z) + 0.07
      const prev = mk.last[w]
      if (!on) {
        mk.last[w] = null
        continue
      }
      if (!prev) {
        mk.last[w] = p
        continue
      }
      if (p.distanceTo(prev) < 0.5) continue
      const dx = p.x - prev.x, dz = p.z - prev.z
      const len = Math.hypot(dx, dz) || 1
      const nx = (-dz / len) * 0.11, nz = (dx / len) * 0.11
      const q = [prev.x - nx, prev.y, prev.z - nz, prev.x + nx, prev.y, prev.z + nz, p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz]
      const i = mk.next
      mk.next = (mk.next + 1) % StageView.MARKS
      const tri = [0, 1, 2, 0, 2, 3]
      for (let k = 0; k < 6; k++) {
        const v = tri[k]
        mk.pos.set([q[v * 3], q[v * 3 + 1], q[v * 3 + 2]], (i * 6 + k) * 3)
        mk.col.set([tone[0], tone[1], tone[2], strength], (i * 6 + k) * 4)
      }
      mk.last[w] = p
      const g = mk.mesh.geometry
      ;(g.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(g.attributes.color as THREE.BufferAttribute).needsUpdate = true
    }
  }

  /** The car picks up the colour of the stage: faster in mud and water, not at all on clean tarmac. */
  private updateDirt(dt: number): void {
    const car = this.sim.car
    const rate = car.surface === 'mud' || car.surface === 'water' ? 1 / 300 : ['gravel', 'wetgravel', 'rough', 'sand', 'verge', 'grass'].includes(car.surface) ? 1 / 1400 : car.surface === 'snow' ? 1 / 3500 : 0
    if (rate) this.dirt = Math.min(1, this.dirt + car.speed * dt * rate)
    const rally = this.sim.setup.rally
    const col = rally.surface === 'snow' ? 0xc9ced4 : rally.biome === 'savannah' ? 0xa0583a : rally.surface === 'asphalt' ? 0x5a554e : (rally.gravel?.[1] ?? rally.palette.soil)
    this.car.setDirt(this.dirt, col)
  }

  private makeSoft(): void {
    const sim = this.sim
    const items = planSoft({ route: sim.route, ground: sim.ground, rally: sim.setup.rally, seed: sim.setup.stage.seed, noise: noise2(9), snowAll: false }, sim.start, sim.finish)
    const geo: Record<Soft['kind'], THREE.BufferGeometry> = {
      bale: new THREE.CylinderGeometry(0.6, 0.6, 1.2, 14).rotateZ(Math.PI / 2).translate(0, 0.6, 0),
      cone: new THREE.ConeGeometry(0.22, 0.7, 12).translate(0, 0.35, 0),
      tyres: new THREE.CylinderGeometry(0.34, 0.34, 0.75, 14).translate(0, 0.375, 0),
    }
    const mat: Record<Soft['kind'], THREE.Material> = {
      bale: new THREE.MeshLambertMaterial({ color: 0xd2b766 }),
      cone: new THREE.MeshLambertMaterial({ color: 0xff6a1f }),
      tyres: new THREE.MeshLambertMaterial({ color: 0x1b1b1d }),
    }
    for (const kind of ['bale', 'cone', 'tyres'] as const) {
      const list = items.filter((x) => x.kind === kind)
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(geo[kind], mat[kind], list.length)
      mesh.castShadow = true
      list.forEach((item, i) => {
        // On the drawn verge, so a bale or cone never hovers over a dip between grid points.
        const y = this.world.surface.height(item.x, item.z)
        this.soft.push({ item, mesh, i, y, vx: 0, vy: 0, vz: 0, spin: 0, rx: 0, rz: 0, hit: false })
      })
      this.softMeshes.push(mesh)
      this.scene.add(mesh)
    }
    for (const sp of this.soft) this.placeSoft(sp)
  }

  private readonly m4 = new THREE.Matrix4()
  private readonly q4 = new THREE.Quaternion()
  private readonly e4 = new THREE.Euler()

  private placeSoft(sp: (typeof this.soft)[number]): void {
    this.e4.set(sp.rx, sp.item.yaw, sp.rz)
    this.q4.setFromEuler(this.e4)
    this.m4.compose(new THREE.Vector3(sp.item.x, sp.y, sp.item.z), this.q4, new THREE.Vector3(1, 1, 1))
    sp.mesh.setMatrixAt(sp.i, this.m4)
    sp.mesh.instanceMatrix.needsUpdate = true
  }

  /** Hit a prop and it flies off in the car's direction, tumbling, and comes to rest on the ground. */
  private updateSoft(dt: number): void {
    this.softHits = 0
    const car = this.sim.car
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), lx = Math.cos(car.heading), lz = -Math.sin(car.heading)
    const wx = fx * car.vx + lx * car.vy, wz = fz * car.vx + lz * car.vy
    for (const sp of this.soft) {
      const dx = sp.item.x - car.x, dz = sp.item.z - car.z
      if (!sp.hit) {
        if (dx * dx + dz * dz > 2.6 || car.speed < 2) continue
        sp.hit = true
        sp.vx = wx * 0.9 + dx * 2
        sp.vz = wz * 0.9 + dz * 2
        sp.vy = 2.5 + car.speed * 0.15
        sp.spin = (Math.random() - 0.5) * 12
        this.softHits++
        // A bale takes a little speed out of the car; cones barely notice.
        const k = sp.item.kind === 'bale' ? 0.96 : 0.995
        car.vx *= k
        car.vy *= k
      }
      if (sp.vx === 0 && sp.vy === 0 && sp.vz === 0) continue
      sp.vy -= 9.81 * dt
      sp.item.x += sp.vx * dt
      sp.item.z += sp.vz * dt
      sp.y += sp.vy * dt
      sp.rx += sp.spin * dt
      sp.rz += sp.spin * 0.6 * dt
      const g = this.sim.ground.height(sp.item.x, sp.item.z)
      if (sp.y <= g) {
        sp.y = g
        sp.vy = Math.abs(sp.vy) > 2 ? -sp.vy * 0.3 : 0
        sp.vx *= 0.6
        sp.vz *= 0.6
        sp.spin *= 0.5
        if (Math.hypot(sp.vx, sp.vz) < 0.3 && sp.vy === 0) sp.vx = sp.vz = sp.spin = 0
      }
      this.placeSoft(sp)
    }
  }

  private makeHeadlights(): THREE.SpotLight {
    const l = new THREE.SpotLight(0xfff1d6, 60, 70, 0.5, 0.5, 1.2)
    l.position.set(0, 0.9, 1.6)
    l.target.position.set(0, 0, 18)
    this.car.root.add(l, l.target)
    for (const m of this.car.lights) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5
    return l
  }

  private makeDust(color: number): Dust {
    const N = 260
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), size = new Float32Array(N)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { col: { value: new THREE.Color(color) }, ...THREE.UniformsLib.fog },
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; varying float vLife; varying float vDepth;
        #include <fog_pars_vertex>
        void main() {
          vLife = aLife;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mvPosition.z;
          gl_PointSize = min(90.0, aSize * (1.0 + (1.0 - aLife) * 2.0) * 160.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 col; varying float vLife; varying float vDepth;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // Fade out up close so dust never smears across the lens.
          float a = smoothstep(0.5, 0.0, d) * vLife * 0.32 * smoothstep(3.0, 9.0, vDepth);
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    })
    const points = new THREE.Points(g, m)
    points.frustumCulled = false
    this.scene.add(points)
    return { points, pos, vel, life, size, next: 0 }
  }

  private updateDust(dt: number): void {
    const d = this.dust
    const car = this.sim.car
    const N = d.life.length
    const loose = (car.surface !== 'asphalt' && car.surface !== 'wet') || (car.surface === 'wet' && this.sim.setup.stage.weather === 'rain')
    const speed = this.override ? this.override.speed : car.speed
    const rate = this.override
      ? (loose ? clamp(speed / 25, 0, 1.2) * 1.4 : 0)
      : car.airborne ? 0 : (loose ? clamp(speed / 25, 0, 1.2) * 1.4 : 0) + clamp((car.slipR - 0.12) * 4, 0, 1) * 1.5 + this.burst * 8
    this.burst = Math.max(0, this.burst - dt * 2.5)
    const emit = Math.floor(rate * 60 * dt + Math.random())
    const p = this.pose
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading)
    const lx = Math.cos(p.heading), lz = -Math.sin(p.heading)
    const r = rng((this.time * 1000) | 0)
    for (let e = 0; e < emit; e++) {
      const i = d.next
      d.next = (d.next + 1) % N
      const side = e % 2 ? 0.7 : -0.7
      d.pos[i * 3] = p.x - fx * 1.4 + lx * side
      d.pos[i * 3 + 1] = p.y + 0.25
      d.pos[i * 3 + 2] = p.z - fz * 1.4 + lz * side
      d.vel[i * 3] = -fx * speed * 0.15 + (r() - 0.5) * 2
      d.vel[i * 3 + 1] = 0.6 + r() * 1.2
      d.vel[i * 3 + 2] = -fz * speed * 0.15 + (r() - 0.5) * 2
      d.life[i] = 1
      d.size[i] = 0.6 + r() * 0.6
    }
    for (let i = 0; i < N; i++) {
      if (d.life[i] <= 0) continue
      d.life[i] -= dt * 0.55
      d.pos[i * 3] += d.vel[i * 3] * dt
      d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt
      d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * dt
      d.vel[i * 3] *= 1 - dt * 1.5
      d.vel[i * 3 + 2] *= 1 - dt * 1.5
    }
    const g = d.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aLife.needsUpdate = true
    g.attributes.aSize.needsUpdate = true
  }

  private makeWeather(kind: 'rain' | 'snow'): THREE.Points {
    const N = kind === 'rain' ? 1400 : 1000
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 60
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = new THREE.PointsMaterial({
      color: kind === 'rain' ? 0xb8c4cc : 0xffffff,
      size: kind === 'rain' ? 0.06 : 0.12,
      transparent: true,
      opacity: kind === 'rain' ? 0.55 : 0.85,
      depthWrite: false,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.userData.kind = kind
    this.scene.add(pts)
    return pts
  }

  private updateWeather(dt: number): void {
    const w = this.weather
    if (!w) return
    const pos = w.geometry.attributes.position as THREE.BufferAttribute
    const fall = w.userData.kind === 'rain' ? 16 : 1.6
    const c = this.camPos
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - fall * dt
      let x = pos.getX(i), z = pos.getZ(i)
      if (w.userData.kind === 'snow') x += Math.sin(this.time + i) * dt * 0.5
      // Keep the volume centred on the camera, wrapping drops around it.
      if (y < c.y - 12) y += 30
      if (x < c.x - 30) x += 60
      if (x > c.x + 30) x -= 60
      if (z < c.z - 30) z += 60
      if (z > c.z + 30) z -= 60
      pos.setXYZ(i, x, y, z)
    }
    pos.needsUpdate = true
  }
}
