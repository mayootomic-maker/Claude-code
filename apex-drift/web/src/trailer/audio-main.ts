import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EngineDSP } from '../audio/engine-dsp'
import { engineProfileFor } from '../audio/engines'
import { soundInputs, type CarSoundState } from '../audio/engine'
import { Biquad, dbToGain, env, fadeIn, noiseGen, OnePole, panGains, Reverb, SR, stereo, TAU, type Stereo } from './dsp'
import { renderMusic, type Cue } from './music'
import { BPM } from './plan'

/**
 * The trailer's sound, rendered offline from the telemetry each shot was
 * filmed from (run with vite-node: `vite-node src/trailer/audio-main.ts <work>`).
 *
 * Every car in a shot gets its own instance of the game's engine synth,
 * driven step by step from its recorded rpm, throttle, gear, boost, surface
 * and slip. Outside the car, each is heard from the camera: delayed by the
 * time sound takes to travel (which is what makes the doppler sweep as a car
 * passes), quieter and duller with distance, panned by where it is in frame.
 * Onboard, the hero is heard through the game's own cabin mix. Shots are
 * cross-faded exactly where the picture dissolves. Music is ducked under the
 * big moments and the co-driver, and the whole is mastered to -14 LUFS.
 */

interface ShotPlan {
  /** Index in the full plan: names the shot's telemetry file. */
  idx: number
  name: string
  run: string
  t0: number
  dur: number
  frames: number
  at: number
  out: { type: string; dur: number }
  audio: 'outside' | 'chase' | 'cockpit' | 'bonnet'
  voice: { words: string[]; at: number }[]
  marks: { kind: 'go' | 'finish'; at: number }[]
  title: number | null
}
interface PlanFile {
  shots: ShotPlan[]
  length: number
}
interface Telemetry {
  fields: string[]
  t0: number
  dur: number
  audio: ShotPlan['audio']
  weather: string
  cars: { id: string; rows: (number | string)[][] }[]
  cams: number[][]
}

const work = process.argv[2]
if (!work) throw new Error('usage: audio-main.ts <work dir>')
const plan = JSON.parse(readFileSync(join(work, process.argv[3] ?? 'plan.json'), 'utf8')) as PlanFile
const LEN = plan.length
const N = Math.ceil(LEN * SR)
const C_SOUND = 343
const pad = (i: number) => String(i).padStart(2, '0')
const t0 = Date.now()
const log = (s: string) => console.log(`  [audio ${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`)

// ------------------------------------------------------------------ one-shots

/** Landing: springs bottoming out, a body thump and a suspension knock (the game's recipe). */
function landing(out: Float32Array, i0: number, s: number, rnd: () => number): void {
  const bp = new Biquad().set('bp', 260 + s * 200, 2.5)
  let ph = 0
  for (let n = 0; n < 0.5 * SR && i0 + n < out.length; n++) {
    const t = n / SR
    ph += (TAU * (32 + 38 * Math.exp(-t / 0.07))) / SR
    out[i0 + n] += Math.sin(ph) * env(t, 0.006, 0.09) * 0.85 * s + bp.tick(rnd()) * env(t - 0.06, 0.003, 0.05) * 1.2 * s
  }
}

/** Contact: a low thud, a crunch of panel, a short metallic ring. */
function impact(out: Float32Array, i0: number, s: number, rnd: () => number): void {
  const bp = new Biquad().set('bp', 900 + s * 900, 0.9)
  const ring = new Biquad().set('peak', 2300 + rnd() * 1400 + 1400, 18, 14)
  let ph = 0
  for (let n = 0; n < 0.6 * SR && i0 + n < out.length; n++) {
    const t = n / SR
    ph += (TAU * (38 + (60 + s * 30) * Math.exp(-t / 0.08))) / SR
    out[i0 + n] += Math.sin(ph) * env(t, 0.004, 0.1) * 0.9 * s + ring.tick(bp.tick(rnd())) * env(t, 0.002, 0.06 + s * 0.08) * 0.8 * s
  }
}

