/**
 * German and English copy.
 *
 * The dictionary is the source of truth for the key type, so a missing or
 * misspelled key is a compile error rather than a blank space on screen.
 *
 * Station names and disruption texts arrive from the API in German regardless
 * of this setting — that is what the operators publish — so the English build
 * is an English shell around German place names, which is how every Swiss
 * transport app behaves.
 */

import type { Settings } from './types'

const de = {
  'app.name': 'Pendlo',

  'now.leaveIn': 'Losgehen in',
  'now.goNow': 'Jetzt losgehen',
  'now.goNowHint': 'Zug fährt in {min} Min',
  'now.minutes': 'Min',
  'now.departsAt': 'Abfahrt {time}',
  'now.platform': 'Gleis {platform}',
  'now.toward': 'Richtung {destination}',
  'now.nextUp': 'Danach',
  'now.noRealtime': 'Keine Echtzeitdaten',
  'now.noRealtimeHint': 'Fahrplanzeit — Verspätungen nicht sichtbar',
  'now.onTime': 'Pünktlich',
  'now.late': '+{min} Min',
  'now.cancelled': 'Fällt aus',
  'now.cancelledHint': 'Diese Verbindung fällt aus',
  'now.cancelledSkipped': '{line} um {time} fällt aus',
  'now.cancelledSkippedHint': 'Nächste fahrende Verbindung wird angezeigt.',
  'now.nothingLeft': 'Heute keine Verbindung mehr',
  'now.nothingLeftHint': 'Für diese Route fährt heute nichts mehr.',
  'now.flip': 'Richtung wechseln',
  'now.walkAssumed': 'Ab {origin} gerechnet',

  'state.loading': 'Verbindungen werden geladen',
  'state.offline': 'Offline',
  'state.offlineHint': 'Fahrplanzeiten von {age} — Verspätungen nicht sichtbar.',
  'state.stale': 'Stand {age}',
  'state.error': 'Daten nicht erreichbar',
  'state.errorHint': 'Der Fahrplandienst antwortet nicht.',
  'state.retry': 'Erneut versuchen',
  'state.usingFallback': 'Ersatzquelle',
  'state.droppedSome': '{count} Abfahrt(en) unlesbar',

  'onboarding.welcome': 'Willkommen',
  'onboarding.intro': 'Drei Angaben, dann weiss die App, wann du losmusst.',
  'onboarding.originLabel': 'Von welcher Haltestelle fährst du?',
  'onboarding.destinationLabel': 'Wohin pendelst du?',
  'onboarding.walkLabel': 'Wie lange läufst du zur Haltestelle?',
  'onboarding.walkHint': 'Diese Zahl bestimmt, wann du losgehen musst. Du kannst sie später anpassen.',
  'onboarding.searchPlaceholder': 'Haltestelle suchen',
  'onboarding.useLocation': 'Nächste Haltestelle verwenden',
  'onboarding.locating': 'Standort wird ermittelt',
  'onboarding.locationDenied': 'Kein Standortzugriff — bitte suchen',
  'onboarding.noResults': 'Keine Haltestelle gefunden',
  'onboarding.searchFailed': 'Suche nicht erreichbar',
  'onboarding.continue': 'Weiter',
  'onboarding.finish': 'Fertig',
  'onboarding.back': 'Zurück',
  'onboarding.minutesOnFoot': '{min} Min zu Fuss',

  'nav.now': 'Jetzt',
  'nav.board': 'Abfahrten',
  'nav.routes': 'Routen',
  'nav.settings': 'Einstellungen',

  'time.justNow': 'gerade eben',
  'time.minutesAgo': 'vor {min} Min',
  'time.hoursAgo': 'vor {h} Std',
} as const

export type MessageKey = keyof typeof de

const en: Record<MessageKey, string> = {
  'app.name': 'Pendlo',

  'now.leaveIn': 'Leave in',
  'now.goNow': 'Leave now',
  'now.goNowHint': 'Train departs in {min} min',
  'now.minutes': 'min',
  'now.departsAt': 'Departs {time}',
  'now.platform': 'Platform {platform}',
  'now.toward': 'Toward {destination}',
  'now.nextUp': 'After that',
  'now.noRealtime': 'No live data',
  'now.noRealtimeHint': 'Timetabled time — delays not visible',
  'now.onTime': 'On time',
  'now.late': '+{min} min',
  'now.cancelled': 'Cancelled',
  'now.cancelledHint': 'This service is cancelled',
  'now.cancelledSkipped': '{line} at {time} is cancelled',
  'now.cancelledSkippedHint': 'Showing the next service that is running.',
  'now.nothingLeft': 'Nothing left today',
  'now.nothingLeftHint': 'No further departures on this route today.',
  'now.flip': 'Switch direction',
  'now.walkAssumed': 'Calculated from {origin}',

  'state.loading': 'Loading departures',
  'state.offline': 'Offline',
  'state.offlineHint': 'Timetable from {age} — delays not visible.',
  'state.stale': 'As of {age}',
  'state.error': 'Data unavailable',
  'state.errorHint': 'The timetable service is not responding.',
  'state.retry': 'Try again',
  'state.usingFallback': 'Backup source',
  'state.droppedSome': '{count} departure(s) unreadable',

  'onboarding.welcome': 'Welcome',
  'onboarding.intro': 'Three answers, and the app knows when you need to leave.',
  'onboarding.originLabel': 'Which stop do you leave from?',
  'onboarding.destinationLabel': 'Where do you commute to?',
  'onboarding.walkLabel': 'How long is your walk to the stop?',
  'onboarding.walkHint': 'This number decides when you must leave. You can adjust it later.',
  'onboarding.searchPlaceholder': 'Search for a stop',
  'onboarding.useLocation': 'Use nearest stop',
  'onboarding.locating': 'Finding your location',
  'onboarding.locationDenied': 'No location access — please search',
  'onboarding.noResults': 'No stop found',
  'onboarding.searchFailed': 'Search unavailable',
  'onboarding.continue': 'Continue',
  'onboarding.finish': 'Done',
  'onboarding.back': 'Back',
  'onboarding.minutesOnFoot': '{min} min on foot',

  'nav.now': 'Now',
  'nav.board': 'Departures',
  'nav.routes': 'Routes',
  'nav.settings': 'Settings',

  'time.justNow': 'just now',
  'time.minutesAgo': '{min} min ago',
  'time.hoursAgo': '{h} h ago',
}

const dictionaries = { de, en } satisfies Record<Settings['language'], Record<MessageKey, string>>

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

export function translator(language: Settings['language']): Translate {
  const dictionary = dictionaries[language]
  return (key, vars) => {
    const template = dictionary[key]
    if (vars === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name]
      return value === undefined ? match : String(value)
    })
  }
}

/** Picks a starting language from the browser, defaulting to German. */
export function detectLanguage(languages: readonly string[]): Settings['language'] {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'de') return 'de'
    if (base === 'en') return 'en'
  }
  return 'de'
}
