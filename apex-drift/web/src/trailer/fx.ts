import * as THREE from 'three'
import { clamp, fbm2, noise2, rng } from '../core/math'
import type { Atmos } from '../render/atmosphere'
import type { Run } from './hero'

/**
 * Particles for the trailer: dust behind every car, the hero's included (the
 * game's own dust is a handful of small puffs, fine at play size but dotty on
 * a big frame), and a sheet of spray from every car that hits water.
 * Deterministic (seeded per frame), so a re-render matches.
 *
 * Dust is drawn as large, soft, slowly growing billows with a noise texture,
 * lit by the hour: drawn unlit at full colour, small round sprites read as
 * glowing fireflies against a dark sunset.
 */
export class Fx {
  private readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly fade: Float32Array
  private readonly size: Float32Array
  private readonly col: Float32Array
  private readonly spin: Float32Array
  private next = 0
  private frame = 0
  private readonly dustCol: THREE.Color
  private readonly sprayCol: THREE.Color
  private readonly tex: THREE.DataTexture
  private static readonly N = 1600

  constructor(scene: THREE.Scene, private readonly run: Run, atmos: Atmos) {
    const N = Fx.N
    this.pos = new Float32Array(N * 3)
    this.vel = new Float32Array(N * 3)
    this.life = new Float32Array(N)
    this.fade = new Float32Array(N)
    this.size = new Float32Array(N)
    this.col = new Float32Array(N * 3)
    this.spin = new Float32Array(N)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3))
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1))
    this.tex = puffTexture()
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsLib.fog, puff: { value: this.tex }, halfH: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; attribute vec3 aCol; attribute float aSpin;
        uniform float halfH;
        varying float vLife; varying float vDepth; varying vec3 vCol; varying float vSpin;
        #include <fog_pars_vertex>
        void main() {
          vLife = aLife; vCol = aCol; vSpin = aSpin;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mvPosition.z;
          // Billows: a cloud keeps spreading as it hangs in the air.
          float metres = aSize * (1.0 + (1.0 - aLife) * 2.6);
          gl_PointSize = min(420.0, metres * projectionMatrix[1][1] * halfH / max(0.1, vDepth));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D puff;
        varying float vLife; varying float vDepth; varying vec3 vCol; varying float vSpin;
        #include <fog_pars_fragment>
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vSpin), s = sin(vSpin);
          vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
          float d = length(p) * 2.0;
          float body = texture2D(puff, q).r * (1.0 - smoothstep(0.35, 1.0, d));
          // In over the first moments, out slowly; thinner as it spreads.
          float age = 1.0 - vLife;
          float a = body * smoothstep(0.0, 0.12, age) * vLife * vLife * 0.45 / (1.0 + age * 1.5);
          // Fade out up close so a billow never smears across the lens.
          a *= smoothstep(1.2, 4.0, vDepth);
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol, a);
          #include <fog_fragment>
        }`,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
    scene.add(this.points)
    const rally = run.sim.setup.rally
    // Lit by the hour: the dust's own colour, darkened and tinted toward the low sun's.
    const light = new THREE.Color(0xffffff).lerp(new THREE.Color(atmos.sun), 0.35).multiplyScalar(0.3 + 0.7 * atmos.dim)
    this.dustCol = new THREE.Color(rally.surface === 'snow' ? 0xf4f6f8 : rally.biome === 'savannah' ? 0xc0764a : rally.surface === 'asphalt' ? 0xc8c8c8 : (rally.gravel?.[0] ?? 0xb8a58a)).multiply(light)
    this.sprayCol = new THREE.Color(0xe4ecef).multiply(light)
  }

  /** Half the drawing buffer's height in pixels: sprites are sized in metres. */
  setViewport(height: number): void {
    ;(this.points.material as THREE.ShaderMaterial).uniforms.halfH.value = height / 2
  }

  dispose(): void {
    this.points.parent?.remove(this.points)
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.tex.dispose()
  }

  private emit(r: () => number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color): void {
    const i = this.next
    this.next = (this.next + 1) % Fx.N
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.life[i] = 1
    this.fade[i] = 1 / life
    this.size[i] = size * (0.75 + r() * 0.5)
    this.spin[i] = r() * Math.PI * 2
    // A little variation in tone, so overlapping billows don't flatten into one sheet.
    const k = 0.9 + r() * 0.2
    this.col.set([c.r * k, c.g * k, c.b * k], i * 3)
  }

  /** Advance by dt with the cars as they are now (the tape has just been restored). */
  update(dt: number): void {
    const r = rng(9001 + this.frame++)
    this.run.cars.forEach((car) => {
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
            0.6 + r() * 0.4, 0.5 + v * 0.015, this.sprayCol)
        }
        return
      }
      const loose = car.surface !== 'asphalt' && car.surface !== 'wet'
      const rate = (loose ? clamp(v / 25, 0, 1.2) * 1.0 : 0) + clamp((car.slipR - 0.12) * 4, 0, 1) * 1.0 + (loose ? car.events.landed * 3 : 0)
      const n = Math.floor(rate * 26 * dt + r())
      for (let e = 0; e < n; e++) {
        const side = e % 2 ? 0.8 : -0.8
        this.emit(r, car.x - fx * 1.6 + lx * side, car.y + 0.45, car.z - fz * 1.6 + lz * side,
          -fx * v * 0.22 + (r() - 0.5) * 2.4, 0.5 + r() * 1.0, -fz * v * 0.22 + (r() - 0.5) * 2.4, 2.4 + r() * 1.2, 1.3, this.dustCol)
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
      // Spray is water and falls; dust hangs in the air, drifts and slowly rises.
      this.vel[i * 3 + 1] = heavy ? this.vel[i * 3 + 1] - 9.81 * dt : this.vel[i * 3 + 1] * (1 - dt * 0.8) + 0.12 * dt
      const drag = 1 - dt * (heavy ? 0.6 : 1.6)
      this.vel[i * 3] *= drag
      this.vel[i * 3 + 2] *= drag
      const g = this.run.sim.ground.height(this.pos[i * 3], this.pos[i * 3 + 2])
      if (this.pos[i * 3 + 1] < g + 0.3) {
        this.pos[i * 3 + 1] = g + 0.3
        this.vel[i * 3 + 1] = Math.max(0, this.vel[i * 3 + 1])
        if (heavy) this.life[i] = Math.min(this.life[i], 0.15)
      }
    }
    const g = this.points.geometry
    for (const k of ['position', 'aLife', 'aSize', 'aCol', 'aSpin']) g.attributes[k].needsUpdate = true
  }
}

/** A soft, lumpy puff of smoke: fractal noise under a round falloff, tileable enough for a sprite. */
function puffTexture(): THREE.DataTexture {
  const S = 64
  const n = noise2(77)
  const data = new Uint8Array(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / (S - 1) - 0.5, v = y / (S - 1) - 0.5
      const d = Math.hypot(u, v) * 2
      const fall = Math.exp(-d * d * 2.6)
      const lump = 0.55 + 0.45 * clamp(fbm2(n, u * 4.5 + 3, v * 4.5 + 7, 4) * 1.4 + 0.5, 0, 1)
      const a = Math.round(clamp(fall * lump, 0, 1) * 255)
      data.set([a, a, a, 255], (y * S + x) * 4)
    }
  }
  const t = new THREE.DataTexture(data, S, S)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
