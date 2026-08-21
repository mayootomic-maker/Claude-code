/**
 * Transfer risk.
 *
 * A missed connection is the worst thing that happens on a commute: you are
 * already committed, standing on a platform, with no good options. It is also
 * the thing most apps handle worst — they show the delay on leg one and leave
 * you to do the arithmetic about leg two while the train is moving.
 *
 * This does that arithmetic. Three outcomes, and when the connection is broken
 * it is the caller's job to show the next viable one rather than a dead plan.
 */

import type { DepartureTiming } from './time'
import { hasRealtime } from './time'
import type { Journey } from './types'

export type TransferVerdict = 'comfortable' | 'tight' | 'broken' | 'unknown'

export type TransferRisk = {
  verdict: TransferVerdict
  /** Where the change happens. */
  stopName: string
  /** Seconds actually available, after delays. Negative means missed. */
  availableSeconds: number
  /** Seconds the station realistically needs. */
  requiredSeconds: number
  /** Delay on the arriving leg, minutes. Null when there is no realtime. */
  arrivalDelayMinutes: number | null
}

/**
 * Minimum transfer time, in seconds.
 *
 * Swiss timetables already build a small buffer into published connections, so
 * this is about whether reality still fits, not about re-planning the journey.
 * Large interchanges need more: platform changes at Zürich HB or Bern can mean
 * a genuine walk, whereas a rural two-platform stop does not.
 */
const DEFAULT_MIN_TRANSFER_SECONDS = 120
const LARGE_STATION_MIN_TRANSFER_SECONDS = 300

/**
 * Stations where a change realistically takes longer.
 *
 * Deliberately a short, explicit list rather than a heuristic on name length or
 * departure count: guessing wrong here tells someone a connection is safe when
 * it is not.
 */
const LARGE_STATIONS = new Set([
  '8503000', // Zürich HB
  '8507000', // Bern
  '8500010', // Basel SBB
  '8501120', // Lausanne
  '8505000', // Luzern
  '8501008', // Genève
  '8506302', // Winterthur
  '8503016', // Zürich Oerlikon
])

export function minimumTransferSeconds(stopId: string): number {
  return LARGE_STATIONS.has(stopId)
    ? LARGE_STATION_MIN_TRANSFER_SECONDS
    : DEFAULT_MIN_TRANSFER_SECONDS
}

/**
 * Classifies one change.
 *
 * `unknown` when the arriving leg has no realtime data: without it we cannot
 * tell whether the connection holds, and claiming "comfortable" on a
 * timetable that may already be wrong is exactly the false reassurance this
 * feature exists to prevent.
 */
export function assessTransfer(input: {
  arrival: DepartureTiming
  departure: DepartureTiming
  stopId: string
  stopName: string
}): TransferRisk {
  const required = minimumTransferSeconds(input.stopId)
  const availableSeconds = Math.round((input.departure.actual - input.arrival.actual) / 1000)

  const base = {
    stopName: input.stopName,
    availableSeconds,
    requiredSeconds: required,
    arrivalDelayMinutes: input.arrival.delayMinutes,
  }

  // A cancelled onward leg is broken regardless of timing.
  if (input.departure.cancelled) return { ...base, verdict: 'broken' }

  if (availableSeconds < required) {
    // Already impossible on the published minimum.
    return { ...base, verdict: availableSeconds <= 0 ? 'broken' : 'tight' }
  }

  if (!hasRealtime(input.arrival)) return { ...base, verdict: 'unknown' }

  // Comfortable means the change holds even if the arrival slips another
  // couple of minutes; anything tighter is worth flagging while you can still
  // act on it.
  const buffer = availableSeconds - required
  return { ...base, verdict: buffer >= 120 ? 'comfortable' : 'tight' }
}

/** Every change in a journey, in order. Single-leg journeys yield none. */
export function assessJourney(journey: Journey): TransferRisk[] {
  const risks: TransferRisk[] = []

  for (let i = 0; i < journey.legs.length - 1; i++) {
    const arriving = journey.legs[i]
    const departing = journey.legs[i + 1]
    if (arriving === undefined || departing === undefined) continue

    risks.push(
      assessTransfer({
        arrival: arriving.arrival,
        departure: departing.departure,
        stopId: arriving.to.id,
        stopName: arriving.to.name,
      }),
    )
  }

  return risks
}

/** The worst change in a journey — what the Now screen should warn about. */
export function worstTransfer(risks: readonly TransferRisk[]): TransferRisk | null {
  const rank: Record<TransferVerdict, number> = {
    broken: 3,
    tight: 2,
    unknown: 1,
    comfortable: 0,
  }

  let worst: TransferRisk | null = null
  for (const risk of risks) {
    if (worst === null || rank[risk.verdict] > rank[worst.verdict]) worst = risk
  }
  return worst
}

/**
 * The first journey whose changes all hold — what to offer when a plan breaks.
 *
 * Returns null rather than a "least bad" option: suggesting a connection we
 * have already computed as missed would be worse than admitting we have
 * nothing.
 */
export function firstViableJourney(
  journeys: readonly Journey[],
  now: number,
): Journey | null {
  for (const journey of journeys) {
    const firstLeg = journey.legs[0]
    if (firstLeg === undefined) continue
    if (firstLeg.departure.cancelled) continue
    if (firstLeg.departure.actual <= now) continue

    const risks = assessJourney(journey)
    if (risks.some((r) => r.verdict === 'broken')) continue

    return journey
  }
  return null
}
