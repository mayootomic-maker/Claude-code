import workletUrl from './engine-worklet.ts?worker&url'
import { scriptUrls } from '../core/assets'
import { ENGINE_PARAMS, defaultInputs, type EngineInputs } from './engine-dsp'
import type { EngineProfile } from './engines'

export { engineProfileFor, type EngineProfile } from './engines'

export interface CarSoundState {
  rpm: number
  /** 0..1 applied */
  throttle: number
  /** -1..1, negative = overrun */
  load: number
  gear: number
  shifting: boolean
  /** 0..1 */
  boost: number
  /** m/s */
  speed: number
  /** 'asphalt'|'gravel'|'wetgravel'|'snow'|'rough'|'ice'|'mud'|'sand'|'verge'|'grass'|'water'|'wet' */
  surface: string
  /** 0..1 lateral scrub */
  slip: number
  /** 0..1 */
  wheelSpin: number
  onGround: boolean
  /** m/s into a barrier this frame, 0 if none */
  impact: number
  /** m/s vertical at landing, 0 if none */
  landed: number
  camera: 'chase' | 'near' | 'bonnet'
}

// --------------------------------------------------------------------- mix

interface SurfaceVoice {
  crunch: number
  crunchFreq: number
  /** grains per second at full speed */
  grain: number
  /** stones per second at full speed */
  stones: number
  stoneGain: number
  rumble: number
  /** suspension knocks per second at full speed */
  clunk: number
  hiss: number
  splash: number
  squelch: number
  /** how much this surface lets a tyre squeal */
  squeal: number
}

const S = (crunch: number, crunchFreq: number, grain: number, stones: number, stoneGain: number, rumble: number, clunk: number, hiss: number, splash: number, squelch: number, squeal: number): SurfaceVoice =>
  ({ crunch, crunchFreq, grain, stones, stoneGain, rumble, clunk, hiss, splash, squelch, squeal })

//                         crunch  freq  grain stones  ping  rumble clunk hiss  splash squelch squeal
const SURFACES: Record<string, SurfaceVoice> = {
  asphalt: S(0.015, 450, 0, 0, 0, 0.12, 0, 0.015, 0, 0, 0.32),
  wet: S(0.015, 450, 0, 0, 0, 0.1, 0, 0.13, 0, 0, 0.14),
  gravel: S(0.4, 1100, 260, 14, 0.32, 0.17, 0.6, 0.02, 0, 0, 0),
  wetgravel: S(0.25, 850, 200, 9, 0.35, 0.17, 0.6, 0.07, 0, 0.03, 0),
  snow: S(0.22, 520, 90, 0.6, 0.18, 0.08, 0.3, 0.03, 0, 0, 0),
  rough: S(0.28, 900, 220, 10, 0.38, 0.35, 3.5, 0.02, 0, 0, 0),
  ice: S(0.03, 2500, 30, 0, 0, 0.05, 0, 0.05, 0, 0, 0.08),
  mud: S(0.08, 380, 40, 0.5, 0.15, 0.2, 1, 0.02, 0.06, 0.35, 0),
  sand: S(0.2, 1600, 380, 1.5, 0.15, 0.12, 0.3, 0.09, 0, 0, 0),
  verge: S(0.18, 700, 120, 4, 0.3, 0.25, 2, 0.03, 0, 0, 0),
  grass: S(0.12, 600, 60, 0.3, 0.12, 0.2, 1, 0.06, 0, 0.03, 0),
  water: S(0.02, 500, 0, 0, 0, 0.15, 0.5, 0.05, 0.85, 0.06, 0),
}

interface CameraMix {
  exhaust: number
  intake: number
  whine: number
  muffle: number
  cabin: number
  chassis: number
  stones: number
}

