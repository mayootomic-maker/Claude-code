# The `.song.json` format

`notewright/1`

A song is one JSON file. It is meant to be edited by hand as readily as by the
application, so three rules shape all of it:

1. **Units are the ones a musician uses** — hertz, decibels, beats, semitones.
2. **Anything omitted has a sensible default.** A file writes only what makes
   this song this song; the application fills in the rest.
3. **Nothing is stored twice, and nothing points somewhere else.** There is no
   preset library to resolve, no sidecar. What the file says is what you hear.

Reading a file never throws. A field of the wrong type, a number out of range, a
clip pointing at a pattern that does not exist — each is reported as an issue
with its location and the file loads anyway. The Files tab lists them.

## The document

```json
{
  "format": "notewright/1",
  "title": "Night Ferry",
  "artist": "Notewright demo",
  "tempo": 124,
  "timeSignature": "4/4",
  "key": "A minor",
  "swing": 0.06,
  "master": { },
  "tracks": [ ],
  "patterns": [ ],
  "sections": [ ]
}
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `format` | string | — | `notewright/1`. Another value loads with a warning. |
| `title` | string | `Untitled` | |
| `artist` | string | `""` | Omitted when empty. |
| `tempo` | number | `120` | 20–400 BPM. |
| `timeSignature` | string | `4/4` | `n/d`. `6/8` is three quarter-note beats to the bar. |
| `key` | string | `C major` | A tonic and a scale name. Used for the piano roll's shading and the chord helper — it does not transpose anything. |
| `swing` | number | `0` | 0–1. Delays every other subdivision of a pattern's own grid; at 1 the off-beat lands exactly on the triplet. |

## Tracks

A track is an instrument plus a channel strip. Its `id` is what patterns refer
to, so keep it readable.

```json
{
  "id": "bass",
  "name": "Bass",
  "colour": "#ff8fa3",
  "gain": -7,
  "pan": 0,
  "mute": false,
  "solo": false,
  "sends": { "delay": 0, "reverb": 0.2 },
  "instrument": { "type": "synth" },
  "effects": [ ],
  "automation": [ ]
}
```

`gain` is decibels (−60 to +12, default −6). `pan` runs −1 to 1. Sends run 0 to
1 and are post-fader, so pulling a fader down takes its reverb with it.

## Instruments

### `synth` — two oscillators, a filter and two envelopes

```json
{
  "type": "synth",
  "oscillators": [
    { "wave": "sawtooth", "level": 0.85, "octave": 0, "detune": 0 },
    { "wave": "square", "level": 0, "octave": 0, "detune": 0 }
  ],
  "noise": 0,
  "filter": { "mode": "lowpass", "frequency": 320, "resonance": 12, "envelope": 34, "keyTracking": 0.3 },
  "filterEnvelope": { "attack": 0.002, "decay": 0.18, "sustain": 0.05, "release": 0.1 },
  "amplitudeEnvelope": { "attack": 0.004, "decay": 0.2, "sustain": 0.7, "release": 0.08 },
  "lfo": { "wave": "sine", "rate": 5, "toPitch": 0, "toFilter": 0, "toAmplitude": 0 },
  "unison": { "voices": 1, "detune": 12, "width": 0.5 },
  "glide": 0.05,
  "mono": true,
  "gain": 0
}
```

- `wave`: `sine`, `triangle`, `sawtooth`, `square`, `pulse`, `supersaw`.
  `supersaw` forces at least seven unison voices however `unison` is set.
- `filter.mode`: `lowpass`, `highpass`, `bandpass`, `notch`.
- `filter.envelope` is in **semitones** the envelope opens the cutoff by, so a
  patch keeps its character across the keyboard. `keyTracking` (0–1) is how much
  the played pitch carries the cutoff with it.
- `lfo.toPitch` and `lfo.toFilter` are semitones; `toAmplitude` is 0–1.
- `glide` is only audible when `mono` is true.
- Envelope times are seconds; `sustain` is a fraction of the peak.

### `fm` — two operators

```json
{
  "type": "fm",
  "carrier": { "wave": "sine", "ratio": 1 },
  "modulator": {
    "wave": "sine", "ratio": 2, "index": 2.6,
    "envelope": { "attack": 0.001, "decay": 0.5, "sustain": 0.04, "release": 0.3 }
  },
  "amplitudeEnvelope": { "attack": 0.002, "decay": 1.6, "sustain": 0.12, "release": 0.5 },
  "gain": 2
}
```

Ratios are multiples of the played frequency. Whole numbers sound tuned;
anything else sounds like metal. `index` is the modulation depth in multiples of
the modulator's frequency — the convention every FM synth uses.

### `drums` — eight synthesised lanes

```json
{
  "type": "drums",
  "lanes": [
    { "id": "kick", "name": "Kick", "voice": "kick", "tune": 52, "decay": 0.36,
      "snap": 0.6, "level": 0, "pan": 0, "choke": 0 }
  ]
}
```

`voice` is one of `kick`, `snare`, `hat`, `clap`, `tom`, `rim`, `cymbal`,
`cowbell`. `tune` is hertz — a pitch for the tuned voices, a filter centre for
the noisy ones. `snap` (0–1) is the transient: the click on a kick, the crack on
a snare. `level` is decibels and means the same loudness on every lane, because
the voices are trimmed against measured output. Lanes sharing a non-zero `choke`
group cut each other off, the way a hi-hat pedal closes an open hat.

Omit `lanes` entirely to get the default eight-lane kit.

### `sampler`

```json
{
  "type": "sampler",
  "sample": "vocal-chop.wav",
  "root": "C4",
  "loop": false,
  "start": 0, "end": 1,
  "fixedPitch": false,
  "reverse": false,
  "amplitudeEnvelope": { "attack": 0.002, "decay": 0.1, "sustain": 1, "release": 0.08 }
}
```

`sample` names a file. **Audio does not live in the song file** — drop the file
onto the sampler panel to load it into the browser for this session. A track
whose sample is missing says so and stays silent rather than pretending.
`start` and `end` are fractions of the sample's length.

## Effects

An array on the track, running in order before the fader. Every effect takes
`enabled` (default `true`).

| `type` | Fields |
| --- | --- |
| `filter` | `mode`, `frequency` (Hz), `resonance` |
| `drive` | `amount` 0–1, `tone` 0–1, `mix` 0–1 |
| `chorus` | `rate` (Hz), `depth` 0–1, `mix` 0–1 |
| `delay` | `time` (a note division), `feedback` 0–0.95, `mix` 0–1, `pingPong` |
| `reverb` | `size` 0–1, `damping` 0–1, `mix` 0–1 |
| `compressor` | `threshold` (dB), `ratio`, `attack` (s), `release` (s) |
| `eq` | `low` (dB), `mid` (dB), `middleFrequency` (Hz), `high` (dB) |
| `crush` | `bits` 1–16, `mix` 0–1 — bit depth only, not sample rate |

Note divisions: `1/32`, `1/16`, `1/8t`, `1/16d`, `1/8`, `3/16`, `1/4t`, `1/4`,
`3/8`, `1/2`, `1/1`. A `t` suffix is a triplet, `d` is dotted.

## Patterns

A pattern belongs to exactly one track, which is what gives it an instrument.

```json
{
  "id": "bass-main",
  "track": "bass",
  "bars": 4,
  "grid": "1/16",
  "notes": [
    "A1~2 . A1 .  A1~2 . . .  A1~2 . A1 .  A1 . E2 .",
    "F1~2 . F1 .  F1~2 . . .  F1~2 . F1 .  F1 . C2 ."
  ]
}
```

`grid` sets what one step means: `1/4`, `1/8`, `1/8t`, `1/16`, `1/16t`, `1/32`.
One string per bar, or a single string for a one-bar pattern.

### Melodic notation

A stream of whitespace-separated tokens, one per step. `|` and extra spaces are
ignored — they are there for you.

| Token | Meaning |
| --- | --- |
| `.` | a rest |
| `-` | hold the previous step's notes one step longer |
| `C4` | a note. `C#4`, `Db4`, `Cb4`, `B#3`, `f#-1` and bare MIDI numbers all read. |
| `C4~4` | a note four steps long |
| `C4@0.5` | velocity 0.5. Values above 1 are read as MIDI units, so `@64` is 0.504. |
| `[C4 E4 G4]` | a chord. Suffixes apply to the group; a member's own suffix wins. |

