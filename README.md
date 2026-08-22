# Accent Voice Changer

Speak English. Come out sounding like a Russian or a German who learned it late.

It listens to your microphone, works out what you said, and says it again in a
native Russian or German voice using the pronunciation a native speaker of that
language would actually produce — then sends the result to a virtual microphone
so Discord, Zoom, OBS, or a game hears it instead of you.

```
"This is the best voice changer in the world!"
  Russian →  зис ис зэ бэст войс чейнджэр ин зэ ворлт!
             (zees ees ze best voys cheynjer in ze vorlt!)
  German  →  sis is se best weus tschehntscher in se weerlt!
             (zis is zuh best voys tschentschah in zuh veahlt!)
```

Everything runs on your own machine. Nothing is uploaded unless you deliberately
choose one of the voices marked "online".

---

## Install

### Windows (recommended)

Grab **`AccentVoiceChanger-Setup-1.0.0.exe`**:

- from the [Releases page](../../releases), if a release has been published; or
- from the latest green run of the
  [Build Windows installer](../../actions/workflows/build-windows.yml) workflow
  — every run attaches the installer (~80 MB) and a portable `.zip` (~115 MB)
  as artifacts; or
- build it yourself in one command (see *Building the installer* below).

Run the installer, or unzip the portable build anywhere and run
`AccentVoiceChanger.exe`.

Then, on first launch:

1. **Models tab** → download one voice (about 60 MB) for the accent you want.
   (On Windows the app can already speak through a system voice before you
   do this, but it will only sound properly accented once a real Russian or
   German voice is installed.)
2. **Audio tab** → set the virtual cable (see *Being heard in other apps* below).
3. **Live tab** → press **Start listening** and talk.

### From source (Windows, macOS, Linux)

```bash
git clone https://github.com/mayootomic-maker/claude-code
cd claude-code
pip install -e ".[full]"

ravc voices --install ru_RU-dmitri-medium     # or de_DE-thorsten-medium
ravc                                          # opens the window
```

On Linux you also need PortAudio and Tk: `sudo apt install libportaudio2 python3-tk`.

### Building the installer yourself

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build_windows.ps1
```

Needs Python 3.9+ and [Inno Setup 6](https://jrsoftware.org/isdl.php). Output
lands in `dist\`. The same build runs in CI — see
`.github/workflows/build-windows.yml`.

---

## Being heard in other apps

The changed voice has to leave your machine through something other apps can
select as a *microphone*. That is what a virtual audio cable is for.

1. Install **[VB-CABLE](https://vb-audio.com/Cable/)** (free). Reboot.
2. In this app: **Audio → Virtual cable → `CABLE Input`**.
3. In Discord / Zoom / OBS / your game: set the microphone to **`CABLE Output`**.
4. Optionally set **Audio → Monitor** to your headphones so you hear yourself.

VoiceMeeter, Virtual Audio Cable and (on macOS) BlackHole are detected too.

---

## The three modes

| Mode | What it does | Delay |
|---|---|---|
| **Live** | Speak; at each pause the sentence is re-spoken with the accent. | ~1 s after you stop talking |
| **Type & Speak** | Type a line, it is spoken immediately. No microphone or speech recognition needed. | instant |
| **File** | Convert an existing recording. | offline |

There is a real reason Live has a delay, and it is not slow code: a *phonetic*
accent depends on which words you said. `read` and `read` are spelled the same
and sound different; `the` becomes `ze` only once you know it is a word and not
part of another one. So the pipeline has to hear a whole phrase before it can
change how it sounds. Type & Speak has no such constraint and is instant — which
is why streamers tend to live in that tab.

---

## How it works

```
microphone ─▶ VAD / endpointing ─▶ speech recognition ─▶ accent engine ─▶ voice ─▶ effects ─▶ virtual cable
             (when did you stop)    (what did you say)   (how would they    (Piper /   (pitch,
                                                          have said it)      Edge)      formant, EQ)
