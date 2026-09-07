/**
 * The Files tab.
 *
 * It shows the song's own text, live, next to the controls that save it. That
 * is not a debug view — it is the point of the whole application. If you can
 * see what the file says while you edit, you can edit the file directly, and so
 * can anyone else working on it with you.
 */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Button, SelectField, TextField } from './controls'
import { useAppState, useWorkbench } from './context'
import { canSaveToDisk, downloadSong, exportWav, library, saveToDisk } from '../state/files'
import { newSongNamed } from '../state/store'
import { buildTimeline, timelineDuration } from '../engine/sequencer'

export function Files(): JSX.Element {
  const { store } = useWorkbench()
  const state = useAppState()
  const song = state.song
  const text = store.text()
  const entries = library()
  const [busy, setBusy] = useState<string | null>(null)
  const [bitDepth, setBitDepth] = useState<'16' | '24'>('16')
  const timeline = buildTimeline(song)
  const seconds = timelineDuration(timeline, song.tempo, 0)

  const save = async (): Promise<void> => {
    setBusy('Saving…')
    const error = await saveToDisk(state.name, text)
    setBusy(null)
    if (error) store.notify(error, 'error')
    else {
      store.markSaved()
      store.notify(`Wrote songs/${state.name}.song.json`)
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
          <Button tone="primary" disabled={busy !== null} onClick={() => void save()}>
            {canSaveToDisk ? 'Save to songs/' : 'Save (needs the dev server)'}
          </Button>
          <Button onClick={() => downloadSong(state.name, text)}>Download</Button>
        </div>
        {!canSaveToDisk && (
          <p class="hint">
            This is a built copy with no dev server behind it, so saving writes a download instead of touching
            the project folder. Run <code>npm run dev</code> to edit songs in place.
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
          <Button
            onClick={() => {
              if (state.dirty && !confirm('Start a new song and lose unsaved changes?')) return
              store.load(newSongNamed('Untitled'), 'untitled', [])
            }}
          >
            New song
          </Button>
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
