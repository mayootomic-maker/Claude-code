"""Persistent settings."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import (MISSING, asdict, dataclass, field, fields,
                         is_dataclass)
from pathlib import Path
from typing import Any, Dict, Optional

from .accent.languages import DEFAULT_LANGUAGE, get_pack
from .accent.languages.base import AccentProfile
from .asr.whisper_asr import DEFAULT_MODEL
from .dsp.chain import DEFAULT_PRESET, VoiceFx, get_preset
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
    strength: float = 1.0
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
    preset: str = DEFAULT_PRESET
    speaking_rate: float = 1.0
    fx: VoiceFx = field(default_factory=lambda: get_preset(DEFAULT_PRESET))

    def voice_for(self, language: str) -> str:
        return self.voice_keys.get(language) or f"piper:{default_voice(language)}"

    def set_voice(self, language: str, key: str) -> None:
        self.voice_keys[language] = key


@dataclass
class BehaviourSettings:
    start_minimised: bool = False
    autostart_pipeline: bool = False
    push_to_talk: bool = False
    show_subtitles: bool = True
    play_on_monitor: bool = True
    duck_original: bool = True
    max_queue: int = 3


@dataclass
class AppConfig:
    version: int = CONFIG_VERSION
    audio: AudioSettings = field(default_factory=AudioSettings)
    recognition: RecognitionSettings = field(default_factory=RecognitionSettings)
    accent: AccentSettings = field(default_factory=AccentSettings)
    voice: VoiceSettings = field(default_factory=VoiceSettings)
    behaviour: BehaviourSettings = field(default_factory=BehaviourSettings)

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

    @property
    def language(self) -> str:
        return self.accent.language

    @property
    def active_voice_key(self) -> str:
        return self.voice.voice_for(self.accent.language)


def _declared_type(f) -> Optional[type]:
    """The runtime type of a field.

    ``f.type`` is a *string* here because of ``from __future__ import
    annotations``, so nested dataclasses have to be identified from what the
    field's default produces rather than from the annotation.
    """
    if f.default_factory is not MISSING:  # type: ignore[misc]
        try:
            return type(f.default_factory())  # type: ignore[misc]
        except Exception:
            return None
    if f.default is not MISSING and f.default is not None:
        return type(f.default)
    return None


def _build(cls, data: Dict[str, Any]):
    """Rebuild a nested dataclass, ignoring unknown or removed keys."""
    kwargs: Dict[str, Any] = {}
    for f in fields(cls):
        if f.name not in data:
            continue
        value = data[f.name]
        target = _declared_type(f)
        if isinstance(value, dict) and target is not None and is_dataclass(target):
            kwargs[f.name] = _build(target, value)
        else:
            kwargs[f.name] = value
    return cls(**kwargs)
