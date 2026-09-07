/**
 * The two-way bridge between the running app and the `songs/` folder.
 *
 * This is what makes Notewright a shared workspace rather than a toy: a song is
 * a file on disk. Edit that file in an editor — or have an agent edit it — and
 * the running app reloads the song without losing its place. Edit it in the app
 * and press save, and the file changes, so the next `git diff` shows exactly
 * what the music now is.
 *
 * Both halves are development-only. A built bundle has no server to write to,
 * so it falls back to the File System Access API and plain downloads.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

const VIRTUAL_ID = 'virtual:notewright-songs'
const RESOLVED_ID = `\0${VIRTUAL_ID}`
const SUFFIX = '.song.json'

/** `songs/night-drive.song.json` → `night-drive`. */
function songName(file: string): string {
  return basename(file, SUFFIX)
}

function isSongFile(file: string): boolean {
  return file.endsWith(SUFFIX) && !basename(file).startsWith('.')
}

async function listSongs(dir: string): Promise<Array<{ name: string; source: string }>> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const songs = await Promise.all(
    entries.filter(isSongFile).sort().map(async (entry) => ({
      name: songName(entry),
      source: await readFile(join(dir, entry), 'utf8'),
    })),
  )
  return songs
}

export function songLibrary(): Plugin {
  let songsDir = ''
  let server: ViteDevServer | undefined

  return {
    name: 'notewright:song-library',

    configResolved(config) {
      songsDir = resolve(config.root, 'songs')
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },

    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      const songs = await listSongs(songsDir)
      // Sources are embedded as strings rather than parsed objects so that the
      // app validates them through exactly the same path as a pasted file.
      return [
        `export const songs = ${JSON.stringify(songs)}`,
        `export const canWriteToDisk = ${JSON.stringify(process.env['NODE_ENV'] !== 'production')}`,
      ].join('\n')
    },

    configureServer(dev) {
      server = dev

      dev.middlewares.use('/__songs', (request, response) => {
        if (request.method !== 'PUT') {
          response.statusCode = 405
          response.end('Only PUT')
          return
        }
        const name = decodeURIComponent((request.url ?? '/').replace(/^\/+/, ''))
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
          response.statusCode = 400
          response.end('Song names may contain letters, digits and dashes only')
          return
        }
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            JSON.parse(body)
          } catch (error) {
            response.statusCode = 400
            response.end(`Refusing to write invalid JSON: ${(error as Error).message}`)
            return
          }
          writeFile(join(songsDir, `${name}${SUFFIX}`), body.endsWith('\n') ? body : `${body}\n`, 'utf8').then(
            () => {
              response.statusCode = 204
              response.end()
            },
            (error: Error) => {
              response.statusCode = 500
              response.end(error.message)
            },
          )
        })
      })
    },

    /**
     * A song file changing on disk invalidates the virtual module, and the app
     * hot-swaps the song in place. The transport keeps running, so you hear the
     * edit land on the next bar rather than after a reload.
     */
    async handleHotUpdate(context) {
      if (!isSongFile(context.file)) return undefined
      const module = server?.moduleGraph.getModuleById(RESOLVED_ID)
      if (module) {
        server?.moduleGraph.invalidateModule(module)
        return [module, ...context.modules]
      }
      return undefined
    },
  }
}