/** The bow wave as a car hits water: a burst of broadband wash with a long, falling tail. */
function splash(out: Float32Array, i0: number, s: number, rnd: () => number): void {
  const bp = new Biquad(), lp = new Biquad().set('lp', 500, 0.7)
  for (let n = 0; n < 1.6 * SR && i0 + n < out.length; n++) {
    const t = n / SR
    if (n % 64 === 0) bp.set('bp', 2400 * Math.exp(-t * 1.2) + 500, 0.8)
    out[i0 + n] += (bp.tick(rnd()) * 1.6 + lp.tick(rnd()) * 0.8) * env(t, 0.01, 0.45) * s
  }
}

// ------------------------------------------------------------------ telemetry helpers

class Tel {
  readonly f: Record<string, number>
  constructor(readonly d: Telemetry) {
    this.f = Object.fromEntries(d.fields.map((k, i) => [k, i]))
  }

  /** Linear interpolation of a numeric field of car ci at tape time t. */
  num(ci: number, key: string, t: number): number {
    const rows = this.d.cars[ci].rows
    const t0 = rows[0][0] as number
    const x = Math.min(Math.max(0, (t - t0) * 60), rows.length - 1.0001)
    const i = Math.floor(x), u = x - i
    const j = this.f[key]
    return (rows[i][j] as number) * (1 - u) + (rows[i + 1][j] as number) * u
  }

  near(ci: number, key: string, t: number): number | string {
    const rows = this.d.cars[ci].rows
    const i = Math.min(Math.max(0, Math.round((t - (rows[0][0] as number)) * 60)), rows.length - 1)
    return rows[i][this.f[key]]
  }

  /** Camera position, forward and right at tape time t (held before the first frame). */
  cam(t: number): number[] {
    const c = this.d.cams
    if (!c.length) return [0, 0, 0, 0, 0, 1, 1, 0, 0]
    const x = Math.min(Math.max(0, (t - c[0][0]) * 30), c.length - 1.0001)
    const i = Math.floor(x), u = c.length > 1 ? x - i : 0
    const a = c[i], b = c[Math.min(c.length - 1, i + 1)]
    return a.slice(1).map((v, k) => v * (1 - u) + b[k + 1] * u)
  }
}

// ------------------------------------------------------------------ one shot

