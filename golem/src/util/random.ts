/**
 * Seeded randomness and the distributions the humanisation layer is built on.
 *
 * Everything here is seeded and deterministic. That is not a testing
 * convenience: a persona has to be *stable across sessions* or the bot's
 * "personality" would resample every launch and the illusion collapses. The
 * same seed always yields the same reaction times, the same aim tremor, the
 * same typing quirks.
 */

/** xoshiro128** — small, fast, and far better distributed than a bare LCG. */
export class Rng {
  private s0: number
  private s1: number
  private s2: number
  private s3: number

  constructor(seed: string | number) {
    // splitmix32 the seed out into four words so that adjacent seeds ("bot1",
    // "bot2") produce unrelated streams rather than correlated ones.
    let h = typeof seed === 'number' ? seed >>> 0 : hashString(seed)
    const next = () => {
      h = (h + 0x9e3779b9) >>> 0
      let z = h
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
      return (z ^ (z >>> 15)) >>> 0
    }
    this.s0 = next()
    this.s1 = next()
    this.s2 = next()
    this.s3 = next()
  }

  /** Uniform in [0, 1). */
  next(): number {
    const r = Math.imul(this.s1, 5) >>> 0
    const result = Math.imul((r << 7) | (r >>> 25), 9) >>> 0
    const t = (this.s1 << 9) >>> 0
    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0
    return result / 4294967296
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on an empty array')
    return items[Math.floor(this.next() * items.length)] as T
  }

  /** Standard normal, via Box–Muller. */
  normal(mean = 0, stdDev = 1): number {
    // u must be strictly positive or log(0) blows up.
    const u = 1 - this.next()
    const v = this.next()
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /**
   * Log-normal. Human reaction and decision latencies are right-skewed — most
   * responses cluster near a floor with a long tail of "I got distracted".
   * A symmetric normal would produce impossibly fast outliers as often as slow
   * ones, and fast outliers are exactly what reads as robotic.
   */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma))
  }

  /** Log-normal clamped to a plausible window, so the tail cannot stall a task. */
  latency(median: number, sigma: number, min: number, max: number): number {
    return clamp(this.logNormal(median, sigma), min, max)
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * Ornstein–Uhlenbeck process: noise that wanders but is pulled back to a mean.
 *
 * This is what makes an idle crosshair look alive. White noise jitters around
 * the centre with no memory and reads as a vibration; a random walk drifts away
 * and never returns. Real hand tremor does both — it wanders, then corrects.
 */
export class OrnsteinUhlenbeck {
  private value = 0

  constructor(
    private readonly rng: Rng,
    /** Pull-back strength per second. Higher = tighter around the mean. */
    private readonly theta: number,
    /** Volatility. Higher = larger excursions. */
    private readonly sigma: number,
  ) {}

  /** Advance by `dt` seconds and return the new offset. */
  step(dt: number): number {
    this.value += -this.theta * this.value * dt + this.sigma * Math.sqrt(dt) * this.rng.normal()
    return this.value
  }

  get current(): number {
    return this.value
  }
}
