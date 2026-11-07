/** What the engine synth needs to know about a car. Pure data, shared with the audio worklet. */
export interface EngineProfile {
  cylinders: 4 | 5 | 6
  layout: 'inline' | 'flat' | 'v'
  turbo: boolean
  /** rpm */
  idle: number
  /** rpm */
  redline: number
}

const p = (cylinders: 4 | 5 | 6, layout: EngineProfile['layout'], turbo: boolean, idle: number, redline: number): EngineProfile =>
  ({ cylinders, layout, turbo, idle, redline })

const PROFILES: Record<string, EngineProfile> = {
  piccola: p(4, 'inline', false, 900, 7000),
  ventura: p(4, 'inline', false, 850, 6500),
  kestrel: p(4, 'inline', false, 900, 7800),
  ruska: p(4, 'inline', false, 850, 6800),
  saetta: p(6, 'v', false, 900, 7800),
  bison: p(6, 'inline', false, 800, 6500),
  falco: p(6, 'v', false, 900, 8000),
  boxer: p(5, 'inline', true, 950, 7800),
  vulcan: p(4, 'inline', true, 950, 8000),
  corsaire: p(4, 'flat', true, 900, 7500),
  strada: p(4, 'inline', true, 950, 7800),
  apex: p(4, 'inline', true, 1000, 8200),
}

/** A plausible engine for each car; unknown ids get a generic naturally aspirated four. */
export function engineProfileFor(carId: string): EngineProfile {
  return PROFILES[carId] ?? PROFILES.piccola
}

/**
 * Per-layout character. Firing angles are where each exhaust pulse *arrives* at
 * the collector, in crank degrees over the 720° four-stroke cycle, so unequal
 * headers (the boxer burble) are just uneven arrival angles. `amp` is the
 * per-cylinder pulse strength: the spread between cylinders is what puts energy
 * at the half-orders and makes a five warble and a boxer lump.
 */
export interface Voicing {
  fire: number[]
  amp: number[]
  /** pulse width, crank degrees */
  width: number
  /** exhaust body and pipe resonances, Hz */
  body: number
  pipe: number
  pipeQ: number
  /** extra saturation: buzz */
  drive: number
  /** cycle-to-cycle combustion jitter at idle */
  lump: number
  /** intake formant base, Hz */
  intake: number
  /** induction honk: the airbox's own low resonance, Hz */
  honk: number
  /** 0..1 how much hard edge the exhaust gets under load */
  rasp: number
  /** 0..1 intake roar under load */
  roar: number
  /** 0..1 turbo whistle; ignored for naturally aspirated engines */
  whistle: number
  /** overrun crackle and anti-lag appetite */
  crackle: number
}

export function voicingFor(pr: EngineProfile): Voicing {
  const even = (n: number) => Array.from({ length: n }, (_, i) => (i * 720) / n)
  // A turbo sits in the exhaust: it soaks up rasp and adds whistle, and with
  // anti-lag it bangs far more on a lift than any naturally aspirated engine.
  const t = pr.turbo
  if (pr.layout === 'flat') {
    // Unequal-length headers: pulses arrive in pairs, then a gap. That is the burble.
    return { fire: [0, 212, 360, 568], amp: [1, 0.74, 1.12, 0.8], width: 175, body: 105, pipe: 380, pipeQ: 3.5, drive: 1.2, lump: 0.32, intake: 650, honk: 290, rasp: 0.45, roar: 0.7, whistle: 0.9, crackle: t ? 1.2 : 0.8 }
  }
  if (pr.cylinders === 5) {
    // Firing every 144°: a half-order warble no four or six has.
    return { fire: even(5).map((a, i) => a + [0, 7, -5, 10, -3][i]), amp: [1, 0.84, 1.1, 0.88, 1.03], width: 150, body: 135, pipe: 440, pipeQ: 4.5, drive: 1.35, lump: 0.2, intake: 800, honk: 350, rasp: t ? 0.7 : 0.85, roar: 0.85, whistle: 1, crackle: t ? 1.4 : 0.9 }
  }
  if (pr.cylinders === 6 && pr.layout === 'v') {
    // Two banks into two pipes: alternate pulses differ, which deepens the note.
    return { fire: even(6), amp: [1, 0.82, 1, 0.82, 1, 0.82], width: 140, body: 95, pipe: 330, pipeQ: 3, drive: 1.1, lump: 0.12, intake: 700, honk: 320, rasp: 0.55, roar: 0.9, whistle: 0.8, crackle: 0.8 }
  }
  if (pr.cylinders === 6) {
    // Perfect balance: smooth and rising to a howl rather than a bark.
    return { fire: even(6), amp: [1, 0.97, 1.02, 0.98, 1.01, 0.96], width: 125, body: 140, pipe: 620, pipeQ: 2.5, drive: 0.85, lump: 0.08, intake: 900, honk: 470, rasp: 0.7, roar: 0.8, whistle: 0.8, crackle: 0.6 }
  }
  // Inline four: tight and buzzy; unboosted ones scream through the airbox.
  return { fire: even(4).map((a, i) => a + [0, 3, -2, 2][i]), amp: [1, 0.92, 1.05, 0.95], width: 145, body: 160, pipe: 540, pipeQ: 5.5, drive: 1.6, lump: 0.18, intake: 950, honk: 410, rasp: t ? 0.6 : 0.95, roar: t ? 0.65 : 1, whistle: 1.1, crackle: t ? 1.5 : 0.75 }
}
