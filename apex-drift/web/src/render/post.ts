import * as THREE from 'three'
import type { Grade } from './atmosphere'
import { lensDirtTexture } from './textures'

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

/** Bright-pass and 4-tap box downsample: only what's brighter than white glows, with a soft knee. */
const BRIGHT = /* glsl */ `
  uniform sampler2D tex; uniform vec2 texel; uniform float threshold;
  varying vec2 vUv;
  vec3 knee(vec3 c) {
    // Threshold 0: a plain downsample, for the wider bloom levels.
    if (threshold <= 0.0) return c;
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - threshold + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    float w = max(soft, l - threshold) / max(l, 1e-4);
    return c * w;
  }
  void main() {
    vec3 c = knee(texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb) + knee(texture2D(tex, vUv + texel * vec2(1.0, -1.0)).rgb)
           + knee(texture2D(tex, vUv + texel * vec2(-1.0, 1.0)).rgb) + knee(texture2D(tex, vUv + texel * vec2(1.0, 1.0)).rgb);
    // Clamp single-pixel fireflies (a sun glint on a wet road) so they bloom, not flicker.
    gl_FragColor = vec4(min(c * 0.25, vec3(24.0)), 1.0);
  }`

/** Separable Gaussian, 9 taps folded into 5 bilinear fetches. */
const BLUR = /* glsl */ `
  uniform sampler2D tex; uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb * 0.2270270270;
    c += texture2D(tex, vUv + dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tex, vUv - dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tex, vUv + dir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tex, vUv - dir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }`

/**
 * The film pass: the scene is rendered to a half-float target, then one
 * full-screen pass does what a camera and a colourist would: bloom from a
 * blurred bright pass, sun shafts, lens ghosts and dirt lit by the sun,
 * exposure, ACES filmic tone mapping, split-tone grading, vignette, a hint of
 * chromatic aberration and grain. Bloom runs at quarter (and eighth)
 * resolution, so the whole thing stays affordable on phones; Low skips it.
 */
