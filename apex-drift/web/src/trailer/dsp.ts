/**
 * Small offline DSP kit for the trailer soundtrack and sound design. Plain
 * arrays in, plain arrays out; nothing here runs in the game.
 */

export const SR = 48000
export const TAU = Math.PI * 2

/** Deterministic white noise. */
export function noiseGen(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a ^= a << 13
    a >>>= 0
    a ^= a >>> 17
    a ^= a << 5
    a >>>= 0
    return (a / 4294967296) * 2 - 1
  }
}

/** RBJ biquad, direct form I. Coefficients can be changed between samples. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0

  set(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', f: number, q = 0.707, gainDb = 0): this {
    const w = (TAU * Math.min(Math.max(f, 10), SR * 0.45)) / SR
    const c = Math.cos(w), s = Math.sin(w)
    const alpha = s / (2 * q)
    const A = Math.pow(10, gainDb / 40)
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha }
    else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha }
    else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A }
    else {
      const sq = 2 * Math.sqrt(A) * alpha
      if (type === 'lowshelf') {
        b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq)
        a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq
      } else {
        b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq)
        a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
    return this
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x
    this.y2 = this.y1; this.y1 = Math.abs(y) < 1e-20 ? 0 : y
    return this.y1
  }

  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.tick(buf[i])
    return buf
  }
}

/** One-pole low-pass with a cutoff that may move every sample. */
export class OnePole {
  y = 0
  tick(x: number, f: number): number {
    const a = 1 - Math.exp((-TAU * f) / SR)
    this.y += (x - this.y) * a
    return this.y
  }
}

/** Stereo buffer pair. */
export interface Stereo {
  l: Float32Array
  r: Float32Array
}

export const stereo = (n: number): Stereo => ({ l: new Float32Array(n), r: new Float32Array(n) })

/** Equal-power pan: -1 left … +1 right. */
export function panGains(p: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4
  return [Math.cos(a), Math.sin(a)]
}

/** Freeverb-style stereo reverb: eight damped combs into four allpasses per side. */
export class Reverb {
  private readonly combs: { buf: Float32Array; i: number; store: number }[][]
  private readonly alls: { buf: Float32Array; i: number }[][]
  constructor(private readonly room = 0.84, private readonly damp = 0.3) {
    const C = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
    const A = [556, 441, 341, 225]
    const k = SR / 44100
    this.combs = [0, 23].map((sp) => C.map((n) => ({ buf: new Float32Array(Math.round((n + sp) * k)), i: 0, store: 0 })))
    this.alls = [0, 23].map((sp) => A.map((n) => ({ buf: new Float32Array(Math.round((n + sp) * k)), i: 0 })))
  }

  /** Adds the reverberated `input` (mono send) into out. */
  process(input: Float32Array, out: Stereo, wet: number): void {
    for (let s = 0; s < input.length; s++) {
      const x = input[s] * 0.015
      for (let ch = 0; ch < 2; ch++) {
        let y = 0
        for (const c of this.combs[ch]) {
          const o = c.buf[c.i]
          c.store = o * (1 - this.damp) + c.store * this.damp
          c.buf[c.i] = x + c.store * this.room
          if (++c.i >= c.buf.length) c.i = 0
          y += o
        }
        for (const a of this.alls[ch]) {
          const o = a.buf[a.i]
          a.buf[a.i] = y + o * 0.5
          if (++a.i >= a.buf.length) a.i = 0
          y = o - y
        }
        ;(ch ? out.r : out.l)[s] += y * wet
      }
    }
  }
}

/** Percussive envelope: linear attack, exponential decay to silence. */
export function env(t: number, attack: number, decay: number): number {
  if (t < 0) return 0
  if (t < attack) return t / attack
  return Math.exp(-(t - attack) / decay)
}

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

/** Raised-cosine fade weights for crossfades: equal power when `power`. */
export function fadeIn(u: number, power = true): number {
  const x = Math.max(0, Math.min(1, u))
  return power ? Math.sin((x * Math.PI) / 2) : 0.5 - 0.5 * Math.cos(x * Math.PI)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}
