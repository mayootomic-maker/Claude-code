/**
 * The audio context's life story.
 *
 * Browsers will not start an AudioContext without a gesture from the person
 * using the page, so this is built lazily on the first play or preview and the
 * interface says plainly when sound is not running yet. Creating it eagerly and
 * hoping produces an app that is silent for reasons the user cannot see.
 */
import { Player } from '../engine/player'
import type { Song } from '../format/types'

export type AudioStatus = 'idle' | 'running' | 'suspended' | 'unsupported'

export class AudioHost {
  private context: AudioContext | null = null
  private currentPlayer: Player | null = null
  private samples = new Map<string, AudioBuffer>()
  private listeners = new Set<() => void>()
  private lastSong: Song | null = null

  status: AudioStatus = 'idle'
  /** Set when the browser has no Web Audio at all, or refused to start it. */
  problem: string | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  get player(): Player | null {
    return this.currentPlayer
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0
  }

  /** Called from a click handler. Safe to call repeatedly. */
  async ensure(song: Song): Promise<Player | null> {
    if (typeof AudioContext === 'undefined') {
      this.status = 'unsupported'
      this.problem = 'This browser has no Web Audio, so Notewright cannot make sound in it.'
      this.emit()
      return null
    }

    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' })
      } catch (error) {
        this.status = 'unsupported'
        this.problem = `The audio engine would not start: ${(error as Error).message}`
        this.emit()
        return null
      }
      this.currentPlayer = new Player(this.context, song, this.samples)
      this.lastSong = song
      this.context.addEventListener('statechange', () => {
        this.status = this.context?.state === 'running' ? 'running' : 'suspended'
        this.emit()
      })
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume()
      } catch (error) {
        this.status = 'suspended'
        this.problem = `Audio is held: ${(error as Error).message}`
        this.emit()
        return this.currentPlayer
      }
    }

    this.status = this.context.state === 'running' ? 'running' : 'suspended'
    this.problem = null
    this.emit()
    return this.currentPlayer
  }

  /** Pushes an edit to a running engine. No-op before the first gesture. */
  setSong(song: Song): void {
    if (song === this.lastSong) return
    this.lastSong = song
    this.currentPlayer?.setSong(song)
  }

  async addSample(name: string, file: Blob): Promise<string | null> {
    if (!this.context) {
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' })
      } catch (error) {
        return `The audio engine would not start: ${(error as Error).message}`
      }
    }
    try {
      const buffer = await this.context.decodeAudioData(await file.arrayBuffer())
      this.samples.set(name, buffer)
      this.currentPlayer?.setSamples(this.samples)
      this.emit()
      return null
    } catch (error) {
      return `"${name}" is not audio this browser can decode: ${(error as Error).message}`
    }
  }

  sampleNames(): string[] {
    return [...this.samples.keys()].sort()
  }

  sampleLibrary(): Map<string, AudioBuffer> {
    return this.samples
  }

  dispose(): void {
    this.currentPlayer?.dispose()
    this.currentPlayer = null
    void this.context?.close()
    this.context = null
    this.status = 'idle'
    this.emit()
  }
}
