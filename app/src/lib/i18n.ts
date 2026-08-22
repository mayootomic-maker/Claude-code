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

  'transfer.title': 'Umstieg {stop}',
  'transfer.comfortable': '{min} Min Umsteigezeit',
  'transfer.tight': 'Knapp: {min} Min Umsteigezeit',
  'transfer.broken': 'Umstieg verpasst',
  'transfer.unknown': 'Umstieg {min} Min — keine Echtzeitdaten',
  'transfer.delayed': 'Zug {min} Min verspätet',
  'transfer.nextViable': 'Nächste sichere Verbindung wird gesucht',

  'onboard.title': 'Du bist unterwegs',
  'onboard.line': '{line} Richtung {destination}',
  'onboard.since': 'Abgefahren {time}',
  'onboard.notMyTrain': 'Doch nicht dieser Zug',

  'insp.title': 'Kontrollen',
  'insp.button': 'Kontrolle',
  'insp.logged': 'Kontrolle erfasst',
  'insp.estimate': 'Kontrolle: ~1 von {oneIn} Fahrten',
  'insp.never': 'Bisher keine Kontrolle erfasst',
  'insp.insufficient': 'Zu wenig Daten',
  'insp.insufficientHint': 'Noch {missing} Fahrten, dann gibt es eine Schätzung.',
  'insp.basis': 'Aus {inspections} von {rides} Fahrten',
  'insp.hotSegment': 'Meist zwischen {from} und {to}',
  'insp.weekdayHigher': 'An diesem Wochentag häufiger',
  'insp.weekdayLower': 'An diesem Wochentag seltener',
  'insp.disclaimer': 'Basiert nur auf deinen eigenen Fahrten.',
  'insp.basisPrior': 'Grobe Annahme — noch kaum Daten',
  'insp.basisCategory': 'Aus deinen {rides} Fahrten mit {category}',
  'insp.basisAll': 'Aus deinen bisher {rides} erfassten Fahrten',
  'insp.basisTrip': 'Aus {inspections} von {rides} Fahrten mit diesem Zug',
  'insp.priorQuestion': 'Wie oft wirst du etwa kontrolliert?',
  'insp.priorHint': 'Nur ein Startwert. Deine echten Fahrten ersetzen ihn nach und nach.',
  'insp.priorRarely': 'Selten',
  'insp.priorSometimes': 'Ab und zu',
  'insp.priorOften': 'Oft',
  'insp.priorSkip': 'Weiss ich nicht',
  'insp.showTicket': 'Billett zeigen',
  'insp.stats': 'Statistik',
  'insp.noneLogged': 'Noch nichts erfasst',

  'ticket.title': 'Billett',
  'ticket.add': 'Billett hinzufügen',
  'ticket.addHint': 'Screenshot deines Billetts. Bleibt nur auf diesem Gerät.',
  'ticket.pdfWarning': 'PDF wird vom Browser geöffnet — auf dem iPhone langsamer und weniger zuverlässig als ein Screenshot.',
  'ticket.tooLarge': 'Datei zu gross (max. 8 MB)',
  'ticket.unsupported': 'Nur PNG, JPEG, WebP oder PDF',
  'ticket.storageFailed': 'Speichern fehlgeschlagen',
  'ticket.remove': 'Entfernen',
  'ticket.close': 'Schliessen',
  'ticket.none': 'Kein Billett hinterlegt',
  'ticket.openPdf': 'PDF öffnen',

  'board.title': 'Abfahrten',
  'board.search': 'Haltestelle suchen',
  'board.nearby': 'In der Nähe',
  'board.empty': 'Keine Abfahrten',
  'board.pickStop': 'Haltestelle wählen',

  'routes.title': 'Routen',
  'routes.add': 'Route hinzufügen',
  'routes.walk': 'Fussweg',
  'routes.note': 'Notiz',
  'routes.notePlaceholder': 'z. B. Wagen 3 — beim Ausgang',
  'routes.delete': 'Löschen',
  'routes.save': 'Speichern',
  'routes.empty': 'Noch keine Route',
  'routes.confirmDelete': 'Route wirklich löschen?',

  'settings.title': 'Einstellungen',
  'settings.language': 'Sprache',
  'settings.theme': 'Erscheinungsbild',
  'settings.themeSystem': 'System',
  'settings.themeLight': 'Hell',
  'settings.themeDark': 'Dunkel',
  'settings.alertThreshold': 'Hinweis ab Verspätung',
  'settings.data': 'Daten',
  'settings.export': 'Daten exportieren',
  'settings.exportHint': 'Routen, Kontroll-Log und Einstellungen als Datei.',
  'settings.import': 'Daten importieren',
  'settings.importDone': '{routes} Routen, {rides} Fahrten, {inspections} Kontrollen importiert',
  'settings.importFailed': 'Datei nicht lesbar',
  'settings.backupOverdue': 'Letzte Sicherung ist lange her',
  'settings.backupOverdueHint': 'iOS löscht App-Daten nach längerer Nichtnutzung. Exportiere dein Kontroll-Log.',
  'settings.noPersistence': 'Kein dauerhafter Speicher',
  'settings.noPersistenceHint': 'Der Browser speichert nichts. Daten gehen beim Schliessen verloren.',
  'settings.sources': 'Datenquellen',
  'settings.sourcesHint': 'Fahrplandaten: transport.opendata.ch und opentransportdata.swiss.',
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

  'transfer.title': 'Change at {stop}',
  'transfer.comfortable': '{min} min to change',
  'transfer.tight': 'Tight: {min} min to change',
  'transfer.broken': 'Connection missed',
  'transfer.unknown': '{min} min to change — no live data',
  'transfer.delayed': 'Train {min} min late',
  'transfer.nextViable': 'Finding the next connection that holds',

  'onboard.title': 'You are on board',
  'onboard.line': '{line} toward {destination}',
  'onboard.since': 'Departed {time}',
  'onboard.notMyTrain': 'Not this train',

  'insp.title': 'Inspections',
  'insp.button': 'Inspection',
  'insp.logged': 'Inspection logged',
  'insp.estimate': 'Inspection: about 1 in {oneIn} rides',
  'insp.never': 'No inspection logged yet',
  'insp.insufficient': 'Not enough data',
  'insp.insufficientHint': '{missing} more rides and there will be an estimate.',
  'insp.basis': 'From {inspections} of {rides} rides',
  'insp.hotSegment': 'Usually between {from} and {to}',
  'insp.weekdayHigher': 'More frequent on this weekday',
  'insp.weekdayLower': 'Less frequent on this weekday',
  'insp.disclaimer': 'Based only on your own rides.',
  'insp.basisPrior': 'Rough assumption — barely any data yet',
  'insp.basisCategory': 'From your {rides} rides on {category}',
  'insp.basisAll': 'From the {rides} rides you have logged so far',
  'insp.basisTrip': 'From {inspections} of {rides} rides on this train',
  'insp.priorQuestion': 'Roughly how often do you get checked?',
  'insp.priorHint': 'Just a starting point. Your actual rides replace it over time.',
  'insp.priorRarely': 'Rarely',
  'insp.priorSometimes': 'Now and then',
  'insp.priorOften': 'Often',
  'insp.priorSkip': "I don't know",
  'insp.showTicket': 'Show ticket',
  'insp.stats': 'Statistics',
  'insp.noneLogged': 'Nothing logged yet',

  'ticket.title': 'Ticket',
  'ticket.add': 'Add ticket',
  'ticket.addHint': 'A screenshot of your ticket. Stays on this device only.',
  'ticket.pdfWarning': 'PDFs open in the browser viewer — slower and less reliable on iPhone than a screenshot.',
  'ticket.tooLarge': 'File too large (max 8 MB)',
  'ticket.unsupported': 'Only PNG, JPEG, WebP or PDF',
  'ticket.storageFailed': 'Could not save',
  'ticket.remove': 'Remove',
  'ticket.close': 'Close',
  'ticket.none': 'No ticket stored',
  'ticket.openPdf': 'Open PDF',

  'board.title': 'Departures',
  'board.search': 'Search for a stop',
  'board.nearby': 'Nearby',
  'board.empty': 'No departures',
  'board.pickStop': 'Choose a stop',

  'routes.title': 'Routes',
  'routes.add': 'Add route',
  'routes.walk': 'Walk',
  'routes.note': 'Note',
  'routes.notePlaceholder': 'e.g. coach 3 — by the exit',
  'routes.delete': 'Delete',
  'routes.save': 'Save',
  'routes.empty': 'No routes yet',
  'routes.confirmDelete': 'Delete this route?',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Appearance',
  'settings.themeSystem': 'System',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.alertThreshold': 'Alert from delay of',
  'settings.data': 'Data',
  'settings.export': 'Export data',
  'settings.exportHint': 'Routes, inspection log and settings as a file.',
  'settings.import': 'Import data',
  'settings.importDone': 'Imported {routes} routes, {rides} rides, {inspections} inspections',
  'settings.importFailed': 'File could not be read',
  'settings.backupOverdue': 'Last backup was a while ago',
  'settings.backupOverdueHint': 'iOS clears app data after periods of inactivity. Export your inspection log.',
  'settings.noPersistence': 'No persistent storage',
  'settings.noPersistenceHint': 'The browser is not storing anything. Data is lost when you close it.',
  'settings.sources': 'Data sources',
  'settings.sourcesHint': 'Timetable data: transport.opendata.ch and opentransportdata.swiss.',
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
