import { useEffect, useState } from 'preact/hooks'
import { hasRoutes, loaded, load, settings, t as translate } from './lib/store'
import { requestPersistence } from './lib/db'
import { Now } from './routes/Now'
import { Board } from './routes/Board'
import { Routes } from './routes/Routes'
import { Settings } from './routes/Settings'
import { Onboarding } from './routes/Onboarding'
import type { MessageKey } from './lib/i18n'

type Tab = 'now' | 'board' | 'routes' | 'settings'

const TABS: ReadonlyArray<{ id: Tab; label: MessageKey; icon: string }> = [
  { id: 'now', label: 'nav.now', icon: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { id: 'board', label: 'nav.board', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'routes', label: 'nav.routes', icon: 'M6 19V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v10M6 19h12M9 22h6' },
  { id: 'settings', label: 'nav.settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('now')
  const [onboarded, setOnboarded] = useState(0)

  useEffect(() => {
    void load()
    // Asked on every launch: iOS can drop the grant, and re-requesting is
    // cheap. Export/import is the real safety net — see lib/store.ts.
    void requestPersistence()
  }, [])

  // Applied to the root element so tokens resolve before any component paints.
  useEffect(() => {
    const root = document.documentElement
    const theme = settings.value.theme
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    root.lang = settings.value.language
  }, [settings.value.theme, settings.value.language])

  if (!loaded.value) return null
  if (!hasRoutes.value) return <Onboarding onDone={() => setOnboarded((n) => n + 1)} key={onboarded} />

  return (
    <div class="pb-16">
      {tab === 'now' && <Now />}
      {tab === 'board' && <Board />}
      {tab === 'routes' && <Routes />}
      {tab === 'settings' && <Settings />}
      <TabBar current={tab} onChange={setTab} />
    </div>
  )
}

function TabBar({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  const t = translate.value

  return (
    // Fixed to the bottom: every primary action stays within thumb reach, and
    // the safe-area inset keeps it clear of the home indicator.
    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label={t('app.name')}
    >
      <ul class="mx-auto flex max-w-md">
        {TABS.map((entry) => {
          const active = entry.id === current
          return (
            <li key={entry.id} class="flex-1">
              <button
                type="button"
                onClick={() => onChange(entry.id)}
                aria-current={active ? 'page' : undefined}
                class={`flex min-h-[var(--tap)] w-full flex-col items-center justify-center gap-0.5 py-1.5 text-[0.65rem] font-medium ${
                  active ? 'text-accent' : 'text-faint'
                }`}
              >
                <svg viewBox="0 0 24 24" class="size-5" fill="none" aria-hidden="true">
                  <path
                    d={entry.icon}
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                {t(entry.label)}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
