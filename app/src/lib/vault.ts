/**
 * The ticket vault.
 *
 * Stores your ticket on the device so it opens instantly, full-screen, at
 * maximum contrast — with no network. That last part matters more than it
 * sounds: inspections happen in tunnels and on rural stretches, which is
 * exactly where a ticket that needs loading is useless.
 *
 * Nothing here ever leaves the device. No upload, no account, no server.
 *
 * ## On PDFs
 *
 * My plan said PDFs would be "converted to an image once at import". That is
 * not achievable in a browser without shipping pdf.js, which is roughly seven
 * times the size of this entire app — an unreasonable cost for a personal
 * commute tool.
 *
 * So: images are the first-class path, and the UI says to screenshot your
 * ticket. A PDF can still be stored and opened, but it is handed to the
 * browser's own viewer rather than rendered inline, which means it is slower
 * and less reliable in a standalone PWA on iOS. The app tells you that rather
 * than letting you discover it in front of an inspector.
 */

import { dbDelete, dbGet, dbSet } from './db'

const VAULT_KEY = 'ticket-vault'

/** Well beyond any screenshot, and far under the ~50 MB iOS PWA storage ceiling. */
export const MAX_TICKET_BYTES = 8 * 1024 * 1024

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

export type Ticket = {
  id: string
  label: string
  /** MIME type as reported by the file. */
  type: string
  /** Stored as a Blob: IndexedDB handles binary natively, unlike localStorage. */
  blob: Blob
  addedAt: number
}

export type StoredVault = { tickets: Ticket[] }

const EMPTY: StoredVault = { tickets: [] }

export type TicketKind = 'image' | 'pdf'

export function ticketKind(type: string): TicketKind {
  return type === 'application/pdf' ? 'pdf' : 'image'
}

export type AddResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: 'too-large' | 'unsupported-type' | 'storage-failed' }

export async function loadVault(): Promise<StoredVault> {
  try {
    const stored = await dbGet<unknown>(VAULT_KEY)
    if (typeof stored !== 'object' || stored === null) return EMPTY

    const tickets = (stored as Partial<StoredVault>).tickets
    if (!Array.isArray(tickets)) return EMPTY

    // A Blob that failed to round-trip (some private modes) must not crash the
    // screen; drop it and keep whatever survived.
    return { tickets: tickets.filter((t): t is Ticket => t?.blob instanceof Blob) }
  } catch {
    return EMPTY
  }
}

export async function addTicket(file: File, label: string): Promise<AddResult> {
  if (!ACCEPTED_TYPES.includes(file.type)) return { ok: false, reason: 'unsupported-type' }
  if (file.size > MAX_TICKET_BYTES) return { ok: false, reason: 'too-large' }

  const ticket: Ticket = {
    id: newId(),
    label: label.trim() === '' ? file.name : label.trim(),
    type: file.type,
    blob: file,
    addedAt: Date.now(),
  }

  try {
    const vault = await loadVault()
    await dbSet(VAULT_KEY, { tickets: [...vault.tickets, ticket] })
    return { ok: true, ticket }
  } catch {
    return { ok: false, reason: 'storage-failed' }
  }
}

export async function removeTicket(id: string): Promise<void> {
  const vault = await loadVault()
  const remaining = vault.tickets.filter((t) => t.id !== id)
  if (remaining.length === 0) await dbDelete(VAULT_KEY)
  else await dbSet(VAULT_KEY, { tickets: remaining })
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Keeps the screen awake while a ticket is shown.
 *
 * There is **no web API to set screen brightness** — an earlier draft of the
 * plan claimed otherwise and was wrong. What is achievable, and what this does:
 * prevent the screen sleeping mid-inspection, and render on pure white at full
 * contrast, which both scans better and nudges auto-brightness upward on its
 * own.
 *
 * Returns a release function; wake locks are dropped when a tab is backgrounded
 * and must be re-acquired on return.
 */
export async function keepScreenAwake(): Promise<() => void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
  }
  if (nav.wakeLock === undefined) return () => undefined

  let sentinel: { release: () => Promise<void> } | null = null

  const acquire = async () => {
    try {
      sentinel = await nav.wakeLock!.request('screen')
    } catch {
      // Denied (battery saver, permissions). The ticket still displays; it may
      // just dim. Not worth surfacing as an error.
      sentinel = null
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void acquire()
  }

  await acquire()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    void sentinel?.release().catch(() => undefined)
    sentinel = null
  }
}

/**
 * An object URL for a ticket, plus its revoker.
 *
 * Callers must revoke: object URLs live until the document is discarded, and
 * leaking several multi-megabyte blobs on a phone is a real cost.
 */
export function ticketUrl(ticket: Ticket): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(ticket.blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