`C4` is middle C, MIDI 60. The piano roll's chord tool writes several notes at
one step, which is what a chord looks like in this notation: `[A3 C4 E4]~4`.

Timing is stored in **beats**, not steps, so changing a pattern's grid rewrites
the string without moving a single note.

### Drum notation

One character per step, keyed by lane id:

```json
"lanes": { "kick": "x... x... x... x...", "hat": "..o. ..x. ..o. ..x." }
```

| Character | Meaning |
| --- | --- |
| `.` | rest |
| `x` | a hit, velocity 0.8 |
| `X` | an accent, velocity 1 |
| `o` | a ghost note, velocity 0.45 |
| `1`–`9` | velocity in tenths |
| `-` | hold the previous hit one step longer |

### When a pattern cannot be written as steps

If a note does not land on the grid, the serializer writes the pattern as
explicit note objects instead of quietly moving it:

```json
"notes": [{ "at": 0.1, "pitch": "C4", "length": 0.3, "velocity": 0.62 }]
```

`at` and `length` are beats from the start of the pattern. Both forms read back
identically; the string form is simply used whenever it can be.

## Sections

The arrangement. Sections play in order; each is a run of bars in which some
patterns play.

```json
{
  "id": "verse",
  "name": "Verse",
  "bars": 16,
  "clips": [
    { "pattern": "drums-main", "times": 15 },
    { "pattern": "drums-fill", "at": 15, "times": 1 },
    "bass-main",
    "chords"
  ]
}
```

