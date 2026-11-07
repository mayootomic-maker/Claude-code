import { voicingFor, type EngineProfile } from './engines'

/**
 * The whole car, synthesised sample by sample: a firing-pulse engine (exhaust,
 * intake, turbo, pops, limiter, gearbox) on output 0 and the chassis (surface,
 * stones, squeal, splash, wind) on output 1. It runs inside an AudioWorklet in
 * the game and in plain Node under tests, so it touches nothing but numbers,
 * and it allocates nothing after construction: the audio thread must never GC.
 *
 * Inputs arrive once per 128-frame block and from a 60 Hz game loop, so every
 * one of them is smoothed and every gain is ramped sample by sample across the
 * block. A value that steps at a block edge is a click 375 times a second.
 */

/** Inputs, written once per 128-frame block. Order is the AudioParam order. */
export const ENGINE_PARAMS = [
  'rpm', 'throttle', 'load', 'boost', 'gear', 'shifting', 'speed',
  // camera mix
  'exhaust', 'intake', 'whine', 'muffle', 'cabin',
  // chassis
  'crunch', 'crunchFreq', 'grain', 'stones', 'stoneGain', 'rumble', 'clunk', 'hiss', 'squeal', 'squealFreq', 'splash', 'squelch', 'wind',
] as const
export type EngineParam = (typeof ENGINE_PARAMS)[number]
export type EngineInputs = Record<EngineParam, number>

export function defaultInputs(): EngineInputs {
  const o = {} as EngineInputs
  for (const k of ENGINE_PARAMS) o[k] = 0
  o.exhaust = 1
  o.intake = 0.6
  o.whine = 0.5
  o.muffle = 18000
  o.crunchFreq = 1000
  o.squealFreq = 1100
  return o
}

const TAU = Math.PI * 2
const TABLE = 512
const RATIOS = [1.6, 3.3, 2.3, 1.75, 1.4, 1.15, 0.95, 0.85]
/** Below this a decaying state is flushed to zero: denormals are slow enough to glitch the audio thread. */
const TINY = 1e-12