const CAMERAS: Record<CarSoundState['camera'], CameraMix> = {
  // Outside: the exhaust is the car.
  chase: { exhaust: 1, intake: 0.45, whine: 0.35, muffle: 20000, cabin: 0, chassis: 1, stones: 1 },
  near: { exhaust: 1, intake: 0.6, whine: 0.6, muffle: 20000, cabin: 0, chassis: 1.1, stones: 1.2 },
  // In the car: intake and gearbox up front, the exhaust behind a bulkhead, and
  // every stone hitting the floorpan right under you.
  bonnet: { exhaust: 0.8, intake: 1, whine: 1, muffle: 1400, cabin: 0.6, chassis: 0.9, stones: 1.6 },
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0)

/** Everything the DSP needs, from game state. Pure, so it is tested without audio. */
export function soundInputs(s: CarSoundState, out: EngineInputs = defaultInputs()): EngineInputs {
  const cam = CAMERAS[s.camera] ?? CAMERAS.chase
  const surf = SURFACES[s.surface] ?? SURFACES.gravel
  const speed = Math.abs(s.speed) || 0
  const v = clamp01(speed / 30)
  const slip = clamp01(s.slip)
  const spin = clamp01(s.wheelSpin)
  const g = s.onGround ? 1 : 0
  out.rpm = s.rpm
  out.throttle = clamp01(s.throttle)
  out.load = Math.max(-1, Math.min(1, s.load || 0))
  out.boost = clamp01(s.boost)
  out.gear = s.gear
  out.shifting = s.shifting ? 1 : 0
  out.speed = speed
  out.exhaust = cam.exhaust
  out.intake = cam.intake
  out.whine = cam.whine
  out.muffle = cam.muffle
  out.cabin = cam.cabin
  // Loose surfaces get louder when the tyres scrabble sideways or spin.
  const scrabble = 1 + slip * 0.8 + spin * 0.6
  const c = cam.chassis * g
  out.crunch = surf.crunch * Math.pow(v, 0.8) * scrabble * c
  out.crunchFreq = surf.crunchFreq * (0.85 + 0.3 * v)
  out.grain = surf.grain * (0.25 + v) * scrabble * g
  out.stones = surf.stones * v * (1 + 3 * spin + slip) * g
  out.stoneGain = surf.stoneGain * cam.stones
  out.rumble = surf.rumble * v * c
  out.clunk = surf.clunk * v * g
  out.hiss = surf.hiss * v * (1 + spin) * c + (s.surface === 'ice' ? slip * 0.08 * c : 0)
  out.splash = surf.splash * Math.pow(v, 0.6) * c
  out.squelch = surf.squelch * Math.min(1, speed / 8) * c
  out.squeal = surf.squeal * clamp01((slip - 0.12) * 1.6 + spin * 0.5) * clamp01(speed / 6) * c
  out.squealFreq = 950 + 350 * slip
  out.wind = 0.12 * v * v * cam.chassis
  return out
}

// --------------------------------------------------------------------- loading

const modules = new WeakMap<BaseAudioContext, Promise<boolean>>()

/** Load the engine worklet once per context. Resolves false instead of throwing. */
export function loadEngineWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = modules.get(ctx)
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false
        let last: unknown = null
        for (const url of await scriptUrls(workletUrl)) {
          try {
            await ctx.audioWorklet.addModule(url)
            return true
          } catch (e) {
            last = e
          }
        }
        throw last
      } catch (e) {
        console.warn('engine worklet unavailable, using the simple engine', e)
        return false
      }
    })()
    modules.set(ctx, p)
  }
  return p
}

interface CarVoice {
  update(s: CarSoundState): void
  stop(): void
}

class WorkletCar implements CarVoice {
  private readonly params: AudioParam[]
  private readonly inputs = defaultInputs()
  private readonly eg: GainNode
  private readonly sg: GainNode

