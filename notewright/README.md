# Notewright

**A beat maker built around 808s, hi-hat rolls and half-time drums — whose songs
are plain, readable text.**

Everything else is a normal DAW. The thing that makes this one different is that
the song is a file you can read:

```json
{
  "id": "drums-hook",
  "track": "drums",
  "bars": 1,
  "grid": "1/16",
  "lanes": {
    "kick": "x..x .... ..x. .x..",
    "clap": ".... .... X... ....",
    "hat":  "x.x. x.q. x.x. t.q.",
    "open": ".... ..x. .... ...."
  }
}
```

`x` is a hit, `X` an accent, `o` a ghost, `.` a rest — and `t` is a triplet roll
inside that one step, `q` a four. Thirteen hi-hats in sixteen characters, still
lined up in columns you can scan.

The 808 reads the same way, and its slides are just overlapping notes:

```
"F1~14 . . .  . . . .  . . . .  . C2~3 . ."
 └── lasts 14 steps ──────────────┘ starts on step 14, so the 808 bends into it
```

Because the song is text, two people can work on the same beat from opposite
ends — one in the interface, one in an editor — and each can read exactly what
the other changed, because `git diff` shows the music.

## Install

Desktop builds are on the [Releases page](../../releases). They are built on
GitHub's own macOS and Windows machines from the source in this repository.

**macOS** — download the `.dmg`, open it, drag Notewright to Applications. The
app is not signed with an Apple certificate, so the first time you open it macOS
will say it cannot be verified: **right-click the app and choose Open**, then
confirm. Once only.

**Windows** — download and run the `.exe`. SmartScreen will say the publisher is
unknown, because the installer is not code-signed: click **More info**, then
**Run anyway**.

Signing would cost about $99 a year for Apple plus a Windows certificate. Until
that is worth paying for, those are the two extra clicks — and the reason for
them is honest: nobody has paid to vouch for the binary.

Songs are saved to **Documents/Notewright/songs** as `.song.json` files. Open one
in any text editor and the app picks up your change while it is playing.

### Or run it from source

```bash
npm install
npm run dev          # the app in a browser, with the repo's songs/ folder live
npm run desktop      # the desktop app, if you have Rust installed
```

## What is in it

**The 808.** Its own instrument, not a synth preset. Pitch drops at the attack,
saturation so a 40 Hz note is still there on a phone speaker, and slides that
retune the running oscillator rather than starting a second one — a slide made
of two voices clicks, because the waveform jumps.

**Ducking.** `"duck": { "from": "drums", "lane": "kick", "amount": 0.62 }` and
the 808 gets out of the kick's way. Not a sidechain compressor — Web Audio has
no sidechain input — but the sequencer already knows exactly when the kick lands,
so the dips are scheduled. Sample-accurate, and identical on every render.

**Rolls.** In the notation as single characters, and in the step editor as a
"place a roll of 3" mode. The velocities ramp, which is what makes a roll sound
like a roll.

**Templates.** Every new beat starts as a playable eight bars — kick, clap on
three, hats with a roll, an 808 that slides — at 118, 140 or 150. Not an empty
screen asking you to make eight decisions before you hear anything.

**A reference analyser.** `npm run analyse -- track.mp3` reports the tempo, the
key, where the bass sits, where the energy sits, and where the hits land in the
bar. Producers work to references; those are the questions, and all of them are
measurable.

**The rest of a studio.** A subtractive synth, a two-operator FM synth, an
eight-lane drum machine with choke groups, a sampler. Filter, drive, chorus,
tempo-synced ping-pong delay, convolution reverb, compressor, EQ, bit crusher,
plus delay and reverb sends. Piano roll with a chord tool that builds from the
song's key. Automation. Offline render to 16- or 24-bit WAV, through the same
graph as playback, from the app or from `npm run render`.

## How it is checked

Unit tests cover the notation, the document format and the sequencer, including
a fuzz round-trip that writes random patterns, reads them back and asserts that
not one note moved.

But almost nothing that matters about a DAW can be unit tested — there is no Web
Audio in Node, and mocking it only proves the mock works. So the engine is
checked by **rendering songs in a real browser and measuring the samples**: the
808 sits on its note, an overlapping note bends the pitch up, the 808 dips where
the kick lands and does not dip without ducking, a `t` is three hits and an `s`
is six, an empty arrangement is silent rather than noisy, and two renders differ
only below audibility.

That approach has now found five things the unit tests were happy with. The
worst was in the amplitude envelope: **a note shorter than its own decay had the
decay discarded and dived straight to silence.** A six-step 808 was inaudible by
its fourth step, and every long-decay patch in the app was affected. It showed up
as a demo whose hook measured quieter than its verse, and it took rendering one
bar and printing its level step by step to see. Fixing it made the whole beat
5.5 dB louder and flattened the section-to-section difference to 0.2 dB.

The others: velocities near the default were being written as "default" and read
back changed; the drum kit's `level` field meant nothing, so the same setting
gave a clap nineteen decibels under a kick; the master limiter was a
`DynamicsCompressorNode`, and Chromium's starts every render with ~300 ms of
heavy gain reduction, so the first beat of an export came out eighteen decibels
quiet; and rendering was quadratic in song length.

`npm run e2e` drives the built app in Chromium — clicking the arrangement grid,
painting steps, dragging notes, moving a fader and a knob *from the keyboard*,
playing, saving to disk, changing the file underneath the app and waiting for it
to notice, exporting audio, and loading deliberately broken JSON. It fails on any
console error.

```bash
npm test              # 114 unit and property tests
npm run check:engine  # renders audio in a browser and measures it
npm run check:songs   # every song in songs/, with its spectral balance
npm run e2e           # drives the whole interface
npm run verify        # all of it
```

## Honest limits

- **Not signed.** See Install. macOS and Windows will both warn you once.
- **A sample is not part of the song file.** Text cannot hold audio. Sampler
  tracks reference a file by name; if it is not loaded, the track says so and
  stays silent rather than pretending.
- **Automation targets mixer and effect controls, not instrument parameters.** A
  synth's filter belongs to each voice, not to the track. To sweep a filter
  across a part, put a Filter effect on the track and automate that.
- **Rendering takes about a fifth of the song's length.** A two-minute beat is
  roughly twenty-five seconds of export.
- **No MIDI in or out, and no plugin format.** Both are real work; neither is
  faked.
- **Bit crushing is bit depth only.** Sample-rate reduction needs an
  AudioWorklet, and the engine deliberately uses only native nodes so nothing has
  to load before the first note.

## Layout

```
src/format/     the song document: types, notation, parse, serialize
src/engine/     theory, sequencer, voices, effects, mixer, transport, render
src/state/      store, undo, actions, audio host, song library, templates
src/ui/         the interface
src-tauri/      the desktop shell: a real songs folder, and a watcher on it
songs/          .song.json files — the actual music
e2e/            browser drivers that measure audio and click the interface
scripts/        render and analyse, from the terminal
docs/FORMAT.md  the format, field by field
```

## Licence

MIT. See [LICENSE](LICENSE).
