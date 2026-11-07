import { rng } from '../core/math'

/**
 * How a rival likes to drive, independent of how good they are. Every value
 * feeds the AI directly (see `AiDriver`), so two characters on the same rung
 * take different lines, brake in different places and fight differently.
 */
export interface Personality {
  /** 0..1: dives for gaps, follows closer, gives less room alongside. */
  aggression: number
  /** 0..1: fewer mistakes, less fatigue, steadier under pressure. */
  consistency: number
  /** -1 early apex … +1 late apex. */
  apex: number
  /** 0..1: how much of the road width the line uses (1 kerb to kerb). */
  line: number
  /** 0..1: Scandinavian flicks and handbrake entries into anything tighter than a fast bend. */
  drift: number
  /** 0..1: brakes later and harder than the rest. */
  lateBrake: number
  /** 0..1: covers the line when someone is close behind. */
  defence: number
  /** -1 wilts under pressure and when trailing … +1 takes more risk the further behind it is. */
  pressure: number
}

export interface Bilingual {
  en: string
  de: string
}

export interface Character {
  /** Matches the rival id in content.json, so career standings and races share the same people. */
  id: string
  /** A short tag for the style; no two characters share one. */
  style: Bilingual
  bio: Bilingual
  quote: Bilingual
  p: Personality
}

/** The rivals' characters, fictional people. Names and nationalities live with the rest of the rival data. */
export const CHARACTERS: readonly Character[] = [
  {
    id: 'r1',
    style: { en: 'The Metronome', de: 'Das Metronom' },
    bio: { en: 'Grew up on forest roads near Jyväskylä. Same line, same braking point, every single time.', de: 'Aufgewachsen auf Waldwegen bei Jyväskylä. Gleiche Linie, gleicher Bremspunkt, jedes Mal.' },
    quote: { en: '"The road does the talking. I just listen."', de: '„Die Straße spricht. Ich höre nur zu.“' },
    p: { aggression: 0.45, consistency: 0.97, apex: 0, line: 1, drift: 0.5, lateBrake: 0.5, defence: 0.5, pressure: 0.2 },
  },
  {
    id: 'r2',
    style: { en: 'The Professor', de: 'Der Professor' },
    bio: { en: 'An engineer before a driver. Late apexes, tidy exits, and a notebook for every corner.', de: 'Erst Ingenieur, dann Fahrer. Späte Scheitelpunkte, saubere Ausgänge und ein Notizbuch für jede Kurve.' },
    quote: { en: '"Slow in, fast out. It is not a slogan, it is geometry."', de: '„Langsam rein, schnell raus. Kein Spruch, sondern Geometrie.“' },
    p: { aggression: 0.35, consistency: 0.88, apex: 0.9, line: 1, drift: 0.1, lateBrake: 0.3, defence: 0.7, pressure: 0 },
  },
  {
    id: 'r3',
    style: { en: 'The Pendulum', de: 'Das Pendel' },
    bio: { en: 'Learned to drive on frozen lakes. Throws the car sideways a corner early and hangs on.', de: 'Fahren gelernt auf zugefrorenen Seen. Wirft das Auto eine Kurve zu früh quer und hält es fest.' },
    quote: { en: '"If you are not sideways, you are not trying."', de: '„Wer nicht quer fährt, gibt sich keine Mühe.“' },
    p: { aggression: 0.6, consistency: 0.62, apex: -0.2, line: 1, drift: 1, lateBrake: 0.45, defence: 0.35, pressure: 0.3 },
  },
  {
    id: 'r4',
    style: { en: 'The Late Braker', de: 'Der Spätbremser' },
    bio: { en: 'Brakes where everyone else is already turning in. Sometimes it works.', de: 'Bremst dort, wo alle anderen schon einlenken. Manchmal geht das gut.' },
    quote: { en: '"Brakes only slow you down."', de: '„Bremsen macht nur langsam.“' },
    p: { aggression: 0.8, consistency: 0.5, apex: 0.3, line: 0.95, drift: 0.35, lateBrake: 1, defence: 0.4, pressure: 0.6 },
  },
  {
    id: 'r5',
    style: { en: 'The Surgeon', de: 'Der Chirurg' },
    bio: { en: 'Tarmac specialist. Never puts a wheel off the road, never makes the same mistake twice.', de: 'Asphaltspezialist. Setzt nie ein Rad neben die Straße und macht keinen Fehler zweimal.' },
    quote: { en: '"Smooth is fast. Messy is a lottery ticket."', de: '„Sauber ist schnell. Schlampig ist Lotterie.“' },
    p: { aggression: 0.3, consistency: 0.94, apex: 0.15, line: 0.9, drift: 0.15, lateBrake: 0.4, defence: 0.45, pressure: -0.2 },
  },
  {
    id: 'r6',
    style: { en: 'The Wall', de: 'Die Mauer' },
    bio: { en: 'Impossible to pass in the wet and not much easier in the dry. Owns the inside line.', de: 'Im Regen nicht zu überholen und im Trockenen kaum leichter. Die Innenbahn gehört ihm.' },
    quote: { en: '"You want past? Bring a map."', de: '„Vorbei? Bring eine Landkarte mit.“' },
    p: { aggression: 0.4, consistency: 0.78, apex: -0.6, line: 0.92, drift: 0.25, lateBrake: 0.5, defence: 1, pressure: 0.1 },
  },
  {
    id: 'r7',
    style: { en: 'The Firecracker', de: 'Der Feuerwerkskörper' },
    bio: { en: 'All attack, all the time. Wins stages and loses rallies in the same afternoon.', de: 'Immer Angriff. Gewinnt Prüfungen und verliert Rallyes am selben Nachmittag.' },
    quote: { en: '"Second is just the first one to lose."', de: '„Zweiter ist nur der erste Verlierer.“' },
    p: { aggression: 1, consistency: 0.32, apex: 0, line: 1, drift: 0.7, lateBrake: 0.75, defence: 0.3, pressure: 0.9 },
  },
  {
    id: 'r8',
    style: { en: 'The Showman', de: 'Der Showman' },
    bio: { en: 'Drives for the spectators at every hairpin. The stopwatch is a secondary concern.', de: 'Fährt in jeder Haarnadel fürs Publikum. Die Stoppuhr kommt danach.' },
    quote: { en: '"Nobody buys a poster of a tidy lap."', de: '„Niemand kauft ein Poster von einer sauberen Runde.“' },
    p: { aggression: 0.7, consistency: 0.45, apex: 0.2, line: 1, drift: 0.9, lateBrake: 0.6, defence: 0.3, pressure: 0.35 },
  },
  {
    id: 'r9',
    style: { en: 'The Strategist', de: 'Die Strategin' },
    bio: { en: 'Measures the gap, not the corner. Cruises when ahead and turns it up when she has to.', de: 'Misst den Abstand, nicht die Kurve. Fährt vorne kontrolliert und legt nach, wenn es sein muss.' },
    quote: { en: '"Only the time at the finish counts."', de: '„Es zählt nur die Zeit im Ziel.“' },
    p: { aggression: 0.5, consistency: 0.82, apex: 0.4, line: 0.96, drift: 0.3, lateBrake: 0.5, defence: 0.65, pressure: 0.5 },
  },
  {
    id: 'r10',
    style: { en: 'Flat Out', de: 'Vollgas' },
    bio: { en: 'Uses every centimetre of road and a few of the ditch. Lifts only when the co-driver screams.', de: 'Nutzt jeden Zentimeter Straße und ein paar vom Graben. Geht nur vom Gas, wenn der Beifahrer schreit.' },
    quote: { en: '"Flat. It is always flat."', de: '„Voll. Es ist immer voll.“' },
    p: { aggression: 0.75, consistency: 0.55, apex: -0.3, line: 1, drift: 0.5, lateBrake: 0.7, defence: 0.4, pressure: 0.4 },
  },
  {
    id: 'r11',
    style: { en: 'The Worrier', de: 'Der Grübler' },
    bio: { en: 'Quick on his own, a bag of nerves in a mirror. Gets ragged when someone is close.', de: 'Allein schnell, im Rückspiegel ein Nervenbündel. Wird fahrig, wenn jemand dicht dran ist.' },
    quote: { en: '"Is that you behind me? Please be patient."', de: '„Bist du das hinter mir? Bitte etwas Geduld.“' },
    p: { aggression: 0.25, consistency: 0.5, apex: 0.1, line: 0.88, drift: 0.2, lateBrake: 0.35, defence: 0.2, pressure: -0.9 },
  },
  {
    id: 'r12',
    style: { en: 'The Long Game', de: 'Der lange Atem' },
    bio: { en: 'Never the fastest on the first kilometre, never slower on the last. Does not tire.', de: 'Auf dem ersten Kilometer nie die Schnellste, auf dem letzten nie langsamer. Wird nicht müde.' },
    quote: { en: '"Rallies are won in the last stage, not the first corner."', de: '„Rallyes gewinnt man auf der letzten Prüfung, nicht in der ersten Kurve.“' },
    p: { aggression: 0.25, consistency: 0.92, apex: 0.5, line: 0.94, drift: 0.4, lateBrake: 0.45, defence: 0.35, pressure: 0.15 },
  },
]

