/**
 * Starting points that already sound like something.
 *
 * An empty arrangement is the worst screen a beat maker can show you: it asks
 * you to make eight decisions before you hear anything. These templates put a
 * playable eight bars in front of you — kick, clap on three, hats with a roll,
 * an 808 that slides — so the first thing you do is press space, and the second
 * is change something you can already hear.
 */
import { parseSong } from '../format/parse'
import type { Song } from '../format/types'

export interface Template {
  id: string
  name: string
  description: string
  build: () => Song
}

/**
 * The half-time trap layout: clap on beat three, kick around it, hats on eighths
 * with a roll at the turnaround, and an 808 ducked out of the kick's way.
 */
function trapBeat(tempo: number, key: string): Song {
  return parseSong({
    format: 'notewright/1',
    title: 'New beat',
    tempo,
    timeSignature: '4/4',
    key,
    tracks: [
      {
        id: 'drums',
        name: 'Drums',
        colour: '#64d2ff',
        gain: -5,
        instrument: { type: 'drums' },
      },
      {
        id: '808',
        name: '808',
        colour: '#ff8fa3',
        gain: -6,
        // Ducking the 808 under the kick is the difference between a low end you
        // can hear and one that just flaps.
        duck: { from: 'drums', lane: 'kick', amount: 0.65, release: 0.16 },
        instrument: { type: '808' },
      },
      {
        id: 'melody',
        name: 'Melody',
        colour: '#ffd479',
        gain: -14,
        sends: { reverb: 0.3, delay: 0.18 },
        instrument: {
          type: 'fm',
          modulator: {
            wave: 'sine',
            ratio: 2.01,
            index: 4.2,
            envelope: { attack: 0.001, decay: 0.55, sustain: 0.05, release: 0.3 },
          },
          amplitudeEnvelope: { attack: 0.002, decay: 1.5, sustain: 0.06, release: 0.7 },
          gain: 1,
        },
      },
    ],
    patterns: [
      {
        id: 'drums-main',
        track: 'drums',
        bars: 1,
        grid: '1/16',
        lanes: {
          kick: 'x... .... ..x. .x..',
          clap: '.... .... X... ....',
          hat: 'x.x. x.x. x.x. x.t.',
          open: '.... ..x. .... ....',
        },
      },
      {
        id: '808-main',
        track: '808',
        bars: 2,
        grid: '1/16',
        notes: [
          'F1~14 . . .  . . . .  . . . .  . C2~3 . .',
          'D#1~8 . . .  . . . .  C2~6 . . .  . . . .',
        ],
      },
      {
        id: 'melody-main',
        track: 'melody',
        bars: 2,
        grid: '1/8',
        notes: [
          'F4 . G#4 .  C5 . G#4 .',
          'D#4 . F4 .  G#4 . F4 .',
        ],
      },
    ],
    sections: [
      { id: 'intro', name: 'Intro', bars: 4, clips: ['drums-main', '808-main'] },
      { id: 'loop', name: 'Loop', bars: 16, clips: ['drums-main', '808-main', 'melody-main'] },
    ],
  }).value
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'trap-140',
    name: 'Trap — 140',
    description: 'Half-time, clap on three, 808 with a slide. The usual pocket.',
    build: () => trapBeat(140, 'F minor'),
  },
  {
    id: 'trap-118',
    name: 'Trap — 118 slow',
    description: 'The same layout dragged back, where hood trap tends to sit.',
    build: () => trapBeat(118, 'F minor'),
  },
  {
    id: 'trap-150',
    name: 'Trap — 150 fast',
    description: 'Quicker hats, tighter 808s.',
    build: () => trapBeat(150, 'G minor'),
  },
  {
    id: 'empty',
    name: 'Empty',
    description: 'Nothing at all. One section, no tracks.',
    build: () =>
      parseSong({
        format: 'notewright/1',
        title: 'Untitled',
        tempo: 140,
        timeSignature: '4/4',
        key: 'F minor',
        tracks: [],
        patterns: [],
        sections: [{ id: 'section-1', name: 'A', bars: 8, clips: [] }],
      }).value,
  },
]
