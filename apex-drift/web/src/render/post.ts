import * as THREE from 'three'
import type { Grade } from './atmosphere'

/**
 * One full-screen pass doing everything a film grade needs: exposure, ACES
 * tone mapping, lift/gain, saturation, contrast, vignette and a little grain.
 * A single pass instead of a post-processing stack keeps it affordable on phones.
 */
export class GradePass {
  readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mat: THREE.ShaderMaterial

  constructor(w: number, h: number, samples: number) {
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true })
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tex: { value: this.target.texture },
        exposure: { value: 1 },
        lift: { value: new THREE.Vector3() },
        gain: { value: new THREE.Vector3(1, 1, 1) },
        saturation: { value: 1 },
        contrast: { value: 1 },
        vignette: { value: 0.3 },
        time: { value: 0 },
        aspect: { value: w / h },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex; uniform float exposure; uniform vec3 lift; uniform vec3 gain;
        uniform float saturation; uniform float contrast; uniform float vignette; uniform float time; uniform float aspect;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tex, vUv).rgb * exposure;
          c = aces(c);
          c = c * gain + lift * (1.0 - c);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, saturation);
          c = (c - 0.5) * contrast + 0.5;
          vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
          c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
          c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
          c += (hash(vUv * 900.0 + time) - 0.5) * 0.018;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat))
  }

  setGrade(g: Grade, exposure: number): void {
    const u = this.mat.uniforms
    u.exposure.value = exposure
    u.lift.value.set(...g.lift)
    u.gain.value.set(...g.gain)
    u.saturation.value = g.saturation
    u.contrast.value = g.contrast
    u.vignette.value = g.vignette
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h)
    this.mat.uniforms.aspect.value = w / h
  }

  render(r: THREE.WebGLRenderer, time: number): void {
    this.mat.uniforms.time.value = time % 100
    r.setRenderTarget(null)
    r.render(this.scene, this.cam)
  }

  dispose(): void {
    this.target.dispose()
    this.mat.dispose()
  }
}
