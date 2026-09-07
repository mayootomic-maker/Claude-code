/**
 * Downloads and audio export. Where songs are *stored* is `songs.ts`.
 */
import { encodeWav, renderSong, type RenderOptions } from '../engine/render'
import type { Song } from '../format/types'

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