A clip is either a pattern id on its own — meaning "start at the top and repeat
to fill the section" — or an object:

| Field | Default | Meaning |
| --- | --- | --- |
| `pattern` | — | which pattern |
| `at` | `0` | bars from the start of the section |
| `times` | `null` | repeats; `null` fills the remaining bars |
| `transpose` | `0` | semitones. Ignored on drum tracks, where it would be meaningless. |

A note that starts after its section has ended is not played — otherwise one
section's tail would drag over the next section's downbeat. A note that starts
inside and rings past the end is kept, because that is a tail.

## Master

```json
"master": {
  "gain": -1,
  "limiter": true,
  "delay": { "time": "3/16", "feedback": 0.34, "mix": 1, "pingPong": true },
  "reverb": { "size": 0.72, "damping": 0.35, "mix": 1 }
}
```

`delay` and `reverb` are the two send buses every track can feed. The limiter is
a stateless soft ceiling: transparent below about −3 dBFS, and it rounds peaks
off rather than clipping them.

## Automation

Lanes on a track, aimed at mixer and effect parameters.

```json
"automation": [
  { "target": "effects.0.frequency", "points": "0:6000 96:420 126:9000 132:6000" }
]
```

`points` is a list of `beat:value` pairs in **song beats**, ramped linearly
between, and held flat outside the first and last. Two points on the same beat
make an instant jump; the later one wins.

Targets:

- `gain` — decibels
- `pan` — −1 to 1
- `sends.delay`, `sends.reverb` — 0 to 1
- `effects.<index>.<parameter>` — by the effect's position in the rack, counting
  bypassed effects, so bypassing one does not silently retarget the lanes below it

**Instrument parameters cannot be automated.** A synth's filter belongs to each
voice, not to the track, so there is nothing stable to aim at. To sweep a filter
across a whole part, add a `filter` effect to the track and automate that.

## What the writer guarantees

- **Stable.** Saving an unchanged song produces a byte-identical file, so a save
  is never a spurious commit.
- **Sparse.** Only what differs from the defaults is written. Arrays are
  all-or-nothing: a kit or an oscillator pair is a definition, and half of one
  with the unchanged half elided would be harder to read, not easier.
- **Lossless.** Everything the reader can read, the writer can write back. Where
  it cannot express something exactly — a velocity outside the lane alphabet, a
  note off the grid — it falls back to the explicit form rather than rounding.
