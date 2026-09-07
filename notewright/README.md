# Notewright

A music studio you can read.

Notewright is a browser-based DAW whose songs are **plain, diffable text**. You
write music by clicking in a piano roll, dragging a fader, or painting a drum
pattern — and the file that results is something a person can open in an editor
and understand:

```json
{
  "id": "drums-main",
  "track": "drums",
  "bars": 1,
  "grid": "1/16",
  "lanes": {
    "kick": "x... x... x... x...",
    "clap": ".... X... .... X...",
    "hat":  "..o. ..x. ..o. ..x."
  }
}
```

`x` is a hit, `X` an accent, `o` a ghost note, `.` a rest. A melodic part reads
the same way — `A1~4 . . .  E2~2 . . .` is an A that lasts four steps, then rests,
then an E that lasts two.

That is the whole idea. Because the song is text, two people can work on the
same piece at once from opposite ends: one in the interface, one in an editor —
and each can read exactly what the other changed, because `git diff` shows the
music, not a wall of coordinates.

## The collaboration loop

```
    you, in an editor            you, in the app
            │                          │
            ▼                          ▼
     songs/night-ferry.song.json ◄──── Save (⌘S)
            │
            └──► the running app swaps the song in, mid-playback,
                 without a reload
```

Run `npm run dev`, open a song, and edit `songs/*.song.json` on disk — the app
picks the change up live. Edit in the app and press ⌘S — the file changes. Your
unsaved work is never overwritten by a change on disk; the app says so instead.

## Getting started

```bash
npm install
npm run dev          # then open the URL it prints
```

Press **space** to play. Tabs are **1**–**4**: Arrange, Edit, Mix, Files. The
Files tab shows the song's own text, live, next to the button that saves it.

```bash
npm run render -- night-ferry           # bounce a song to WAV without opening the app
npm run render -- night-ferry --from 25 --to 48 --bits 24

npm test             # unit and property tests, in Node
npm run e2e          # drives the whole app in a real browser
npm run check:engine # renders audio in a browser and measures the samples
npm run check:songs  # renders every song in songs/ and reports its shape
npm run verify       # all of the above, plus typecheck and build
```

## What is in it

**Instruments.** A subtractive synth (two oscillators with sine, triangle, saw,
square, pulse and supersaw shapes; a resonant multimode filter with its own
envelope and key tracking; an LFO to pitch, filter or amplitude; unison up to
seven voices; mono with glide). A two-operator FM synth. An eight-lane drum
machine whose lanes each pick a synthesised kick, snare, hat, clap, tom, rim,
cymbal or cowbell voice, with choke groups. A sampler with looping, reverse, start/end and pitch tracking.

**Effects.** Filter, drive, chorus, tempo-synced ping-pong delay, convolution
reverb with a generated impulse response, compressor, three-band EQ and a bit
crusher — as track inserts, plus delay and reverb send buses on the master.

**Writing.** A piano roll that can stamp a triad or a seventh built from the
song's key rather than a fixed major triad, and a "keep in key" mode that pulls
every note you place or drag onto the nearest note of the scale. A step editor
for drum kits where you paint runs, with accents and ghost notes on a modifier.

**Arrangement.** Sections with a bar count; patterns switch on and off per
section, with an offset, a repeat count and a transpose. Automation lanes on
mixer and effect parameters, written as `beat:value` pairs.

**Export.** Offline render to 16- or 24-bit WAV, through the same graph builder
and the same note scheduler as live playback — which is the only way "export"
can be trusted to sound like what you just heard. `npm run render` does the same
thing from a terminal, driving a headless browser rather than reimplementing the
engine, and can bounce a bar range.

Twenty-three presets across bass, keys, pads, leads, texture, kits and the
sampler. Everything
is copied into the song when chosen, never referenced, so a song file still
sounds the same in a year on a machine that has never seen the preset list.

## How it is checked

Unit tests cover the notation, the document format and the sequencer, including
a fuzz round-trip that writes random patterns, reads them back and asserts that
not one note moved.

But most of what matters about a DAW cannot be unit tested — there is no Web
Audio in Node, and mocking it only ever proves the mock works. So the engine is
checked by **rendering songs in a real browser and measuring the samples**:
every instrument makes sound, every drum voice lands within a kit's worth of the
kick, an empty arrangement is silent rather than noisy, panning hard left empties
the right channel, a filter sweep gets brighter as it goes, two renders of one
song differ only below audibility, and the WAV header matches its payload.

That found four things the unit tests were happy with:

- Velocities near the default were being written as "default" and read back
  changed — a silent edit on every save.
- The drum kit's `level` field meant nothing: the same setting produced a clap
  nineteen decibels under a kick.
- The master limiter was a `DynamicsCompressorNode`, and Chromium's starts every
  render with about 300 ms of heavy gain reduction — so the first beat of an
  exported song came out eighteen decibels quiet.
- Rendering was quadratic in song length, because every note's nodes existed
  from the first sample.

`npm run e2e` drives the built application in Chromium: it clicks the
arrangement grid, paints steps, drags a note in the piano roll, moves a fader
and a knob **from the keyboard**, adds and removes an effect, plays, saves to
disk, changes the file underneath the app and waits for it to notice, exports
audio, and loads deliberately broken JSON. It fails on any console error.

## Honest limits

- **A sample is not part of the song file.** Text files cannot hold audio.
  Sampler tracks reference a file by name; if it is not loaded, the track says
  so and stays silent rather than pretending.
- **Automation targets mixer and effect controls, not instrument parameters.**
  A synth's filter belongs to each voice, not to the track, so there is nothing
  stable to automate. To sweep a filter across a whole part, put a Filter effect
  on the track and automate that — which is what the demo song does.
- **Rendering takes about a fifth of the song's length.** The demo song is 2:38
  and exports in 31 seconds. It is offline, not real-time, but it is not
  instant.
- **No MIDI in or out, and no plugin format.** Both are real work rather than
  small additions; neither is faked.
- **Bit crushing is bit-depth only.** Sample-rate reduction needs an
  AudioWorklet, and the whole engine deliberately uses native nodes so that
  nothing has to load before the first note can sound.

## Layout

```
src/format/     the song document: types, notation, parse, serialize
src/engine/     theory, sequencer, voices, effects, mixer graph, transport, render
src/state/      the store, undo, actions, audio host, file bridge
src/ui/         the interface
src/dev/        the dev-server bridge that makes songs/ two-way
songs/          .song.json files — the actual music
e2e/            browser drivers that measure audio and click the interface
docs/FORMAT.md  the format, field by field
```

## Licence

MIT. See [LICENSE](LICENSE).