  constructor(private readonly ctx: BaseAudioContext, private readonly node: AudioWorkletNode, engineOut: AudioNode, sfxOut: AudioNode) {
    this.params = ENGINE_PARAMS.map((k) => {
      const p = node.parameters.get(k)
      if (!p) throw new Error(`engine worklet has no ${k} parameter`)
      return p
    })
    this.eg = ctx.createGain()
    this.sg = ctx.createGain()
    node.connect(this.eg, 0).connect(engineOut)
    node.connect(this.sg, 1).connect(sfxOut)
  }

  update(s: CarSoundState): void {
    const inp = soundInputs(s, this.inputs)
    for (let i = 0; i < ENGINE_PARAMS.length; i++) this.params[i].value = inp[ENGINE_PARAMS[i]]
  }

  stop(): void {
    const t = this.ctx.currentTime
    this.eg.gain.setTargetAtTime(0, t, 0.08)
    this.sg.gain.setTargetAtTime(0, t, 0.08)
    const node = this.node
    setTimeout(() => {
      node.port.postMessage('stop')
      node.disconnect()
    }, 500)
  }
}

/**
 * The car for devices without AudioWorklet: two oscillators at the firing rate
 * through a waveshaper, plus a noise bed for the surface. Less alive, never silent.
 */
class FallbackCar implements CarVoice {
  private readonly o1: OscillatorNode
  private readonly o2: OscillatorNode
  private readonly f: BiquadFilterNode
  private readonly g: GainNode
  private readonly surf: { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode }
  private readonly squeal: { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode }
  private readonly inputs = defaultInputs()

  constructor(private readonly ctx: BaseAudioContext, private readonly profile: EngineProfile, noise: AudioBuffer, engineOut: AudioNode, sfxOut: AudioNode) {
    this.o1 = ctx.createOscillator()
    this.o2 = ctx.createOscillator()
    this.o1.type = 'sawtooth'
    this.o2.type = 'square'
    const g2 = ctx.createGain()
    g2.gain.value = 0.35
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.5)
    shaper.curve = curve
    this.f = ctx.createBiquadFilter()
    this.f.type = 'lowpass'
    this.f.Q.value = 3
    this.g = ctx.createGain()
    this.g.gain.value = 0
    this.o1.connect(shaper)
    this.o2.connect(g2).connect(shaper)
    shaper.connect(this.f).connect(this.g).connect(engineOut)
    this.o1.start()
    this.o2.start()
    const loop = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource()
      src.buffer = noise
      src.loop = true
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(f).connect(g).connect(sfxOut)
      src.start(0, Math.random() * 1.5)
      return { src, f, g }
    }
    this.surf = loop('bandpass', 700, 0.8)
    this.squeal = loop('bandpass', 1100, 14)
  }

  update(s: CarSoundState): void {
    const t = this.ctx.currentTime
    const inp = soundInputs(s, this.inputs)
    const f0 = (Math.max(300, s.rpm) / 60) * (this.profile.cylinders / 2)
    const thr = inp.shifting ? 0 : inp.throttle
    this.o1.frequency.setTargetAtTime(f0, t, 0.02)
    this.o2.frequency.setTargetAtTime(f0 / 2, t, 0.02)
    this.f.frequency.setTargetAtTime(Math.min(inp.muffle, 350 + thr * 2200 + s.rpm * 0.15), t, 0.04)
    this.g.gain.setTargetAtTime((0.12 + thr * 0.2) * inp.exhaust, t, 0.04)
    this.surf.g.gain.setTargetAtTime(inp.crunch + inp.rumble * 0.6 + inp.splash * 0.5 + inp.hiss * 0.4, t, 0.08)
    this.surf.f.frequency.setTargetAtTime(inp.splash > inp.crunch ? 900 : inp.crunchFreq, t, 0.1)
    this.squeal.g.gain.setTargetAtTime(inp.squeal * 0.8, t, 0.06)
    this.squeal.f.frequency.setTargetAtTime(inp.squealFreq, t, 0.06)
  }

  stop(): void {
    const t = this.ctx.currentTime
    for (const g of [this.g, this.surf.g, this.squeal.g]) g.gain.setTargetAtTime(0, t, 0.08)
    setTimeout(() => {
      for (const n of [this.o1, this.o2, this.surf.src, this.squeal.src]) n.stop()
    }, 500)
  }
}