export class GradePass {
  readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly bright: THREE.ShaderMaterial
  private readonly blur: THREE.ShaderMaterial
  /** Bloom levels: [result, scratch] at 1/4 and 1/8 resolution. */
  private readonly levels: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget][] = []

  constructor(w: number, h: number, samples: number, bloomLevels = 1) {
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true })
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    for (let i = 0; i < Math.max(1, bloomLevels); i++) this.levels.push([rt(), rt()])
    this.bright = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: VERT, fragmentShader: BRIGHT, uniforms: { tex: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.0 } } })
    this.blur = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: VERT, fragmentShader: BLUR, uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() } } })
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      defines: { BLOOM2: bloomLevels > 1 ? 1 : 0, FRINGE: bloomLevels > 1 ? 1 : 0 },
      uniforms: {
        tex: { value: this.target.texture },
        bloomA: { value: this.levels[0][0].texture },
        bloomB: { value: this.levels[this.levels.length - 1][0].texture },
        dirt: { value: lensDirtTexture() },
        exposure: { value: 1 },
        lift: { value: new THREE.Vector3() },
        gain: { value: new THREE.Vector3(1, 1, 1) },
        shadowTint: { value: new THREE.Vector3() },
        highTint: { value: new THREE.Vector3() },
        saturation: { value: 1 },
        contrast: { value: 1 },
        vignette: { value: 0.3 },
        bloom: { value: 0.06 },
        time: { value: 0 },
        aspect: { value: w / h },
        sunUv: { value: new THREE.Vector2(0.5, 0.5) },
        sunAmt: { value: 0 },
        sunCol: { value: new THREE.Color(1, 0.9, 0.7) },
        rays: { value: 1 },
        speed: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex; uniform sampler2D bloomA; uniform sampler2D bloomB; uniform sampler2D dirt;
        uniform float exposure; uniform vec3 lift; uniform vec3 gain; uniform vec3 shadowTint; uniform vec3 highTint;
        uniform float saturation; uniform float contrast; uniform float vignette; uniform float bloom; uniform float time; uniform float aspect;
        uniform vec2 sunUv; uniform float sunAmt; uniform vec3 sunCol; uniform float rays; uniform float speed;
        varying vec2 vUv;
        float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        // ACES filmic (Hill's fit of the RRT and ODT, with the input and output matrices).
        vec3 rrtOdt(vec3 v) {
          vec3 a = v * (v + 0.0245786) - 0.000090537;
          vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
          return a / b;
        }
        vec3 aces(vec3 c) {
          const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
          const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
          return clamp(outM * rrtOdt(inM * c), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 fromC = vUv - 0.5;
          vec3 c;
          #if FRINGE
            // A trace of lateral chromatic aberration toward the corners, like a real lens.
            vec2 ca = fromC * dot(fromC, fromC) * 0.004;
            c = vec3(texture2D(tex, vUv - ca).r, texture2D(tex, vUv).g, texture2D(tex, vUv + ca).b);
          #else
            c = texture2D(tex, vUv).rgb;
          #endif
          // Speed: a gentle radial streak toward the edges, nothing in the middle where you look.
          if (speed > 0.01) {
            vec2 fc = vUv - vec2(0.5, 0.45);
            float edge = smoothstep(0.15, 0.7, length(fc * vec2(aspect, 1.0)));
            vec3 acc = c;
            for (int i = 1; i <= 5; i++) acc += texture2D(tex, vUv - fc * float(i) * 0.012 * speed).rgb;
            c = mix(c, acc / 6.0, edge);
          }
          vec3 glow = texture2D(bloomA, vUv).rgb;
          #if BLOOM2
            glow = glow * 0.6 + texture2D(bloomB, vUv).rgb * 0.9;
          #endif
          c += glow * bloom;
          // Is the sun really in view? The blurred bright pass at its position says.
          float vis = sunAmt > 0.0 ? clamp(lum(texture2D(bloomA, sunUv).rgb) * 0.5, 0.0, 1.0) * sunAmt : 0.0;
          // Sun shafts: march toward the sun and gather bright, unoccluded sky.
          if (vis > 0.0 && rays > 0.0) {
            vec2 dir = (sunUv - vUv) / 14.0;
            vec2 p = vUv;
            float acc = 0.0, w = 1.0;
            for (int i = 0; i < 14; i++) {
              p += dir;
              acc += smoothstep(0.9, 1.6, lum(texture2D(tex, p).rgb)) * w;
              w *= 0.93;
            }
            float fall = 1.0 - smoothstep(0.0, 0.9, length((vUv - sunUv) * vec2(aspect, 1.0)));
            c += sunCol * acc / 14.0 * vis * fall * 0.9;
          }
          if (vis > 0.0) {
            // Lens ghosts strung along the line from the sun through the centre, tinted by the coatings.
            vec2 axis = vec2(0.5) - sunUv;
            for (int i = 0; i < 4; i++) {
              float f = 0.45 + float(i) * 0.42;
              vec2 gp = sunUv + axis * f * 2.0;
              float r = 0.035 + float(i) * 0.03;
              float d = length((vUv - gp) * vec2(aspect, 1.0));
              float g = smoothstep(r, r * 0.55, d) * (0.5 + 0.5 * smoothstep(r * 0.4, r, d));
              vec3 tint = i == 0 ? vec3(0.4, 0.7, 1.0) : i == 1 ? vec3(1.0, 0.65, 0.35) : i == 2 ? vec3(0.55, 1.0, 0.6) : vec3(0.8, 0.5, 1.0);
              c += tint * sunCol * g * vis * 0.05;
            }
            // Wide warm haze around the sun and the dirt on the lens catching it.
            float sd = length((vUv - sunUv) * vec2(aspect, 1.0));
            c += sunCol * exp(-sd * 3.5) * vis * 0.12;
            c += sunCol * texture2D(dirt, vUv).r * exp(-sd * 1.6) * vis * 0.55;
          }
          // Bright lights at night smear the dirt too.
          c += glow * texture2D(dirt, vUv).r * bloom * 2.5;
          c *= exposure / 0.6;
          c = aces(c);
          c = c * gain + lift * (1.0 - c);
          float l = lum(c);
          // Split toning: one tint into the shadows, another into the highlights.
          c += shadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + highTint * smoothstep(0.45, 1.0, l);
          c = mix(vec3(l), c, saturation);
          c = (c - 0.5) * contrast + 0.5;
          vec2 q = fromC * vec2(aspect, 1.0);
          c *= 1.0 - vignette * smoothstep(0.3, 1.05, length(q));
          c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
          // Film grain: animated, strongest in the mid-tones, gone in the highlights.
          float gr = hash(vUv * vec2(1213.0, 917.0) + fract(time * 7.13)) - 0.5;
          c += gr * 0.03 * (1.0 - smoothstep(0.4, 1.0, l));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
    this.setSize(w, h)
  }

  setGrade(g: Grade, exposure: number): void {
    const u = this.mat.uniforms
    u.exposure.value = exposure
    u.lift.value.set(...g.lift)
    u.gain.value.set(...g.gain)
    u.shadowTint.value.set(...(g.shadowTint ?? [0, 0, 0]))
    u.highTint.value.set(...(g.highTint ?? [0, 0, 0]))
    u.saturation.value = g.saturation
    u.contrast.value = g.contrast
    u.vignette.value = g.vignette
    u.bloom.value = g.bloom ?? 0.06
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h)
    this.mat.uniforms.aspect.value = w / h
    let d = 4
    for (const [a, b] of this.levels) {
      const lw = Math.max(1, Math.round(w / d)), lh = Math.max(1, Math.round(h / d))
      a.setSize(lw, lh)
      b.setSize(lw, lh)
      d *= 2
    }
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

  private pass(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat
    r.setRenderTarget(to)
    r.render(this.scene, this.cam)
  }

  render(r: THREE.WebGLRenderer, time: number): void {
    // Bloom: bright pass down to quarter size, blurred; a second, wider level from that.
    let src: THREE.Texture = this.target.texture
    let sw = this.target.width, sh = this.target.height
    for (const [a, b] of this.levels) {
      this.bright.uniforms.tex.value = src
      this.bright.uniforms.texel.value.set(1 / sw, 1 / sh)
      this.bright.uniforms.threshold.value = src === this.target.texture ? 1.0 : 0.0
      this.pass(r, this.bright, a)
      this.blur.uniforms.tex.value = a.texture
      this.blur.uniforms.dir.value.set(1 / a.width, 0)
      this.pass(r, this.blur, b)
      this.blur.uniforms.tex.value = b.texture
      this.blur.uniforms.dir.value.set(0, 1 / a.height)
      this.pass(r, this.blur, a)
      src = a.texture
      sw = a.width
      sh = a.height
    }
    this.mat.uniforms.time.value = time % 100
    this.pass(r, this.mat, null)
  }

  dispose(): void {
    this.target.dispose()
    for (const [a, b] of this.levels) {
      a.dispose()
      b.dispose()
    }
    this.mat.dispose()
    this.bright.dispose()
    this.blur.dispose()
    this.quad.geometry.dispose()
  }
}
