/**
 * Audio primitives shared by every voice and effect.
 *
 * Each of these is cached per audio context. A song with sixteen reverb sends
 * should generate one impulse response per distinct setting, not one per note,
 * and the offline render context needs its own copies because buffers cannot
 * cross contexts.
 */

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** Below this an exponential ramp is silence to the ear but still legal maths. */
export const SILENCE = 1e-4

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

interface Resources {
  noise: AudioBuffer
  waves: Map<string, PeriodicWave>
  impulses: Map<string, AudioBuffer>
  curves: Map<string, Float32Array<ArrayBuffer>>
}

const perContext = new WeakMap<BaseAudioContext, Resources>()

function resources(context: BaseAudioContext): Resources {
  const existing = perContext.get(context)
  if (existing) return existing
  const created: Resources = {
    noise: makeNoise(context),
    waves: new Map(),
    impulses: new Map(),
    curves: new Map(),
  }
  perContext.set(context, created)
  return created
}

/**
 * Two seconds of white noise, looped. Longer than any drum tail and long enough
 * that the loop point is inaudible under a filter.
 */
function makeNoise(context: BaseAudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    // A fixed seed keeps an exported render bit-identical between runs, which
    // is what makes "render twice and compare" a usable test.
    let seed = 0x2f6e2b1 + channel * 0x9e3779b9
    for (let index = 0; index < length; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[index] = (seed / 0xffffffff) * 2 - 1
    }
  }
  return buffer
}

export function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  return resources(context).noise
}

/**
 * A pulse wave of a given duty cycle, which Web Audio does not offer natively.
 * Narrow pulses are half the character of every classic bass and lead patch.
 */
export function pulseWave(context: BaseAudioContext, duty = 0.25): PeriodicWave {
  const store = resources(context).waves
  const key = `pulse:${duty.toFixed(3)}`
  const cached = store.get(key)
  if (cached) return cached
  const harmonics = 64
  const real = new Float32Array(harmonics)
  const imaginary = new Float32Array(harmonics)
  for (let n = 1; n < harmonics; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  }
  const wave = context.createPeriodicWave(real, imaginary, { disableNormalization: false })
  store.set(key, wave)
  return wave
}

/**
 * A synthetic room. Noise shaped by an exponential decay, damped more with
 * time, and with a short gap at the front so the reverb sits behind the dry
 * signal instead of smearing its attack.
 *
 * Generating this beats shipping an impulse-response file: no asset to
 * download, and `size` becomes a continuous control rather than a menu of
 * recordings.
 */
export function impulseResponse(context: BaseAudioContext, size: number, damping: number): AudioBuffer {
  const store = resources(context).impulses
  const key = `ir:${size.toFixed(3)}:${damping.toFixed(3)}`
  const cached = store.get(key)
  if (cached) return cached

  const seconds = 0.25 + Math.pow(clamp(size, 0, 1), 1.7) * 4.25
  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const preDelay = Math.floor(rate * 0.012)
  const buffer = context.createBuffer(2, length, rate)
  const decay = seconds * 0.34

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let seed = 0x1a2b3c4 + channel * 0x51ed2701
    let lowpassed = 0
    for (let index = 0; index < length; index++) {
      if (index < preDelay) {
        data[index] = 0
        continue
      }
      seed = (seed * 1664525 + 1013904223) >>> 0
      const white = (seed / 0xffffffff) * 2 - 1
      const time = (index - preDelay) / rate
      // Damping closes a one-pole filter further as the tail ages, which is
      // what real rooms do: high frequencies are absorbed first.
      const openness = clamp(1 - damping * (0.25 + 0.75 * (time / seconds)), 0.02, 1)
      lowpassed += (white - lowpassed) * openness
      data[index] = lowpassed * Math.exp(-time / decay)
    }
    // Early reflections give the tail a size you can hear rather than a wash.
    for (const [offset, level] of [[0.011, 0.5], [0.019, 0.36], [0.031, 0.27], [0.047, 0.2]] as const) {
      const at = preDelay + Math.floor(offset * rate * (0.5 + size))
      if (at < length) data[at] = (data[at] ?? 0) + level * (channel === 0 ? 1 : -1)
    }
  }

  store.set(key, buffer)
  return buffer
}

