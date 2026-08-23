/**
 * The session list, as the catalog produces it.
 *
 * Round-tripped through the real database rather than assembled in memory, so the shape here is
 * one the storage layer can actually produce. A fixture that never touched storage would let
 * this screen be built against a shape the database cannot deliver.
 */
export interface StoredSessionSummary {
  readonly id: string;
  readonly game: string;
  /** Session epoch in .NET UTC ticks. Converted for display only, never for arithmetic. */
  readonly epochUtcTicks: number;
  readonly durationMs: number;
  readonly frameCount: number;
  readonly stutterCount: number;
  readonly state: 'Open' | 'Finalized' | 'Recovered' | 'Aborted';
  /**
   * Smallest excess the detector could resolve during this session.
   *
   * Null when it was never established. Surfaced because "0 stutters" means something different
   * on a session that could resolve 3 ms from one that could only resolve 30 ms, and without it
   * the two rows are indistinguishable.
   */
  readonly sensitivityFloorMs: number | null;
  /**
   * Whether this session may seed a baseline.
   *
   * Shown per row rather than as a footnote. A session excluded for a measurement problem looks
   * identical to an included one, and comparing across the two manufactures a regression out of
   * something that never happened to the machine.
   */
  readonly baselineEligible: boolean;
}

/** .NET ticks are 100 ns since year 1; JavaScript milliseconds are since 1970. */
const TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

export function sessionStartedAt(session: StoredSessionSummary): Date {
  return new Date((session.epochUtcTicks - TICKS_AT_UNIX_EPOCH) / 10_000);
}

const base = import.meta.env.BASE_URL ?? '/';

export async function loadSessions(): Promise<StoredSessionSummary[]> {
  const response = await fetch(`${base}scenarios/sessions.json`);
  if (!response.ok) throw new Error(`Session list unavailable (${response.status})`);
  return (await response.json()) as StoredSessionSummary[];
}
