import { voicingFor, type EngineProfile } from './engines'

/**
 * The whole car, synthesised sample by sample: a firing-pulse engine (exhaust,
 * intake, turbo, pops, limiter, gearbox) on output 0 and the chassis (surface,
 * stones, squeal, splash, wind) on output 1. It runs inside an AudioWorklet in
 * the game and in plain Node under tests, so it touches nothing but numbers,
 * and it allocates nothing after construction: the audio thread must never GC.
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
  reset(): void {
    this.c1 = this.c2 = this.lp = this.bp = this.hp = 0
  }
}

/** Two-pole resonator, struck by an impulse: stones on the floorpan, suspension knocks. */
class Ring {
  private y1 = 0
  private y2 = 0
  private c1 = 0
  private c2 = 0
  private sw = 1
  click = 0
  private clickDec = 0
  constructor(private readonly sr: number) {}
  strike(f: number, decay: number, a: number, click: number): void {
    const w = (TAU * f) / this.sr
    const r = Math.exp(-1 / (decay * this.sr))
    this.c1 = 2 * r * Math.cos(w)
    this.c2 = r * r
    this.sw = Math.sin(w)
    this.y1 += a * this.sw
    this.click = click
    this.clickDec = Math.exp(-1 / (0.0012 * this.sr))
  }
  tick(noise: number): number {
    const y = this.c1 * this.y1 - this.c2 * this.y2
    this.y2 = this.y1
    this.y1 = y
    const c = this.click * noise
    this.click *= this.clickDec
    return y + c
  }
}

/** One exhaust bang: a crack of raw noise, a resonant body, and a falling low thud. */
class Pop {
  env = 0
  private dec = 0
  private crack = 0
  private crackDec = 0
  private low = 0
  private lowDec = 0
  private ph = 0
  private dph = 0
  private readonly f: SVF
  constructor(private readonly sr: number) {
    this.f = new SVF(sr)
  }
  fire(strength: number, big: boolean, r1: number, r2: number): void {
    const sr = this.sr
    this.f.set(big ? 110 + r1 * 240 : 280 + r1 * 900, big ? 1.4 : 2.4)
    this.env = strength
    this.dec = Math.exp(-1 / ((big ? 0.045 + r2 * 0.06 : 0.01 + r2 * 0.022) * sr))
    this.crack = strength * (big ? 1.3 : 0.9)
    this.crackDec = Math.exp(-1 / ((big ? 0.004 : 0.0022) * sr))
    this.low = strength * (big ? 1.1 : 0.3)
    this.lowDec = Math.exp(-1 / ((big ? 0.085 : 0.025) * sr))
    this.ph = 0
    this.dph = (big ? 60 + r2 * 40 : 95 + r1 * 70) / sr
  }
  tick(noise: number): number {
    if (this.env < 1e-4 && this.low < 1e-4) return 0
    this.f.tick(noise)
    const y = this.env * this.f.bpn * 2.2 + this.crack * noise + this.low * Math.sin(TAU * this.ph)
    this.ph += this.dph
    this.dph *= 0.99996
    this.env *= this.dec
    this.crack *= this.crackDec
    this.low *= this.lowDec
    return y
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
  private readonly table = new Float32Array(TABLE + 1)
  private readonly profile: EngineProfile
  private readonly v: ReturnType<typeof voicingFor>

  // random
  private seed = 0x2f6b9a1d

  // smoothed state
  private rpm: number
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
  private drive = 1
  private exGain = 0
  private inGain = 0
  private rough = 0.3

  // engine filters
  private dc = 0
  private dcX = 0
  private readonly exTone: SVF
  private readonly exBody: SVF
  private readonly exPipe: SVF
  private readonly muffle: SVF
  private readonly inF: SVF
  private readonly cabF: SVF
  private readonly bovF: SVF
  private readonly pops: Pop[] = []
  private popNext = 0
  private bodyG = 0.9
  private pipeG = 0.6

  // turbo
  private twC = 1
  private twS = 0
  private twF = 2000
  private twA = 0
  private bov = 0
  private bovAge = 1
  // gearbox
  private gwC = 1
  private gwS = 0
  private gwF = 100
  private gwA = 0

  // chassis
  private readonly crF: SVF
  private readonly rumF: SVF
  private readonly hisF: SVF
  private readonly sqF: SVF
  private readonly spF: SVF
  private readonly muF: SVF
  private readonly wiF: SVF
  private readonly rings: Ring[] = []
  private ringNext = 0
  private readonly clunkR: Ring
  private grainEnv = 0
  private grainLeft = Infinity
  private stoneLeft = Infinity
  private clunkLeft = Infinity
  private grainRate = 0
  private stoneRate = 0
  private clunkRate = 0
  private grainDec: number
  private sqPh = 0
  private spMod = 0.5
  private spTarget = 0.5
  private spClock = 0
  private slurpAge = 1
  private ch: EngineInputs = defaultInputs()

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
    this.rpm = profile.idle
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
    const sr = sampleRate
    this.exTone = new SVF(sr)
    this.exBody = new SVF(sr)
    this.exPipe = new SVF(sr)
    this.muffle = new SVF(sr)
    this.inF = new SVF(sr)
    this.cabF = new SVF(sr)
    this.cabF.set(115, 2.2)
    this.bovF = new SVF(sr)
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
    this.grainDec = Math.exp(-1 / (0.003 * sr))
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
    // Take the quietest voice, so a burst of anti-lag never cuts a bang short.
    let best = this.popNext
    for (let i = 0; i < this.pops.length; i++) if (this.pops[i].env < this.pops[best].env) best = i
    this.popNext = (best + 1) % this.pops.length
    this.pops[best].fire(strength, big, this.rand(), this.rand())
  }

