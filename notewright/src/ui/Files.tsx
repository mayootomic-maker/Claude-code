/**
 * The Files tab.
 *
 * It shows the song's own text, live, next to the controls that save it. That
 * is not a debug view — it is the point of the whole application. If you can
 * see what the file says while you edit, you can edit the file directly, and so
 * can anyone else working on it with you.
 */
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, SelectField, TextField } from './controls'
import { useAppState, useWorkbench } from './context'
import { downloadSong, exportWav } from '../state/files'
import type { LibraryEntry } from '../state/songs'
import { TEMPLATES } from '../state/templates'
import { buildTimeline, timelineDuration } from '../engine/sequencer'

export function Files(): JSX.Element {
  const { store, library } = useWorkbench()
  const state = useAppState()
  const song = state.song
  const text = store.text()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [bitDepth, setBitDepth] = useState<'16' | '24'>('16')
  const timeline = buildTimeline(song)
  const seconds = timelineDuration(timeline, song.tempo, 0)

  const refresh = useCallback(() => {
    void library.list().then(setEntries)
    void library.folder().then(setFolder)
  }, [library])

  useEffect(refresh, [refresh])
  useEffect(() => library.watch(setEntries), [library])

  const save = async (): Promise<void> => {
    setBusy('Saving…')
    const error = await library.save(state.name, text)
    setBusy(null)
    if (error) store.notify(error, 'error')
    else {
      store.markSaved()
      store.notify(`Saved ${state.name}.song.json`)
      refresh()
    }
  }

  const render = async (): Promise<void> => {
    if (timeline.notes.length === 0) {
      store.notify('There are no notes to export yet.', 'error')
      return
    }
    setBusy('Rendering…')
    try {
      const result = await exportWav(song, state.name, { bitDepth: bitDepth === '24' ? 24 : 16 })
      store.notify(
        `Exported ${result.seconds.toFixed(1)}s, peak ${(20 * Math.log10(Math.max(result.peak, 1e-6))).toFixed(1)} dBFS, ${(result.bytes / 1e6).toFixed(1)} MB`,
      )
    } catch (error) {
      store.notify(`The render failed: ${(error as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const open = (name: string, source: string): void => {
    if (state.dirty && !confirm(`${state.name} has unsaved changes. Open ${name} anyway?`)) return
    store.loadText(source, name)
  }

  const importFile = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return
    const name = file.name.replace(/\.song\.json$|\.json$/, '')
    if (store.loadText(await file.text(), name)) store.notify(`Opened ${file.name}`)
  }

  const errors = state.issues.filter((issue) => issue.severity === 'error')
  const warnings = state.issues.filter((issue) => issue.severity === 'warning')

  return (
    <div class="cards">
      <section class="card">
        <h3>This song</h3>
        <TextField label="Title" value={song.title} onChange={(value) => store.edit((draft) => { draft.title = value })} />
        <TextField label="Artist" value={song.artist} onChange={(value) => store.edit((draft) => { draft.artist = value })} />
        <TextField
          label="File name"
          value={state.name}
          onChange={(value) => store.load(song, value.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'untitled', state.issues, { dirty: true })}
        />
        <p class="hint">
          {song.tracks.length} tracks · {song.patterns.length} patterns · {timeline.totalBars} bars ·{' '}
          {timeline.notes.length} notes · {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, '0')}
        </p>
        <div class="row">
          <Button tone="primary" disabled={busy !== null || !library.canSave} onClick={() => void save()}>
            Save
          </Button>
          <Button onClick={() => downloadSong(state.name, text)}>Download</Button>
          {library.backend === 'desktop' && (
            <Button
              onClick={() =>
                void library.reveal().then((error) => error && store.notify(error, 'error'))
              }
            >
              Show folder
            </Button>
          )}
        </div>
        {folder && (
          <p class="hint">
            Songs live in <code>{folder}</code>
            {library.backend === 'desktop'
              ? ' — open one in any text editor and the app picks up your change while it is playing.'
              : '.'}
          </p>
        )}
        {!library.canSave && (
          <p class="hint">
            This is the web version, which has nowhere on your disk to write, so saving is a download. The
            desktop app saves to a real folder you can edit by hand.
          </p>
        )}
      </section>

      <section class="card">
        <h3>Export audio</h3>
        <SelectField
          label="Bit depth"
          value={bitDepth}
          options={[
            { value: '16' as const, label: '16-bit (opens anywhere)' },
            { value: '24' as const, label: '24-bit (for another studio)' },
          ]}
          onChange={setBitDepth}
        />
        <Button tone="primary" disabled={busy !== null} onClick={() => void render()}>
          {busy === 'Rendering…' ? 'Rendering…' : 'Render to WAV'}
        </Button>
        <p class="hint">
          Rendered offline through the same engine you are listening to, so the file sounds like the app.
          Expect roughly a fifth of the song's length in time — about{' '}
          {Math.max(1, Math.round(seconds * 0.2))} seconds for this one.
        </p>
      </section>

      <section class="card">
        <h3>Songs in this project</h3>
        {entries.length === 0 && <p class="hint">No .song.json files in songs/ yet.</p>}
        <div class="list">
          {entries.map((entry) => (
            <button
              key={entry.name}
              type="button"
              class="list-row"
              data-selected={entry.name === state.name}
              onClick={() => open(entry.name, entry.source)}
            >
              <span class="grow">{entry.name}</span>
              <span class="chip">{Math.round(entry.source.length / 1024)} KB</span>
            </button>
          ))}
        </div>
        <div class="row">
          <label>
            <span class="button">Open a file…</span>
            <input
              type="file"
              accept=".json,application/json"
              class="visually-hidden"
              onChange={(event) => void importFile(event.currentTarget.files)}
            />
          </label>
        </div>
      </section>

      <section class="card">
        <h3>Start something</h3>
        <p class="hint">
          Each of these is a playable eight bars, not an empty screen: kick, clap on three, hats with a roll,
          and an 808 that slides and ducks out of the kick's way.
        </p>
        <div class="list">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              class="list-row"
              onClick={() => {
                if (state.dirty && !confirm('Start a new beat and lose unsaved changes?')) return
                store.load(template.build(), 'untitled', [])
                store.setView('arrange')
                store.notify(`Started from ${template.name}`)
              }}
            >
              <span class="grow">
                <strong style="display:block; font-size:12.5px">{template.name}</strong>
                <span class="hint">{template.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section class="card">
        <h3>
          Problems{' '}
          {state.issues.length > 0 && (
            <span class="chip">{errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
          )}
        </h3>
        {state.issues.length === 0 && (
          <p class="hint">Nothing wrong with the file that was loaded. Warnings from a hand edit appear here.</p>
        )}
        <div class="issues">
          {state.issues.map((issue, index) => (
            <div class="issue" key={index} data-severity={issue.severity}>
              <span style="flex:1">{issue.message}</span>
              {issue.where && <code>{issue.where}</code>}
            </div>
          ))}
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1">
        <h3>What the file says right now</h3>
        <p class="hint">
          This is exactly what saving writes. Patterns are step strings — <code>x</code> is a hit,{' '}
          <code>.</code> a rest, <code>~4</code> holds a note four steps — so a change to the music is a
          change you can read in a diff.
        </p>
        <pre class="source">{text}</pre>
      </section>
    </div>
  )
}