function renderShot(i: number, s: ShotPlan): Stereo {
  const tel = new Tel(JSON.parse(readFileSync(join(work, `shot-${pad(s.idx)}.json`), 'utf8')) as Telemetry)
  const n = Math.ceil(s.dur * SR)
  const out = stereo(n)
  const verb = new Float32Array(n)
  const onboard = s.audio === 'cockpit' || s.audio === 'bonnet'
  const rnd = noiseGen(1000 + i)
  tel.d.cars.forEach((car, ci) => {
    const rows = car.rows
    const rt0 = rows[0][0] as number
    const rt1 = rows[rows.length - 1][0] as number
    // Skip cars too far from the camera all shot long to be heard over the hero.
    let closest = Infinity
    for (let t = s.t0; t <= s.t0 + s.dur; t += 0.1) {
      const c = tel.cam(t)
      closest = Math.min(closest, Math.hypot(tel.num(ci, 'x', t) - c[0], tel.num(ci, 'y', t) - c[1], tel.num(ci, 'z', t) - c[2]))
    }
    if (ci > 0 && closest > 380) return
    const inside = onboard && ci === 0
    const prof = engineProfileFor(car.id)
    const dsp = new EngineDSP(prof, SR)
    const total = Math.floor(((rt1 - rt0) * SR) / 128) * 128
    const src = new Float32Array(total)
    const eng = new Float32Array(128), sfx = new Float32Array(128)
    let lastLand = -1, lastHit = -1, wasWater = false
    for (let b = 0; b < total; b += 128) {
      const t = rt0 + b / SR
      const live = tel.near(ci, 'live', t) === 1
      const state: CarSoundState = {
        rpm: tel.num(ci, 'rpm', t),
        throttle: live ? tel.num(ci, 'throttle', t) : 0,
        load: live ? tel.num(ci, 'load', t) : 0,
        gear: tel.near(ci, 'gear', t) as number,
        shifting: tel.near(ci, 'shifting', t) === 1,
        boost: tel.num(ci, 'boost', t),
        speed: Math.hypot(tel.num(ci, 'vx', t), tel.num(ci, 'vz', t)),
        surface: String(tel.near(ci, 'surface', t)),
        slip: Math.min(1, tel.num(ci, 'slip', t) * 3),
        wheelSpin: tel.num(ci, 'spin', t),
        onGround: tel.near(ci, 'air', t) !== 1,
        impact: 0, landed: 0,
        camera: inside ? 'bonnet' : 'chase',
      }
      soundInputs(state, dsp.in)
      dsp.render(eng, sfx, 128)
      for (let k = 0; k < 128; k++) src[b + k] = eng[k] * 0.56 + sfx[k] * 0.85
      // One-shots, at the step they happened, rate limited as in the game.
      const landed = tel.num(ci, 'landed', t), hit = tel.num(ci, 'impact', t)
      if (landed > 2.5 && t - lastLand > 0.25) {
        lastLand = t
        landing(src, b, Math.min(1, landed / 9), rnd)
      }
      if (hit > 1.5 && t - lastHit > 0.2) {
        lastHit = t
        impact(src, b, Math.min(1, hit / 12), rnd)
      }
      const water = state.surface === 'water'
      if (water && !wasWater && state.speed > 4) splash(src, b, Math.min(1.2, state.speed / 22), rnd)
      wasWater = water
    }
    // Place on the shot: onboard straight in; outside through the air from the car to the camera.
    const air = new OnePole(), air2 = new OnePole()
    const cabin = new Biquad().set('lp', 900, 0.7)
    for (let k = 0; k < n; k++) {
      const t = s.t0 + k / SR
      if (inside) {
        const v = src[Math.min(total - 1, Math.max(0, Math.round((t - rt0) * SR)))] * 0.95
        out.l[k] += v
        out.r[k] += v
        verb[k] += v * 0.03
        continue
      }
      const c = tel.cam(t)
      const px = tel.num(ci, 'x', t), py = tel.num(ci, 'y', t) + 0.5, pz = tel.num(ci, 'z', t)
      const dx = px - c[0], dy = py - c[1], dz = pz - c[2]
      const d = Math.max(0.8, Math.hypot(dx, dy, dz))
      // Heard now is what the car made d/c seconds ago: the doppler shift falls out of this.
      const te = t - d / C_SOUND
      const x = (te - rt0) * SR
      const j = Math.floor(x)
      if (j < 0 || j >= total - 1) continue
      let v = src[j] + (src[j + 1] - src[j]) * (x - j)
      const fwd = dx * c[3] + dy * c[4] + dz * c[5]
      const right = dx * c[6] + dy * c[7] + dz * c[8]
      const g = Math.min(1.5, Math.pow(7 / d, 0.85))
      const cut = 15000 * Math.exp(-d / 110) + 1400
      v = air2.tick(air.tick(v, fwd < 0 ? cut * 0.55 : cut), fwd < 0 ? cut * 0.55 : cut)
      if (onboard) v = cabin.tick(v) * 0.6
      const pan = (right / d) * 0.85
      const [gl, gr] = panGains(pan)
      out.l[k] += v * g * gl * 1.41
      out.r[k] += v * g * gr * 1.41
      verb[k] += v * g * (0.15 + 0.5 * Math.min(1, d / 60))
    }
  })
  // Ambience: rain on everything in the wet, air rushing past a drone, a crowd at the start and finish.
  const amb = noiseGen(500 + i), amb2 = noiseGen(900 + i)
  const rainL = new Biquad().set('hp', 2400, 0.7), rainR = new Biquad().set('hp', 2500, 0.7)
  const windL = new Biquad().set('lp', 380, 0.7), windR = new Biquad().set('lp', 420, 0.7)
  const crowdL = new Biquad().set('bp', 1050, 0.6), crowdR = new Biquad().set('bp', 1150, 0.6)
  const crowd = ['grid-drone', 'launch-low', 'finish-tele', 'outro-rise'].includes(s.name)
  for (let k = 0; k < n; k++) {
    const t = s.t0 + k / SR
    let l = 0, r = 0
    if (tel.d.weather === 'rain') {
      const g = onboard ? 0.05 : 0.035
      l += rainL.tick(amb()) * g
      r += rainR.tick(amb2()) * g
    }
    const c = tel.cam(t)
    const high = Math.max(0, Math.min(1, (c[1] - tel.num(0, 'y', t) - 6) / 20))
    const gust = 0.6 + 0.4 * Math.sin(TAU * 0.13 * t + i) * Math.sin(TAU * 0.07 * t)
    l += windL.tick(amb()) * (0.05 + 0.25 * high) * gust
    r += windR.tick(amb2()) * (0.05 + 0.25 * high) * gust
    if (crowd) {
      const swell = 0.7 + 0.3 * Math.sin(TAU * 0.4 * t + 1)
      l += crowdL.tick(amb()) * 0.07 * swell
      r += crowdR.tick(amb2()) * 0.07 * swell
    }
    out.l[k] += l
    out.r[k] += r
  }
  new Reverb(onboard ? 0.6 : 0.8, 0.45).process(verb, out, 0.55)
  return out
}

