import { render } from 'preact'
import { App } from './ui/App'
import { WorkbenchContext, type Workbench } from './ui/context'
import { Store } from './state/store'
import { AudioHost } from './state/audio'
import { openLibrary } from './state/songs'
import './style.css'

const store = new Store()
const audio = new AudioHost()
const library = openLibrary()
const workbench: Workbench = { store, audio, library }

// Open whatever is in the songs folder, preferring one the URL asks for.
const wanted = new URLSearchParams(location.search).get('song')
void library.list().then((entries) => {
  const chosen = entries.find((entry) => entry.name === wanted) ?? entries[0]
  if (chosen && store.get().song.tracks.length === 0) store.loadText(chosen.source, chosen.name)
})

/**
 * The desktop half of the collaboration loop: the shell watches the songs
 * folder and tells us when a file changes. Unsaved work always wins — reloading
 * over it would be a way to lose it.
 */
library.watch((entries) => {
  const current = store.get()
  const match = entries.find((entry) => entry.name === current.name)
  if (!match || match.source === store.text()) return
  if (current.dirty) {
    store.notify(`${current.name}.song.json changed on disk, but you have unsaved changes here.`, 'error')
    return
  }
  if (store.loadText(match.source, match.name)) {
    store.notify(`Reloaded ${match.name}.song.json from disk`)
  }
})

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
Object.assign(window, { notewright: { store, audio, library } })
