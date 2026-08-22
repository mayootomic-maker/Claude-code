"""Common types for every text-to-speech backend."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np


@dataclass(frozen=True)
class Voice:
    """One selectable voice."""

    key: str                 # stable id, e.g. "piper:ru_RU-dmitri-medium"
    name: str                # display name, e.g. "Dmitri"
    engine: str              # "piper" | "edge" | "sapi"
    gender: str = "unknown"  # "male" | "female"
    language: str = "ru-RU"
    accent: str = "russian"      # which accent language pack this voice serves
    description: str = ""
    offline: bool = True
    installed: bool = True

    @property
    def label(self) -> str:
        """One-line description for a picker, e.g. "Dmitri - male, offline"."""
        bits = []
        if self.gender in ("male", "female"):
            bits.append(self.gender)
        bits.append("offline" if self.offline else "online")
        if not self.installed:
            bits.append("not downloaded")
        return f"{self.name} \u2014 {', '.join(bits)}"


@dataclass
class Audio:
    """Mono float32 PCM in [-1, 1]."""

    samples: np.ndarray
    sample_rate: int

    def __post_init__(self) -> None:
        arr = np.asarray(self.samples, dtype=np.float32).reshape(-1)
        self.samples = arr

    @property
    def duration(self) -> float:
        return len(self.samples) / float(self.sample_rate or 1)

    @classmethod
    def silence(cls, seconds: float, sample_rate: int) -> "Audio":
        return cls(np.zeros(int(seconds * sample_rate), dtype=np.float32),
                   sample_rate)


@dataclass
class SynthRequest:
    """Everything a backend might need to speak one utterance.

    Backends that drive a phoneme model use :attr:`ipa`; backends that take
    text use :attr:`text`, which is already spelled the way the target voice
    needs to read it (Cyrillic for Russian, German orthography for German).
    """

    text: str                    # already spelled for the target TTS language
    ipa: Sequence[Sequence[str]] = field(default_factory=list)
    voice_key: Optional[str] = None
    speaker: str = ""            # sub-voice / emotion within a multi-speaker model
    rate: float = 1.0        # 1.0 = natural; <1 slower
    pitch: float = 0.0       # semitones
    volume: float = 1.0
    plain_text: str = ""     # original English, for logging / SAPI fallback


class TtsError(RuntimeError):
    pass


class TtsEngine(ABC):
    """A speech backend."""

    name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        """Can this engine run right now (deps present, model downloaded)?"""

    @abstractmethod
    def list_voices(self, language: Optional[str] = None) -> List[Voice]:
        """Voices this engine offers, optionally filtered by accent language."""

    @abstractmethod
    def synthesize(self, request: SynthRequest) -> Audio:
        ...

    def warm_up(self) -> None:
        """Optional: pay one-time costs before the first real utterance."""

    def close(self) -> None:
        """Optional: release models / sessions."""


def resample(audio: Audio, target_rate: int) -> Audio:
    """Band-limited resampling; backends differ, the mixer needs one rate."""
    if audio.sample_rate == target_rate or len(audio.samples) == 0:
        return Audio(audio.samples, target_rate)
    from ..dsp.pitch import resample_to
    return Audio(resample_to(audio.samples, audio.sample_rate, target_rate),
                 target_rate)
