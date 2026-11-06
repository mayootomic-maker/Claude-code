import { asset } from '../core/assets'
import { clamp } from '../core/math'
import type { Lang } from '../game/save'
import { CarSound, engineProfileFor, loadEngineWorklet, playImpact, playLanding, type CarSoundState, type EngineProfile } from './engine'

export { engineProfileFor, type CarSoundState, type EngineProfile }

export interface Mix {
  master: number
  music: number
  sfx: number
  engine: number
  voice: number
}

interface VoiceBank {
  buf: AudioBuffer
  clips: Record<string, [number, number]>
}

/**
 * All sound is synthesised or cut from the two co-driver recordings, so
 * there is no third-party audio to license. Everything is created lazily on
 * the first user gesture, as mobile browsers require.
 */
export class Audio {
  private ctx: AudioContext | null = null
  private bus: Record<keyof Mix | 'duck', GainNode> | null = null
  private car: CarSound | null = null
  private carProfile: EngineProfile = engineProfileFor('piccola')
  private lastHit = 0
  private lastLand = 0
  private legacy = { rpm: 0, gear: 1, boost: 0 }
  private rain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private voices = new Map<Lang, VoiceBank>()
  private speakingUntil = 0
  private queue: string[][] = []
  private music: Music | null = null
  private mix: Mix = { master: 0.9, music: 0.5, sfx: 0.9, engine: 0.8, voice: 1 }
  /** Shown as subtitles when the co-driver speaks. */
  onSay: ((text: string[]) => void) | null = null

  get ready(): boolean {
    return this.ctx !== null
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx({ latencyHint: 'interactive' })
    this.ctx = ctx
    const g = () => ctx.createGain()
    const bus = { master: g(), music: g(), sfx: g(), engine: g(), voice: g(), duck: g() }
    // A gentle limiter on the master: a full-throttle engine, a bang and the
    // co-driver together must never clip the phone's output.
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -4
    lim.knee.value = 4
    lim.ratio.value = 12
    lim.attack.value = 0.002
    lim.release.value = 0.12
    bus.master.connect(lim).connect(ctx.destination)
    bus.duck.connect(bus.master)
    bus.music.connect(bus.duck)
    bus.engine.connect(bus.duck)
    bus.sfx.connect(bus.master)
    bus.voice.connect(bus.master)
    this.bus = bus
    this.setMix(this.mix)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    // Fetch and compile the engine now, so it is ready long before a stage starts.
    void loadEngineWorklet(ctx)
  }

  setMix(m: Mix): void {
    this.mix = m
    const b = this.bus
    if (!b || !this.ctx) return
    const t = this.ctx.currentTime
    b.master.gain.setTargetAtTime(m.master, t, 0.05)
    b.music.gain.setTargetAtTime(m.music * 0.6, t, 0.05)
    b.sfx.gain.setTargetAtTime(m.sfx, t, 0.05)
    b.engine.gain.setTargetAtTime(m.engine * 0.7, t, 0.05)
    b.voice.gain.setTargetAtTime(m.voice * 1.3, t, 0.05)
  }

  suspend(): void {
    void this.ctx?.suspend()
  }

  resume(): void {
    void this.ctx?.resume()
  }