```

The interesting part is the middle.

**1. Words to sounds.** Each word is looked up in a vendored CMU pronouncing
dictionary (126,000 words, shipped in the package, no network) to get its
phonemes. Words that are not in it — names, gamertags, slang, typos — go
through a rule-based letter-to-sound engine, then through suffix stripping and
compound splitting, so `streamers` finds `stream`, and `moonbeam` finds `moon`
plus `beam`.

**2. Sounds to accented sounds.** A *language pack* rewrites the phonemes into
the ones a native speaker of that language would actually produce, and then
applies that language's real phonological rules. This is where the accent lives.

The same approach — intercept the phonemes between the dictionary and the
synthesiser, and rewrite them — is what [Learning-free L2-Accented Speech
Generation using Phonological Rules](https://arxiv.org/abs/2603.07550) does,
and their evaluation is a good sanity check that it works. Their stated
limitation is that prosody still comes from the underlying English voice. This
project avoids that by synthesising with a *native Russian or German* voice
reading the accented phonemes, so the rhythm, the vowel durations and the
missing aspiration on stops come from a model that was trained on the real
thing rather than being bolted on.

<details>
<summary><b>Russian</b> — what gets changed and why</summary>

| English | Becomes | Example |
|---|---|---|
| /θ/ | /s/ | think → **s**ink |
| /ð/ | /z/ | this → **z**is, the → **z**e |
| /w/ | /v/ | water → **v**ater |
| /h/ | /x/ | hello → **kh**ello |
| /ŋ/ | /n/, /nk/ finally | going → goin**k** |
| /æ/ | /ɛ/ | bad → b**e**d |
| /ɪ/ | /i/ | ship → sh**ee**p |
| stressed ⟨o⟩ | read as spelt | st**o**p, j**o**b, pr**o**blem — not English /ɑ/ |
| unstressed a/o | [ɐ] before the stress, [ə] elsewhere | c**o**mputer → [k**ɐ**mˈpʲjut**ə**r] |
| unstressed after a soft consonant | [ɪ] | hello → [x**ɪ**ˈlo] |
| final voiced stops | devoiced | dog → do**k**, was → va**s** |
| /dʒ/ | /dʐ/, devoiced finally | job → dzho**p** |
| /r/ | apical trill | |
| /l/ | velarised, palatal only before /i/ | |

Plus genuine Russian phonotactics: regressive voicing assimilation (`vodka` →
`vot-ka`), palatalisation before front vowels, and /i/ backing to /ɨ/ after the
permanently hard sibilants (`ship` → `shyp`). One detail worth calling out:
Russian /v/ undergoes voicing assimilation but never *triggers* it — which is
why `question` comes out `kvestion` and not `gvestion`.

The vowel handling is two stages, and it is worth being precise about, because
the obvious version is wrong. A Russian speaker does **not** simply articulate
every vowel fully — Russian reduces unstressed vowels at least as hard as
English does, just by different rules. So the pack first reads the *spelling*
to decide what the vowel is (English ⟨o⟩ is taken as /o/, which is why `stop`
is not "stap"), and then applies **akanye and ikanye** to whatever that
produced: unstressed /a/ and /o/ merge to [ɐ] in the syllable before the stress
and to a weak [ə] elsewhere, and unstressed vowels after a soft consonant go to
[ɪ]. Together those give `computer` → [kɐmˈpʲjutər], which is exactly how the
Russian loanword is said.

One consequence: the Cyrillic shown in the UI is deliberately *not* reduced,
while the phonemes sent to the voice are. A Russian text-to-speech voice runs
its own reduction over whatever text you give it, so writing the reduction into
the spelling as well would apply it twice.

The spellings above isolate one substitution each. In practice they compound —
*"I think this water is bad, and the dog is going to the station."* comes out as:

```
ay seenk zees voter ees bet, ant ze dok ees goeenk too ze steyshyn.
ай синк зис вотэр ис бэт, ант зэ док ис гоинк ту зэ стэйшын.
```
</details>

<details>
<summary><b>German</b> — what gets changed and why</summary>

| English | Becomes | Example |
|---|---|---|
| /w/ | /v/ | we want → **v**e **v**ant |
| /θ/ | /s/ (or /t/) | think → **s**ink |
| /ð/ | /z/ (or /d/) | this → **z**is, the → **z**e |
| initial /s/ + vowel | /z/ | see → **z**ee |
| initial /st/, /sp/ | /ʃt/, /ʃp/ | stop → **sht**op, speak → **shp**eak |
| final voiced obstruents | devoiced | dog → do**k**, have → ha**f** |
| /dʒ/ | /tʃ/ | job → **tsch**ob |
| /ʒ/ | /ʃ/ | measure → mea**sh**ure |
| /æ/ | /ɛ/ | bad → b**e**d |
| /eɪ/, /oʊ/ | long monophthongs | name → n**eh**m, go → g**oh** |
| /r/ | uvular [ʁ] | |
| coda /r/ | vocalised to [ɐ] | better → bett**uh** |
| /l/ | always clear, never dark | |

The same sentence, *"I think this water is bad, and the dog is going to the
station."*, through the German pack:

```
ay singk zis votah is bet, uhnt zuh dok is going tu zuh shtetsion.
ei singk sis wohter is bet, ent se dok is gohing tuh se schtehzion.
```

Note what is deliberately **absent**. German has a schwa and a lax /ɪ/, so the
German pack keeps English vowel reduction and does *not* turn "ship" into
"sheep". Copying the Russian rules across would make a German speaker sound
Slavic — the two accents differ as much in what they leave alone as in what they
change.
</details>

**3. Accented sounds to speech.** Here is the trick that makes it work at all:
the accented phonemes are handed to a **native Russian or German neural voice**.
A native voice reading Russian phonemes produces, for free, all the things that
are nearly impossible to fake with signal processing — unaspirated /p t k/, an
apical trill, the right vowel qualities, native prosody. The synthesiser is
driven through its phoneme table directly rather than through text, so nothing
is lost to a text front-end re-guessing what was already worked out.

**4. Character.** Finally a small DSP chain gives the voice its body: a phase
vocoder with cepstral envelope warping shifts pitch and formants *independently*
(lowering formants without lowering pitch is what makes a voice sound physically
large rather than slowed down), then EQ, saturation, compression and a limiter.

---

## Matching your own voice

The honest limitation of any accent changer built on text-to-speech is that it
replaces you: whatever you sound like, out comes Dmitri. **Voice → Match my
voice** narrows that. It records a few seconds of you talking and measures the
two things that carry most of a speaker's identity:

- **pitch**, the median fundamental frequency over the voiced frames;
- **vocal tract length**, which shows up as a near-uniform scaling of all the
  formants — a long tract puts them low, a short one high. It is measured by
  taking the spectral envelope onto a log-frequency axis, where a change of
  tract length is a pure translation, and cross-correlating yours against the
  character voice's. (This is vocal-tract-length normalisation, as used in
  speech recognition, run backwards.)

It then solves for the pitch and formant shift that put the character voice
where yours sits. Measured against the real voice models this lands within
about 0.2 semitones. It is not neural voice conversion and will not make the
output sound like *you* — but it stops a 1.9 m baritone coming out as a light
tenor, which is most of the uncanny-valley effect.

If the recording has too little clear speech it changes nothing and says so,
rather than calibrating to the sound of your fan.

```
ravc calibrate                     # record from the microphone
ravc calibrate my-voice.wav        # or measure a recording
```

## Command line

Everything the window does, scriptably.

```bash
ravc                                          # open the window
ravc doctor                                   # check the installation
ravc say -l de "we have ways of making you talk"
ravc say -l ru -p "Bond Villain" "I have been expecting you" -o bond.wav
ravc live -l ru                               # headless live pipeline
ravc file interview.wav interview_accented.wav
ravc voices --install de_DE-thorsten-medium
ravc devices                                  # find your virtual cable
ravc presets
```

`--strength 0..1` thins the accent out, `--grammar 0..1` turns on broken English
(see below), `--rate` changes speaking speed.

---

## Settings worth knowing

**Accent strength** (0–100%). Backs the whole thing off. Features drop out in a
realistic order: the most stereotyped substitutions go first, the subtle
phonotactics last. Around 40% you get someone who has lived abroad for a decade.

**Broken English** (off by default, on purpose). The accent changes how you
*sound*. This changes the words you actually said — dropping articles and the
copula for Russian ("I going to store"), moving negation after the verb for
German ("I know not"). That is a bigger thing to do to someone's speech without
asking, so it ships off and lives on its own slider.

**Individual features.** Every substitution in the tables above has its own
switch, per language. If one of them mangles a word you say constantly, turn
just that one off.

**Presets.** `Comrade` (default), `Bond Villain`, `Big Bear`, `Babushka`,
`KGB Radio`, `Cosmonaut`, `Natural`. Pitch and formant are separate sliders
underneath.

---

## Making it faster

- **Models tab** → a smaller recognition model. `Tiny` or `Base` are usually
  plenty for close-mic speech.
- **Audio tab** → shorten *Pause before speaking back*.
- An NVIDIA GPU is detected and used automatically.
- Or use **Type & Speak**, which skips recognition entirely.

On a mid-range laptop CPU: recognition ≈ 0.3× real time, synthesis ≈ 0.05×
real time. The delay you notice is mostly the pause you have to leave at the
end of a sentence, not computation.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Apps cannot hear the changed voice | Their microphone must be **CABLE Output**, not your real mic. |
| No sound at all | Audio tab → **Refresh devices**. Check the virtual cable is installed. |
| It transcribes and repeats itself | Lower microphone gain, or turn the monitor off — it is hearing its own output. |
| Nothing is recognised | Raise microphone gain, or lower *Speech threshold above room noise*. |
| Sentences get cut in half | Increase *Pause before speaking back*. |
| "No voice model downloaded" | Models tab → download one, or `ravc voices --install …`. |
| Anything else | `ravc doctor` prints a full diagnosis. |

---

## Privacy

Recognition and synthesis both run locally. Audio never leaves the machine. The
only exception is the voices listed as **online**, which send the *transcribed
text* (not audio) to Microsoft's public speech endpoint; the offline Piper
voices are the default precisely so this is opt-in.

---

## Layout

```
src/ravc/
  phonetics/     words → phonemes: CMU dictionary + letter-to-sound rules
  accent/        phonemes → accented phonemes; language packs live here
    languages/     russian.py, german.py — add a file to add an accent
  tts/           Piper (offline, ONNX), Edge (online), Windows SAPI
  dsp/           pitch/formant shifting, EQ, dynamics, presets
  audio/         capture, playback, device discovery, VAD/endpointing
  asr/           faster-whisper wrapper
  ui/            desktop window and command line
  pipeline.py    wires it all together
packaging/       PyInstaller spec, Inno Setup script, build scripts
```

### Adding another accent

Write one file in `src/ravc/accent/languages/`: a consonant map, a vowel map, a
few post-processing functions, and a renderer that spells the result the way the
target TTS language reads it. Register it in `languages/__init__.py`. Nothing
else in the codebase needs to change — the dictionary, normaliser, synthesiser,
effects and routing are all shared.

---

## Licence

MIT — see [LICENSE](LICENSE).

Third-party components: the [CMU Pronouncing
Dictionary](https://github.com/cmusphinx/cmudict) (BSD-2-Clause, bundled),
[Piper](https://github.com/rhasspy/piper) voices (MIT / CC-BY, downloaded on
demand), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT).
VB-CABLE is donationware from VB-Audio and is **not** bundled — the app links to
its download page.

### A note on using this

Accents are how most people in the world speak their second language, and there
is a difference between wearing one for a Bond villain bit on stream and using
one to mock someone. This tool also has straightforward legitimate uses —
dubbing, game dialogue, language-learning demos, privacy. Whichever you are
doing, impersonating a real person to deceive someone is fraud in most places,
and it stays fraud when a piece of software does the voice.