/** A middle-of-the-road driver, for tests and for any rival without a character. */
export const NEUTRAL: Personality = { aggression: 0.5, consistency: 0.75, apex: 0, line: 1, drift: 0.3, lateBrake: 0.5, defence: 0.5, pressure: 0 }

export function character(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id)
}

/** A country code as its flag: two regional-indicator letters. */
export function flag(nat: string): string {
  if (!/^[A-Z]{2}$/.test(nat)) return ''
  return String.fromCodePoint(...[...nat].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

const KEYS: (keyof Personality)[] = ['aggression', 'consistency', 'apex', 'line', 'drift', 'lateBrake', 'defence', 'pressure']

/** How differently two characters drive: distance between their personalities. */
export function styleDistance(a: Personality, b: Personality): number {
  let d = 0
  for (const k of KEYS) d += (a[k] - b[k]) ** 2
  return Math.sqrt(d)
}

/**
 * Picks `n` characters for a race from the indices in `pool`: the first at
 * random, then each next one the most different from those already picked
 * among a few random candidates, so a grid never holds three of a kind.
 * Seeded: the same stage always draws the same field.
 */
export function pickField(pool: readonly number[], n: number, seed: number, persona: (i: number) => Personality): number[] {
  const r = rng(seed)
  const left = pool.slice()
  const out: number[] = []
  while (out.length < n && left.length) {
    if (!out.length) {
      out.push(left.splice(Math.floor(r() * left.length), 1)[0])
      continue
    }
    let best = 0, bestD = -1
    for (let k = 0; k < Math.min(4, left.length); k++) {
      const i = Math.floor(r() * left.length)
      const c = persona(left[i])
      const d = Math.min(...out.map((j) => styleDistance(c, persona(j))))
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    out.push(left.splice(best, 1)[0])
  }
  return out
}
