/** Small formatters shared across the interface. */
import { beatsPerBar } from '../format/types'

export function barsAndBeats(beat: number, timeSignature: string): string {
  const perBar = beatsPerBar(timeSignature)
  const bar = Math.floor(beat / perBar) + 1
  const within = beat - (bar - 1) * perBar
  const beatNumber = Math.floor(within) + 1
  const sixteenth = Math.floor((within - Math.floor(within)) * 4) + 1
  return `${bar}.${beatNumber}.${sixteenth}`
}

export function clock(beat: number, tempo: number): string {
  const seconds = Math.max(0, (beat * 60) / tempo)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function decibels(value: number): string {
  if (value <= -60) return '-inf'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

export function panLabel(value: number): string {
  if (Math.abs(value) < 0.005) return 'C'
  return `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`
}
