/**
 * The AI skill ladder, from a rival who can barely keep it on the road to one
 * driving at the limit of what the car can do. One rung sets everything that
 * used to hang off the old three-step difficulty: how the rivals drive, the
 * medal targets, the career field's pace, prize money and rewinds. Player
 * assists are a separate choice (see `game/assists.ts`).
 *
 * The ids of the old Rookie, Driver and Pro are kept as rungs of the same
 * name, so saves, best times and medals keyed by them still mean the same.
 */
export const LEVELS = ['bad', 'wobbly', 'casual', 'rookie', 'amateur', 'club', 'driver', 'semipro', 'pro', 'elite', 'champion', 'legend', 'unbeatable'] as const
export type Difficulty = (typeof LEVELS)[number]
export const TOP_LEVEL = LEVELS.length - 1

export const levelIndex = (d: Difficulty): number => Math.max(0, LEVELS.indexOf(d))
export const levelAt = (i: number): Difficulty => LEVELS[Math.max(0, Math.min(TOP_LEVEL, Math.round(i)))]
export const isLevel = (v: unknown): v is Difficulty => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

/** How one rung drives. Personality then pulls each rival a little either way. */
export interface Rung {
  /** Share of the friction circle planned for cornering. */
  grip: number
  /** Share planned for braking: higher means later, harder braking points. */
  brake: number
  /** Clearance kept from the road edge, metres: the best use every centimetre. */
  edge: number
  /** 0..1: how much of the racing line it takes, against sitting in the middle of the road. */
  lineUse: number
  /** Multiplies the planned speed everywhere: the rung's overall commitment. */
  pace: number
  /** Amplitude of the steering wander (fraction of lock). */
  wobble: number
  /** Seconds the hands take to follow what the eyes want. */
  lag: number
  /** Mistakes per kilometre for an average-consistency driver: late braking, running wide, spins. */
  mistakes: number
  /** How bad a mistake is when it happens, 0..1. */
  severity: number
  /**
   * Engine power relative to the player's car. Driving alone tops out a
   * couple of percent past the old Pro (the cars are power-limited most of
   * a stage), so the top four rungs also run a works-prepared engine: that
   * is what makes "no one can beat it" true.
   */
  power: number
  /** Medal targets: gold is this multiple of the stage's ideal time. */
  target: number
  /** Career rivals' pace relative to gold. */
  field: number
  /** Prize multiplier for a race win. */
  reward: number
  /** Rewinds per time-trial stage. */
  rewinds: number
}

/**
 * Tuned by running every rung over whole stages headless (ai.test.ts keeps
 * the order honest). On Finland SS4 the ladder runs from 179 s (Bad) to 123 s
 * (No one can beat it) with Pro at 129 s; Bad spins and runs wide several
 * times a stage, the top rung never makes a mistake. Medal targets above Pro
 * tighten by about what the rungs gain: the stage's ideal time assumes more
 * acceleration than the cars have, so no driver, AI or human, gets near it on
 * the fast stages.
 */
export const RUNGS: Record<Difficulty, Rung> = {
  bad:        { grip: 0.58, brake: 0.42, edge: 2.2, lineUse: 0.3, pace: 0.74, wobble: 0.16, lag: 0.22, mistakes: 4.5, severity: 1.0, power: 1, target: 1.95, field: 1.06, reward: 0.6, rewinds: 9 },
  wobbly:     { grip: 0.63, brake: 0.47, edge: 2.0, lineUse: 0.42, pace: 0.79, wobble: 0.13, lag: 0.19, mistakes: 3.2, severity: 0.9, power: 1, target: 1.75, field: 1.05, reward: 0.7, rewinds: 8 },
  casual:     { grip: 0.69, brake: 0.53, edge: 1.8, lineUse: 0.55, pace: 0.84, wobble: 0.10, lag: 0.16, mistakes: 2.0, severity: 0.8, power: 1, target: 1.57, field: 1.045, reward: 0.8, rewinds: 6 },
  rookie:     { grip: 0.76, brake: 0.59, edge: 1.6, lineUse: 0.65, pace: 0.88, wobble: 0.08, lag: 0.13, mistakes: 1.3, severity: 0.7, power: 1, target: 1.42, field: 1.035, reward: 1.0, rewinds: 5 },
  amateur:    { grip: 0.81, brake: 0.64, edge: 1.45, lineUse: 0.74, pace: 0.91, wobble: 0.065, lag: 0.11, mistakes: 0.9, severity: 0.6, power: 1, target: 1.31, field: 1.03, reward: 1.08, rewinds: 4 },
  club:       { grip: 0.85, brake: 0.68, edge: 1.35, lineUse: 0.82, pace: 0.93, wobble: 0.05, lag: 0.09, mistakes: 0.6, severity: 0.5, power: 1, target: 1.24, field: 1.025, reward: 1.16, rewinds: 4 },
  driver:     { grip: 0.88, brake: 0.71, edge: 1.25, lineUse: 0.88, pace: 0.95, wobble: 0.04, lag: 0.075, mistakes: 0.42, severity: 0.42, power: 1, target: 1.19, field: 1.02, reward: 1.25, rewinds: 3 },
  semipro:    { grip: 0.90, brake: 0.74, edge: 1.2, lineUse: 0.93, pace: 0.97, wobble: 0.03, lag: 0.06, mistakes: 0.28, severity: 0.35, power: 1, target: 1.12, field: 1.012, reward: 1.4, rewinds: 2 },
  pro:        { grip: 0.92, brake: 0.76, edge: 1.15, lineUse: 0.97, pace: 0.985, wobble: 0.02, lag: 0.05, mistakes: 0.18, severity: 0.3, power: 1, target: 1.07, field: 1.005, reward: 1.6, rewinds: 1 },
  elite:      { grip: 0.93, brake: 0.79, edge: 1.08, lineUse: 1, pace: 0.99, wobble: 0.012, lag: 0.035, mistakes: 0.08, severity: 0.25, power: 1.05, target: 1.06, field: 1.0, reward: 1.8, rewinds: 1 },
  champion:   { grip: 0.94, brake: 0.82, edge: 1.0, lineUse: 1, pace: 0.995, wobble: 0.006, lag: 0.02, mistakes: 0.03, severity: 0.2, power: 1.11, target: 1.05, field: 0.995, reward: 2.0, rewinds: 0 },
  legend:     { grip: 0.95, brake: 0.84, edge: 0.95, lineUse: 1, pace: 1.0, wobble: 0.002, lag: 0.01, mistakes: 0.01, severity: 0.15, power: 1.2, target: 1.04, field: 0.99, reward: 2.3, rewinds: 0 },
  unbeatable: { grip: 0.96, brake: 0.86, edge: 0.9, lineUse: 1, pace: 1.0, wobble: 0, lag: 0, mistakes: 0, severity: 0, power: 1.32, target: 1.03, field: 0.985, reward: 2.7, rewinds: 0 },
}