/**
 * One car's sound. The worklet loads asynchronously (it is preloaded on unlock,
 * so in practice it is ready before a stage starts); until then nothing plays,
 * and if it cannot load, the simple engine takes over without an error.
 */
export class CarSound {
  private voice: CarVoice | null = null
  private last: CarSoundState | null = null
  private stopped = false
  /** Which engine ended up running; for diagnostics and tests. */
  readonly ready: Promise<'worklet' | 'fallback'>

  constructor(ctx: BaseAudioContext, profile: EngineProfile, noise: AudioBuffer, engineOut: AudioNode, sfxOut: AudioNode) {
    this.ready = loadEngineWorklet(ctx).then((ok) => {
      let kind: 'worklet' | 'fallback' = 'fallback'
      if (this.stopped) return kind
      let voice: CarVoice | null = null
      if (ok) {
        try {
          const node = new AudioWorkletNode(ctx, 'apex-engine', {
            numberOfInputs: 0,
            numberOfOutputs: 2,
            outputChannelCount: [1, 1],
            processorOptions: { profile },
          })
          voice = new WorkletCar(ctx, node, engineOut, sfxOut)
          kind = 'worklet'
        } catch (e) {
          console.warn('engine worklet failed to start, using the simple engine', e)
        }
      }
      this.voice = voice ?? new FallbackCar(ctx, profile, noise, engineOut, sfxOut)
      if (this.last) this.voice.update(this.last)
      return kind
    })
  }

  update(s: CarSoundState): void {
    this.last = s
    this.voice?.update(s)
  }

  stop(): void {
    this.stopped = true
    this.voice?.stop()
    this.voice = null
  }
}

// --------------------------------------------------------------------- one-shots

/** A barrier hit: a low thud, a crunch of panel and a short metallic ring. strength 0..1. */
export function playImpact(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, strength: number): void {
  const s = clamp01(strength)
  const t = ctx.currentTime
  const thud = ctx.createOscillator()
  thud.frequency.setValueAtTime(95 + s * 30, t)
  thud.frequency.exponentialRampToValueAtTime(38, t + 0.25)
  const tg = ctx.createGain()
  tg.gain.setValueAtTime(0.9 * s, t)
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
  thud.connect(tg).connect(out)
  thud.start(t)
  thud.stop(t + 0.32)
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 900 + s * 900
  f.Q.value = 0.9
  const ring = ctx.createBiquadFilter()
  ring.type = 'peaking'
  ring.frequency.value = 2300 + Math.random() * 1400
  ring.Q.value = 18
  ring.gain.value = 14
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.7 * s, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + s * 0.25)
  src.connect(f).connect(ring).connect(g).connect(out)
  src.start(t, Math.random(), 0.5)
}

/** Landing: the springs bottom out, a soft body thump and a suspension knock. strength 0..1. */
export function playLanding(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, strength: number): void {
  const s = clamp01(strength)
  const t = ctx.currentTime
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(70, t)
  o.frequency.exponentialRampToValueAtTime(32, t + 0.2)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.85 * s, t)
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
  o.connect(og).connect(out)
  o.start(t)
  o.stop(t + 0.3)
  // The knock arrives a beat later, when the damper tops out.
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 260 + s * 200
  f.Q.value = 2.5
  const g = ctx.createGain()
  const t2 = t + 0.06
  g.gain.setValueAtTime(0, t)
  g.gain.setValueAtTime(0.6 * s, t2)
  g.gain.exponentialRampToValueAtTime(0.001, t2 + 0.12)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random(), 0.3)
}