  async loadVoice(lang: Lang, base = './voice'): Promise<boolean> {
    if (this.voices.has(lang) || !this.ctx) return this.voices.has(lang)
    try {
      const [meta, bin] = await Promise.all([
        fetch(asset(`${base}/voice-${lang}.json`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
        fetch(asset(`${base}/voice-${lang}.mp3`)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
      ])
      const buf = await this.ctx.decodeAudioData(bin)
      this.voices.set(lang, { buf, clips: (meta as { clips: Record<string, [number, number]> }).clips })
      return true
    } catch {
      return false
    }
  }

  /** Queue a call. Calls never overlap: the next waits for the last to finish. */
  say(lang: Lang, words: string[]): void {
    const bank = this.voices.get(lang)
    if (!this.ctx || !this.bus || !bank) {
      this.onSay?.(words)
      return
    }
    this.queue.push(words)
    this.pump(lang)
  }

  get speaking(): boolean {
    return !!this.ctx && this.ctx.currentTime < this.speakingUntil
  }

  clearCalls(): void {
    this.queue.length = 0
  }

  private pump(lang: Lang): void {
    const ctx = this.ctx, bus = this.bus, bank = this.voices.get(lang)
    if (!ctx || !bus || !bank) return
    if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 2) // stale calls are worse than none
    let t = Math.max(ctx.currentTime + 0.02, this.speakingUntil)
    const words = this.queue.shift()
    if (!words) return
    this.onSay?.(words)
    for (const w of words) {
      const c = bank.clips[w]
      if (!c) continue
      const src = ctx.createBufferSource()
      src.buffer = bank.buf
      src.connect(bus.voice)
      src.start(t, c[0], c[1])
      t += c[1] + 0.03
    }
    // Duck the engine and music under the voice instead of shouting over them.
    bus.duck.gain.setTargetAtTime(0.45, ctx.currentTime, 0.05)
    bus.duck.gain.setTargetAtTime(1, t, 0.25)
    this.speakingUntil = t
    if (this.queue.length) setTimeout(() => this.pump(lang), Math.max(0, (t - ctx.currentTime) * 1000))
  }

  // ------------------------------------------------------------------ car

  /** Start the car's sound. Without a profile, a generic naturally aspirated four. */
  startCar(profile: EngineProfile = engineProfileFor('piccola')): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise || this.car) return
    this.carProfile = profile
    this.legacy = { rpm: profile.idle, gear: 1, boost: 0 }
    this.car = new CarSound(ctx, profile, this.noise, bus.engine, bus.sfx)
  }

  stopCar(): void {
    this.car?.stop()
    this.car = null
  }

  /** Feed the car's state every frame. Impacts and landings in it play their own one-shots. */
  updateCar(s: CarSoundState): void
  /** @deprecated The pre-3.0 call; estimates gear, load and boost from rpm and throttle. */
  updateCar(rpm: number, throttle: number, speed: number, loose: boolean, slip: number, onGround: boolean): void
  updateCar(a: CarSoundState | number, throttle = 0, speed = 0, loose = false, slip = 0, onGround = true): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise || !this.car) return
    const s = typeof a === 'number' ? this.fromLegacy(a, throttle, speed, loose, slip, onGround) : a
    this.car.update(s)
    // Rate-limit the one-shots: a scrape along a barrier reports an impact every frame.
    const t = ctx.currentTime
    if (s.impact > 2 && t - this.lastHit > 0.12) {
      this.lastHit = t
      playImpact(ctx, bus.sfx, this.noise, Math.min(1, s.impact / 15))
    }
    if (s.landed > 2.5 && t - this.lastLand > 0.2) {
      this.lastLand = t
      playLanding(ctx, bus.sfx, this.noise, Math.min(1, s.landed / 10))
    }
  }

  private fromLegacy(rpm: number, throttle: number, speed: number, loose: boolean, slip: number, onGround: boolean): CarSoundState {
    const L = this.legacy, p = this.carProfile
    // The old gearbox only reports rpm; a sudden drop is an upshift, a jump a downshift.
    if (rpm < L.rpm - 900) L.gear++
    else if (rpm > L.rpm + 900 && L.gear > 1) L.gear--
    L.rpm = rpm
    L.boost += ((p.turbo ? throttle * clamp((rpm - p.idle) / (p.redline * 0.5), 0, 1) : 0) - L.boost) * 0.08
    return {
      rpm, throttle, load: throttle > 0.1 ? throttle : rpm > p.idle * 1.4 ? -0.6 : 0, gear: L.gear, shifting: false,
      boost: L.boost, speed, surface: loose ? 'gravel' : 'asphalt', slip, wheelSpin: 0, onGround, impact: 0, landed: 0, camera: 'chase',
    }
  }

  /** A thump for barrier hits and landings; strength 0..1. */
  thump(strength: number): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise) return
    playImpact(ctx, bus.sfx, this.noise, strength)
  }

  /** A swell of crowd noise as you pass spectators. */
  cheer(): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1100
    f.Q.value = 0.6
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.18, t + 0.4)
    g.gain.linearRampToValueAtTime(0, t + 2.2)
    src.connect(f).connect(g).connect(bus.sfx)
    src.start(t, Math.random(), 2.4)
  }

  setRain(on: boolean): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise) return
    if (on && !this.rain) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 2500
      const g = ctx.createGain()
      g.gain.value = 0.06
      src.connect(f).connect(g).connect(bus.sfx)
      src.start()
      this.rain = g
    } else if (!on && this.rain) {
      this.rain.gain.setTargetAtTime(0, ctx.currentTime, 0.2)
      this.rain = null
    }
  }

  /** Occasional birdsong for the cozy bits: menus, the start line. */
  chirp(): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const t = ctx.currentTime
    const f = 2600 + Math.random() * 1600
    o.frequency.setValueAtTime(f, t)
    for (let i = 0; i < 3; i++) o.frequency.linearRampToValueAtTime(f * (1.15 + Math.random() * 0.3), t + 0.05 + i * 0.09)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.03, t + 0.02)
    g.gain.linearRampToValueAtTime(0, t + 0.3)
    o.connect(g).connect(bus.sfx)
    o.start(t)
    o.stop(t + 0.35)
  }

  click(): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const t = ctx.currentTime
    o.frequency.value = 1400
    g.gain.setValueAtTime(0.05, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05)
    o.connect(g).connect(bus.sfx)
    o.start(t)
    o.stop(t + 0.06)
  }

  // ------------------------------------------------------------------ music

  playMusic(mood: 'menu' | 'drive'): void {
    if (!this.ctx || !this.bus) return
    if (!this.music) this.music = new Music(this.ctx, this.bus.music)
    this.music.play(mood)
  }

  stopMusic(): void {
    this.music?.stop()
  }
}

