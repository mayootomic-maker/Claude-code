import * as THREE from 'three'
import type { Look, Weather } from '../data'

export interface Grade {
  /** Added to shadows (lift), per channel. */
  lift: [number, number, number]
  /** Multiplied into highlights (gain), per channel. */
  gain: [number, number, number]
  saturation: number
  contrast: number
  vignette: number
}

export interface Atmos {
  /** Sun elevation and azimuth in degrees. */
  sunEl: number
  sunAz: number
  sun: number
  sunI: number
  skyTop: number
  skyHorizon: number
  ground: number
  hemiI: number
  fog: number
  fogDensity: number
  exposure: number
  grade: Grade
  /** Headlights matter: dusk and night. */
  lights: boolean
  stars: boolean
}

/**
 * Hand-tuned looks. The target is a warm, slightly filmic rally broadcast:
 * lifted, warm shadows, gently desaturated greens, never pure black.
 */
const LOOKS: Record<Look, Atmos> = {
  morning: {
    sunEl: 14, sunAz: 70, sun: 0xffd7a8, sunI: 2.6, skyTop: 0x6d9fd6, skyHorizon: 0xf3dcc0, ground: 0x5b5240, hemiI: 1.05,
    fog: 0xe8d6bf, fogDensity: 0.0042, exposure: 1.05, lights: false, stars: false,
    grade: { lift: [0.025, 0.018, 0.02], gain: [1.04, 1.0, 0.95], saturation: 0.95, contrast: 1.04, vignette: 0.32 },
  },
  noon: {
    sunEl: 58, sunAz: 160, sun: 0xfff3e2, sunI: 2.9, skyTop: 0x4f8ed6, skyHorizon: 0xcfe0ee, ground: 0x6a5f49, hemiI: 1.1,
    fog: 0xd2dfe8, fogDensity: 0.0032, exposure: 0.95, lights: false, stars: false,
    grade: { lift: [0.02, 0.02, 0.025], gain: [1.02, 1.0, 0.97], saturation: 0.92, contrast: 1.06, vignette: 0.26 },
  },
  golden: {
    sunEl: 9, sunAz: 245, sun: 0xffb46a, sunI: 3.0, skyTop: 0x5a7fbf, skyHorizon: 0xffc58a, ground: 0x5a4632, hemiI: 0.95,
    fog: 0xf0c493, fogDensity: 0.0046, exposure: 1.08, lights: false, stars: false,
    grade: { lift: [0.035, 0.022, 0.015], gain: [1.08, 1.0, 0.88], saturation: 1.0, contrast: 1.05, vignette: 0.36 },
  },
  sunset: {
    sunEl: 3, sunAz: 255, sun: 0xff8f4f, sunI: 2.4, skyTop: 0x47578f, skyHorizon: 0xff9c63, ground: 0x4a3328, hemiI: 0.8,
    fog: 0xe39a6c, fogDensity: 0.005, exposure: 1.12, lights: false, stars: false,
    grade: { lift: [0.04, 0.02, 0.025], gain: [1.1, 0.97, 0.88], saturation: 1.02, contrast: 1.06, vignette: 0.4 },
  },
  dusk: {
    sunEl: -3, sunAz: 265, sun: 0xb6a0ff, sunI: 0.55, skyTop: 0x253263, skyHorizon: 0xd88a76, ground: 0x2a2530, hemiI: 0.75,
    fog: 0x7b6f86, fogDensity: 0.0055, exposure: 1.35, lights: true, stars: true,
    grade: { lift: [0.03, 0.025, 0.045], gain: [1.02, 0.97, 1.02], saturation: 0.9, contrast: 1.03, vignette: 0.42 },
  },
  night: {
    sunEl: 35, sunAz: 120, sun: 0x9fb4ff, sunI: 0.32, skyTop: 0x0b1226, skyHorizon: 0x26304f, ground: 0x15171f, hemiI: 0.55,
    fog: 0x1f2639, fogDensity: 0.006, exposure: 1.55, lights: true, stars: true,
    grade: { lift: [0.02, 0.025, 0.045], gain: [0.98, 1.0, 1.06], saturation: 0.82, contrast: 1.02, vignette: 0.45 },
  },
  overcast: {
    sunEl: 40, sunAz: 150, sun: 0xe9ecef, sunI: 0.9, skyTop: 0x9aa6b2, skyHorizon: 0xd5d9dc, ground: 0x5b5a52, hemiI: 1.45,
    fog: 0xc3c9cd, fogDensity: 0.006, exposure: 1.02, lights: false, stars: false,
    grade: { lift: [0.03, 0.03, 0.032], gain: [1.03, 1.0, 0.97], saturation: 0.85, contrast: 1.04, vignette: 0.3 },
  },
  mist: {
    sunEl: 22, sunAz: 110, sun: 0xf3e9da, sunI: 0.8, skyTop: 0xb5bcc2, skyHorizon: 0xdcdcd6, ground: 0x5f5e55, hemiI: 1.4,
    fog: 0xd3d4cd, fogDensity: 0.016, exposure: 1.05, lights: false, stars: false,
    grade: { lift: [0.035, 0.034, 0.03], gain: [1.03, 1.0, 0.96], saturation: 0.8, contrast: 1.0, vignette: 0.3 },
  },
}