// ------------------------------------------------------------------ voice

function voiceClips(): { pcm: Float32Array; clips: Record<string, [number, number]> } {
  const dir = join(work, '..', '..', 'public', 'voice')
  const meta = JSON.parse(readFileSync(join(dir, 'voice-en.json'), 'utf8')) as { clips: Record<string, [number, number]> }
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', join(dir, 'voice-en.mp3'), '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error('could not decode the co-driver recording')
  const b = r.stdout
  return { pcm: new Float32Array(b.buffer, b.byteOffset, b.length / 4), clips: meta.clips }
}

// ------------------------------------------------------------------ mix

const fxBus = stereo(N), voiceBus = stereo(N)
const cuts: number[] = []
plan.shots.forEach((s, i) => {
  const a = renderShot(i, s)
  const i0 = Math.round(s.at * SR)
  const inLen = i > 0 ? plan.shots[i - 1].out.dur : 0
  const outLen = i < plan.shots.length - 1 ? s.out.dur : 0
  cuts.push(s.at, s.at + inLen)
  for (let k = 0; k < a.l.length; k++) {
    const t = k / SR
    // Equal-power crossfades exactly where the picture dissolves; the first and last shots fade from and to silence.
    let g = 1
    if (i > 0) g *= fadeIn(t / Math.max(inLen, 0.02))
    else g *= fadeIn(t / 0.6)
    if (i < plan.shots.length - 1) g *= fadeIn((s.dur - t) / Math.max(outLen, 0.02))
    const o = i0 + k
    if (o < 0 || o >= N) continue
    fxBus.l[o] += a.l[k] * g
    fxBus.r[o] += a.r[k] * g
  }
  log(`shot ${pad(i)} ${s.name}`)
})

// Whooshes under the whip transitions.
plan.shots.forEach((s, i) => {
  if (i === plan.shots.length - 1 || !/hblur|smooth/.test(s.out.type)) return
  const mid = plan.shots[i + 1].at + s.out.dur / 2
  const rnd = noiseGen(31 + i)
  const bp = new Biquad(), bp2 = new Biquad()
  const dirn = s.out.type === 'smoothright' ? -1 : 1
  const half = 0.42
  for (let k = Math.round((mid - half) * SR); k < Math.round((mid + half) * SR); k++) {
    if (k < 0 || k >= N) continue
    const u = (k / SR - (mid - half)) / (2 * half)
    if (k % 32 === 0) {
      const f = 350 * Math.pow(9, Math.sin(u * Math.PI))
      bp.set('bp', f, 1.1)
      bp2.set('bp', f * 1.3, 1.1)
    }
    const e = Math.pow(Math.sin(u * Math.PI), 2.2) * 0.32
    const [gl, gr] = panGains(dirn * (u * 2 - 1) * 0.8)
    fxBus.l[k] += bp.tick(rnd()) * e * gl * 1.4
    fxBus.r[k] += bp2.tick(rnd()) * e * gr * 1.4
  }
})
log('cars and effects done')

