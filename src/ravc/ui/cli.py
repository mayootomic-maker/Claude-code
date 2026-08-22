"""Command-line interface.

Everything the GUI can do is available here too, which makes the app
scriptable (stream decks, chat bots, batch dubbing) and makes support
much easier -- "run `ravc doctor` and paste the output".
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import List, Optional

from .. import __version__
from ..accent.engine import AccentEngine
from ..accent.languages import available as available_languages
from ..accent.languages import get_pack
from ..asr.whisper_asr import MODEL_SIZES, WhisperAsr
from ..audio import devices as audio_devices
from ..config import AppConfig, config_path
from ..dsp.chain import PRESETS, preset_names
from ..pipeline import Events, VoiceChanger
from ..tts import voices as voice_catalogue
from ..tts.registry import VoiceRegistry

LANGUAGE_ALIASES = {
    "ru": "russian", "rus": "russian", "russian": "russian",
    "de": "german", "ger": "german", "deu": "german", "german": "german",
}


def _resolve_language(value: Optional[str], config: AppConfig) -> str:
    if not value:
        return config.accent.language
    return LANGUAGE_ALIASES.get(value.lower(), value.lower())


def _load_config(args) -> AppConfig:
    config = AppConfig.load(Path(args.config) if args.config else None)
    config.accent.language = _resolve_language(getattr(args, "language", None),
                                               config)
    if getattr(args, "strength", None) is not None:
        config.accent.strength = args.strength
    if getattr(args, "grammar", None) is not None:
        config.accent.grammar_strength = args.grammar
    if getattr(args, "preset", None):
        config.apply_preset(args.preset)
    if getattr(args, "voice", None):
        config.voice.set_voice(config.accent.language, args.voice)
    if getattr(args, "rate", None) is not None:
        config.voice.speaking_rate = args.rate
    return config


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def cmd_say(args) -> int:
    config = _load_config(args)
    text = " ".join(args.text).strip()
    if not text:
        print("Nothing to say.", file=sys.stderr)
        return 2

    changer = VoiceChanger(config)
    accented, audio = changer.render(text)
    if accented.is_empty:
        print("Nothing speakable in that text.", file=sys.stderr)
        return 2

    print(f"English  : {text}")
    print(f"Accented : {accented.eye_dialect}")
    print(f"For TTS  : {accented.native_text}")

    if args.out:
        out = Path(args.out)
        import soundfile as sf
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), audio.samples, audio.sample_rate)
        print(f"Wrote    : {out}  ({audio.duration:.2f}s)")
        return 0

    if args.dry_run:
        return 0

    try:
        changer.start()
        if changer.state == "error":
            print("No audio output available; use --out to write a file.",
                  file=sys.stderr)
            return 1
        changer.speak(text)
    finally:
        changer.close()
    return 0


def cmd_file(args) -> int:
    config = _load_config(args)
    changer = VoiceChanger(config)
    try:
        changer.convert_file(Path(args.source), Path(args.destination),
                             progress=lambda m: print(m))
    except Exception as exc:
        print(f"Failed: {exc}", file=sys.stderr)
        return 1
    finally:
        changer.close()
    return 0


def cmd_live(args) -> int:
    config = _load_config(args)
    pack = get_pack(config.accent.language)

    def on_utterance(source: str, accented) -> None:
        print(f"  heard : {source}")
        print(f"  spoken: {accented.eye_dialect}")

    events = Events(
        on_state=lambda s: print(f"[{s}]"),
        on_log=lambda m: print(f"  {m}"),
        on_error=lambda m: print(f"  error: {m}", file=sys.stderr),
        on_utterance=on_utterance,
    )
    changer = VoiceChanger(config, events)
    print(f"{pack.adjective} accent — live. Ctrl+C to stop.")
    changer.start()
    if changer.state == "error":
        return 1
    try:
        while changer.running:
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping…")
    finally:
        changer.close()
    return 0


def cmd_voices(args) -> int:
    config = AppConfig.load()
    language = _resolve_language(args.language, config) if args.language else None

    if args.install:
        keys = args.install
        if keys == ["all"]:
            keys = list(voice_catalogue.for_language(language)
                        if language else voice_catalogue.CATALOGUE)
        for key in keys:
            if key not in voice_catalogue.CATALOGUE:
                print(f"Unknown voice: {key}", file=sys.stderr)
                return 2
            _download_with_bar(key)
        return 0

    registry = VoiceRegistry()
    for lang_key, lang_name in available_languages():
        if language and lang_key != language:
            continue
        print(f"\n{lang_name}")
        for voice in registry.all_voices(lang_key):
            mark = "installed" if voice.installed else "not installed"
            where = "offline" if voice.offline else "online"
            print(f"  {voice.key:34s} {voice.gender:6s} {where:7s} "
                  f"{mark:14s} {voice.description}")
    print(f"\nModels are stored in: {voice_catalogue.models_dir()}")
    print("Install one with:  ravc voices --install de_DE-thorsten-medium")
    return 0


def _download_with_bar(key: str) -> None:
    last = {"line": ""}

    def progress(stage: str, fraction: float) -> None:
        filled = int(fraction * 30)
        bar = "#" * filled + "-" * (30 - filled)
        line = f"\r{stage:42s} [{bar}] {fraction*100:5.1f}%"
        if line != last["line"]:
            sys.stdout.write(line)
            sys.stdout.flush()
            last["line"] = line

    voice_catalogue.download_voice(key, progress=progress)
    sys.stdout.write("\n")


def cmd_devices(args) -> int:
    if not audio_devices.sounddevice_available():
        print("Audio backend unavailable: pip install sounddevice")
        return 1
    print("Inputs (microphones):")
    default_in = audio_devices.default_input()
    for device in audio_devices.input_devices():
        mark = " (default)" if default_in and device.index == default_in.index else ""
        print(f"  [{device.index:2d}] {device.label}{mark}")
    print("\nOutputs:")
    default_out = audio_devices.default_output()
    for device in audio_devices.output_devices():
        mark = " (default)" if default_out and device.index == default_out.index else ""
        brand = device.virtual_cable_brand
        tag = f"  <- {brand}" if brand else ""
        print(f"  [{device.index:2d}] {device.label}{mark}{tag}")
    print()
    print(audio_devices.describe_routing())
    return 0


def cmd_doctor(args) -> int:
    config = AppConfig.load()
    language = _resolve_language(args.language, config)
    pack = get_pack(language)
    print(f"Accent Voice Changer {__version__}")
    print(f"Python {sys.version.split()[0]} on {sys.platform}")
    print(f"Settings file: {config_path()}"
          f"{'' if config_path().exists() else '  (not created yet)'}")
    print(f"Voice models : {voice_catalogue.models_dir()}")
    print()

    print("Accent languages:")
    for key, name in available_languages():
        mark = " (active)" if key == language else ""
        print(f"  {key:10s} {name}{mark}")
    print()

    print("Speech recognition:")
    if WhisperAsr.is_installed():
        print(f"  faster-whisper installed; CUDA: "
              f"{'yes' if WhisperAsr.cuda_available() else 'no (CPU)'}")
        print(f"  model: {config.recognition.model_size}")
    else:
        print("  NOT installed — pip install faster-whisper")
        print("  (Type-to-Speak and file conversion still need it for files;")
        print("   typed text works without it.)")
    print()

    print("Speech synthesis:")
    for line in VoiceRegistry().status_lines(language):
        print(f"  {line}")
    print()

    print("Audio:")
    if audio_devices.sounddevice_available():
        cable = audio_devices.find_virtual_cable()
        print(f"  PortAudio ready; "
              f"{len(audio_devices.input_devices())} inputs, "
              f"{len(audio_devices.output_devices())} outputs")
        print(f"  Virtual cable: {cable.name if cable else 'NOT FOUND'}")
    else:
        print("  sounddevice/PortAudio NOT available — pip install sounddevice")
    print()

    print("End-to-end check:")
    try:
        engine = AccentEngine(language=language, profile=pack.profile())
        result = engine.accentify(pack.sample_line)
        print(f"  in  : {pack.sample_line}")
        print(f"  out : {result.eye_dialect}")
        print(f"  tts : {result.native_text}")
    except Exception as exc:
        print(f"  accent engine FAILED: {exc}")
        return 1

    try:
        changer = VoiceChanger(config)
        _accented, audio = changer.render(pack.sample_line)
        print(f"  synthesised {audio.duration:.2f}s via "
              f"'{changer.stats.engine}' in {changer.stats.tts_ms:.0f} ms")
        changer.close()
    except Exception as exc:
        print(f"  synthesis FAILED: {exc}")
        print("  -> install a voice:  ravc voices --install "
              f"{voice_catalogue.default_voice(language)}")
        return 1
    print("\nAll good.")
    return 0


def cmd_models(args) -> int:
    print("Speech recognition models (downloaded on first use):")
    for key, name, note in MODEL_SIZES:
        print(f"  {key:12s} {name:10s} {note}")
    return 0


def cmd_presets(args) -> int:
    for name in preset_names():
        fx = PRESETS[name]
        print(f"  {name:14s} pitch {fx.pitch_semitones:+.1f} st, "
              f"formant {fx.formant_semitones:+.1f} st, "
              f"bass {fx.bass_db:+.1f} dB, drive {fx.drive:.2f}")
    return 0


def cmd_gui(args) -> int:
    from .gui import run_gui
    return run_gui()


# --------------------------------------------------------------------------
# Parser
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ravc",
        description="Speak English with a massive Russian or German accent.")
    parser.add_argument("--version", action="version",
                        version=f"%(prog)s {__version__}")
    parser.add_argument("--config", help="path to an alternative settings file")
    sub = parser.add_subparsers(dest="command")

    def add_accent_options(p, with_voice: bool = True) -> None:
        p.add_argument("-l", "--language", choices=sorted(LANGUAGE_ALIASES),
                       help="accent language (default: whatever is saved)")
        p.add_argument("-s", "--strength", type=float,
                       help="accent strength, 0.0 to 1.0")
        p.add_argument("-g", "--grammar", type=float,
                       help="broken-English grammar strength, 0.0 to 1.0")
        if with_voice:
            p.add_argument("-v", "--voice", help="voice key, e.g. "
                                                 "piper:de_DE-thorsten-medium")
            p.add_argument("-p", "--preset", choices=preset_names(),
                           help="voice-character preset")
            p.add_argument("-r", "--rate", type=float,
                           help="speaking rate, 1.0 is natural")

    p_say = sub.add_parser("say", help="speak a line of text")
    p_say.add_argument("text", nargs="+")
    p_say.add_argument("-o", "--out", help="write a WAV file instead of playing")
    p_say.add_argument("--dry-run", action="store_true",
                       help="print the transcription only, synthesise nothing")
    add_accent_options(p_say)
    p_say.set_defaults(func=cmd_say)

    p_file = sub.add_parser("file", help="convert an audio file")
    p_file.add_argument("source")
    p_file.add_argument("destination")
    add_accent_options(p_file)
    p_file.set_defaults(func=cmd_file)

    p_live = sub.add_parser("live", help="run the live microphone pipeline")
    add_accent_options(p_live)
    p_live.set_defaults(func=cmd_live)

    p_voices = sub.add_parser("voices", help="list or install voice models")
    p_voices.add_argument("-l", "--language", choices=sorted(LANGUAGE_ALIASES))
    p_voices.add_argument("--install", nargs="+", metavar="KEY",
                          help="download voice models ('all' for every one)")
    p_voices.set_defaults(func=cmd_voices)

    sub.add_parser("devices", help="list audio devices").set_defaults(
        func=cmd_devices)
    sub.add_parser("models", help="list speech-recognition models").set_defaults(
        func=cmd_models)
    sub.add_parser("presets", help="list voice-character presets").set_defaults(
        func=cmd_presets)

    p_doctor = sub.add_parser("doctor", help="check the installation")
    p_doctor.add_argument("-l", "--language", choices=sorted(LANGUAGE_ALIASES))
    p_doctor.set_defaults(func=cmd_doctor)

    sub.add_parser("gui", help="open the desktop window").set_defaults(
        func=cmd_gui)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        return cmd_gui(args)
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1
