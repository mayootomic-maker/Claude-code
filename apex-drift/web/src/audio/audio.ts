import { clamp } from '../core/math'
import type { Lang } from '../game/save'

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
  private engine: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null
  private surface: { g: GainNode; f: BiquadFilterNode } | null = null
  private squeal: { g: GainNode } | null = null
  private wind: { g: GainNode; f: BiquadFilterNode } | null = null
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
    bus.master.connect(ctx.destination)
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
  }

  setMix(m: Mix): void {
    this.mix = m
    const b = this.bus
    if (!b || !this.ctx) return
    const t = this.ctx.currentTime
    b.master.gain.setTargetAtTime(m.master, t, 0.05)
    b.music.gain.setTargetAtTime(m.music * 0.6, t, 0.05)
    b.sfx.gain.setTargetAtTime(m.sfx, t, 0.05)
    b.engine.gain.setTargetAtTime(m.engine * 0.55, t, 0.05)
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
        fetch(`${base}/voice-${lang}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
        fetch(`${base}/voice-${lang}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
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

  startCar(): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise || this.engine) return
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator()
    o1.type = 'sawtooth'
    o2.type = 'square'
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 3
    const g = ctx.createGain()
    g.gain.value = 0
    const g2 = ctx.createGain()
    g2.gain.value = 0.35
    o1.connect(f)
    o2.connect(g2).connect(f)
    f.connect(g).connect(bus.engine)
    o1.start()
    o2.start()
    this.engine = { o1, o2, f, g }
    const loop = (type: BiquadFilterType, freq: number, q: number, out: AudioNode) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const flt = ctx.createBiquadFilter()
      flt.type = type
      flt.frequency.value = freq
      flt.Q.value = q
      const gg = ctx.createGain()
      gg.gain.value = 0
      src.connect(flt).connect(gg).connect(out)
      src.start(0, Math.random() * 1.5)
      return { g: gg, f: flt }
    }
    this.surface = loop('bandpass', 700, 0.8, bus.sfx)
    this.squeal = loop('bandpass', 1800, 12, bus.sfx)
    this.wind = loop('lowpass', 400, 0.5, bus.sfx)
  }

  stopCar(): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    for (const n of [this.engine?.g, this.surface?.g, this.squeal?.g, this.wind?.g]) n?.gain.setTargetAtTime(0, t, 0.08)
    const e = this.engine
    if (e) setTimeout(() => {
      e.o1.stop()
      e.o2.stop()
    }, 400)
    this.engine = this.surface = this.squeal = this.wind = null
  }

  /** rpm 800..7500, throttle 0..1, loose = gravel/snow underneath, slip 0..1 sideways scrub. */
  updateCar(rpm: number, throttle: number, speed: number, loose: boolean, slip: number, onGround: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.engine) return
    const t = ctx.currentTime
    const e = this.engine
    // Four cylinders: two firing pulses per revolution.
    const f0 = (rpm / 60) * 2
    e.o1.frequency.setTargetAtTime(f0, t, 0.03)
    e.o2.frequency.setTargetAtTime(f0 * 0.5, t, 0.03)
    e.f.frequency.setTargetAtTime(300 + throttle * 1800 + rpm * 0.15, t, 0.05)
    e.g.gain.setTargetAtTime(0.18 + throttle * 0.22, t, 0.05)
    const v = clamp(speed / 40, 0, 1)
    this.surface?.g.gain.setTargetAtTime(onGround ? (loose ? 0.35 : 0.08) * v : 0, t, 0.08)
    if (this.surface) this.surface.f.frequency.setTargetAtTime(loose ? 500 + v * 900 : 300 + v * 300, t, 0.1)
    this.squeal?.g.gain.setTargetAtTime(onGround && !loose ? clamp((slip - 0.1) * 2, 0, 0.25) : 0, t, 0.06)
    this.wind?.g.gain.setTargetAtTime(v * v * 0.3, t, 0.1)
    if (this.wind) this.wind.f.frequency.setTargetAtTime(250 + v * 900, t, 0.1)
  }

  /** A thump for barrier hits and landings; strength 0..1. */
  thump(strength: number): void {
    const ctx = this.ctx, bus = this.bus
    if (!ctx || !bus || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 220 + strength * 400
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(clamp(strength, 0, 1) * 0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    src.connect(f).connect(g).connect(bus.sfx)
    src.start(t, Math.random(), 0.4)
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
