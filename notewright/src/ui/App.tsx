/** The shell: layout, keyboard shortcuts, and the status line. */
import { useEffect } from 'preact/hooks'
import type { JSX } from 'preact'
import { Transport } from './Transport'
import { TrackRail } from './TrackRail'
import { Arrangement } from './Arrangement'
import { Editor } from './Editor'
import { Mixer } from './Mixer'
import { Files } from './Files'
import { Inspector } from './Inspector'
import { useAppState, useAudioStatus, useWorkbench } from './context'
import { removeNotes } from '../state/actions'
import { saveToDisk, canSaveToDisk } from '../state/files'

export function App(): JSX.Element {
  const { store, audio } = useWorkbench()
  const state = useAppState()
  const { status, problem } = useAudioStatus()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true

      const accel = event.metaKey || event.ctrlKey

      if (accel && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (accel && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void (async () => {
          const error = await saveToDisk(store.get().name, store.text())
          if (error) store.notify(error, 'error')
          else {
            store.markSaved()
            store.notify(`Wrote songs/${store.get().name}.song.json`)
          }
        })()
        return
      }

      if (typing) return

      if (event.key === ' ') {
        event.preventDefault()
        void audio.ensure(store.get().song).then((player) => {
          if (!player) return
          if (player.state.playing) player.stop()
          else player.play()
        })
        return
      }
      if (event.key === 'Home') {
        audio.player?.seek(0)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const { selection } = store.get()
        if (selection.patternId && selection.notes.length > 0) {
          event.preventDefault()
          removeNotes(store, selection.patternId, selection.notes)
          store.select({ notes: [] })
        }
        return
      }
      if (event.key === '1') store.setView('arrange')
      if (event.key === '2') store.setView('edit')
      if (event.key === '3') store.setView('mix')
      if (event.key === '4') store.setView('files')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [audio, store])

  // A notice is a passing remark, not a dialogue box; it clears itself.
  useEffect(() => {
    if (!state.notice) return undefined
    const handle = setTimeout(() => store.clearNotice(), 6000)
    return () => clearTimeout(handle)
  }, [state.notice, store])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!store.get().dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store])

  const engineWarnings = audio.player?.warnings ?? []

  return (
    <div class="app">
      <Transport />

      <div class="workspace" data-panel={state.view === 'files' ? 'hidden' : 'shown'}>
        <TrackRail />
        <main class="main">
          {status === 'idle' && (
            <div class="banner">
              Browsers only start audio after you press something. Hit play, or press space, and the engine
              starts.
            </div>
          )}
          {problem && <div class="banner" data-tone="error">{problem}</div>}
          {engineWarnings.map((warning) => (
            <div class="banner" data-tone="error" key={warning.trackId}>
              {state.song.tracks.find((track) => track.id === warning.trackId)?.name ?? warning.trackId}:{' '}
              {warning.message}
            </div>
          ))}

          {state.view === 'arrange' && <Arrangement />}
          {state.view === 'edit' && <Editor />}
          {state.view === 'mix' && <Mixer />}
          {state.view === 'files' && <Files />}
        </main>
        {state.view !== 'files' && <Inspector />}
      </div>

      <footer class="status">
        <span class="dot" data-state={status} />
        <span>
          {status === 'running'
            ? 'Audio running'
            : status === 'idle'
              ? 'Audio not started'
              : status === 'suspended'
                ? 'Audio held by the browser'
                : 'No audio in this browser'}
        </span>
        <span>·</span>
        <span>
          {state.dirty ? 'Unsaved changes' : canSaveToDisk ? 'Saved' : 'No changes'}
          {state.undoDepth > 0 ? ` · ${state.undoDepth} undo step${state.undoDepth === 1 ? '' : 's'}` : ''}
        </span>
        {state.notice && (
          <>
            <span>·</span>
            <span data-tone={state.notice.tone} role="status">
              {state.notice.text}
            </span>
          </>
        )}
        <span class="spacer" />
        <span class="hint">space play · 1-4 tabs · ⌘Z undo · ⌘S save</span>
      </footer>
    </div>
  )
}