/** A soft-clipping curve. `amount` 0 is nearly clean, 1 is a fuzz box. */
export function driveCurve(context: BaseAudioContext, amount: number): Float32Array<ArrayBuffer> {
  const store = resources(context).curves
  const key = `drive:${amount.toFixed(3)}`
  const cached = store.get(key)
  if (cached) return cached
  const samples = 2048
  const curve = new Float32Array(samples)
  const gain = 1 + clamp(amount, 0, 1) * 40
  const normalise = Math.tanh(gain)
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1
    curve[index] = Math.tanh(x * gain) / normalise
  }
  store.set(key, curve)
  return curve
}

/**
 * A soft-clipping ceiling for the master bus.
 *
 * This replaced a DynamicsCompressorNode used as a limiter, for a measured
 * reason: Chromium's compressor begins every render with roughly 300ms of
 * heavy gain reduction that ramps away, so the first beat of an exported song
 * came out eighteen decibels quiet. A waveshaper has no state at all — it
 * cannot have a startup transient, it cannot pump, and it renders identically
 * every time.
 *
 * Below `threshold` the curve is exactly the identity, so ordinary material
 * passes through untouched and only peaks are rounded off.
 */
export function limiterCurve(context: BaseAudioContext, threshold = 0.7): Float32Array<ArrayBuffer> {
  const store = resources(context).curves
  const key = `limit:${threshold.toFixed(3)}`
  const cached = store.get(key)
  if (cached) return cached
  const samples = 8192
  const curve = new Float32Array(samples)
  const headroom = 1 - threshold
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    const shaped =
      magnitude <= threshold ? magnitude : threshold + headroom * Math.tanh((magnitude - threshold) / headroom)
    curve[index] = Math.sign(x) * shaped
  }
  store.set(key, curve)
  return curve
}

/** Quantises the signal to 2^bits levels — the stair-step of an old sampler. */
export function crushCurve(context: BaseAudioContext, bits: number): Float32Array<ArrayBuffer> {
  const store = resources(context).curves
  const key = `crush:${bits.toFixed(2)}`
  const cached = store.get(key)
  if (cached) return cached
  const samples = 4096
  const curve = new Float32Array(samples)
  const levels = Math.max(2, Math.pow(2, clamp(bits, 1, 16)))
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1
    curve[index] = Math.round(x * (levels / 2)) / (levels / 2)
  }
  store.set(key, curve)
  return curve
}

/** Note divisions like `1/8`, `3/16`, `1/4t` as a fraction of a beat. */
export function divisionToBeats(division: string, fallback = 0.75): number {
  const match = /^(\d+)\/(\d+)(t|d)?$/.exec(division.trim())
  if (!match) return fallback
  const [, numerator = '1', denominator = '4', modifier = ''] = match
  const beats = (Number(numerator) / Number(denominator)) * 4
  if (!Number.isFinite(beats) || beats <= 0) return fallback
  if (modifier === 't') return beats * (2 / 3)
  if (modifier === 'd') return beats * 1.5
  return beats
}

export const DIVISIONS = ['1/32', '1/16', '1/8t', '1/16d', '1/8', '3/16', '1/4t', '1/4', '3/8', '1/2', '1/1'] as const

/**
 * A ramp that is safe at zero. `exponentialRampToValueAtTime` throws on a
 * target of 0 and does nothing useful from a current value of 0, which is
 * exactly where every amplitude envelope starts.
 */
export function rampTo(param: AudioParam, value: number, when: number): void {
  param.exponentialRampToValueAtTime(Math.max(value, SILENCE), when)
}
