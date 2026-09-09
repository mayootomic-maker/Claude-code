/**
 * What the bot remembers between sessions.
 *
 * Three kinds of thing, and they earn their keep differently:
 *
 *  - **Places.** Named locations the owner referred to ("home", "the mine").
 *  - **Sightings.** Where blocks worth caring about were last seen. These feed
 *    straight back into the planner as `searchOverrides`, which is what makes
 *    the second diamond run cheaper than the first: a remembered vein forty
 *    blocks away beats the generic "diamonds take four minutes to find" prior.
 *  - **Episodes.** What was attempted and how it went, so the model has some
 *    idea what it already tried and what happened.
 *
 * Stored as one JSON file, written atomically. A database would be a heavier
 * dependency than the data justifies — this is a few hundred kilobytes at
 * worst, and being able to read and edit it in a text editor is worth more than
 * query performance nobody needs.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { Vec3Like } from './types.js'
import { SECONDS_PER_BLOCK_TRAVEL } from '../plan/cost.js'
import type { Logger } from '../util/log.js'

export interface Place {
  readonly name: string
  readonly position: Vec3Like
  readonly dimension: string
  readonly note?: string
  readonly savedAt: number
}

export interface Sighting {
  readonly block: string
  readonly position: Vec3Like
  /** Where the bot was standing when it saw it, for a travel estimate. */
  readonly seenFrom: Vec3Like
  readonly seenAt: number
}

export interface Episode {
  readonly at: number
  readonly task: string
  readonly outcome: 'done' | 'failed' | 'cancelled'
  readonly detail: string
  readonly seconds: number
}

interface MemoryFile {
  version: 1
  places: Place[]
  sightings: Sighting[]
  episodes: Episode[]
  deaths: Array<{ at: number; position: Vec3Like; cause: string }>
}

/** Sightings older than this are probably mined out or misremembered. */
const SIGHTING_TTL_MS = 1000 * 60 * 60 * 24 * 3

/** Keep the file bounded: the newest N of each kind survive a save. */
const LIMITS = { sightings: 400, episodes: 200, deaths: 40 }

export class Memory {
  private data: MemoryFile = { version: 1, places: [], sightings: [], episodes: [], deaths: [] }
  private dirty = false

  private constructor(
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  static async open(profile: string, log: Logger, directory?: string): Promise<Memory> {
    const root = directory ?? join(homedir(), '.golem')
    const memory = new Memory(join(root, `${profile}.json`), log)
    await memory.load()
    return memory
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (isMemoryFile(parsed)) {
        this.data = parsed
        this.log.info('memory loaded', {
          places: parsed.places.length,
          sightings: parsed.sightings.length,
        })
        return
      }
      this.log.warn('memory file did not parse; starting fresh', { path: this.path })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // A missing file on first run is expected, not a problem to report.
      if (code !== 'ENOENT') this.log.warn('could not read memory', { error: String(error) })
    }
  }

  /** Write atomically: a crash mid-write must not leave a truncated file. */
  async save(): Promise<void> {
    if (!this.dirty) return
    this.prune()
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8')
    await rename(temporary, this.path)
    this.dirty = false
  }

  private prune(): void {
    this.data.sightings = newest(this.data.sightings, (s) => s.seenAt, LIMITS.sightings)
    this.data.episodes = newest(this.data.episodes, (e) => e.at, LIMITS.episodes)
    this.data.deaths = newest(this.data.deaths, (d) => d.at, LIMITS.deaths)
  }

  // ------------------------------------------------------------------ places

  remember(name: string, position: Vec3Like, dimension: string, note?: string): void {
    const key = name.toLowerCase().trim()
    this.data.places = this.data.places.filter((p) => p.name !== key)
    this.data.places.push({ name: key, position, dimension, note, savedAt: Date.now() })
    this.dirty = true
  }

  place(name: string): Place | null {
    return this.data.places.find((p) => p.name === name.toLowerCase().trim()) ?? null
  }

  places(): readonly Place[] {
    return this.data.places
  }

  forget(name: string): boolean {
    const before = this.data.places.length
    this.data.places = this.data.places.filter((p) => p.name !== name.toLowerCase().trim())
    this.dirty = this.dirty || this.data.places.length !== before
    return this.data.places.length !== before
  }

  // --------------------------------------------------------------- sightings

  sawBlock(block: string, position: Vec3Like, seenFrom: Vec3Like): void {
    // One sighting per block kind per rough area: recording every diamond ore
    // in a vein separately would fill the file with the same information.
    const near = this.data.sightings.find(
      (s) => s.block === block && distance(s.position, position) < 12,
    )
    if (near) return
    this.data.sightings.push({ block, position, seenFrom, seenAt: Date.now() })
    this.dirty = true
  }

  /**
   * Remembered block locations as planner search overrides.
   *
   * Converts "there is deepslate diamond ore at these coordinates" into "finding
   * diamond ore costs about ninety seconds", which is the form the cost model
   * consumes. This is the single highest-value thing in memory: it is the
   * difference between the planner guessing and the planner knowing.
   */
  searchTimes(from?: Vec3Like): ReadonlyMap<string, number> {
    const out = new Map<string, number>()
    const now = Date.now()

    for (const sighting of this.data.sightings) {
      if (now - sighting.seenAt > SIGHTING_TTL_MS) continue
      const origin = from ?? sighting.seenFrom
      const seconds = distance(origin, sighting.position) * SECONDS_PER_BLOCK_TRAVEL
      const existing = out.get(sighting.block)
      if (existing === undefined || seconds < existing) out.set(sighting.block, seconds)
    }
    return out
  }

  sightings(block?: string): readonly Sighting[] {
    return block ? this.data.sightings.filter((s) => s.block === block) : this.data.sightings
  }

  // ---------------------------------------------------------------- episodes

  record(episode: Episode): void {
    this.data.episodes.push(episode)
    this.dirty = true
  }

  recent(limit = 8): readonly Episode[] {
    return this.data.episodes.slice(-limit)
  }

  died(position: Vec3Like, cause: string): void {
    this.data.deaths.push({ at: Date.now(), position, cause })
    this.dirty = true
  }

}

function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function newest<T>(items: T[], at: (item: T) => number, limit: number): T[] {
  if (items.length <= limit) return items
  return [...items].sort((a, b) => at(a) - at(b)).slice(items.length - limit)
}

/**
 * Validate the file at the boundary rather than trusting it.
 *
 * It is a file on disk that a person may well have edited by hand, which makes
 * it exactly as untrusted as anything off a network.
 */
function isMemoryFile(value: unknown): value is MemoryFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<MemoryFile>
  return (
    v.version === 1 &&
    Array.isArray(v.places) &&
    Array.isArray(v.sightings) &&
    Array.isArray(v.episodes) &&
    Array.isArray(v.deaths)
  )
}
