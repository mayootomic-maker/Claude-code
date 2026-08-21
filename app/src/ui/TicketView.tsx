/**
 * Full-screen ticket.
 *
 * Rendered on pure white regardless of theme, at maximum size. There is no web
 * API to raise screen brightness, so the two things that actually help are:
 * holding a wake lock so the screen cannot sleep mid-inspection, and filling
 * the display with white, which scans better and nudges auto-brightness up on
 * its own.
 *
 * Works with no connectivity — the blob is already on the device, which is the
 * whole point, because inspections happen in tunnels.
 */

import { useEffect, useState } from 'preact/hooks'
import { keepScreenAwake, loadVault, ticketKind, ticketUrl, type Ticket } from '../lib/vault'
import { t as translate } from '../lib/store'

export function TicketView({ onClose }: { onClose: () => void }) {
  const t = translate.value
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    let release: (() => void) | null = null
    let revoke: (() => void) | null = null
    let cancelled = false

    void (async () => {
      const vault = await loadVault()
      if (cancelled) return

      const first = vault.tickets[0]
      if (first === undefined) {
        setEmpty(true)
        return
      }

      setTicket(first)
      if (ticketKind(first.type) === 'image') {
        const handle = ticketUrl(first)
        revoke = handle.revoke
        setUrl(handle.url)
      }
      release = await keepScreenAwake()
    })()

    return () => {
      cancelled = true
      release?.()
      revoke?.()
    }
  }, [])

  // Escape closes, as it would in any dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('ticket.title')}
      // Explicit white, not a theme token: the point is maximum contrast for a
      // scanner, in both themes.
      class="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div class="flex-1 overflow-auto p-3">
        {empty ? (
          <p class="pt-8 text-center text-sm text-neutral-600">{t('ticket.none')}</p>
        ) : url !== null ? (
          <img src={url} alt={ticket?.label ?? t('ticket.title')} class="mx-auto h-auto w-full max-w-full" />
        ) : ticket !== null ? (
          <div class="pt-8 text-center">
            <p class="text-sm text-neutral-700">{t('ticket.pdfWarning')}</p>
            <button
              type="button"
              onClick={() => {
                const handle = ticketUrl(ticket)
                window.open(handle.url, '_blank', 'noopener')
                // The new context keeps its own reference; revoke shortly after
                // so this document does not hold the blob indefinitely.
                setTimeout(handle.revoke, 30_000)
              }}
              class="mt-4 min-h-[var(--tap)] rounded-[var(--radius-card)] bg-neutral-900 px-5 font-semibold text-white"
            >
              {t('ticket.openPdf')}
            </button>
          </div>
        ) : (
          <p class="pt-8 text-center text-sm text-neutral-600">{t('state.loading')}</p>
        )}
      </div>

      <div class="safe-bottom px-4 pb-2">
        <button
          type="button"
          onClick={onClose}
          class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] bg-neutral-900 font-semibold text-white"
        >
          {t('ticket.close')}
        </button>
      </div>
    </div>
  )
}
