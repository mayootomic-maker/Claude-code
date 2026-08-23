"""Persistent settings."""

from __future__ import annotations

import copy
import json
import os
import tempfile
from dataclasses import (MISSING, asdict, dataclass, field, fields,
                         is_dataclass)
from pathlib import Path
from typing import Any, Dict, List, Optional, get_args, get_origin, get_type_hints

from .accent.languages import DEFAULT_LANGUAGE, get_pack
from .hotkeys import DEFAULTS as DEFAULT_HOTKEYS
from .accent.languages.base import AccentProfile
from .asr.whisper_asr import DEFAULT_MODEL
from .dsp.accentfx import AccentFxSettings
from .soundboard import SoundboardSettings
from .dsp.chain import DEFAULT_PRESET, VoiceFx, get_preset
from .dsp.comms import DEFAULT_PROFILE as DEFAULT_COMMS
from .dsp.comms import CommsProfile, get_profile
from .tts.voices import default_voice

APP_NAME = "AccentVoiceChanger"
CONFIG_VERSION = 1


def config_dir() -> Path:
    override = os.environ.get("RAVC_CONFIG_DIR")
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif os.uname().sysname == "Darwin":  # pragma: no cover - mac
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / APP_NAME


def config_path() -> Path:
    return config_dir() / "settings.json"


@dataclass
class AudioSettings:
    input_device: str = ""       # stored by name; index is not stable
    output_device: str = ""      # the virtual cable
    monitor_device: str = ""     # your own headphones
    monitor_enabled: bool = True
    input_gain_db: float = 0.0
    output_sample_rate: int = 48000
    mic_block_ms: int = 20


@dataclass
class RecognitionSettings:
    model_size: str = DEFAULT_MODEL
    device: str = "auto"
    beam_size: int = 1
    silence_hangover_ms: int = 620
    speech_onset_ms: int = 120
    vad_threshold_db: float = 9.0
    max_utterance_s: float = 14.0


@dataclass
class AccentSettings:
    """Which accent, how strong, and which of its features are enabled.

    Feature switches are stored per language, because the Russian and German
    packs expose different ones -- turning off "h → kh" is meaningless for
    German, and "stop → shtop" is meaningless for Russian.
    """

    language: str = DEFAULT_LANGUAGE
    # Not 1.0: at full strength every feature fires at once and the result
    # crosses from "English with a heavy accent" into "reading Russian".
    # 0.75 keeps the persistent markers and drops the beginner ones.
    strength: float = 0.75
    grammar_strength: float = 0.0
    swap_prepositions: bool = False
    features: Dict[str, Dict[str, bool]] = field(default_factory=dict)

    def overrides(self, language: Optional[str] = None) -> Dict[str, bool]:
        return dict(self.features.get(language or self.language, {}))

    def set_feature(self, name: str, value: bool,
                    language: Optional[str] = None) -> None:
        key = language or self.language
        self.features.setdefault(key, {})[name] = bool(value)

    def to_profile(self) -> AccentProfile:
        pack = get_pack(self.language)
        return pack.profile(self.strength, self.overrides())


@dataclass
class VoiceSettings:
    """Voice choice is per accent language; the character FX are shared."""

    voice_keys: Dict[str, str] = field(default_factory=dict)
    # Chosen sub-voice per multi-speaker model, keyed by voice key: which of
    # the eight Thorsten emotions, or which of the 236 pooled speakers.
    speakers: Dict[str, str] = field(default_factory=dict)
    preset: str = DEFAULT_PRESET
    # Measured, not guessed: at 1.0 the Russian voice reads English
    # phonemes at 4.1 words/second. Natural conversational English is
    # 2.5-3. 0.7 lands at about 2.9.
    speaking_rate: float = 0.7
    fx: VoiceFx = field(default_factory=lambda: get_preset(DEFAULT_PRESET))
    # The voice-chat link the output is pushed through, after the character
    # effects: narrowband codec, cheap mic, room noise.
    # Live mode holds the room-noise bed back until you actually speak.
    live_gate_db: float = -55.0
    # The real-time accent applied to your own voice in Live mode.
    live_accent: AccentFxSettings = field(default_factory=AccentFxSettings)
    # How far Live shifts your own pitch. Zero by default, and that matters:
    # `fx` above describes the *character voice* the Full path synthesises,
    # and Live was borrowing its pitch shift, so a fresh install moved the
    # speaker down two semitones through a delay-line shifter. Live is
    # supposed to keep your voice and change only the accent, and a pitch
    # shift is the one thing guaranteed to stop it being your voice.
    live_pitch_semitones: float = 0.0
    comms: str = DEFAULT_COMMS
    comms_profile: CommsProfile = field(
        default_factory=lambda: get_profile(DEFAULT_COMMS))

    def voice_for(self, language: str) -> str:
        return self.voice_keys.get(language) or f"piper:{default_voice(language)}"

    def set_voice(self, language: str, key: str) -> None:
        self.voice_keys[language] = key

    def speaker_for(self, voice_key: str) -> str:
        return self.speakers.get(voice_key, "")

    def set_speaker(self, voice_key: str, speaker: str) -> None:
        if speaker:
            self.speakers[voice_key] = speaker
        else:
            self.speakers.pop(voice_key, None)


