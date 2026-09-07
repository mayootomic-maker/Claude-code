import { render } from 'preact'
import { App } from './ui/App'
import { WorkbenchContext, type Workbench } from './ui/context'
import { Store } from './state/store'
import { AudioHost } from './state/audio'
import { library } from './state/files'
import './style.css'

const store = new Store()
const audio = new AudioHost()
const workbench: Workbench = { store, audio }

// Open whatever is in songs/, preferring one the URL asks for.
const wanted = new URLSearchParams(location.search).get('song')
const entries = library()
const chosen = entries.find((entry) => entry.name === wanted) ?? entries[0]
if (chosen) store.loadText(chosen.source, chosen.name)

/**
 * A song file changing on disk swaps into the running app.
 *
 * This is the other half of the collaboration loop: someone edits the JSON in
 * an editor, and the app they are listening to picks it up without a reload.
 * Local changes win — reloading over unsaved work would be a way to lose it.
 */
if (import.meta.hot) {
  import.meta.hot.accept('virtual:notewright-songs', (updated) => {
    const module = updated as { songs?: { name: string; source: string }[] } | undefined
    const current = store.get()
    const match = module?.songs?.find((entry) => entry.name === current.name)
    if (!match) return
    if (current.dirty) {
      store.notify(`${current.name}.song.json changed on disk, but you have unsaved changes here.`, 'error')
      return
    }
    if (store.loadText(match.source, match.name)) {
      store.notify(`Reloaded ${match.name}.song.json from disk`)
    }
  })
}

const root = document.getElementById('app')
if (root) {
  render(
    <WorkbenchContext.Provider value={workbench}>
      <App />
    </WorkbenchContext.Provider>,
    root,
  )
}

// A small scripting surface. Useful from the console, and it is what the
// browser tests drive rather than a separate build of the engine.
Object.assign(window, { notewright: { store, audio } })
