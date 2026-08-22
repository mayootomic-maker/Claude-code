/**
 * A line number, rendered the way Swiss transport actually renders it.
 *
 * Every real departure board — station displays, SBB's own app, the signage on
 * the platform — shows the line as a coloured badge, and people navigate by
 * that colour before they read the text. Rendering "IR 16" as plain bold text
 * throws away the fastest recognition cue there is.
 *
 * Colours follow the categories rather than exact operator branding: the point
 * is instant separation of long-distance from regional from city transit, not
 * a pixel match to SBB's palette.
 */

type Size = 'sm' | 'md' | 'lg'

/** Groups of product categories that share a colour. */
const FAMILIES: ReadonlyArray<{ match: RegExp; classes: string }> = [
  // Long-distance. SBB red is the strongest signal on any Swiss board.
  { match: /^(IC|ICE|EC|EN|NJ|RJX?|TGV|PE)$/, classes: 'bg-[oklch(52%_0.21_25)] text-white' },
  // InterRegio and regional express: a deep slate that reads as "fast, but not IC".
  { match: /^(IR|RE|PE)$/, classes: 'bg-[oklch(38%_0.06_255)] text-white' },
  // S-Bahn: blue, as in every Swiss S-Bahn network map.
  { match: /^(S|SN)$/, classes: 'bg-[oklch(48%_0.15_255)] text-white' },
  // Ordinary regional.
  { match: /^(R|RB)$/, classes: 'bg-[oklch(45%_0.04_255)] text-white' },
  // Bus and PostAuto: yellow, which needs dark text to stay legible.
  { match: /^(B|BUS|NFB|PB)$/, classes: 'bg-[oklch(80%_0.15_85)] text-[oklch(25%_0.02_85)]' },
  // Tram.
  { match: /^(T|TRAM)$/, classes: 'bg-[oklch(42%_0.10_150)] text-white' },
  // Boats and funiculars.
  { match: /^(BAT|FAE)$/, classes: 'bg-[oklch(55%_0.11_215)] text-white' },
  { match: /^(FUN|GB|LB|ASC)$/, classes: 'bg-[oklch(45%_0.07_60)] text-white' },
]

const FALLBACK = 'bg-sunken text-ink'

const SIZES: Record<Size, string> = {
  sm: 'min-w-[2.5rem] px-1.5 py-0.5 text-xs',
  md: 'min-w-[3rem] px-2 py-0.5 text-sm',
  lg: 'min-w-[3.5rem] px-2.5 py-1 text-base',
}

function classesFor(category: string): string {
  const normalised = category.trim().toUpperCase()
  for (const family of FAMILIES) {
    if (family.match.test(normalised)) return family.classes
  }
  return FALLBACK
}

export function LineBadge({
  line,
  category,
  size = 'md',
}: {
  /** Full label, e.g. "IR 16" or "IR16". */
  line: string
  /** Product category used for the colour, e.g. "IR". */
  category: string
  size?: Size
}) {
  // Spaces are dropped so "IR 16" and "IR16" render at the same width; boards
  // are read as a column and ragged badges are harder to scan.
  const label = line.replace(/\s+/g, '')
  if (label === '') return null

  return (
    <span
      class={`inline-flex shrink-0 items-center justify-center rounded font-bold tracking-tight tabular-nums ${SIZES[size]} ${classesFor(category)}`}
    >
      {label}
    </span>
  )
}