@dataclass
class BehaviourSettings:
    # System-wide shortcuts, so the mode can be changed without leaving a
    # full-screen game. Empty string disables one.
    hotkeys: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_HOTKEYS))
    hotkeys_enabled: bool = True
    start_minimised: bool = False
    autostart_pipeline: bool = False
    push_to_talk: bool = False
    show_subtitles: bool = True
    play_on_monitor: bool = True
    duck_original: bool = True
    max_queue: int = 3


@dataclass
class Profile:
    """A named snapshot of everything that decides how you sound.

    Devices are deliberately not part of it: a profile is "how I sound in
    this game", and the microphone does not change between games.
    """

    name: str = ""
    accent: AccentSettings = field(default_factory=AccentSettings)
    voice: VoiceSettings = field(default_factory=VoiceSettings)


@dataclass
class AppConfig:
    version: int = CONFIG_VERSION
    audio: AudioSettings = field(default_factory=AudioSettings)
    recognition: RecognitionSettings = field(default_factory=RecognitionSettings)
    accent: AccentSettings = field(default_factory=AccentSettings)
    voice: VoiceSettings = field(default_factory=VoiceSettings)
    behaviour: BehaviourSettings = field(default_factory=BehaviourSettings)
    soundboard: SoundboardSettings = field(default_factory=SoundboardSettings)
    profiles: List[Profile] = field(default_factory=list)

    # -- profiles --------------------------------------------------------

    def save_profile(self, name: str) -> "Profile":
        """Store the current accent and voice settings under ``name``.

        Saving over an existing name replaces it in place, so the order the
        buttons appear in does not shuffle when you re-save one.
        """
        profile = Profile(name=name,
                          accent=copy.deepcopy(self.accent),
                          voice=copy.deepcopy(self.voice))
        for index, existing in enumerate(self.profiles):
            if existing.name == name:
                self.profiles[index] = profile
                return profile
        self.profiles.append(profile)
        return profile

    def apply_profile(self, name: str) -> bool:
        for profile in self.profiles:
            if profile.name == name:
                self.accent = copy.deepcopy(profile.accent)
                self.voice = copy.deepcopy(profile.voice)
                return True
        return False

    def delete_profile(self, name: str) -> bool:
        before = len(self.profiles)
        self.profiles = [p for p in self.profiles if p.name != name]
        return len(self.profiles) != before

    # -- persistence -----------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AppConfig":
        return _build(cls, data or {})

    def save(self, path: Optional[Path] = None) -> Path:
        target = Path(path) if path else config_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(self.to_dict(), indent=2, ensure_ascii=False)
        # Write-then-rename: a crash mid-save must not leave an unparseable
        # settings file that stops the app starting next time.
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
            os.replace(tmp, target)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return target

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "AppConfig":
        target = Path(path) if path else config_path()
        try:
            with open(target, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return cls()
        try:
            return cls.from_dict(data)
        except Exception:
            return cls()

    def apply_preset(self, name: str) -> None:
        self.voice.preset = name
        self.voice.fx = get_preset(name)

    def apply_comms(self, name: str) -> None:
        self.voice.comms = name
        self.voice.comms_profile = get_profile(name)

    @property
    def language(self) -> str:
        return self.accent.language

    @property
    def active_voice_key(self) -> str:
        return self.voice.voice_for(self.accent.language)


def _hints(cls) -> Dict[str, Any]:
    """Resolved annotations for a dataclass, or {} if they cannot be.

    ``f.type`` is a *string* here because of ``from __future__ import
    annotations``, so the annotations have to be resolved before a field's
    declared type means anything.
    """
    try:
        return get_type_hints(cls)
    except Exception:      # a forward reference that cannot be resolved
        return {}


def _declared_type(f, hints: Dict[str, Any]) -> Optional[type]:
    """The runtime type of a field, for rebuilding a nested dataclass."""
    hint = hints.get(f.name)
    if is_dataclass(hint):
        return hint          # type: ignore[return-value]
    # Fall back to what the default produces, which covers fields whose
    # annotation could not be resolved.
    if f.default_factory is not MISSING:  # type: ignore[misc]
        try:
            return type(f.default_factory())  # type: ignore[misc]
        except Exception:
            return None
    if f.default is not MISSING and f.default is not None:
        return type(f.default)
    return None


def _element_type(hint: Any) -> Optional[type]:
    """The dataclass a ``List[...]`` annotation holds, if it holds one.

    Needed because a list field's default is an empty list, which says
    nothing about what goes in it -- so without reading the annotation, a
    saved list of profiles came back as a list of plain dicts and failed at
    the first attribute access.
    """
    if get_origin(hint) is not list:
        return None
    args = get_args(hint)
    return args[0] if args and is_dataclass(args[0]) else None


def _build(cls, data: Dict[str, Any]):
    """Rebuild a nested dataclass, ignoring unknown or removed keys."""
    hints = _hints(cls)
    kwargs: Dict[str, Any] = {}
    for f in fields(cls):
        if f.name not in data:
            continue
        value = data[f.name]
        element = _element_type(hints.get(f.name))
        if element is not None and isinstance(value, list):
            kwargs[f.name] = [_build(element, item) if isinstance(item, dict)
                              else item for item in value]
            continue
        target = _declared_type(f, hints)
        if isinstance(value, dict) and target is not None and is_dataclass(target):
            kwargs[f.name] = _build(target, value)
        else:
            kwargs[f.name] = value
    return cls(**kwargs)
