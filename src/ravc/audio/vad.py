"""Voice activity detection and utterance endpointing.

The pipeline needs to know when you *finished* a sentence, not just when
sound is present: the accent conversion works on whole words, so it has to
wait for a natural pause before it can transcribe and re-speak.

Detection combines three cheap features, because none of them is reliable
alone in a real room:

* **energy** relative to an adaptively tracked noise floor -- robust, but
  fooled by a fan spinning up or a door closing;
* **zero-crossing rate** -- separates voiced speech from broadband noise;
* **spectral flatness** -- speech is tonal (peaky spectrum), most room noise
  and keyboard clatter is flat.

The noise floor tracks upward quickly and downward slowly, so the detector
adapts to a noisy room without slowly going deaf during a long sentence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import numpy as np


class VadState(Enum):
    SILENCE = "silence"
    SPEECH = "speech"


@dataclass
class VadConfig:
    sample_rate: int = 16000
    frame_ms: int = 20
    # How far above the tracked noise floor counts as speech.
    threshold_db: float = 9.0
    # An absolute floor, so a dead-silent room does not trigger on nothing.
    absolute_floor_db: float = -58.0
    speech_onset_ms: int = 120        # sustained speech before we open
    silence_hangover_ms: int = 620    # silence before we close an utterance
    max_utterance_s: float = 14.0     # force a cut on a monologue
    min_utterance_ms: int = 260       # discard shorter blips
    pre_roll_ms: int = 260            # audio kept from before the onset

    @property
    def frame_length(self) -> int:
        return int(self.sample_rate * self.frame_ms / 1000)


@dataclass
class Utterance:
    samples: np.ndarray
    sample_rate: int
    started_at: float = 0.0

    @property
    def duration(self) -> float:
        return len(self.samples) / float(self.sample_rate or 1)


def frame_energy_db(frame: np.ndarray) -> float:
    arr = np.asarray(frame, dtype=np.float64)
    if arr.size == 0:
        return -120.0
    power = float(np.mean(arr * arr))
    return 10.0 * math.log10(max(power, 1e-12))


def zero_crossing_rate(frame: np.ndarray) -> float:
    arr = np.asarray(frame)
    if arr.size < 2:
        return 0.0
    return float(np.mean(np.abs(np.diff(np.signbit(arr).astype(np.int8)))))


def spectral_flatness(frame: np.ndarray) -> float:
    """1.0 = white noise, near 0 = strongly tonal (voiced speech)."""
    arr = np.asarray(frame, dtype=np.float64)
    if arr.size < 16:
        return 1.0
    spectrum = np.abs(np.fft.rfft(arr * np.hanning(arr.size))) ** 2
    spectrum = np.maximum(spectrum[1:], 1e-12)
    geometric = math.exp(float(np.mean(np.log(spectrum))))
    arithmetic = float(np.mean(spectrum))
    return geometric / max(arithmetic, 1e-12)


class VoiceActivityDetector:
    """Frame-level speech/silence decision with an adaptive noise floor."""

    def __init__(self, config: Optional[VadConfig] = None) -> None:
        self.config = config or VadConfig()
        self.noise_floor_db = self.config.absolute_floor_db
        self._initialised = False

    def reset(self) -> None:
        self.noise_floor_db = self.config.absolute_floor_db
        self._initialised = False

    def is_speech(self, frame: np.ndarray) -> bool:
        cfg = self.config
        energy = frame_energy_db(frame)

        if not self._initialised:
            self.noise_floor_db = energy
            self._initialised = True

        threshold = max(self.noise_floor_db + cfg.threshold_db,
                        cfg.absolute_floor_db)
        loud_enough = energy > threshold

        speechlike = True
        if loud_enough:
            zcr = zero_crossing_rate(frame)
            flatness = spectral_flatness(frame)
            # Very high ZCR with a flat spectrum is hiss, a fan, or a click.
            speechlike = not (zcr > 0.42 and flatness > 0.42)

        speech = loud_enough and speechlike

        # Track the floor: fast up, slow down, and never while speaking.
        if not speech:
            rate = 0.10 if energy > self.noise_floor_db else 0.02
            self.noise_floor_db += rate * (energy - self.noise_floor_db)
        return speech


class Endpointer:
    """Turns a stream of frames into complete utterances."""

    def __init__(self, config: Optional[VadConfig] = None) -> None:
        self.config = config or VadConfig()
        self.vad = VoiceActivityDetector(self.config)
        self.state = VadState.SILENCE
        self._buffer: List[np.ndarray] = []
        self._pre_roll: List[np.ndarray] = []
        self._speech_frames = 0
        self._silence_frames = 0
        self._collected = 0
        self._clock = 0.0

    # -- helpers ---------------------------------------------------------

    def _frames(self, ms: int) -> int:
        return max(1, int(round(ms / self.config.frame_ms)))

    @property
    def _max_pre_roll(self) -> int:
        return self._frames(self.config.pre_roll_ms)

    def reset(self) -> None:
        self.state = VadState.SILENCE
        self._buffer.clear()
        self._pre_roll.clear()
        self._speech_frames = 0
        self._silence_frames = 0
        self._collected = 0
        self.vad.reset()

    # -- main ------------------------------------------------------------

    def push(self, frame: np.ndarray) -> Optional[Utterance]:
        """Feed one frame; returns an utterance when one completes."""
        cfg = self.config
        frame = np.asarray(frame, dtype=np.float32)
        self._clock += cfg.frame_ms / 1000.0
        speech = self.vad.is_speech(frame)

        if self.state is VadState.SILENCE:
            self._pre_roll.append(frame)
            if len(self._pre_roll) > self._max_pre_roll:
                self._pre_roll.pop(0)
            if speech:
                self._speech_frames += 1
                if self._speech_frames >= self._frames(cfg.speech_onset_ms):
                    self.state = VadState.SPEECH
                    self._buffer = list(self._pre_roll)
                    self._collected = len(self._buffer)
                    self._pre_roll.clear()
                    self._silence_frames = 0
            else:
                self._speech_frames = 0
            return None

        # -- speech state
        self._buffer.append(frame)
        self._collected += 1
        if speech:
            self._silence_frames = 0
        else:
            self._silence_frames += 1

        too_long = (self._collected * cfg.frame_ms / 1000.0) >= cfg.max_utterance_s
        ended = self._silence_frames >= self._frames(cfg.silence_hangover_ms)

        if ended or too_long:
            return self._finish()
        return None

    def flush(self) -> Optional[Utterance]:
        """Close any in-progress utterance (called when capture stops)."""
        if self.state is VadState.SPEECH and self._buffer:
            return self._finish()
        return None

    def _finish(self) -> Optional[Utterance]:
        cfg = self.config
        samples = (np.concatenate(self._buffer) if self._buffer
                   else np.zeros(0, dtype=np.float32))
        # Trim the trailing hangover silence, keeping a short tail.
        keep_tail = self._frames(140) * cfg.frame_length
        trim = max(0, (self._silence_frames * cfg.frame_length) - keep_tail)
        if trim and samples.size > trim:
            samples = samples[:samples.size - trim]

        self.state = VadState.SILENCE
        self._buffer = []
        self._pre_roll = []
        self._speech_frames = 0
        self._silence_frames = 0
        self._collected = 0

        duration_ms = samples.size * 1000.0 / cfg.sample_rate
        if duration_ms < cfg.min_utterance_ms:
            return None
        return Utterance(samples=samples, sample_rate=cfg.sample_rate,
                         started_at=self._clock)