/**
 * Original generative music: a slow, warm progression on a soft electric-piano
 * voice with a pad underneath and a gentle plucked figure. Never the same
 * twice, never loud, and entirely ours.
 */
class Music {
  private timer = 0
  private step = 0
  private mood: 'menu' | 'drive' = 'menu'
  private readonly out: GainNode

  constructor(private readonly ctx: AudioContext, bus: GainNode) {
    this.out = ctx.createGain()
    this.out.gain.value = 0
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 2600
    this.out.connect(f).connect(bus)
  }

  // Dmaj9 – Bm7 – Gmaj7 – A6sus: warm, unresolved, loops forever without tiring.
  private readonly chords = [
    [50, 57, 62, 66, 69, 64], [47, 54, 59, 62, 66, 69], [43, 50, 55, 59, 62, 66], [45, 52, 57, 62, 64, 66],
  ]

  play(mood: 'menu' | 'drive'): void {
    this.mood = mood
    const t = this.ctx.currentTime
    this.out.gain.setTargetAtTime(mood === 'menu' ? 0.5 : 0.18, t, 0.8)
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 385)
  }

  stop(): void {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6)
    const id = this.timer
    this.timer = 0
    setTimeout(() => clearInterval(id), 2000)
  }

  private note(midi: number, t: number, dur: number, vol: number, type: OscillatorType, detune = 0): void {
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12)
    o.detune.value = detune
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.4)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    o.connect(g).connect(this.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private tick(): void {
    const t = this.ctx.currentTime + 0.05
    const bar = Math.floor(this.step / 8) % this.chords.length
    const beat = this.step % 8
    const ch = this.chords[bar]
    if (beat === 0) {
      // Pad: two detuned triangles per chord tone, long and quiet.
      for (const n of ch.slice(0, 4)) {
        this.note(n, t, 3.2, 0.035, 'triangle', -6)
        this.note(n, t, 3.2, 0.035, 'triangle', 6)
      }
      this.note(ch[0] - 12, t, 3, 0.07, 'sine')
    }
    // Plucked figure, sparse in the drive mix so it never fights the co-driver.
    const density = this.mood === 'menu' ? 0.7 : 0.35
    if (Math.random() < density && beat % 2 === (bar % 2)) {
      const n = ch[2 + Math.floor(Math.random() * 4)] + 12
      this.note(n, t, 1.2, 0.05, 'sine')
      this.note(n + 12, t, 0.6, 0.012, 'sine')
    }
    this.step++
  }
}

export function haptic(ms: number, enabled: boolean): void {
  if (!enabled) return
  const native = (window as unknown as { ApexNative?: { vibrate(ms: number): void } }).ApexNative
  if (native) native.vibrate(ms)
  else navigator.vibrate?.(ms)
}
