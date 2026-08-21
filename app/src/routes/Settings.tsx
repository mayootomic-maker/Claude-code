/**
 * Settings, and the data-durability controls.
 *
 * Export is not a nice-to-have here. iOS clears PWA storage after periods of
 * inactivity, and the inspection log is months of hand-collected data that
 * cannot be reconstructed from anywhere. `storage.persist()` is a request the
 * browser may decline; a file in your downloads folder is not.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import {
  backupOverdue,
  exportData,
  exportFilename,
  importData,
  lastBackupAt,
  log,
  markBackedUp,
  persistenceAvailable,
  settings,
  t as translate,
  updateSettings,
} from '../lib/store'
import { clock } from '../lib/live'
import { Banner, formatAge } from '../ui/status'
import { TicketManager } from '../ui/TicketManager'
import type { Settings as SettingsType } from '../lib/types'

export function Settings() {
  const t = translate.value
  const current = settings.value
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const now = clock.now()
  const overdue = backupOverdue(now)

  const doExport = async () => {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exportFilename(now)
    anchor.click()
    // Revoke on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    await markBackedUp(now)
  }

  const doImport = async (file: File) => {
    try {
      const result = await importData(await file.text())
      setImportStatus(t('settings.importDone', result))
    } catch {
      setImportStatus(t('settings.importFailed'))
    }
  }

  return (
    <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header class="safe-top pb-3">
        <h1 class="text-xl font-bold">{t('settings.title')}</h1>
      </header>

      <div class="safe-bottom flex-1 space-y-6">
        {!persistenceAvailable.value && (
          <Banner
            tone="error"
            title={t('settings.noPersistence')}
            detail={t('settings.noPersistenceHint')}
          />
        )}

        {overdue && (
          <Banner
            tone="warn"
            title={t('settings.backupOverdue')}
            detail={t('settings.backupOverdueHint')}
            action={{ label: t('settings.export'), onClick: () => void doExport() }}
          />
        )}

        <Group label={t('settings.language')}>
          <Choice
            value={current.language}
            options={[
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(language) => void updateSettings({ language })}
          />
        </Group>

        <Group label={t('settings.theme')}>
          <Choice
            value={current.theme}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
            ]}
            onChange={(theme) => void updateSettings({ theme })}
          />
        </Group>

        <Group label={t('settings.alertThreshold')}>
          <Choice
            value={String(current.delayAlertMinutes)}
            options={[3, 5, 10].map((n) => ({ value: String(n), label: `${n} ${t('now.minutes')}` }))}
            onChange={(value) => void updateSettings({ delayAlertMinutes: Number(value) })}
          />
        </Group>

        <Group label={t('ticket.title')}>
          <TicketManager />
        </Group>

        <Group label={t('settings.data')}>
          <p class="pb-3 text-sm text-muted">{t('settings.exportHint')}</p>

          <button
            type="button"
            onClick={() => void doExport()}
            class="min-h-[var(--tap)] w-full rounded-[var(--radius-card)] bg-accent px-4 font-semibold text-on-accent"
          >
            {t('settings.export')}
          </button>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            class="mt-2 min-h-[var(--tap)] w-full rounded-[var(--radius-card)] border border-line px-4 font-semibold"
          >
            {t('settings.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="sr-only"
            onChange={(event) => {
              const file = (event.target as HTMLInputElement).files?.[0]
              if (file !== undefined) void doImport(file)
            }}
          />

          {importStatus !== null && (
            <p class="pt-2 text-sm text-muted" role="status">
              {importStatus}
            </p>
          )}

          <dl class="pt-3 text-sm text-muted">
            <div class="flex justify-between py-0.5">
              <dt>{t('insp.title')}</dt>
              <dd>
                {log.value.inspections.length} / {log.value.rides.length}
              </dd>
            </div>
            {lastBackupAt.value !== null && (
              <div class="flex justify-between py-0.5">
                <dt>{t('settings.export')}</dt>
                <dd>{formatAge(now - lastBackupAt.value, t)}</dd>
              </div>
            )}
          </dl>
        </Group>

        <Group label={t('settings.sources')}>
          <p class="text-sm text-muted">{t('settings.sourcesHint')}</p>
        </Group>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <section>
      <h2 class="pb-2 text-xs font-semibold tracking-wide text-faint uppercase">{label}</h2>
      {children}
    </section>
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" class="flex gap-2">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            class={`min-h-[var(--tap)] flex-1 rounded-[var(--radius-card)] border px-3 text-sm font-semibold ${
              active ? 'border-accent bg-accent text-on-accent' : 'border-line text-muted'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Applies the stored theme to the document root. */
export function useAppliedTheme(theme: SettingsType['theme'], language: SettingsType['language']) {
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    root.lang = language
  }, [theme, language])
}
