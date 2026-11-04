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
        sunUv: { value: new THREE.Vector2(0.5, 0.5) },
        sunAmt: { value: 0 },
        sunCol: { value: new THREE.Color(1, 0.9, 0.7) },
        texel: { value: new THREE.Vector2(1 / w, 1 / h) },
        rays: { value: 1 },
        speed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex; uniform float exposure; uniform vec3 lift; uniform vec3 gain;
        uniform float saturation; uniform float contrast; uniform float vignette; uniform float time; uniform float aspect;
        uniform vec2 sunUv; uniform float sunAmt; uniform vec3 sunCol; uniform vec2 texel; uniform float rays; uniform float speed;
        varying vec2 vUv;
        float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tex, vUv).rgb;
          // Speed: a gentle radial streak toward the edges, nothing in the middle where you look.
          if (speed > 0.01) {
            vec2 fromC = vUv - vec2(0.5, 0.45);
            float edge = smoothstep(0.15, 0.7, length(fromC * vec2(aspect, 1.0)));
            vec3 acc = c;
            for (int i = 1; i <= 5; i++) acc += texture2D(tex, vUv - fromC * float(i) * 0.012 * speed).rgb;
            c = mix(c, acc / 6.0, edge);
          }
          // Bloom: a ring of taps picks up only what's brighter than white.
          vec3 glow = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            for (int r = 1; r <= 2; r++) {
              vec3 t = texture2D(tex, vUv + vec2(cos(a), sin(a)) * texel * float(r) * 9.0).rgb;
              glow += max(t - 1.0, 0.0) / float(r);
            }
          }
          c += glow * 0.05;
          // Sun shafts: march toward the sun and gather bright, unoccluded sky.
          if (sunAmt > 0.0 && rays > 0.0) {
            vec2 dir = (sunUv - vUv) / 14.0;
            vec2 p = vUv;
            float acc = 0.0, w = 1.0;
            for (int i = 0; i < 14; i++) {
              p += dir;
              vec3 t = texture2D(tex, p).rgb;
              acc += smoothstep(0.9, 1.6, lum(t)) * w;
              w *= 0.93;
            }
            float fall = 1.0 - smoothstep(0.0, 0.9, length((vUv - sunUv) * vec2(aspect, 1.0)));
            c += sunCol * acc / 14.0 * sunAmt * fall * 0.9;
          }
          c *= exposure;
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
    this.mat.uniforms.texel.value.set(1 / w, 1 / h)
  }

  /** Sun position on screen (0..1 UV) and how strongly its shafts show; 0 hides them. */
  setSun(u: number, v: number, amount: number, color: THREE.Color, rays: boolean): void {
    const m = this.mat.uniforms
    m.sunUv.value.set(u, v)
    m.sunAmt.value = amount
    m.sunCol.value.copy(color)
    m.rays.value = rays ? 1 : 0
  }

  setSpeed(v: number): void {
    this.mat.uniforms.speed.value = v
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
