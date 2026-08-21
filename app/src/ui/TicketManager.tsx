/**
 * Ticket vault UI.
 *
 * Images are the first-class path and the copy says to screenshot your ticket,
 * because a PDF has to go through the browser's own viewer — slower and less
 * reliable in a standalone PWA on iOS. Better to say that here than to have
 * you discover it with an inspector waiting.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import {
  ACCEPTED_TYPES,
  addTicket,
  loadVault,
  removeTicket,
  ticketKind,
  ticketUrl,
  type Ticket,
} from '../lib/vault'
import { t as translate } from '../lib/store'

export function TicketManager() {
  const t = translate.value
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    void loadVault().then((vault) => setTickets(vault.tickets))
  }

  useEffect(refresh, [])

  const add = async (file: File) => {
    setError(null)
    const result = await addTicket(file, file.name)
    if (!result.ok) {
      setError(
        result.reason === 'too-large'
          ? t('ticket.tooLarge')
          : result.reason === 'unsupported-type'
            ? t('ticket.unsupported')
            : t('ticket.storageFailed'),
      )
      return
    }
    refresh()
  }

  return (
    <div>
      <p class="pb-3 text-sm text-muted">{t('ticket.addHint')}</p>

      {tickets.length === 0 ? (
        <p class="pb-3 text-sm text-faint">{t('ticket.none')}</p>
      ) : (
        <ul class="space-y-2 pb-3">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              class="flex items-center gap-3 rounded-[var(--radius-card)] border border-line p-2"
            >
              <TicketThumb ticket={ticket} />
              <span class="min-w-0 flex-1 truncate text-sm">{ticket.label}</span>
              <button
                type="button"
                onClick={() => void removeTicket(ticket.id).then(refresh)}
                class="min-h-[var(--tap)] shrink-0 px-2 text-sm font-semibold text-critical"
              >
                {t('ticket.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tickets.some((ticket) => ticketKind(ticket.type) === 'pdf') && (
        <p class="pb-3 text-sm text-warn">{t('ticket.pdfWarning')}</p>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line px-4 font-semibold"
      >
        {t('ticket.add')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        class="sr-only"
        onChange={(event) => {
          const file = (event.target as HTMLInputElement).files?.[0]
          if (file !== undefined) void add(file)
        }}
      />

      {error !== null && (
        <p class="pt-2 text-sm text-critical" role="status">
          {error}
        </p>
      )}
    </div>
  )
}

function TicketThumb({ ticket }: { ticket: Ticket }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (ticketKind(ticket.type) !== 'image') return
    const handle = ticketUrl(ticket)
    setUrl(handle.url)
    // Object URLs live until the document is discarded; leaking several
    // multi-megabyte blobs on a phone is a real cost.
    return handle.revoke
  }, [ticket.id])

  if (url === null) {
    return <span class="grid size-10 shrink-0 place-items-center rounded bg-sunken text-xs">PDF</span>
  }
  return <img src={url} alt="" class="size-10 shrink-0 rounded object-cover" />
}
