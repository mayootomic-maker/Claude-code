/**
 * Where songs come from and go back to.
 *
 * Three backends behind one interface, because the app runs in three places
 * and the difference between them is real and worth being honest about:
 *
 *   desktop  a folder on your disk. Saving writes a file; editing that file in
 *            a text editor reaches the running app. Both directions work.
 *   dev      the Vite dev server, doing the same thing for the repo's songs/.
 *   browser  songs baked into the bundle. Saving is a download, because a web
 *            page has nowhere to put a file.
 *
 * The interface does not pretend the third case is the first. `canSave` and
 * `folder` are how the interface tells the user which one they are in.
 */
import { canWriteToDisk, songs as bundledSongs } from 'virtual:notewright-songs'

export interface LibraryEntry {
  name: string
  source: string
}

export type Backend = 'desktop' | 'dev' | 'browser'

export interface SongLibrary {
  readonly backend: Backend
  /** True when saving writes a file rather than starting a download. */
  readonly canSave: boolean
  /** The folder songs live in, when there is one to show the user. */
  folder(): Promise<string | null>
  list(): Promise<LibraryEntry[]>
  /** Returns null on success, or a message worth showing. */
  save(name: string, text: string): Promise<string | null>
  /** Opens the folder in Finder or Explorer, where that means anything. */
  reveal(): Promise<string | null>
  /** Calls back when the folder changes underneath the app. */
  watch(handler: (entries: LibraryEntry[]) => void): () => void
}

/** Tauri injects this before any of our code runs. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const noWatch = (): (() => void) => () => {}

const browserLibrary: SongLibrary = {
  backend: 'browser',
  canSave: false,
  folder: async () => null,
  list: async () => bundledSongs,
  save: async () =>
    'This is the web version, which has no folder to write to — use Download, or install the app.',
  reveal: async () => 'There is no folder to open in the web version.',
  watch: noWatch,
}

const devLibrary: SongLibrary = {
  backend: 'dev',
  canSave: true,
  folder: async () => 'songs/',
  list: async () => bundledSongs,
  async save(name, text) {
    try {
      const response = await fetch(`/__songs/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: text,
      })
      if (!response.ok) return `The dev server refused the save: ${await response.text()}`
      return null
    } catch (error) {
      return `Could not reach the dev server: ${(error as Error).message}`
    }
  },
  reveal: async () => 'Open the songs/ folder in your editor.',
  // The dev server pushes changes through Vite's hot update channel instead,
  // which main.tsx is already listening to.
  watch: noWatch,
}

function desktopLibrary(): SongLibrary {
  const core = import('@tauri-apps/api/core')
  const events = import('@tauri-apps/api/event')

  return {
    backend: 'desktop',
    canSave: true,
    async folder() {
      try {
        return await (await core).invoke<string>('songs_folder')
      } catch {
        return null
      }
    },
    async list() {
      try {
        return await (await core).invoke<LibraryEntry[]>('list_songs')
      } catch {
        // Falling back to the bundled songs beats an empty screen, and the
        // interface still shows that saving is not working.
        return bundledSongs
      }
    },
    async save(name, text) {
      try {
        await (await core).invoke('write_song', { name, source: text })
        return null
      } catch (error) {
        return typeof error === 'string' ? error : `Could not save: ${String(error)}`
      }
    },
    async reveal() {
      try {
        await (await core).invoke('reveal_songs_folder')
        return null
      } catch (error) {
        return typeof error === 'string' ? error : `Could not open the folder: ${String(error)}`
      }
    },
    watch(handler) {
      let stop: (() => void) | null = null
      let cancelled = false
      void events.then(async ({ listen }) => {
        const unlisten = await listen<LibraryEntry[]>('songs-changed', (event) => handler(event.payload))
        if (cancelled) unlisten()
        else stop = unlisten
      })
      return () => {
        cancelled = true
        stop?.()
      }
    },
  }
}

export function openLibrary(): SongLibrary {
  if (isDesktop()) return desktopLibrary()
  return canWriteToDisk ? devLibrary : browserLibrary
}
