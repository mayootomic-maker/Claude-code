/**
 * Connecting the app to your deployed Worker.
 *
 * Entirely optional. Without it the app calls transport.opendata.ch directly
 * and works fine — it just cannot show occupancy or disruptions, because that
 * data only exists behind an OJP key, and the key can only live server-side.
 *
 * The test button matters: a wrong token and an unreachable host fail in ways
 * that look identical from the Now screen, where you would only notice as a
 * missing occupancy chip.
 */

import { useState } from 'preact/hooks'
import { settings, t as translate, updateSettings } from '../lib/store'

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; source: string }
  | { kind: 'auth' }
  | { kind: 'unreachable' }

export function WorkerSettings() {
  const t = translate.value
  const current = settings.value

  const [url, setUrl] = useState(current.workerUrl ?? '')
  const [token, setToken] = useState(current.deviceToken ?? '')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const save = async (nextUrl: string, nextToken: string) => {
    await updateSettings({
      workerUrl: nextUrl.trim() === '' ? null : nextUrl.trim().replace(/\/$/, ''),
      deviceToken: nextToken.trim() === '' ? null : nextToken.trim(),
    })
  }

  const test = async () => {
    setStatus({ kind: 'testing' })
    await save(url, token)

    const base = url.trim().replace(/\/$/, '')
    if (base === '') {
      setStatus({ kind: 'unreachable' })
      return
    }

    try {
      // A real departures call, not /health: only this exercises the token and
      // tells us which upstream actually answered.
      const response = await fetch(`${base}/departures?stopId=8503000&limit=1`, {
        headers: { 'x-pendlo-token': token.trim() },
      })
      if (response.status === 401 || response.status === 403) {
        setStatus({ kind: 'auth' })
        return
      }
      if (!response.ok) {
        setStatus({ kind: 'unreachable' })
        return
      }
      const body = (await response.json()) as { source?: unknown }
      setStatus({ kind: 'ok', source: typeof body.source === 'string' ? body.source : 'unknown' })
    } catch {
      setStatus({ kind: 'unreachable' })
    }
  }

  return (
    <div>
      <p class="pb-3 text-sm text-muted">{t('worker.hint')}</p>

      <label class="block text-sm font-medium text-muted" for="worker-url">
        {t('worker.url')}
      </label>
      <input
        id="worker-url"
        type="url"
        inputMode="url"
        autocomplete="off"
        placeholder="https://pendlo-solo.<name>.workers.dev"
        value={url}
        onInput={(event) => setUrl((event.target as HTMLInputElement).value)}
        onBlur={() => void save(url, token)}
        class="mt-1 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line bg-bg px-3 text-base"
      />

      <label class="mt-3 block text-sm font-medium text-muted" for="worker-token">
        {t('worker.token')}
      </label>
      <input
        id="worker-token"
        // A password field so it is not left on screen in a café; it never
        // leaves the device either way.
        type="password"
        autocomplete="off"
        value={token}
        onInput={(event) => setToken((event.target as HTMLInputElement).value)}
        onBlur={() => void save(url, token)}
        class="mt-1 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line bg-bg px-3 text-base"
      />
      <p class="mt-1 text-xs text-faint">{t('worker.tokenHint')}</p>

      <button
        type="button"
        onClick={() => void test()}
        class="mt-3 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line px-4 font-semibold"
      >
        {status.kind === 'testing' ? t('worker.testing') : t('worker.test')}
      </button>

      <p
        class={`mt-2 min-h-5 text-sm ${
          status.kind === 'ok' ? 'text-ok' : status.kind === 'idle' || status.kind === 'testing' ? 'text-muted' : 'text-critical'
        }`}
        role="status"
      >
        {status.kind === 'ok' && t('worker.ok', { source: status.source })}
        {status.kind === 'auth' && t('worker.authFailed')}
        {status.kind === 'unreachable' && t('worker.unreachable')}
        {status.kind === 'idle' && current.workerUrl === null && t('worker.notSet')}
      </p>
    </div>
  )
}
