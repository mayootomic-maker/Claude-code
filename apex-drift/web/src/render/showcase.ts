import * as THREE from 'three'
import type { LiveryDef } from '../data'
import type { DriverLook } from '../game/paint'
import { buildCar, type CarOpts, type CarRig } from './car-model'

/**
 * A warm, lamp-lit service tent with the car on a slow turntable: the garage
 * background and the source of the menu artwork. The calm between stages.
 */
export class Showcase {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  private car: CarRig | null = null
  private readonly turntable = new THREE.Group()
  angle = 0.6
  spin = 0.12
  /** Set when the caller places the camera itself (the dev views). */
  manualCamera = false
  private mode: 'car' | 'driver' = 'car'
  private helmetOn = true
  private angleTo: number | null = null
  private orbitYaw = 0
  private orbitPitch = 0.117
  private dist = 8.56
  private camDist = 8.56
  private snap = true

  constructor(private readonly gl: THREE.WebGLRenderer) {
    const s = this.scene
    s.background = new THREE.Color(0x15110d)
    s.fog = new THREE.Fog(0x15110d, 9, 22)
    // Canvas tent: a warm half-dome overhead, a concrete floor, tools on a back wall.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b5249, roughness: 0.85 }))
    floor.receiveShadow = true
    s.add(floor)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.06, 48), new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.5, metalness: 0.2 }))
    disc.position.y = 0.03
    disc.receiveShadow = true
    this.turntable.add(disc)
    s.add(this.turntable)
    const tent = new THREE.Mesh(new THREE.SphereGeometry(13, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9c7a8, roughness: 1, side: THREE.BackSide }))
    s.add(tent)
    const wall = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.8 })
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 })
    const red = new THREE.MeshStandardMaterial({ color: 0xa83a2a, roughness: 0.6 })
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 0.8), wood)
    bench.position.set(0, 0.45, 0)
    const board = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.06), wood)
    board.position.set(0, 1.9, -0.36)
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), red)
    chest.position.set(2.7, 0.5, 0)
    wall.add(bench, board, chest)
    for (let i = 0; i < 9; i++) {
      const tool = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35 + (i % 3) * 0.12, 0.03), metal)
      tool.position.set(-1.6 + i * 0.4, 1.95, -0.3)
      wall.add(tool)
    }
    const tyres = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 10, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 }))
      t.position.set(0, 0.12 + i * 0.24, 0)
      tyres.add(t)
    }
    tyres.position.set(-2.8, 0, 0.2)
    wall.add(tyres)
    wall.position.set(0, 0, -5.2)
    s.add(wall)
    // Mug of coffee on the bench, steam not included.
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.4 }))
    mug.position.set(0.9, 0.96, -5.1)
    s.add(mug)

    s.add(new THREE.HemisphereLight(0xffe2b8, 0x2a2018, 0.9))
    const lamp = (x: number, z: number, i: number) => {
      const l = new THREE.SpotLight(0xffc98a, i, 18, 0.7, 0.6, 1.4)
      l.position.set(x, 5.5, z)
      l.target.position.set(0, 0, 0)
      l.castShadow = true
      l.shadow.mapSize.set(1024, 1024)
      l.shadow.bias = -0.0005
      s.add(l, l.target)
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a8 }))
      bulb.position.copy(l.position)
      s.add(bulb)
    }
    lamp(-2.5, 1.5, 120)
    lamp(2.8, -1, 90)
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.6)
    rim.position.set(-4, 3, -6)
    s.add(rim)
    const pm = new THREE.PMREMGenerator(gl)
    s.environment = pm.fromScene(new RoomLike(), 0.04).texture
    s.environmentIntensity = 0.6
    pm.dispose()
    this.camera.position.set(0, 1.6, 8.5)
    this.camera.lookAt(0, 0.6, 0)
  }

  setCar(id: string, livery: LiveryDef, opts: CarOpts = {}): void {
    if (this.car) {
      this.turntable.remove(this.car.root)
      this.car.dispose()
    }
    this.car = buildCar(id, livery, opts)
    this.car.root.position.y = 0.06
    this.car.helmet(this.helmetOn)
    this.car.clearGlass(this.mode === 'driver' ? 0.25 : 1)
    this.turntable.add(this.car.root)
  }

  /** Repaints the car on the turntable without rebuilding it: for live editing. */
  repaint(livery: LiveryDef): void {
    this.car?.repaint(livery)
  }

  setDriver(look: DriverLook, name?: string): void {
    this.car?.setDriver(look, name)
  }

  helmet(on: boolean): void {
    this.helmetOn = on
    this.car?.helmet(on)
  }

  /**
   * What the camera frames: the whole car, or the driver through the
   * windscreen (the glass all but cleared so his face reads).
   */
  frame(mode: 'car' | 'driver'): void {
    this.mode = mode
    this.snap = true
    this.car?.clearGlass(mode === 'driver' ? 0.25 : 1)
    if (mode === 'driver') {
      this.orbitYaw = -0.06
      this.orbitPitch = 0.2
      this.dist = 1.9
      this.spin = 0
      this.angleTo = 0
    } else {
      this.orbitYaw = 0
      this.orbitPitch = 0.117
      this.dist = 8.56
      this.spin = 0.12
      this.angleTo = null
    }
  }

  /** Drag to orbit: the camera circles the car (or the driver), pitch kept above the floor. */
  orbit(dx: number, dy: number): void {
    this.orbitYaw -= dx * 0.008
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.005, -0.05, 1.2)
    this.angleTo = null
  }

  zoom(k: number): void {
    const [lo, hi] = this.mode === 'driver' ? [0.8, 3.5] : [4.5, 12]
    this.dist = THREE.MathUtils.clamp(this.dist * k, lo, hi)
  }

  resize(w: number, h: number, offsetX = 0): void {
    this.camera.aspect = w / h
    // Shift the car toward one side so the menu panel doesn't cover it.
    this.camera.setViewOffset(w, h, offsetX, 0, w, h)
    this.camera.updateProjectionMatrix()
  }

  private readonly target = new THREE.Vector3(0, 0.6, 0)
  private readonly tmp = new THREE.Vector3()

  render(dt: number): void {
    if (this.angleTo !== null && this.snap) this.angle = this.angleTo
    else if (this.angleTo !== null) {
      // Ease the turntable round to the framing's angle by the shortest way.
      const d = Math.atan2(Math.sin(this.angleTo - this.angle), Math.cos(this.angleTo - this.angle))
      this.angle += d * Math.min(1, dt * 4)
    } else this.angle += dt * this.spin
    this.turntable.rotation.y = this.angle
    // The camera's goal: the car's middle, or the driver's face.
    const goal = this.tmp.set(0, 0.6, 0)
    if (this.mode === 'driver' && this.car?.eye) {
      this.turntable.updateMatrixWorld(true)
      goal.copy(this.car.eye).add(new THREE.Vector3(0, -0.06, 0))
      this.car.body.localToWorld(goal)
    }
    if (this.manualCamera) return this.draw()
    // A new framing cuts straight to it; zooming and orbiting ease.
    const k = this.snap ? 1 : Math.min(1, dt * 5)
    this.snap = false
    this.target.lerp(goal, k)
    this.camDist += (this.dist - this.camDist) * k
    const yaw = this.orbitYaw, pitch = this.orbitPitch
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * this.camDist,
      this.target.y + Math.sin(pitch) * this.camDist,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * this.camDist,
    )
    this.camera.lookAt(this.target)
    this.draw()
  }

  private draw(): void {
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = 1.0
    this.gl.setRenderTarget(null)
    this.gl.render(this.scene, this.camera)
  }

  dispose(): void {
    this.car?.dispose()
    this.scene.environment?.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }
}

/** A soft warm box to light reflections in the paint. */
class RoomLike extends THREE.Scene {
  constructor() {
    super()
    const m = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x8a7458, side: THREE.BackSide }))
    this.add(m)
    for (const [x, z] of [[-4, 2], [4, -2]]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: 0xfff1d8 }))
      panel.position.set(x, 4.9, z)
      panel.rotation.x = Math.PI / 2
      this.add(panel)
    }
  }
}