// Co-driver calls: words spaced as the game spaces them, each with a short fade.
{
  const { pcm, clips } = voiceClips()
  const hp = new Biquad().set('hp', 160, 0.7), pres = new Biquad().set('peak', 2800, 1, 3)
  const mono = new Float32Array(N)
  for (const s of plan.shots) {
    for (const v of s.voice) {
      let t = s.at + v.at
      for (const w of v.words) {
        const c = clips[w]
        if (!c) continue
        const [off, dur] = c
        const a = Math.round(off * SR), len = Math.round(dur * SR), at = Math.round(t * SR), f = Math.round(0.008 * SR)
        for (let k = 0; k < len; k++) {
          const g = Math.min(1, k / f, (len - k) / f)
          if (at + k >= 0 && at + k < N && a + k < pcm.length) mono[at + k] += pcm[a + k] * g
        }
        t += dur + 0.15
      }
    }
  }
  for (let k = 0; k < N; k++) {
    const v = pres.tick(hp.tick(mono[k])) * 1.25
    voiceBus.l[k] = v
    voiceBus.r[k] = v
  }
}
log('co-driver placed')

// Music, written against the edit.
const cues: Cue[] = []
plan.shots.forEach((s, i) => {
  for (const m of s.marks) cues.push({ t: s.at + m.at, kind: m.kind })
  if (s.out.type === 'fadeblack' && i < plan.shots.length - 1) cues.push({ t: plan.shots[i + 1].at + s.out.dur / 2, kind: 'dip' })
  if (s.title !== null) cues.push({ t: s.at + s.title, kind: 'title' })
})
const score = renderMusic(LEN, BPM, cues)
log('music done')

// Sidechain: the music gives way to the co-driver and to big moments in the car sound.
const level = (b: Stereo, k: number) => Math.abs(b.l[k]) + Math.abs(b.r[k])
const duck = new Float32Array(N)
{
  let fxEnv = 0, vEnv = 0
  const att = Math.exp(-1 / (0.008 * SR)), rel = Math.exp(-1 / (0.35 * SR))
  for (let k = 0; k < N; k++) {
    const f = level(fxBus, k), v = level(voiceBus, k)
    fxEnv = f > fxEnv ? f + (fxEnv - f) * att : f + (fxEnv - f) * rel
    vEnv = v > vEnv ? v + (vEnv - v) * att : v + (vEnv - v) * rel
    const fxDb = 20 * Math.log10(fxEnv + 1e-9)
    // Over -12 dBFS of car sound the music comes down, up to 6 dB.
    const a = Math.min(6, Math.max(0, (fxDb + 12) * 0.6))
    const b = vEnv > 0.02 ? 7 : 0
    duck[k] = dbToGain(-Math.max(a, b))
  }
}

const mix = stereo(N)
const MUSIC = dbToGain(-5.5), FX = dbToGain(-1), VOICE = dbToGain(-2)
for (let k = 0; k < N; k++) {
  mix.l[k] = score.mix.l[k] * MUSIC * duck[k] + fxBus.l[k] * FX + voiceBus.l[k] * VOICE
  mix.r[k] = score.mix.r[k] * MUSIC * duck[k] + fxBus.r[k] * FX + voiceBus.r[k] * VOICE
}

// Glue: a gentle RMS compressor on the whole mix (2:1 above -18 dBFS), then a look-ahead limiter after the loudness gain.
{
  let e = 0
  const a = Math.exp(-1 / (0.01 * SR)), r = Math.exp(-1 / (0.2 * SR))
  for (let k = 0; k < N; k++) {
    const p = (mix.l[k] ** 2 + mix.r[k] ** 2) / 2
    e = p > e ? p + (e - p) * a : p + (e - p) * r
    const db = 10 * Math.log10(e + 1e-12)
    const over = Math.max(0, db + 18)
    const g = dbToGain(-over * 0.5)
    mix.l[k] *= g
    mix.r[k] *= g
  }
}

function writeWav(path: string, b: Stereo, gain: number): void {
  const n = b.l.length
  const buf = Buffer.alloc(44 + n * 8)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 8, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20) // IEEE float
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 8, 28)
  buf.writeUInt16LE(8, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 8, 40)
  for (let k = 0; k < n; k++) {
    buf.writeFloatLE(b.l[k] * gain, 44 + k * 8)
    buf.writeFloatLE(b.r[k] * gain, 48 + k * 8)
  }
  writeFileSync(path, buf)
}

