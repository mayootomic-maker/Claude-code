import { Biquad, env, midiHz, noiseGen, Reverb, SR, stereo, TAU, type Stereo } from './dsp'

/**
 * An original driving score for the trailer, synthesised from nothing: the
 * game's own chords (D major, the Bm7 - Gmaj7 - Dmaj9 - A6sus colours of its
 * menu music) turned into a pulse-driven cue. It is written against the
 * edit: a tension intro over the grid, the drop exactly on the launch, a
 * filter dip and a hit on every dip to black, a lead line for the finish,
 * and a resolve under the title.
 */

export interface Cue {
  t: number
  kind: 'go' | 'dip' | 'finish' | 'title'
}

const CHORDS = [
  [47, 59, 62, 66, 69], // Bm7
  [43, 55, 59, 62, 66], // Gmaj7
  [50, 57, 62, 66, 69], // Dmaj9 (no 3rd doubled)
  [45, 57, 62, 64, 66], // A6sus
]
const LEAD = [
  [78, 76, 74, 76],
  [74, 71, 74, 79],
  [78, 74, 69, 74],
  [76, 73, 76, 81],
]

export interface Score {
  mix: Stereo
  /** Kick envelope, for the sidechain pump and for reporting. */
  kick: Float32Array
}

export function renderMusic(len: number, bpm: number, cues: Cue[]): Score {
  const N = Math.ceil(len * SR)
  const beat = 60 / bpm
  const go = cues.find((c) => c.kind === 'go')?.t ?? 4
  const finish = cues.find((c) => c.kind === 'finish')?.t ?? len - 8
  const titleT = cues.find((c) => c.kind === 'title')?.t ?? len - 4
  const dips = cues.filter((c) => c.kind === 'dip').map((c) => c.t)
  const lastDip = dips.length ? dips[dips.length - 1] : finish
  // Bar grid anchored on the launch; bar index can be negative in the intro.
  const barOf = (t: number) => Math.floor((t - go) / (beat * 4))
  const chordAt = (t: number) => CHORDS[((barOf(t) % 4) + 4) % 4]
  const end = finish + beat * 4 * 2 // drums play two bars past the finish, then the outro

  const drums = stereo(N), music = stereo(N), hits = stereo(N)
  const kickEnv = new Float32Array(N)
  const send = new Float32Array(N)
  const rnd = noiseGen(4242)

  const add = (buf: Float32Array, i: number, v: number) => {
    if (i >= 0 && i < N) buf[i] += v
  }
  const addSt = (b: Stereo, i: number, v: number, pan = 0) => {
    if (i < 0 || i >= N) return
    b.l[i] += v * (1 - Math.max(0, pan))
    b.r[i] += v * (1 + Math.min(0, pan))
  }
  /** No drums in the two beats before a dip to black: the hit lands on silence. */
  const quiet = (t: number) => dips.some((d) => t > d - beat * 2 - 0.01 && t < d - 0.01)

  // ---- drums ---------------------------------------------------------------
  const kick = (t0: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    let ph = 0
    for (let n = 0; n < 0.5 * SR; n++) {
      const t = n / SR
      ph += (TAU * (44 + 80 * Math.exp(-t / 0.032))) / SR
      const v = (Math.sin(ph) * env(t, 0.002, 0.17) + rnd() * Math.exp(-t / 0.003) * 0.25) * vel
      addSt(drums, i0 + n, v)
      add(kickEnv, i0 + n, env(t, 0.004, 0.13) * vel)
    }
  }
  const snare = (t0: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    const hp = new Biquad().set('hp', 1600, 0.7)
    for (let n = 0; n < 0.4 * SR; n++) {
      const t = n / SR
      const v = (Math.sin(TAU * 185 * t) * Math.exp(-t / 0.05) * 0.45 + hp.tick(rnd()) * Math.exp(-t / 0.11) * 0.9) * vel
      addSt(drums, i0 + n, v)
      add(send, i0 + n, v * 0.35)
    }
  }
  const hat = (t0: number, vel: number, open: boolean, pan: number) => {
    const i0 = Math.round(t0 * SR)
    const hp = new Biquad().set('hp', 7500, 0.8)
    const dec = open ? 0.22 : 0.028
    for (let n = 0; n < dec * 6 * SR; n++) addSt(drums, i0 + n, hp.tick(rnd()) * Math.exp(-n / SR / dec) * vel, pan)
  }
  const crash = (t0: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    const hl = new Biquad().set('hp', 3200, 0.6), hr = new Biquad().set('hp', 3300, 0.6)
    const rr = noiseGen(77 + i0)
    for (let n = 0; n < 3 * SR; n++) {
      const e = env(n / SR, 0.003, 1.1) * vel
      if (i0 + n >= N) break
      hits.l[i0 + n] += hl.tick(rnd()) * e
      hits.r[i0 + n] += hr.tick(rr()) * e
    }
  }
  const boom = (t0: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    let ph = 0
    const lp = new Biquad().set('lp', 220, 0.7)
    for (let n = 0; n < 3 * SR; n++) {
      const t = n / SR
      ph += (TAU * (30 + 32 * Math.exp(-t / 0.25))) / SR
      const v = (Math.sin(ph) * env(t, 0.004, 0.9) + lp.tick(rnd()) * env(t, 0.002, 0.25) * 1.6) * vel
      addSt(hits, i0 + n, v)
      add(send, i0 + n, v * 0.25)
    }
  }
  const riser = (t0: number, t1: number, vel: number) => {
    const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR)
    const bp = new Biquad()
    let ph = 0
    for (let i = Math.max(0, i0); i < Math.min(N, i1); i++) {
      const u = (i - i0) / (i1 - i0)
      if (i % 32 === 0) bp.set('bp', 300 * Math.pow(25, u), 2.2)
      ph += (TAU * midiHz(54 + u * 12)) / SR
      const saw = ((ph / TAU) % 1) * 2 - 1
      const v = (bp.tick(rnd()) * 1.4 + saw * 0.05 * u) * u * u * vel
      hits.l[i] += v
      hits.r[i] += v
      send[i] += v * 0.4
    }
  }

  const firstBeat = Math.ceil((0 - go) / beat)
  for (let b = firstBeat; ; b++) {
    const t = go + b * beat
    if (t >= Math.min(len, end)) break
    if (t < 0) continue
    const inBar = ((b % 4) + 4) % 4
    if (t < go) {
      // Heartbeat in the last two bars before the launch, louder as it nears.
      if (t > go - beat * 8) kick(t, 0.35 + 0.35 * (1 - (go - t) / (beat * 8)))
      continue
    }
    if (quiet(t)) continue
    const big = t >= lastDip
    kick(t, 0.95)
    if (inBar === 1 || inBar === 3) snare(t, big ? 0.7 : 0.6)
    for (let s = 0; s < 2; s++) hat(t + s * beat / 2, s ? 0.16 : 0.08, s === 1 && inBar === 3, s ? 0.25 : -0.2)
    if (big) for (const s of [1, 3]) hat(t + (s * beat) / 4, 0.06, false, 0.4)
  }
  crash(go, 0.32)
  boom(go, 0.85)
  riser(go - beat * 8, go, 0.5)
  for (const d of dips) {
    boom(d, 0.9)
    crash(d, 0.26)
    riser(d - beat * 4, d - beat * 2, 0.25)
  }
  boom(finish, 1.0)
  crash(finish, 0.4)

  // ---- bass, pad, arpeggio, lead --------------------------------------------
  const bassNote = (m: number, t0: number, dur: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    const lp = new Biquad()
    let ph = 0, sub = 0
    for (let n = 0; n < (dur + 0.05) * SR; n++) {
      const t = n / SR
      if (n % 16 === 0) lp.set('lp', 220 + 900 * Math.exp(-t / 0.09), 0.9)
      ph += midiHz(m) / SR
      sub += (TAU * midiHz(m)) / SR
      const saw = (ph % 1) * 2 - 1
      const a = Math.min(1, t / 0.004) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.05) : 1)
      addSt(music, i0 + n, (lp.tick(saw) * 0.6 + Math.sin(sub) * 0.55) * a * vel)
    }
  }
  const padChord = (notes: number[], t0: number, dur: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    const lp = new Biquad().set('lp', 1900, 0.6)
    const lp2 = new Biquad().set('lp', 1900, 0.6)
    const phs = notes.flatMap(() => [rnd(), rnd(), rnd()])
    const rel = 0.9
    for (let n = 0; n < (dur + rel) * SR; n++) {
      const t = n / SR
      const a = Math.min(1, t / 0.5) * (t > dur ? Math.max(0, 1 - (t - dur) / rel) : 1)
      let l = 0, r = 0
      notes.forEach((m, k) => {
        for (let d = 0; d < 3; d++) {
          const j = k * 3 + d
          phs[j] += (midiHz(m) * Math.pow(2, ((d - 1) * 9) / 1200)) / SR
          const saw = (phs[j] % 1) * 2 - 1
          if (d === 0) l += saw
          else if (d === 2) r += saw
          else { l += saw * 0.5; r += saw * 0.5 }
        }
      })
      if (i0 + n >= N) break
      if (i0 + n < 0) continue
      music.l[i0 + n] += lp.tick(l) * a * vel
      music.r[i0 + n] += lp2.tick(r) * a * vel
      send[i0 + n] += (l + r) * a * vel * 0.05
    }
  }
  const pluck = (m: number, t0: number, vel: number, pan: number) => {
    const i0 = Math.round(t0 * SR)
    for (let n = 0; n < 0.9 * SR; n++) {
      const t = n / SR
      const v = (Math.sin(TAU * midiHz(m) * t) + Math.sin(TAU * midiHz(m + 12) * t) * 0.25 * Math.exp(-t / 0.08)) * env(t, 0.004, 0.22) * vel
      addSt(music, i0 + n, v, pan)
      // Dotted-eighth echo, opposite side.
      addSt(music, i0 + n + Math.round(beat * 0.75 * SR), v * 0.35, -pan)
      add(send, i0 + n, v * 0.3)
    }
  }
  const leadNote = (m: number, t0: number, dur: number, vel: number) => {
    const i0 = Math.round(t0 * SR)
    const lp = new Biquad().set('lp', 2600, 0.8)
    let ph = 0
    for (let n = 0; n < (dur + 0.15) * SR; n++) {
      const t = n / SR
      const vib = 1 + Math.sin(TAU * 5.2 * t) * 0.004 * Math.min(1, Math.max(0, t - 0.15) * 4)
      ph += (midiHz(m) * vib) / SR
      const x = ((ph % 1) * 2 - 1) * 0.6 + (ph % 1 < 0.5 ? 0.4 : -0.4)
      const a = Math.min(1, t / 0.02) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.15) : 1)
      const v = lp.tick(x) * a * vel
      addSt(music, i0 + n, v, 0.1)
      add(send, i0 + n, v * 0.5)
    }
  }

  // Intro pad from the first frame, then a chord a bar from the launch on.
  padChord(CHORDS[0], 0, Math.max(0.5, go - 0.05), 0.05)
  for (let bar = 0; ; bar++) {
    const t = go + bar * beat * 4
    if (t >= finish + beat * 4) break
    const ch = chordAt(t + 0.01)
    padChord(ch.slice(1), t, beat * 4 - 0.05, 0.035)
    for (let e = 0; e < 8; e++) {
      const te = t + (e * beat) / 2
      if (quiet(te) || te > end) continue
      bassNote(ch[0] - 12 + (e % 4 === 3 ? 12 : 0), te, beat / 2 - 0.04, 0.32)
    }
    const tones = ch.slice(1).map((m) => m + 12)
    const pat = [0, 1, 2, 3, 1, 2, 3, 1, 0, 1, 2, 3, 1, 2, 3, 2]
    for (let e = 0; e < 16; e++) {
      const te = t + (e * beat) / 4
      if (te > end) continue
      pluck(tones[pat[e] % tones.length], te, e % 4 === 0 ? 0.07 : 0.045, e % 2 ? 0.35 : -0.35)
    }
    if (t >= lastDip - 0.01 && t < finish) {
      const line = LEAD[((barOf(t + 0.01) % 4) + 4) % 4]
      line.forEach((m, q) => leadNote(m, t + q * beat, beat * 0.9, 0.09))
    }
  }
  // Outro: resolve to D major under the title, a slow arpeggio rising into it.
  const outro = finish + beat * 4
  padChord([50, 57, 62, 66, 69, 74], outro, Math.max(1, len - outro - 1), 0.04)
  bassNote(38, outro, Math.max(1, len - outro - 1.2), 0.3)
  ;[62, 66, 69, 74, 78, 81].forEach((m, k) => pluck(m, titleT - 1.2 + k * beat / 2, 0.08, k % 2 ? 0.4 : -0.4))
  boom(titleT, 0.55)

  // ---- filter automation, sidechain, reverb -----------------------------------
  // Opens from muffled to full over the intro; ducks to a murmur in the bar before each dip.
  const cutoff = (t: number) => {
    let f = t < go ? 300 * Math.pow(60, Math.max(0, t / go) ** 2) : 18000
    for (const d of dips) {
      if (t > d - beat * 4 && t < d) f = Math.min(f, 18000 * Math.pow(0.03, (t - (d - beat * 4)) / (beat * 4)))
      else if (t >= d && t < d + 0.25) f = Math.min(f, 600 + (t - d) * 4 * 17400)
    }
    if (t > outro) f = Math.min(f, 18000 * Math.pow(0.12, Math.min(1, (t - outro) / 3)))
    return f
  }
  const fl = new Biquad(), fr = new Biquad()
  for (let i = 0; i < N; i++) {
    if (i % 32 === 0) {
      const f = cutoff(i / SR)
      fl.set('lp', f, 0.75)
      fr.set('lp', f, 0.75)
    }
    // Pads and bass breathe with the kick.
    const pump = 1 - Math.min(0.45, kickEnv[i] * 0.45)
    music.l[i] = fl.tick(music.l[i] * pump)
    music.r[i] = fr.tick(music.r[i] * pump)
  }
  const mix = stereo(N)
  for (let i = 0; i < N; i++) {
    mix.l[i] = music.l[i] + drums.l[i] * 0.9 + hits.l[i]
    mix.r[i] = music.r[i] + drums.r[i] * 0.9 + hits.r[i]
  }
  new Reverb(0.86, 0.35).process(send, mix, 0.9)
  // The end of the timeline fades to nothing with the picture.
  const fade = Math.round(1.6 * SR)
  for (let i = Math.max(0, N - fade); i < N; i++) {
    const g = (N - i) / fade
    mix.l[i] *= g * g
    mix.r[i] *= g * g
  }
  return { mix, kick: kickEnv }
}
