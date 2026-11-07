import * as THREE from 'three'
import { clamp, rng } from '../core/math'
import type { Run } from './hero'

/**
 * Particles the game draws only for the player's car, extended for the
 * trailer: dust behind the rivals, and a sheet of spray from every car that
 * hits water. Deterministic (seeded per frame), so a re-render matches.
 */
export class Fx {
  private readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly fade: Float32Array
  private readonly size: Float32Array
  private readonly col: Float32Array
  private next = 0
  private frame = 0
  private readonly dustCol: THREE.Color
  private static readonly N = 2400

  constructor(scene: THREE.Scene, private readonly run: Run) {
    const N = Fx.N
    this.pos = new Float32Array(N * 3)
    this.vel = new Float32Array(N * 3)
    this.life = new Float32Array(N)
    this.fade = new Float32Array(N)
    this.size = new Float32Array(N)
    this.col = new Float32Array(N * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsLib.fog },
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; attribute vec3 aCol;
        varying float vLife; varying float vDepth; varying vec3 vCol;
        #include <fog_pars_vertex>
        void main() {
          vLife = aLife; vCol = aCol;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mvPosition.z;
          gl_PointSize = min(140.0, aSize * (1.0 + (1.0 - aLife) * 1.6) * 260.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife; varying float vDepth; varying vec3 vCol;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * min(1.0, vLife * 1.6) * 0.42 * smoothstep(1.5, 5.0, vDepth);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol, a);
          #include <fog_fragment>
        }`,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
    scene.add(this.points)
    const rally = run.sim.setup.rally
    this.dustCol = new THREE.Color(rally.surface === 'snow' ? 0xf4f6f8 : rally.biome === 'savannah' ? 0xc0764a : rally.surface === 'asphalt' ? 0xc8c8c8 : (rally.gravel?.[0] ?? 0xb8a58a))
  }

  dispose(): void {
    this.points.parent?.remove(this.points)
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }

  private emit(r: () => number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color): void {
    const i = this.next
    this.next = (this.next + 1) % Fx.N
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.life[i] = 1
    this.fade[i] = 1 / life
    this.size[i] = size * (0.7 + r() * 0.6)
    this.col.set([c.r, c.g, c.b], i * 3)
  }

  /** Advance by dt with the cars as they are now (the tape has just been restored). */
  update(dt: number): void {
    const r = rng(9001 + this.frame++)
    const spray = new THREE.Color(0xe4ecef)
    this.run.cars.forEach((car, ci) => {
      if (car.airborne) return
      const v = car.speed
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading)
      const lx = Math.cos(car.heading), lz = -Math.sin(car.heading)
      if (car.surface === 'water' && v > 3) {
        // Bow waves off both front wheels, thrown out and up, falling back under gravity.
        const n = Math.floor(clamp(v / 20, 0.3, 1.6) * 70 * dt * 30 + r())
        for (let e = 0; e < n; e++) {
          const side = e % 2 ? 1 : -1
          const out = 2 + r() * 4 + v * 0.12
          this.emit(r, car.x + fx * 1.1 + lx * side * 0.9, car.y + 0.25, car.z + fz * 1.1 + lz * side * 0.9,
            lx * side * out + fx * v * (0.35 + r() * 0.3), 2.5 + r() * 4 + v * 0.1, lz * side * out + fz * v * (0.35 + r() * 0.3),
            0.9 + r() * 0.5, 0.55 + v * 0.02, spray)
        }
        return
      }
      // The game already raises dust behind the player's car (index 0).
      if (ci === 0) return
      const loose = car.surface !== 'asphalt' && car.surface !== 'wet'
      const rate = (loose ? clamp(v / 25, 0, 1.2) * 1.4 : 0) + clamp((car.slipR - 0.12) * 4, 0, 1) * 1.5
      const n = Math.floor(rate * 60 * dt + r())
      for (let e = 0; e < n; e++) {
        const side = e % 2 ? 0.7 : -0.7
        this.emit(r, car.x - fx * 1.4 + lx * side, car.y + 0.25, car.z - fz * 1.4 + lz * side,
          -fx * v * 0.15 + (r() - 0.5) * 2, 0.6 + r() * 1.2, -fz * v * 0.15 + (r() - 0.5) * 2, 1.8, 0.45, this.dustCol)
      }
    })
    const N = Fx.N
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt * this.fade[i]
      const heavy = this.fade[i] > 0.6
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      // Spray is water and falls; dust hangs in the air and drifts.
      this.vel[i * 3 + 1] -= (heavy ? 9.81 : 0) * dt
      const drag = 1 - dt * (heavy ? 0.6 : 1.5)
      this.vel[i * 3] *= drag
      this.vel[i * 3 + 2] *= drag
      const g = this.run.sim.ground.height(this.pos[i * 3], this.pos[i * 3 + 2])
      if (this.pos[i * 3 + 1] < g) {
        this.pos[i * 3 + 1] = g
        this.vel[i * 3 + 1] = 0
        if (heavy) this.life[i] = Math.min(this.life[i], 0.15)
      }
    }
    const g = this.points.geometry
    for (const k of ['position', 'aLife', 'aSize', 'aCol']) g.attributes[k].needsUpdate = true
  }
}