export function atmosphere(look: Look, weather: Weather): Atmos {
  const a: Atmos = { ...LOOKS[look], grade: { ...LOOKS[look].grade } }
  if (weather === 'rain') {
    a.sunI *= 0.45
    a.hemiI *= 1.1
    a.fogDensity *= 1.9
    a.fog = mix(a.fog, 0x8f989f, 0.6)
    a.skyTop = mix(a.skyTop, 0x6f7881, 0.7)
    a.skyHorizon = mix(a.skyHorizon, 0xa6adb1, 0.7)
    a.grade.saturation *= 0.88
  } else if (weather === 'snow') {
    a.sunI *= 0.55
    a.hemiI *= 1.2
    a.fogDensity *= 1.7
    a.fog = mix(a.fog, 0xdfe4ea, 0.6)
    a.skyHorizon = mix(a.skyHorizon, 0xe6ebf0, 0.6)
    a.grade.gain = [a.grade.gain[0] * 0.98, a.grade.gain[1], a.grade.gain[2] * 1.03]
  } else if (weather === 'fog') {
    a.fogDensity = Math.max(a.fogDensity * 2.6, 0.014)
    a.sunI *= 0.6
    a.hemiI *= 1.15
  }
  return a
}

function mix(a: number, b: number, t: number): number {
  const c1 = new THREE.Color(a), c2 = new THREE.Color(b)
  return c1.lerp(c2, t).getHex()
}

export function sunDirection(a: Atmos): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(Math.max(a.sunEl, 4))
  const az = THREE.MathUtils.degToRad(a.sunAz)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
}

/** A gradient sky with a soft sun disc and a few painted clouds; one draw call, no textures. */
export function skyDome(a: Atmos): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1800, 32, 16)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(a.skyTop) },
      horizon: { value: new THREE.Color(a.skyHorizon) },
      sunCol: { value: new THREE.Color(a.sun) },
      sunDir: { value: sunDirection(a) },
      sunVis: { value: a.sunEl > -2 ? Math.min(1, a.sunI / 2) : 0 },
      stars: { value: a.stars ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunCol; uniform vec3 sunDir;
      uniform float sunVis; uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0));
        float c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
        col = mix(col, horizon * 0.8, smoothstep(0.0, -0.2, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += sunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.35 + pow(sd, 4.0) * 0.12) * sunVis;
        // Soft painted clouds in a band above the horizon.
        vec2 uv = d.xz / max(d.y + 0.25, 0.08) * 1.6;
        float cl = noise(uv) * 0.6 + noise(uv * 2.3) * 0.3 + noise(uv * 5.1) * 0.1;
        float band = smoothstep(0.02, 0.18, d.y) * (1.0 - smoothstep(0.45, 0.9, d.y));
        float cover = smoothstep(0.55, 0.85, cl) * band;
        vec3 cloudCol = mix(horizon * 1.08, sunCol, 0.25 + 0.5 * pow(sd, 3.0)) ;
        col = mix(col, cloudCol, cover * 0.75);
        if (stars > 0.5 && d.y > 0.05) {
          float s = step(0.9975, hash(floor(d * 420.0)));
          col += vec3(s) * 0.8 * smoothstep(0.05, 0.4, d.y);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const m = new THREE.Mesh(geo, mat)
  m.frustumCulled = false
  m.renderOrder = -10
  return m
}