  /** Engine into `eng`, chassis into `sfx`; either may be undefined if unconnected. */
  render(eng: Float32Array | undefined, sfx: Float32Array | undefined, frames: number): void {
    this.block(frames / this.sr)
    this.renderEngine(eng, frames)
    this.renderChassis(sfx, frames)
  }

  // --------------------------------------------------------------- control

  private block(dt: number): void {
    const p = this.profile, inp = this.in
    this.dt = dt
    const rpmIn = Number.isFinite(inp.rpm) ? Math.max(0, inp.rpm) : p.idle
    const thrIn = Math.min(1, Math.max(0, inp.throttle || 0))
    const prevThr = this.thr
    this.thr = smooth(this.thr, thrIn, this.k(0.025))
    this.thrPeak = Math.max(this.thr, this.thrPeak * Math.exp(-dt / 0.5))
    this.loadS = smooth(this.loadS, Math.min(1, Math.max(-1, inp.load || 0)), this.k(0.04))
    this.boostS = smooth(this.boostS, Math.min(1, Math.max(0, inp.boost || 0)), this.k(0.06))
    this.boostHeld = Math.max(this.boostS, this.boostHeld * Math.exp(-dt / 0.6))
    const rpmN = sstep(p.idle, p.redline, rpmIn)

    // Gear changes: upshift under load cracks and cuts torque; downshift blips.
    const gear = Math.round(inp.gear || 0)
    if (gear !== this.lastGear) {
      if (this.lastGear > 0 && gear > this.lastGear) {
        this.shiftCut = 0.1
        if (this.thrPeak > 0.5 && rpmN > 0.35) this.pop(0.55 + 0.45 * this.thrPeak * (p.turbo ? 1.2 : 0.8), true)
      } else if (gear > 0 && this.lastGear > gear) {
        this.blip = 1
      }
      this.lastGear = gear
    }
    this.shiftCut = Math.max(0, this.shiftCut - dt)
    this.blip = Math.max(0, this.blip - dt / 0.16)
    const cut = this.shiftCut > 0 || inp.shifting > 0.5
    const blipThr = this.blip > 0 ? Math.sin(Math.PI * Math.min(1, this.blip)) : 0

    // Lift-off: the moment for blow-off, backfire and anti-lag.
    if (this.thr < 0.25 && prevThr >= 0.25 && this.thrPeak > 0.55 && !this.lifted) {
      this.lifted = true
      this.liftAge = 0
      if (p.turbo && this.boostHeld > 0.3) {
        this.bov = Math.min(1, this.boostHeld * 1.1)
        this.bovAge = 0
        this.alsTime = 0.5 + this.boostHeld * 1.3
      }
      if (rpmN > 0.55 && this.rand() < (p.turbo ? 0.85 : 0.5)) this.pop(0.8 + 0.4 * this.rand(), true)
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
    this.rpmTarget = Math.max(200, rpmT)

    const thrEff = cut ? 0.03 : Math.max(this.thr, blipThr)
    const loadP = cut ? 0 : Math.max(0, this.loadS, thrEff * 0.85)
    // Combustion strength sets each exhaust pulse; on overrun only pumping is left.
    this.comb = Math.max(0.2 + 0.8 * loadP, idleish * 0.5)
    if (this.limCut) this.comb = 0.05
    else if (cut) this.comb = 0.12
    this.jitter = this.v.lump * (0.35 + 0.65 * idleish) + 0.04
    const eventsPerSec = (rpmIn / 120) * this.n + 1

    // Overrun crackle: off throttle at high rpm, strongest just after lift-off.
    const overrun = Math.max(sstep(0.05, 0.4, -this.loadS), (1 - sstep(0.05, 0.2, this.thr)) * (cut ? 0 : 1))
    const crackleRate = overrun * 26 * sstep(0.3, 0.9, rpmN) * (0.25 + 0.75 * Math.exp(-this.liftAge / 1.4)) + (this.limCut ? 12 : 0) + (this.blip > 0 ? 10 : 0)
    this.popP = crackleRate / eventsPerSec
    this.bangP = (this.alsTime > 0 ? 10 * Math.min(1, this.alsTime) : 0) / eventsPerSec

    this.drive = (1.1 + 4.2 * loadP + 1.8 * rpmN) * this.v.drive
    this.rough = 0.25 + 0.55 * loadP + 0.25 * idleish
    const turboMuffle = p.turbo ? 0.85 : 1
    this.exGain = inp.exhaust * (0.32 + 0.68 * (0.25 + 0.75 * loadP) + 0.5 * idleish) * (0.55 + 0.45 * rpmN) * turboMuffle
    this.inGain = inp.intake * (0.08 + 0.92 * thrEff) * (0.3 + 0.7 * rpmN) * (p.turbo ? 0.55 : 1)
    this.bodyG = 1.1 - 0.3 * loadP
    this.pipeG = 0.4 + 0.7 * loadP
    this.exTone.set(420 + 2600 * loadP + 1900 * rpmN, 0.8)
    this.exBody.set(this.v.body * (0.85 + 0.4 * rpmN), 1.3)
    this.exPipe.set(this.v.pipe * (0.9 + 0.25 * rpmN), this.v.pipeQ)
    this.muffle.set(inp.muffle, 0.75)
    this.inF.set(this.v.intake + 1500 * thrEff + rpmIn * 0.12, 1.3)

    // Turbo: whistle with boost, blow-off falling in pitch with a short flutter.
    const twFT = 1500 + 4500 * this.boostS + rpmIn * 0.1
    this.twF = smooth(this.twF, twFT, this.k(0.05))
    this.twA = smooth(this.twA, p.turbo ? 0.05 * Math.pow(this.boostS, 1.4) * (0.35 + 0.65 * thrEff) : 0, this.k(0.05))
    this.bovAge += dt
    this.bov *= Math.exp(-dt / 0.28)
    this.bovF.set(1300 + 2700 * Math.exp(-this.bovAge / 0.18), 0.9)

    // Straight-cut whine, pitched by road speed through the gear ratio.
    const ratio = RATIOS[Math.min(RATIOS.length - 1, Math.max(0, Math.abs(gear)))]
    this.gwF = smooth(this.gwF, Math.max(40, Math.abs(inp.speed) * ratio * 26), this.k(0.03))
    this.gwA = smooth(this.gwA, inp.whine * 0.022 * sstep(1, 25, Math.abs(inp.speed)) * (0.45 + 0.55 * Math.abs(this.loadS) + 0.3 * thrEff), this.k(0.05))

    // Chassis inputs are already in their final units; smooth so surface edges cross-fade.
    const kc = this.k(0.06)
    const ch = this.ch
    for (let i = 0; i < ENGINE_PARAMS.length; i++) {
      const key = ENGINE_PARAMS[i]
      ch[key] = smooth(ch[key], Number.isFinite(inp[key]) ? inp[key] : 0, kc)
    }
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

  private rpmTarget = 900
  private dt = 0.003
  private k(tau: number): number {
    return 1 - Math.exp(-this.dt / tau)
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
    const norm = 1 / (0.55 + 0.45 * Math.sqrt(this.drive))
    let bovFlut = 0
    const muffled = this.in.muffle < 16000, cabin = this.in.cabin
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
      const rpm = rpm0 + rpmStep * (i + 1)
      this.phase += (rpm * 6) / sr
      if (this.phase >= 720) this.phase -= 720
      let ex = 0, inn = 0
      for (let c = 0; c < n; c++) {
        let d = this.phase - this.fire[c]
        if (d < 0) d += 720
        if (d < this.lastD[c]) this.firing(c)
        this.lastD[c] = d
        if (d < w) ex += this.amp[c] * table[(d * invW) | 0]
        let di = d - 330
        if (di < 0) di += 720
        if (di < wi) inn += this.cylAmp[c] * table[(di * invWi) | 0]
      }
      const nz = this.rand() * 2 - 1
      // DC blocker: the pulse train is mostly positive pressure.
      const hp = ex - this.dcX + dcR * this.dc
      this.dcX = ex
      this.dc = hp
      const raw = hp + nz * Math.abs(ex) * this.rough
      this.exTone.tick(raw)
      this.exBody.tick(raw)
      this.exPipe.tick(raw)
      let popSum = 0
      for (let j = 0; j < nPops; j++) popSum += pops[j].tick(nz)
      const pre = this.exTone.lp + this.bodyG * this.exBody.bpn + this.pipeG * this.exPipe.bpn + popSum * 0.6
      let e = (sat(pre * this.drive + satBias) - satOff) * norm + popSum * 0.35
      if (muffled) {
        this.muffle.tick(e)
        e = this.muffle.lp
      }
      e *= this.exGain
      // Intake: the pulses themselves plus the roar of air chopped by the valves.
      this.inF.tick(inn * 0.5 + nz * Math.abs(inn) * 1.3)
      let y = e + this.inF.bpn * this.inGain
      // Turbo whistle and blow-off.
      if (this.twA > 1e-4) {
        const c = this.twC * twCw - this.twS * twSw
        const s = this.twS * twCw + this.twC * twSw
        this.twC = c
        this.twS = s
        y += this.twA * (s + 0.5 * s * c + 0.15 * nz)
      }
      if (this.bov > 1e-4) {
        this.bovF.tick(nz)
        bovFlut = this.bovAge < 0.16 ? 0.55 + 0.45 * Math.sin(TAU * 24 * (this.bovAge + i / sr)) : 1
        y += this.bovF.bpn * this.bov * 1.1 * bovFlut
      }
      if (this.gwA > 1e-5) {
        const c = this.gwC * gwCw - this.gwS * gwSw
        const s = this.gwS * gwCw + this.gwC * gwSw
        this.gwC = c
        this.gwS = s
        // s + a little of sin 3θ (= 3s - 4s³): the hard edge of straight-cut teeth.
        y += this.gwA * (s + 0.25 * (3 * s - 4 * s * s * s) + 0.2 * s * s * s)
      }
      // In the cabin, the shell booms at its own low resonance.
      if (cabin > 1e-3) {
        this.cabF.tick(y)
        y += this.cabF.bpn * cabin * 1.4
      }
      if (out) out[i] = limit(y * 0.9)
    }
    this.rpm = this.rpmTarget
    if (!Number.isFinite(this.dc) || !Number.isFinite(this.exTone.lp)) this.recover()
  }

  private firing(c: number): void {
    // Each combustion differs; at idle a lot (lumpy), at full noise very little.
    let a = this.comb * (1 + this.jitter * (this.rand() * 2 - 1))
    if (this.jitter > 0.15 && this.rand() < 0.03) a *= 0.45
    this.amp[c] = a * this.cylAmp[c]
    if (this.rand() < this.popP) this.pop(0.18 + 0.4 * this.rand(), false)
    if (this.rand() < this.bangP) this.pop(0.55 + 0.6 * this.rand(), this.rand() < 0.7)
  }

  /** A NaN anywhere would silence the car for good; reset the filters instead. */
  private recover(): void {
    for (const f of [this.exTone, this.exBody, this.exPipe, this.muffle, this.inF, this.cabF, this.bovF]) f.reset()
    this.dc = this.dcX = 0
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
        this.grainEnv = Math.max(this.grainEnv, 0.4 + 0.9 * this.rand())
        this.grainLeft = this.gap(ch.grain)
      }
      this.grainEnv *= this.grainDec
      if (crunch) {
        this.crF.tick(nz)
        y += this.crF.bpn * (0.3 + this.grainEnv) * ch.crunch
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
        const r = rings[this.ringNext]
        this.ringNext = (this.ringNext + 1) % rings.length
        const a = ch.stoneGain * (0.25 + 0.75 * this.rand())
        r.strike(1800 + 5200 * this.rand(), 0.008 + 0.035 * this.rand(), a, a * 0.6)
        this.stoneLeft = this.gap(ch.stones)
      }
      if (--this.clunkLeft <= 0) {
        this.clunkR.strike(65 + 50 * this.rand(), 0.07 + 0.06 * this.rand(), 0.9, 0.15)
        this.clunkLeft = this.gap(ch.clunk)
      }
      for (let j = 0; j < rings.length; j++) y += rings[j].tick(nz)
      y += this.clunkR.tick(nz) * 0.8
      if (out) out[i] = limit(y)
    }
    if (!Number.isFinite(this.crF.lp)) for (const f of [this.crF, this.rumF, this.hisF, this.sqF, this.spF, this.muF, this.wiF]) f.reset()
  }
}

/** Soft ceiling at -1 dBFS: transparent below -6 dB, never a hard clip above it. */
function limit(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.5) return x
  const y = 0.5 + 0.39 * sat((a - 0.5) / 0.39)
  return x < 0 ? -y : y
}