/** Cytomic TPT state-variable filter: stable under fast modulation, three outputs per tick. */
class SVF {
  private c1 = 0
  private c2 = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  k = 1
  lp = 0
  bp = 0
  hp = 0
  constructor(private readonly sr: number) {}
  set(f: number, q: number): void {
    const g = Math.tan((Math.PI * Math.min(Math.max(f, 10), this.sr * 0.45)) / this.sr)
    this.k = 1 / q
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  tick(x: number): void {
    const v3 = x - this.c2
    const v1 = this.a1 * this.c1 + this.a2 * v3
    const v2 = this.c2 + this.a2 * this.c1 + this.a3 * v3
    this.c1 = 2 * v1 - this.c1
    this.c2 = 2 * v2 - this.c2
    this.lp = v2
    this.bp = v1
    this.hp = x - this.k * v1 - v2
  }
  /** Band-pass with unity gain at the centre (raw bp peaks at Q). */
  get bpn(): number {
    return this.bp * this.k
  }
  flush(): void {
    if (Math.abs(this.c1) < TINY) this.c1 = 0
    if (Math.abs(this.c2) < TINY) this.c2 = 0
  }
  reset(): void {
    this.c1 = this.c2 = this.lp = this.bp = this.hp = 0
  }
}

/**
 * Two-pole resonator: stones on the floorpan, suspension knocks. It is struck
 * with a short raised-cosine push rather than a single-sample impulse, which
 * keeps the ping of a stone and loses the digital tick in front of it.
 */
class Ring {
  private y1 = 0
  private y2 = 0
  private c1 = 0
  private c2 = 0
  private exc = 0
  private excN = 0
  private excI = 0
  constructor(private readonly sr: number) {}
  get level(): number {
    return Math.abs(this.y1) + Math.abs(this.y2) + (this.excI < this.excN ? Math.abs(this.exc) : 0)
  }
  strike(f: number, decay: number, a: number, softness: number): void {
    const w = (TAU * Math.min(f, this.sr * 0.4)) / this.sr
    const r = Math.exp(-1 / (decay * this.sr))
    this.c1 = 2 * r * Math.cos(w)
    this.c2 = r * r
    // Spread the strike over at least half a period, so it never excites above the ring itself.
    this.excN = Math.max(4, Math.round(Math.max(softness * this.sr, (0.5 * this.sr) / f)))
    this.excI = 0
    this.exc = (a * Math.sin(w)) / this.excN
  }
  tick(): number {
    let x = 0
    if (this.excI < this.excN) {
      x = this.exc * (1 - Math.cos((TAU * (this.excI + 0.5)) / this.excN))
      this.excI++
    }
    const y = this.c1 * this.y1 - this.c2 * this.y2 + x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
  flush(): void {
    if (Math.abs(this.y1) < TINY && Math.abs(this.y2) < TINY) this.y1 = this.y2 = 0
  }
}

/**
 * One exhaust bang: a crisp crack of high noise, a resonant body, and a falling
 * low thud. Each part is a difference of two decaying exponentials, so it rises
 * over a fraction of a millisecond instead of jumping, and re-firing a voice that
 * is still sounding adds to it rather than cutting it off: no part ever steps.
 */
class Pop {
  private bd = 0
  private ba = 0
  private cd = 0
  private ca = 0
  private ld = 0
  private la = 0
  private bDec = 0
  private cDec = 0
  private lDec = 0
  private readonly bAtk: number
  private readonly cAtk: number
  private readonly lAtk: number
  private ph = 0
  private dph = 0
  private readonly f: SVF
  constructor(private readonly sr: number) {
    this.f = new SVF(sr)
    this.bAtk = Math.exp(-1 / (0.0007 * sr))
    this.cAtk = Math.exp(-1 / (0.00035 * sr))
    this.lAtk = Math.exp(-1 / (0.0025 * sr))
  }
  get level(): number {
    return this.bd + this.cd + this.ld
  }
  fire(strength: number, big: boolean, r1: number, r2: number): void {
    const sr = this.sr
    this.f.set(big ? 110 + r1 * 240 : 300 + r1 * 1100, big ? 1.4 : 2.2)
    this.bDec = Math.exp(-1 / ((big ? 0.05 + r2 * 0.06 : 0.012 + r2 * 0.02) * sr))
    this.cDec = Math.exp(-1 / ((big ? 0.006 : 0.003) * sr))
    this.lDec = Math.exp(-1 / ((big ? 0.09 : 0.025) * sr))
    const b = strength * 1.5, c = strength * (big ? 1.2 : 0.8), l = strength * (big ? 1.5 : 0.35)
    this.bd += b
    this.ba += b
    this.cd += c
    this.ca += c
    this.ld += l
    this.la += l
    // The thud's phase runs on: restarting it at zero would step the waveform.
    this.dph = (big ? 55 + r2 * 40 : 95 + r1 * 70) / sr
  }
  tick(noise: number, hiss: number): number {
    if (this.bd + this.cd + this.ld < 1e-5) {
      this.bd = this.ba = this.cd = this.ca = this.ld = this.la = 0
      return 0
    }
    this.f.tick(noise)
    const y = (this.bd - this.ba) * this.f.bpn * 2.2 + (this.cd - this.ca) * hiss + (this.ld - this.la) * Math.sin(TAU * this.ph)
    this.ph += this.dph
    if (this.ph >= 1) this.ph -= 1
    this.dph *= 0.99996
    this.bd *= this.bDec
    this.ba *= this.bAtk
    this.cd *= this.cDec
    this.ca *= this.cAtk
    this.ld *= this.lDec
    this.la *= this.lAtk
    return y
  }
  flush(): void {
    this.f.flush()
  }
}

/** Rational tanh: accurate to ~2% and an order of magnitude cheaper than Math.tanh. */
function sat(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

const smooth = (from: number, to: number, k: number): number => from + (to - from) * k
const sstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

// Gains computed once per block and ramped sample by sample across it.
const G_EX = 0, G_IN = 1, G_DRIVE = 2, G_NORM = 3, G_BODY = 4, G_PIPE = 5, G_RASP = 6, G_TW = 7, G_GW = 8, G_CAB = 9, G_BOV = 10, G_FLUT = 11, G_HONK = 12
const GAINS = 13

export class EngineDSP {
  readonly in: EngineInputs = defaultInputs()
  private readonly sr: number
  private readonly n: number
  private readonly fire: Float64Array
  private readonly cylAmp: Float64Array
  private readonly amp: Float64Array
  private readonly lastD: Float64Array
  private readonly width: number
  private readonly widthIn: number
  private readonly table = new Float32Array(TABLE + 2)
  private readonly profile: EngineProfile
  private readonly v: ReturnType<typeof voicingFor>
  private readonly cur = new Float64Array(GAINS)
  private readonly tgt = new Float64Array(GAINS)

  // random
  private seed = 0x2f6b9a1d

  // smoothed state
  private rpm: number
  private rpmS: number
  private rpmTarget: number
  private dt = 0.003
  private thr = 0
  private thrPeak = 0
  private loadS = 0
  private boostS = 0
  private boostHeld = 0
  private lifted = true
  private liftAge = 10
  private alsTime = 0
  private shiftCut = 0
  private blip = 0
  private lastGear = 0
  private limPhase = 0
  private limCut = false
  private idlePh = 0
  private phase = 0

  // per-block derived
  private comb = 0.3
  private jitter = 0.1
  private popP = 0
  private bangP = 0
  private rough = 0.3

  // engine filters
  private dc = 0
  private dcX = 0
  private hiLp = 0
  private readonly exTone: SVF
  private readonly exBody: SVF
  private readonly exPipe: SVF
  private readonly raspF: SVF
  private readonly muffle: SVF
  private readonly inF: SVF
  private readonly honkF: SVF
  private readonly cabF: SVF
  private readonly bovF: SVF
  private readonly flF: SVF
  private readonly twN: SVF
  private readonly pops: Pop[] = []

  // turbo
  private twC = 1
  private twS = 0
  private twF = 2000
  private bov = 0
  private bovAge = 1
  private flut = 0
  private flPh = 0
  // gearbox
  private gwC = 1
  private gwS = 0
  private gwF = 100

  // chassis
  private readonly crF: SVF
  private readonly rumF: SVF
  private readonly hisF: SVF
  private readonly sqF: SVF
  private readonly spF: SVF
  private readonly muF: SVF
  private readonly wiF: SVF
  private readonly rings: Ring[] = []
  private readonly clunkR: Ring
  private grainD = 0
  private grainA = 0
  private grainLeft = Infinity
  private stoneLeft = Infinity
  private clunkLeft = Infinity
  private grainRate = 0
  private stoneRate = 0
  private clunkRate = 0
  private readonly grainDec: number
  private readonly grainAtk: number
  private sqPh = 0
  private spMod = 0.5
  private spTarget = 0.5
  private spClock = 0
  private slurpAge = 1
  private readonly ch: EngineInputs = defaultInputs()
  // Fixed lists, built once: allocating one per block would feed the garbage collector on the audio thread.
  private readonly engFilters: SVF[]
  private readonly chFilters: SVF[]

  constructor(profile: EngineProfile, sampleRate: number) {
    this.profile = profile
    this.sr = sampleRate
    const v = voicingFor(profile)
    this.v = v
    this.n = v.fire.length
    this.fire = Float64Array.from(v.fire)
    this.cylAmp = Float64Array.from(v.amp)
    this.amp = new Float64Array(this.n).fill(0.5)
    this.lastD = new Float64Array(this.n).fill(719)
    this.width = v.width
    this.widthIn = v.width * 1.5
    this.rpm = this.rpmS = this.rpmTarget = profile.idle
    // An exhaust pressure pulse: near-instant blowdown, exponential decay, then
    // the rarefaction that follows it down the pipe. The sharp front is what
    // carries the rasp; the negative lobe keeps it from sounding like a click train.
    let peak = 0
    for (let i = 0; i <= TABLE; i++) {
      const u = i / TABLE
      const pos = (1 - Math.exp(-u * 60)) * Math.exp(-u * 6.5) * (1 - u)
      const neg = u > 0.3 ? -0.42 * Math.sin((Math.PI * (u - 0.3)) / 0.7) * Math.exp(-u * 1.2) : 0
      this.table[i] = pos + neg
      peak = Math.max(peak, Math.abs(pos + neg))
    }
    for (let i = 0; i <= TABLE; i++) this.table[i] /= peak
    // A guard sample, so interpolation at the very end of the pulse reads zero.
    this.table[TABLE + 1] = 0
    const sr = sampleRate
    this.exTone = new SVF(sr)
    this.exBody = new SVF(sr)
    this.exPipe = new SVF(sr)
    this.raspF = new SVF(sr)
    this.muffle = new SVF(sr)
    this.inF = new SVF(sr)
    this.honkF = new SVF(sr)
    this.cabF = new SVF(sr)
    this.cabF.set(115, 2.2)
    this.bovF = new SVF(sr)
    this.flF = new SVF(sr)
    this.twN = new SVF(sr)
    for (let i = 0; i < 6; i++) this.pops.push(new Pop(sr))
    this.crF = new SVF(sr)
    this.rumF = new SVF(sr)
    this.rumF.set(130, 0.7)
    this.hisF = new SVF(sr)
    this.hisF.set(3200, 0.7)
    this.sqF = new SVF(sr)
    this.spF = new SVF(sr)
    this.muF = new SVF(sr)
    this.wiF = new SVF(sr)
    for (let i = 0; i < 4; i++) this.rings.push(new Ring(sr))
    this.clunkR = new Ring(sr)
    this.grainDec = Math.exp(-1 / (0.004 * sr))
    this.grainAtk = Math.exp(-1 / (0.0006 * sr))
    this.engFilters = [this.exTone, this.exBody, this.exPipe, this.raspF, this.muffle, this.inF, this.honkF, this.cabF, this.bovF, this.flF, this.twN]
    this.chFilters = [this.crF, this.rumF, this.hisF, this.sqF, this.spF, this.muF, this.wiF]
  }

  private rand(): number {
    let x = this.seed
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.seed = x
    return (x >>> 0) / 4294967296
  }

  private pop(strength: number, big: boolean): void {
    // Take the quietest voice, so a burst of anti-lag never swamps a bang still ringing.
    let best = 0
    for (let i = 1; i < this.pops.length; i++) if (this.pops[i].level < this.pops[best].level) best = i
    this.pops[best].fire(strength, big, this.rand(), this.rand())
  }

  /** Engine into `eng`, chassis into `sfx`; either may be undefined if unconnected. */
  render(eng: Float32Array | undefined, sfx: Float32Array | undefined, frames: number): void {
    this.block(frames / this.sr)
    this.renderEngine(eng, frames)
    this.renderChassis(sfx, frames)
  }

  // --------------------------------------------------------------- control

  private k(tau: number): number {
    return 1 - Math.exp(-this.dt / tau)
  }

  private block(dt: number): void {
    const p = this.profile, inp = this.in, v = this.v, tgt = this.tgt
    this.dt = dt

    // Smooth everything first: the camera mix and chassis cross-fade instead of switching.
    const kc = this.k(0.06)
    const ch = this.ch
    for (let i = 0; i < ENGINE_PARAMS.length; i++) {
      const key = ENGINE_PARAMS[i]
      ch[key] = smooth(ch[key], Number.isFinite(inp[key]) ? inp[key] : 0, kc)
    }

    const rpmIn = Number.isFinite(inp.rpm) ? Math.min(p.redline * 1.2, Math.max(0, inp.rpm)) : p.idle
    const thrIn = Math.min(1, Math.max(0, inp.throttle || 0))
    const prevThr = this.thr
    this.thr = smooth(this.thr, thrIn, this.k(0.025))
    this.thrPeak = Math.max(this.thr, this.thrPeak * Math.exp(-dt / 0.5))
    this.loadS = smooth(this.loadS, Math.min(1, Math.max(-1, inp.load || 0)), this.k(0.04))
    // Spool lag: boost builds slower than it collapses.
    const boostIn = Math.min(1, Math.max(0, inp.boost || 0))
    this.boostS = smooth(this.boostS, boostIn, this.k(boostIn > this.boostS ? 0.12 : 0.05))
    this.boostHeld = Math.max(this.boostS, this.boostHeld * Math.exp(-dt / 0.6))
    const rpmN = sstep(p.idle, p.redline, rpmIn)

    // Gear changes: upshift under load cuts torque and bangs; downshift blips and crackles.
    const gear = Math.round(Number.isFinite(inp.gear) ? inp.gear : 0)
    if (gear !== this.lastGear) {
      if (this.lastGear > 0 && gear > this.lastGear) {
        this.shiftCut = 0.09
        if (this.thrPeak > 0.5 && rpmN > 0.35) this.pop((0.5 + 0.4 * this.thrPeak) * (p.turbo ? 1.15 : 0.85), true)
      } else if (gear > 0 && this.lastGear > gear) {
        this.blip = 1
      }
      this.lastGear = gear
    }
    this.shiftCut = Math.max(0, this.shiftCut - dt)
    this.blip = Math.max(0, this.blip - dt / 0.16)
    const cut = this.shiftCut > 0 || inp.shifting > 0.5
    const blipThr = this.blip > 0 ? Math.sin(Math.PI * Math.min(1, this.blip)) : 0

    // Lift-off: the moment for blow-off, compressor flutter, backfire and anti-lag.
    if (this.thr < 0.25 && prevThr >= 0.25 && this.thrPeak > 0.55 && !this.lifted) {
      this.lifted = true
      this.liftAge = 0
      if (p.turbo && this.boostHeld > 0.3) {
        this.bov = Math.min(1, this.boostHeld * 1.1)
        this.bovAge = 0
        this.flut = this.boostHeld
        this.alsTime = (0.5 + this.boostHeld * 1.3) * Math.min(1.3, v.crackle)
      }
      if (rpmN > 0.5 && this.rand() < (p.turbo ? 0.9 : 0.55)) this.pop(0.75 + 0.4 * this.rand(), true)
    }
    if (this.thr > 0.5) this.lifted = false
    this.liftAge += dt
    this.alsTime = this.thr > 0.5 ? 0 : Math.max(0, this.alsTime - dt)

    // Rev limiter: a hard fuel cut bouncing about 17 times a second.
    const onLimiter = rpmIn >= p.redline - 90 && thrIn > 0.5
    if (onLimiter) {
      this.limPhase = (this.limPhase + dt * 17) % 1
      this.limCut = this.limPhase < 0.42
    } else {
      this.limCut = false
      this.limPhase = 0
    }
    let rpmT = rpmIn
    if (onLimiter) rpmT -= (this.limCut ? this.limPhase / 0.42 : 1 - (this.limPhase - 0.42) / 0.58) * p.redline * 0.03
    // A lumpy, hunting idle.
    const idleish = 1 - sstep(p.idle * 1.15, p.idle * 1.6, rpmIn)
    this.idlePh = (this.idlePh + dt * 1.7) % 1
    rpmT += idleish * (1 - this.thr) * p.idle * 0.03 * Math.sin(TAU * this.idlePh)
    // The game reports rpm at 60 Hz; unsmoothed, the pitch would stair-step every frame.
    this.rpmS = smooth(this.rpmS, Math.max(200, rpmT), this.k(0.012))
    this.rpmTarget = this.rpmS

    const thrEff = cut ? 0.03 : Math.max(this.thr, blipThr)
    const loadP = cut ? 0 : Math.max(0, this.loadS, thrEff * 0.85)
    // Combustion strength sets each exhaust pulse; on overrun only pumping is left.
    this.comb = Math.max(0.2 + 0.8 * loadP, idleish * 0.5)
    if (this.limCut) this.comb = 0.05
    else if (cut) this.comb = 0.12
    this.jitter = v.lump * (0.35 + 0.65 * idleish) + 0.04
    const eventsPerSec = (rpmIn / 120) * this.n + 1

    // Overrun crackle: off throttle at high rpm, strongest just after lift-off.
    const overrun = Math.max(sstep(0.05, 0.4, -this.loadS), (1 - sstep(0.05, 0.2, this.thr)) * (cut ? 0 : 1))
    const crackleRate = (overrun * 22 * sstep(0.3, 0.9, rpmN) * (0.2 + 0.8 * Math.exp(-this.liftAge / 1.4)) + (this.limCut ? 14 : 0) + (this.blip > 0 ? 12 : 0)) * v.crackle
    this.popP = crackleRate / eventsPerSec
    this.bangP = (this.alsTime > 0 ? 9 * Math.min(1, this.alsTime) : 0) / eventsPerSec

    const drive = (1.1 + 4.4 * loadP + 1.8 * rpmN) * v.drive
    tgt[G_DRIVE] = drive
    tgt[G_NORM] = 1 / (0.55 + 0.45 * Math.sqrt(drive))
    this.rough = 0.25 + 0.6 * loadP + 0.25 * idleish
    const turboMuffle = p.turbo ? 0.85 : 1
    tgt[G_EX] = ch.exhaust * (0.32 + 0.68 * (0.25 + 0.75 * loadP) + 0.5 * idleish) * (0.55 + 0.45 * rpmN) * turboMuffle
    // Intake roar opens up with the throttle; a turbo's grows as boost builds.
    tgt[G_IN] = ch.intake * v.roar * (0.06 + 0.94 * thrEff) * (0.3 + 0.7 * rpmN) * (p.turbo ? 0.45 + 0.45 * this.boostS : 1.15)
    tgt[G_HONK] = 0.6 + 0.8 * thrEff
    tgt[G_BODY] = 1.1 - 0.3 * loadP
    tgt[G_PIPE] = 0.4 + 0.75 * loadP
    tgt[G_RASP] = v.rasp * (0.1 + 0.9 * loadP) * (0.35 + 0.65 * rpmN) * 0.55
    this.exTone.set(420 + 2600 * loadP + 1900 * rpmN, 0.8)
    this.exBody.set(v.body * (0.85 + 0.4 * rpmN), 1.3)
    this.exPipe.set(v.pipe * (0.9 + 0.25 * rpmN), v.pipeQ)
    this.raspF.set(1400 + 1600 * rpmN, 0.9)
    this.muffle.set(ch.muffle, 0.75)
    this.inF.set(v.intake + 1500 * thrEff + rpmIn * 0.12, 1.3)
    this.honkF.set(v.honk * (0.8 + 0.6 * rpmN), 3)

    // Turbo: whistle rising with boost; on a lift a falling blow-off and a fluttering surge.
    const twFT = 1100 + 2300 * this.boostS + rpmIn * 0.05
    this.twF = smooth(this.twF, twFT, this.k(0.05))
    this.twN.set(this.twF * 1.3, 2.5)
    tgt[G_TW] = p.turbo ? 0.014 * v.whistle * Math.pow(this.boostS, 1.3) * (0.3 + 0.7 * thrEff) : 0
    this.bovAge += dt
    this.bov *= Math.exp(-dt / 0.26)
    tgt[G_BOV] = this.bov
    this.bovF.set(1300 + 2900 * Math.exp(-this.bovAge / 0.16), 0.9)
    this.flut *= Math.exp(-dt / 0.3)
    // The surge starts once the blow-off has had its moment.
    tgt[G_FLUT] = this.flut * sstep(0.03, 0.09, this.bovAge)
    this.flF.set(1800 + 900 * this.flut, 2.2)

    // Straight-cut whine, pitched by road speed through the gear ratio; loudest on the overrun.
    const ratio = RATIOS[Math.min(RATIOS.length - 1, Math.max(0, Math.abs(gear)))]
    this.gwF = smooth(this.gwF, Math.max(40, Math.abs(Number.isFinite(inp.speed) ? inp.speed : 0) * ratio * 26), this.k(0.03))
    tgt[G_GW] = ch.whine * 0.012 * sstep(1, 25, Math.abs(ch.speed)) * (0.45 + 0.7 * overrun + 0.3 * thrEff)
    tgt[G_CAB] = ch.cabin

    // Chassis filters.
    this.crF.set(ch.crunchFreq, 0.9)
    this.sqPh = (this.sqPh + dt * 5.3) % 1
    this.sqF.set(ch.squealFreq * (1 + 0.035 * Math.sin(TAU * this.sqPh)), 18)
    this.spClock -= dt
    if (this.spClock <= 0) {
      this.spClock = 0.04 + this.rand() * 0.08
      this.spTarget = this.rand()
    }
    this.spMod = smooth(this.spMod, this.spTarget, this.k(0.05))
    this.spF.set(700 + 900 * this.spMod, 0.7)
    this.slurpAge += dt
    if (ch.squelch > 0.002 && this.rand() < dt * 5) this.slurpAge = 0
    this.muF.set(180 + 620 * Math.min(1, this.slurpAge / 0.14), 5)
    this.wiF.set(250 + 900 * Math.min(1, ch.wind * 4), 0.6)
    this.hisF.set(2800 + 1200 * this.spMod, 0.7)
  }

  // --------------------------------------------------------------- engine

  private renderEngine(out: Float32Array | undefined, frames: number): void {
    const n = this.n, table = this.table, sr = this.sr
    const w = this.width, wi = this.widthIn
    const invW = TABLE / w, invWi = TABLE / wi
    const rpm0 = this.rpm
    const rpmStep = (this.rpmTarget - rpm0) / frames
    const dcR = Math.exp((-TAU * 25) / sr)
    const pops = this.pops
    const nPops = pops.length
    const satBias = 0.18, satOff = sat(satBias)
    const cur = this.cur, tgt = this.tgt, inv = 1 / frames
    let ex_ = cur[G_EX], in_ = cur[G_IN], drv = cur[G_DRIVE], nrm = cur[G_NORM], bdy = cur[G_BODY], pip = cur[G_PIPE]
    let rsp = cur[G_RASP], tw = cur[G_TW], gw = cur[G_GW], cab = cur[G_CAB], bov = cur[G_BOV], flt = cur[G_FLUT], hnk = cur[G_HONK]
    const dEx = (tgt[G_EX] - ex_) * inv, dIn = (tgt[G_IN] - in_) * inv, dDrv = (tgt[G_DRIVE] - drv) * inv, dNrm = (tgt[G_NORM] - nrm) * inv
    const dBdy = (tgt[G_BODY] - bdy) * inv, dPip = (tgt[G_PIPE] - pip) * inv, dRsp = (tgt[G_RASP] - rsp) * inv, dTw = (tgt[G_TW] - tw) * inv
    const dGw = (tgt[G_GW] - gw) * inv, dCab = (tgt[G_CAB] - cab) * inv, dBov = (tgt[G_BOV] - bov) * inv, dFlt = (tgt[G_FLUT] - flt) * inv
    const dHnk = (tgt[G_HONK] - hnk) * inv
    const turbo = this.profile.turbo
    const bovFlutter = this.bovAge < 0.16
    const hiK = 0.35
    const flStep = (17 + 5 * this.flut) / sr
    // Phasor oscillators: a rotation per sample instead of a Math.sin.
    const twCw = Math.cos((TAU * this.twF) / sr), twSw = Math.sin((TAU * this.twF) / sr)
    const gwCw = Math.cos((TAU * this.gwF) / sr), gwSw = Math.sin((TAU * this.gwF) / sr)
    let m = 1 / Math.hypot(this.twC, this.twS)
    this.twC *= m
    this.twS *= m
    m = 1 / Math.hypot(this.gwC, this.gwS)
    this.gwC *= m
    this.gwS *= m
    for (let i = 0; i < frames; i++) {
      ex_ += dEx
      in_ += dIn
      drv += dDrv
      nrm += dNrm
      bdy += dBdy
      pip += dPip
      rsp += dRsp
      tw += dTw
      gw += dGw
      cab += dCab
      bov += dBov
      flt += dFlt
      hnk += dHnk
      const rpm = rpm0 + rpmStep * (i + 1)
      this.phase += (rpm * 6) / sr
      if (this.phase >= 720) this.phase -= 720
      let ex = 0, inn = 0
      for (let c = 0; c < n; c++) {
        let d = this.phase - this.fire[c]
        if (d < 0) d += 720
        if (d < this.lastD[c]) this.firing(c)
        this.lastD[c] = d
        // Interpolated table reads: truncating them adds a gritty, rpm-dependent aliasing hash.
        if (d < w) {
          const u = d * invW, j = u | 0
          ex += this.amp[c] * (table[j] + (table[j + 1] - table[j]) * (u - j))
        }
        let di = d - 330
        if (di < 0) di += 720
        if (di < wi) {
          const u = di * invWi, j = u | 0
          inn += this.cylAmp[c] * (table[j] + (table[j + 1] - table[j]) * (u - j))
        }
      }
      const nz = this.rand() * 2 - 1
      // High noise for the cracks of the bangs: crisp, without the DC-to-daylight tick of raw white noise.
      this.hiLp += (nz - this.hiLp) * hiK
      const hiss = nz - this.hiLp
      // DC blocker: the pulse train is mostly positive pressure.
      const hp = ex - this.dcX + dcR * this.dc
      this.dcX = ex
      this.dc = hp
      const raw = hp + nz * Math.abs(ex) * this.rough
      this.exTone.tick(raw)
      this.exBody.tick(raw)
      this.exPipe.tick(raw)
      let popSum = 0
      for (let j = 0; j < nPops; j++) popSum += pops[j].tick(nz, hiss)
      const pre = this.exTone.lp + bdy * this.exBody.bpn + pip * this.exPipe.bpn + popSum * 0.6
      const s = sat(pre * drv + satBias) - satOff
      // Rasp: the hard-driven pipe's top end, the part of a rally car that tears.
      this.raspF.tick(s)
      let e = s * nrm + this.raspF.hp * rsp + popSum * 0.3
      this.muffle.tick(e)
      e = this.muffle.lp * ex_
      // Intake: the pulses, the roar of air chopped by the valves, and the airbox honk.
      this.inF.tick(inn * 0.5 + nz * Math.abs(inn) * 1.4)
      this.honkF.tick(inn)
      let y = e + (this.inF.bpn + this.honkF.bpn * hnk * 0.5) * in_
      if (turbo) {
        // Whistle: a pure tone and its octave, with a little narrow-band air through it.
        this.twN.tick(nz)
        const c = this.twC * twCw - this.twS * twSw
        const sn = this.twS * twCw + this.twC * twSw
        this.twC = c
        this.twS = sn
        let fl = 1
        if (flt > 1e-4) {
          // Compressor surge: smooth "stu-tu-tu" bursts, raised-cosine shaped so they never tick.
          this.flPh += flStep
          if (this.flPh >= 1) this.flPh -= 1
          const g = 0.5 - 0.5 * Math.cos(TAU * this.flPh)
          fl = g * g
          this.flF.tick(nz)
          y += this.flF.bpn * flt * fl * 0.9
        }
        y += tw * (0.45 * sn + 0.1 * sn * c + 1.1 * this.twN.bpn) + tw * 0.6 * flt * fl * sn
        if (bov > 1e-4) {
          this.bovF.tick(nz)
          const bf = bovFlutter ? 0.6 + 0.4 * Math.cos(TAU * 24 * (this.bovAge + i / sr)) : 1
          y += this.bovF.bpn * bov * 0.9 * bf
        }
      }
      if (gw > 1e-5) {
        const c = this.gwC * gwCw - this.gwS * gwSw
        const sn = this.gwS * gwCw + this.gwC * gwSw
        this.gwC = c
        this.gwS = sn
        // The fundamental, its second (2sc) and a little third: the hard edge of straight-cut teeth.
        y += gw * (sn + 0.45 * sn * c + 0.2 * (3 * sn - 4 * sn * sn * sn))
      }
      // In the cabin, the shell booms at its own low resonance.
      this.cabF.tick(y)
      y += this.cabF.bpn * cab * 1.4
      if (out) out[i] = limit(y * 0.85)
    }
    cur[G_EX] = ex_
    cur[G_IN] = in_
    cur[G_DRIVE] = drv
    cur[G_NORM] = nrm
    cur[G_BODY] = bdy
    cur[G_PIPE] = pip
    cur[G_RASP] = rsp
    cur[G_TW] = tw
    cur[G_GW] = gw
    cur[G_CAB] = cab
    cur[G_BOV] = bov
    cur[G_FLUT] = flt
    cur[G_HONK] = hnk
    this.rpm = this.rpmTarget
    if (!Number.isFinite(this.dc) || !Number.isFinite(this.exTone.lp) || !Number.isFinite(this.cabF.lp)) this.recover()
    for (const f of this.engFilters) f.flush()
    for (let j = 0; j < nPops; j++) pops[j].flush()
  }

  private firing(c: number): void {
    // Each combustion differs; at idle a lot (lumpy), at full noise very little.
    let a = this.comb * (1 + this.jitter * (this.rand() * 2 - 1))
    if (this.jitter > 0.15 && this.rand() < 0.03) a *= 0.45
    this.amp[c] = a * this.cylAmp[c]
    if (this.rand() < this.popP) this.pop(0.16 + 0.36 * this.rand(), false)
    if (this.rand() < this.bangP) this.pop(0.5 + 0.55 * this.rand(), this.rand() < 0.65)
  }

  /** A NaN anywhere would silence the car for good; reset the filters instead. */
  private recover(): void {
    for (const f of this.engFilters) f.reset()
    this.dc = this.dcX = this.hiLp = 0
  }

  // --------------------------------------------------------------- chassis

  /** Samples until the next random event at `rate` per second (exponential gaps). */
  private gap(rate: number): number {
    return rate > 1e-3 ? (-Math.log(1 - this.rand()) * this.sr) / rate : Infinity
  }

  private regap(left: number, was: number, rate: number): number {
    if (rate <= 1e-3) return Infinity
    return left === Infinity || was <= 1e-3 ? this.gap(rate) : (left * was) / rate
  }

  private renderChassis(out: Float32Array | undefined, frames: number): void {
    const ch = this.ch
    const slurpEnv = ch.squelch * Math.exp(-this.slurpAge / 0.09)
    const rings = this.rings
    // Rates change every block. Gaps are exponential, so rescaling the time left
    // by old/new rate is exact, and a gap drawn while a rate ramped up from zero
    // cannot strand the stones for seconds.
    this.grainLeft = this.regap(this.grainLeft, this.grainRate, ch.grain)
    this.stoneLeft = this.regap(this.stoneLeft, this.stoneRate, ch.stones)
    this.clunkLeft = this.regap(this.clunkLeft, this.clunkRate, ch.clunk)
    this.grainRate = ch.grain
    this.stoneRate = ch.stones
    this.clunkRate = ch.clunk
    const crunch = ch.crunch > 1e-4, rumble = ch.rumble > 1e-4, hiss = ch.hiss > 1e-4, squeal = ch.squeal > 1e-4
    const splash = ch.splash > 1e-4, mud = ch.squelch > 1e-4, wind = ch.wind > 1e-4
    for (let i = 0; i < frames; i++) {
      const nz = this.rand() * 2 - 1
      let y = 0
      if (--this.grainLeft <= 0) {
        // Grains swell over a fraction of a millisecond; a stepped envelope on noise is a tick.
        const g = 0.4 + 0.9 * this.rand()
        this.grainD += g
        this.grainA += g
        this.grainLeft = this.gap(ch.grain)
      }
      const grain = this.grainD - this.grainA
      this.grainD *= this.grainDec
      this.grainA *= this.grainAtk
      if (crunch) {
        this.crF.tick(nz)
        y += this.crF.bpn * (0.3 + grain) * ch.crunch
      }
      if (rumble) {
        this.rumF.tick(nz)
        y += this.rumF.lp * ch.rumble * 3
      }
      if (hiss) {
        this.hisF.tick(nz)
        y += this.hisF.hp * ch.hiss
      }
      if (squeal) {
        this.sqF.tick(nz)
        y += this.sqF.bpn * ch.squeal * 6
      }
      if (splash) {
        this.spF.tick(nz)
        y += this.spF.bpn * ch.splash * (0.35 + this.spMod)
      }
      if (mud) {
        this.muF.tick(nz)
        y += this.muF.bpn * (slurpEnv * 2.5 + ch.squelch * 0.25)
      }
      if (wind) {
        this.wiF.tick(nz)
        y += this.wiF.lp * ch.wind
      }
      if (--this.stoneLeft <= 0) {
        // Strike the quietest ring, so a stone never retunes one still ringing loudly.
        let r = rings[0]
        for (let j = 1; j < rings.length; j++) if (rings[j].level < r.level) r = rings[j]
        r.strike(1500 + 3800 * this.rand(), 0.008 + 0.03 * this.rand(), ch.stoneGain * (0.2 + 0.6 * this.rand()), 0.0004)
        this.stoneLeft = this.gap(ch.stones)
      }
      if (--this.clunkLeft <= 0) {
        this.clunkR.strike(65 + 50 * this.rand(), 0.07 + 0.06 * this.rand(), 0.9, 0.004)
        this.clunkLeft = this.gap(ch.clunk)
      }
      for (let j = 0; j < rings.length; j++) y += rings[j].tick()
      y += this.clunkR.tick() * 0.8
      if (out) out[i] = limit(y)
    }
    if (this.grainD < TINY) this.grainD = this.grainA = 0
    for (let j = 0; j < rings.length; j++) rings[j].flush()
    this.clunkR.flush()
    const fs = this.chFilters
    if (!Number.isFinite(this.crF.lp) || !Number.isFinite(this.sqF.lp)) for (const f of fs) f.reset()
    for (const f of fs) f.flush()
  }
}

/** Soft ceiling at -1 dBFS: transparent below -6 dB, never a hard clip above it. */
function limit(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.5) return x
  const y = 0.5 + 0.39 * sat((a - 0.5) / 0.39)
  return x < 0 ? -y : y
}
