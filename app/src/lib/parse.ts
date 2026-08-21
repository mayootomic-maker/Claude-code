/**
 * Boundary validation.
 *
 * Upstream responses are untrusted input: fields documented as present come back
 * null (I confirmed `capacity1st`/`capacity2nd` and `delay` both do), and the
 * volunteer-run API can return an error page instead of JSON. Everything is
 * narrowed here so the rest of the app can rely on its types.
 *
 * Hand-rolled rather than zod: zod costs roughly a quarter of the entire JS
 * budget, and the shapes we consume are few and shallow.
 */

export class ParseError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path || 'root'})`)
    this.name = 'ParseError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ParseError('expected an object', path)
  return value
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ParseError('expected an array', path)
  return value
}

/** A required string. Empty strings are treated as absent. */
export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new ParseError('expected a non-empty string', path)
  }
  return value
}

/** An optional string: null, undefined and '' all collapse to null. */
export function optString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * An optional number.
 *
 * Returns null for null, undefined, NaN and non-numeric input alike — the
 * distinction the app cares about is "we have a value" versus "we do not".
 */
export function optNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // The API occasionally returns numeric strings for coordinates.
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Reads a nested path, returning undefined rather than throwing on any gap. */
export function dig(source: unknown, ...keys: string[]): unknown {
  let current: unknown = source
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/**
 * Maps a list, dropping entries that fail to parse instead of failing the whole
 * response.
 *
 * One malformed departure should not blank the board — but it must not vanish
 * silently either, so callers receive the dropped count and surface it.
 */
export function mapValid<T>(
  items: readonly unknown[],
  path: string,
  parse: (item: unknown, path: string) => T,
): { items: T[]; dropped: number } {
  const out: T[] = []
  let dropped = 0
  for (let i = 0; i < items.length; i++) {
    try {
      out.push(parse(items[i], `${path}[${i}]`))
    } catch {
      dropped++
    }
  }
  return { items: out, dropped }
}
