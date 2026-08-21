import { useEffect, useState } from 'preact/hooks'
import { hasRoutes, loaded, load, settings } from './lib/store'
import { requestPersistence } from './lib/db'
import { Now } from './routes/Now'
import { Onboarding } from './routes/Onboarding'

export function App() {
  const [, force] = useState(0)

  useEffect(() => {
    void load()
    // Asked on every launch: iOS can drop the grant, and re-requesting is
    // cheap. Export/import is the real safety net — see lib/store.ts.
    void requestPersistence()
  }, [])

  // Theme is applied to the root element so CSS can resolve tokens before
  // first paint of any component.
  useEffect(() => {
    const theme = settings.value.theme
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    root.lang = settings.value.language
  }, [settings.value.theme, settings.value.language])

  if (!loaded.value) return null
  if (!hasRoutes.value) return <Onboarding onDone={() => force((n) => n + 1)} />
  return <Now />
}