/** Brick-wall limiter with 5 ms look-ahead and 4x interpolated peak detection, so true peaks stay under the ceiling. */
function limit(b: Stereo, gain: number, ceilDb: number): Stereo {
  const n = b.l.length
  const ceil = dbToGain(ceilDb)
  const look = Math.round(0.005 * SR)
  const need = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    let p = 0
    for (const ch of [b.l, b.r]) {
      const x0 = ch[k] * gain, x1 = (ch[k + 1] ?? ch[k]) * gain
      for (let q = 0; q < 4; q++) p = Math.max(p, Math.abs(x0 + (x1 - x0) * (q / 4)))
    }
    need[k] = p > ceil ? ceil / p : 1
  }
  // Minimum over the look-ahead window, then smoothed: gain falls before the peak arrives and recovers slowly.
  const out = stereo(n)
  let g = 1
  const rel = Math.exp(-1 / (0.08 * SR))
  const win: number[] = []
  for (let k = 0; k < n + look; k++) {
    if (k < n) {
      while (win.length && need[win[win.length - 1]] >= need[k]) win.pop()
      win.push(k)
    }
    const j = k - look
    if (j < 0) continue
    while (win.length && win[0] < j) win.shift()
    const target = win.length ? need[win[0]] : 1
    g = target < g ? target : target + (g - target) * rel
    out.l[j] = b.l[j] * gain * g
    out.r[j] = b.r[j] * gain * g
  }
  return out
}

function loudness(path: string): { I: number; TP: number; LRA: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'loudnorm=I=-14:TP=-1.5:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' })
  const j = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{'))) as Record<string, string>
  return { I: Number(j.input_i), TP: Number(j.input_tp), LRA: Number(j.input_lra) }
}

writeWav(join(work, 'mix.wav'), mix, 1)
// Master to -14 LUFS integrated with true peaks at most -1.5 dBTP: gain, limit, measure, repeat.
let gainDb = -14 - loudness(join(work, 'mix.wav')).I
let master = limit(mix, dbToGain(gainDb), -1.6)
for (let it = 0; it < 4; it++) {
  writeWav(join(work, 'master.wav'), master, 1)
  const m = loudness(join(work, 'master.wav'))
  log(`master pass ${it + 1}: ${m.I.toFixed(2)} LUFS, ${m.TP.toFixed(2)} dBTP, LRA ${m.LRA.toFixed(1)} LU`)
  if (Math.abs(m.I + 14) < 0.2) break
  gainDb += -14 - m.I
  master = limit(mix, dbToGain(gainDb), -1.6)
}

// Clicks: the largest sample-to-sample step around every edit, against the loudest step anywhere.
{
  let global = 0
  for (let k = 1; k < N; k++) global = Math.max(global, Math.abs(master.l[k] - master.l[k - 1]), Math.abs(master.r[k] - master.r[k - 1]))
  let worst = 0, at = 0
  for (const c of cuts) {
    for (let k = Math.max(1, Math.round((c - 0.02) * SR)); k < Math.min(N, Math.round((c + 0.02) * SR)); k++) {
      const j = Math.max(Math.abs(master.l[k] - master.l[k - 1]), Math.abs(master.r[k] - master.r[k - 1]))
      if (j > worst) {
        worst = j
        at = c
      }
    }
  }
  let peak = 0, nan = 0
  for (let k = 0; k < N; k++) {
    if (!Number.isFinite(master.l[k]) || !Number.isFinite(master.r[k])) nan++
    peak = Math.max(peak, Math.abs(master.l[k]), Math.abs(master.r[k]))
  }
  log(`edit points: largest step ${worst.toFixed(4)} (at ${at.toFixed(2)} s) vs largest anywhere ${global.toFixed(4)}; sample peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS; non-finite samples ${nan}`)
  writeFileSync(join(work, 'audio-report.json'), JSON.stringify({ edits: worst, global, peakDb: 20 * Math.log10(peak), nan }))
}
log('wrote master.wav')
