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
  /** Split toning: added to the shadows and to the highlights after tone mapping. */
  shadowTint?: [number, number, number]
  highTint?: [number, number, number]
  /** How strongly highlights bloom. */
  bloom?: number
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
  /**
   * Aerial perspective, per metre at the camera's height (exponential, and
   * thicker below the camera than above it: see installAerialFog). Low
   * enough that ridges two kilometres away still read, as blue silhouettes.
   */
  fogDensity: number
  exposure: number
  grade: Grade
  /**
   * How much light reaches anything drawn unlit (the distant ranges, dust),
   * 1 in daylight. Those carry their colour baked in, so without this a snow
   * cap or a dust cloud would glow at full daylight brightness in the dark.
   */
  dim: number
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
    fog: 0xe8d6bf, fogDensity: 0.0013, exposure: 1.05, dim: 1, lights: false, stars: false,
    grade: { lift: [0.025, 0.018, 0.02], gain: [1.04, 1.0, 0.95], saturation: 0.97, contrast: 1.05, vignette: 0.32, shadowTint: [-0.006, 0.0, 0.012], highTint: [0.018, 0.008, -0.01], bloom: 0.28 },
  },
  noon: {
    sunEl: 58, sunAz: 160, sun: 0xfff3e2, sunI: 2.9, skyTop: 0x4f8ed6, skyHorizon: 0xcfe0ee, ground: 0x6a5f49, hemiI: 1.1,
    fog: 0xd2dfe8, fogDensity: 0.001, exposure: 0.95, dim: 1, lights: false, stars: false,
    grade: { lift: [0.02, 0.02, 0.025], gain: [1.02, 1.0, 0.97], saturation: 0.95, contrast: 1.07, vignette: 0.26, shadowTint: [-0.008, 0.0, 0.01], highTint: [0.01, 0.006, -0.004], bloom: 0.22 },
  },
  golden: {
    sunEl: 9, sunAz: 245, sun: 0xffb46a, sunI: 3.0, skyTop: 0x5a7fbf, skyHorizon: 0xffc58a, ground: 0x5a4632, hemiI: 0.95,
    fog: 0xf0c493, fogDensity: 0.0014, exposure: 1.08, dim: 1, lights: false, stars: false,
    grade: { lift: [0.035, 0.022, 0.015], gain: [1.08, 1.0, 0.88], saturation: 1.02, contrast: 1.06, vignette: 0.36, shadowTint: [-0.012, 0.0, 0.016], highTint: [0.025, 0.01, -0.012], bloom: 0.34 },
  },
  sunset: {
    sunEl: 3, sunAz: 255, sun: 0xff8f4f, sunI: 2.4, skyTop: 0x47578f, skyHorizon: 0xff9c63, ground: 0x4a3328, hemiI: 0.8,
    fog: 0xe39a6c, fogDensity: 0.0016, exposure: 1.12, dim: 0.72, lights: false, stars: false,
    grade: { lift: [0.04, 0.02, 0.025], gain: [1.1, 0.97, 0.88], saturation: 1.04, contrast: 1.07, vignette: 0.4, shadowTint: [-0.01, -0.004, 0.02], highTint: [0.03, 0.008, -0.014], bloom: 0.38 },
  },
  dusk: {
    sunEl: -3, sunAz: 265, sun: 0xb6a0ff, sunI: 0.55, skyTop: 0x253263, skyHorizon: 0xd88a76, ground: 0x2a2530, hemiI: 0.75,
    fog: 0x7b6f86, fogDensity: 0.0018, exposure: 1.35, dim: 0.36, lights: true, stars: true,
    grade: { lift: [0.03, 0.025, 0.045], gain: [1.02, 0.97, 1.02], saturation: 0.92, contrast: 1.04, vignette: 0.42, shadowTint: [-0.004, 0.004, 0.02], highTint: [0.02, 0.008, -0.006], bloom: 0.45 },
  },
  night: {
    sunEl: 35, sunAz: 120, sun: 0x9fb4ff, sunI: 0.32, skyTop: 0x0b1226, skyHorizon: 0x26304f, ground: 0x15171f, hemiI: 0.55,
    fog: 0x1f2639, fogDensity: 0.002, exposure: 1.55, dim: 0.07, lights: true, stars: true,
    grade: { lift: [0.02, 0.025, 0.045], gain: [0.98, 1.0, 1.06], saturation: 0.84, contrast: 1.03, vignette: 0.45, shadowTint: [-0.004, 0.004, 0.016], highTint: [0.016, 0.01, 0.0], bloom: 0.55 },
  },
  overcast: {
    sunEl: 40, sunAz: 150, sun: 0xe9ecef, sunI: 0.9, skyTop: 0x9aa6b2, skyHorizon: 0xd5d9dc, ground: 0x5b5a52, hemiI: 1.45,
    fog: 0xc3c9cd, fogDensity: 0.0019, exposure: 1.02, dim: 1, lights: false, stars: false,
    grade: { lift: [0.03, 0.03, 0.032], gain: [1.03, 1.0, 0.97], saturation: 0.88, contrast: 1.05, vignette: 0.3, shadowTint: [-0.006, 0.002, 0.008], highTint: [0.006, 0.004, 0.0], bloom: 0.2 },
  },
  mist: {
    sunEl: 22, sunAz: 110, sun: 0xf3e9da, sunI: 0.8, skyTop: 0xb5bcc2, skyHorizon: 0xdcdcd6, ground: 0x5f5e55, hemiI: 1.4,
    fog: 0xd3d4cd, fogDensity: 0.0052, exposure: 1.05, dim: 1, lights: false, stars: false,
    grade: { lift: [0.035, 0.034, 0.03], gain: [1.03, 1.0, 0.96], saturation: 0.82, contrast: 1.02, vignette: 0.3, shadowTint: [-0.004, 0.002, 0.008], highTint: [0.008, 0.005, 0.0], bloom: 0.25 },
  },
}
export function atmosphere(look: Look, weather: Weather): Atmos {
  const a: Atmos = { ...LOOKS[look], grade: { ...LOOKS[look].grade } }
  if (weather === 'rain') {
    a.sunI *= 0.45
    a.dim *= 0.8
    a.hemiI *= 1.1
    a.fogDensity *= 1.9
    a.fog = mix(a.fog, 0x8f989f, 0.6)
    a.skyTop = mix(a.skyTop, 0x6f7881, 0.7)
    a.skyHorizon = mix(a.skyHorizon, 0xa6adb1, 0.7)
    a.grade.saturation *= 0.88
  } else if (weather === 'snow') {
    a.sunI *= 0.55
    a.dim *= 0.9
    a.hemiI *= 1.2
    a.fogDensity *= 1.7
    a.fog = mix(a.fog, 0xdfe4ea, 0.6)
    a.skyHorizon = mix(a.skyHorizon, 0xe6ebf0, 0.6)
    a.grade.gain = [a.grade.gain[0] * 0.98, a.grade.gain[1], a.grade.gain[2] * 1.03]
  } else if (weather === 'fog') {
    a.fogDensity = Math.max(a.fogDensity * 2.6, 0.0045)
    a.sunI *= 0.6
    a.hemiI *= 1.15
  }
  return a
}

