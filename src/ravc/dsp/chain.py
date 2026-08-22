"""The voice-character chain: what the synthesised voice actually sounds like.

Order matters.  Pitch and formant first (they work on a clean signal), then
tone shaping, then grit, then dynamics, then the limiter last so nothing
downstream can clip the virtual cable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List

import numpy as np

from ..tts.base import Audio
from . import effects, pitch
from .filters import Biquad, apply_offline, db_to_linear, fade, pad


@dataclass
class VoiceFx:
    """Voice-character settings.  All values are user-facing."""

    pitch_semitones: float = 0.0
    formant_semitones: float = 0.0
    bass_db: float = 0.0
    presence_db: float = 0.0
    drive: float = 0.0                 # 0-1 soft saturation
    compression: float = 0.4           # 0-1
    gate_db: float = -60.0
    output_db: float = 0.0
    high_pass_hz: float = 70.0
    low_pass_hz: float = 0.0           # 0 = off
    normalize: bool = True
    target_peak_db: float = -3.0
    lead_silence: float = 0.06
    tail_silence: float = 0.10

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "VoiceFx":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})

    # -- processing ------------------------------------------------------

    def apply(self, audio: Audio) -> Audio:
        samples = np.asarray(audio.samples, dtype=np.float32)
        sr = audio.sample_rate
        if samples.size == 0:
            return audio

        if abs(self.pitch_semitones) > 1e-6 or abs(self.formant_semitones) > 1e-6:
            samples = pitch.shift(samples, sr,
                                  self.pitch_semitones,
                                  self.formant_semitones)

        stages: List[Biquad] = []
        if self.high_pass_hz > 20:
            stages.append(Biquad.high_pass(sr, self.high_pass_hz))
        if abs(self.bass_db) > 0.05:
            stages.append(Biquad.low_shelf(sr, 220.0, self.bass_db))
        if abs(self.presence_db) > 0.05:
            stages.append(Biquad.peaking(sr, 3200.0, self.presence_db, q=0.9))
        if self.low_pass_hz and self.low_pass_hz < sr / 2 - 100:
            stages.append(Biquad.low_pass(sr, self.low_pass_hz))
        if stages:
            samples = apply_offline(stages, samples, sr)

        if self.drive > 1e-6:
            samples = effects.saturate(samples, self.drive)

        if self.gate_db > -90:
            samples = effects.gate(samples, sr, self.gate_db)

        if self.compression > 1e-6:
            amount = float(np.clip(self.compression, 0.0, 1.0))
            samples = effects.compress(
                samples, sr,
                threshold_db=-14.0 - 12.0 * amount,
                ratio=1.0 + 4.0 * amount,
                makeup_db=3.0 * amount)

        # Normalise before the limiter: TTS output level varies with voice and
        # sentence length, and a virtual microphone needs a predictable level.
        if self.normalize:
            peak = float(np.max(np.abs(samples))) if samples.size else 0.0
            if peak > 1e-5:
                samples = (samples * (db_to_linear(self.target_peak_db) / peak)
                           ).astype(np.float32)

        if abs(self.output_db) > 0.05:
            samples = (samples * db_to_linear(self.output_db)).astype(np.float32)

        samples = effects.limit(samples, sr, ceiling_db=-1.0)
        samples = fade(samples, sr, 0.006, 0.012)
        if self.lead_silence or self.tail_silence:
            samples = pad(samples, sr, self.lead_silence, self.tail_silence)
        return Audio(samples, sr)


PRESETS: Dict[str, VoiceFx] = {
    "Natural": VoiceFx(
        compression=0.3),
    "Comrade": VoiceFx(
        pitch_semitones=-2.0, formant_semitones=-2.0,
        bass_db=3.0, presence_db=1.5, drive=0.12, compression=0.45),
    "Bond Villain": VoiceFx(
        pitch_semitones=-5.0, formant_semitones=-4.0,
        bass_db=6.0, presence_db=2.5, drive=0.25, compression=0.6),
    "Big Bear": VoiceFx(
        pitch_semitones=-8.0, formant_semitones=-6.0,
        bass_db=8.0, presence_db=1.0, drive=0.35, compression=0.7),
    "Babushka": VoiceFx(
        pitch_semitones=4.0, formant_semitones=3.0,
        bass_db=-2.0, presence_db=3.0, compression=0.4),
    "KGB Radio": VoiceFx(
        pitch_semitones=-2.0, formant_semitones=-1.0,
        drive=0.5, compression=0.85, presence_db=5.0,
        high_pass_hz=320.0, low_pass_hz=3400.0),
    "Cosmonaut": VoiceFx(
        pitch_semitones=-3.0, formant_semitones=-2.0,
        drive=0.3, compression=0.8, presence_db=4.0,
        high_pass_hz=200.0, low_pass_hz=5200.0, bass_db=2.0),
}

DEFAULT_PRESET = "Comrade"


def preset_names() -> List[str]:
    return list(PRESETS)


def get_preset(name: str) -> VoiceFx:
    return VoiceFx.from_dict(PRESETS.get(name, PRESETS[DEFAULT_PRESET]).to_dict())
