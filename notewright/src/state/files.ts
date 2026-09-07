/**
 * Getting songs in and out.
 *
 * In development the app can write straight back to `songs/` through the dev
 * server, which is what makes it possible for a person and an agent to edit the
 * same file and see each other's changes. A built copy has no server to write
 * to, so it falls back to a download — stated plainly in the interface rather
 * than silently doing something different.
 */
import { canWriteToDisk, songs as bundledSongs } from 'virtual:notewright-songs'
import { encodeWav, renderSong, type RenderOptions } from '../engine/render'
import type { Song } from '../format/types'

export interface LibraryEntry {
  name: string
  source: string
}

export function library(): LibraryEntry[] {
  return bundledSongs
}

export const canSaveToDisk = canWriteToDisk

/** Returns null on success, or a message worth showing the user. */
export async function saveToDisk(name: string, text: string): Promise<string | null> {
  if (!canWriteToDisk) return 'This copy of Notewright is a built bundle, so it has no folder to write to.'
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
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadSong(name: string, text: string): void {
  download(`${name}.song.json`, new Blob([text], { type: 'application/json' }))
}

export interface ExportResult {
  seconds: number
  peak: number
  bytes: number
}

export async function exportWav(
  song: Song,
  name: string,
  options: RenderOptions & { bitDepth?: 16 | 24 } = {},
): Promise<ExportResult> {
  const buffer = await renderSong(song, options)
  const blob = encodeWav(buffer, options.bitDepth ?? 16)
  download(`${name}.wav`, blob)
  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index++) peak = Math.max(peak, Math.abs(data[index] ?? 0))
  }
  return { seconds: buffer.duration, peak, bytes: blob.size }
}