/**
 * Aerial perspective for every material, replacing three's squared-
 * exponential fog (FogExp2 scenes only; plain linear Fog, as in the garage,
 * is left alone). Exponential with distance, so the near world stays clear
 * while far ridges fade gradually instead of vanishing at a wall; and
 * integrated through air that thins with height, so valleys below the camera
 * fill with haze while peaks above it stand out against the sky.
 */
function installAerialFog(): void {
  const C = THREE.ShaderChunk
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogRay;\n#endif'
  // World-space offset from the camera: the view matrix's rotation, transposed.
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogRay = mvPosition.xyz * mat3( viewMatrix );\n#endif'
  C.fog_pars_fragment = '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying vec3 vFogRay;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif'
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogDist = length( vFogRay );
		// Density halves every ~150 m of height; the integral along the ray, relative to the camera's height.
		float fogK = 0.0046 * vFogRay.y;
		float fogH = abs( fogK ) > 0.001 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0;
		float fogFactor = 1.0 - exp( - fogDensity * fogDist * ( 0.3 + 0.7 * min( fogH, 4.0 ) ) );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`
}
installAerialFog()

function mix(a: number, b: number, t: number): number {
  const c1 = new THREE.Color(a), c2 = new THREE.Color(b)
  return c1.lerp(c2, t).getHex()
}

export function sunDirection(a: Atmos): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(Math.max(a.sunEl, 4))
  const az = THREE.MathUtils.degToRad(a.sunAz)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
}

/** How much of the sky the clouds cover, by look; weather adds more. */
const COVER: Record<Look, number> = { morning: 0.45, noon: 0.38, golden: 0.5, sunset: 0.58, dusk: 0.45, night: 0.3, overcast: 0.92, mist: 0.75 }

export function cloudCover(look: Look, weather: Weather): number {
  return Math.min(0.97, COVER[look] + (weather === 'rain' ? 0.5 : weather === 'snow' ? 0.45 : weather === 'fog' ? 0.2 : 0))
}

/**
 * Sky dome with lit, drifting clouds. Each pixel marches a few steps through
 * a 2D cloud layer and once more toward the sun, so cloud bodies darken where
 * they're thick and their edges glow where the sun shines through: a
 * volumetric look for a handful of texture-free noise lookups.
 */
export function skyDome(a: Atmos, cover = 0.5): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1800, 48, 24)
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
      cover: { value: cover },
      night: { value: a.stars ? 1 : 0 },
      time: { value: 0 },
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
      uniform float sunVis; uniform float stars; uniform float cover; uniform float night; uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      float density(vec2 uv) {
        float d = fbm(uv + vec2(time * 0.004, time * 0.0015));
        d += 0.35 * fbm(uv * 3.1 - vec2(time * 0.01, 0.0)) - 0.17;
        return clamp((d - (1.0 - cover) * 0.75) * 2.6, 0.0, 1.0);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.5));
        col = mix(col, horizon * 0.82, smoothstep(0.0, -0.2, h));
        vec3 sd3 = normalize(sunDir);
        float sd = max(dot(d, sd3), 0.0);
        // Atmosphere around the sun: wide warm glow plus a tight bright halo.
        col += sunCol * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.6) * sunVis;
        // Clouds: project onto a flat layer, march a few steps toward the sun for shading.
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 0.9;
          float dens = density(uv);
          if (dens > 0.001) {
            vec2 toSun = normalize(sd3.xz + 1e-4) * 0.06;
            float shade = 0.0;
            for (int i = 1; i <= 4; i++) shade += density(uv + toSun * float(i));
            shade /= 4.0;
            float lit = exp(-shade * 2.2);
            vec3 dark = mix(horizon, top, 0.35) * mix(0.55, 0.3, night);
            vec3 bright = mix(vec3(1.0), sunCol, 0.55) * (0.9 + 0.6 * sunVis);
            vec3 cloud = mix(dark, bright, lit);
            // Silver lining where thin cloud sits in front of the sun.
            cloud += sunCol * pow(sd, 10.0) * (1.0 - dens) * 1.8 * sunVis;
            float fade = smoothstep(0.0, 0.12, d.y);
            col = mix(col, cloud, dens * fade * 0.95);
          }
        }
        // Sun disc, hidden behind thick cloud.
        float disc = smoothstep(0.9993, 0.9997, sd) * sunVis;
        col += sunCol * disc * 8.0;
        if (stars > 0.5 && d.y > 0.05) {
          float s = step(0.9972, hash3(floor(d * 420.0)));
          col += vec3(s) * 0.9 * smoothstep(0.05, 0.4, d.y) * (1.0 - cover);
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
