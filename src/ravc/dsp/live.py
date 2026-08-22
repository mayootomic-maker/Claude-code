"""Streaming effects for the low-latency path.

The accent path has to wait for you to finish a sentence -- it cannot know
how to mispronounce a word until it knows which word it is. That is fine
for a callout, and useless for banter.

This module is the other half: block-by-block processing of your own voice
with about twenty milliseconds of delay. It cannot add an accent, but it
can change *who you sound like* and put you on the far end of a game voice
link, which between them is most of the effect.

Everything here keeps state across blocks and allocates nothing per sample,
because it runs inside the audio callback.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from .comms import CommsProfile, NOISE_SOURCES
from .filters import Biquad, db_to_linear


class GranularPitchShifter:
    """Pitch shifting by a crossfaded modulated delay line.

    Two taps read the input history at a rate set by the shift ratio, half
    a grain apart, each under a Hann window. Two Hann windows overlapped by
    half sum to exactly one, so the crossfade is transparent.

    This moves the formants along with the pitch, the way a tape speed
    change does. For this purpose that is not a compromise but the point:
    it makes you sound like a *different person* rather than like yourself
    played back wrong, which is what a phase vocoder's
    formant-preserving shift does.
    """

    def __init__(self, sample_rate: int, semitones: float = 0.0,
                 grain_ms: float = 55.0) -> None:
        self.sample_rate = sample_rate
        self.grain = max(64, int(sample_rate * grain_ms / 1000))
        self._buffer = np.zeros(self.grain * 4, dtype=np.float32)
        self._write = 0
        self._phase = 0.0
        self.semitones = semitones

    @property
    def semitones(self) -> float:
        return self._semitones

    @semitones.setter
    def semitones(self, value: float) -> None:
        self._semitones = float(value)
        self._ratio = 2.0 ** (self._semitones / 12.0)

    def reset(self) -> None:
        self._buffer[:] = 0.0
        self._write = 0
        self._phase = 0.0

    def process(self, block: np.ndarray) -> np.ndarray:
        arr = np.asarray(block, dtype=np.float32).reshape(-1)
        if abs(self._semitones) < 1e-6 or arr.size == 0:
            self._append(arr)
            return arr

        size = self._buffer.size
        count = arr.size
        self._append(arr)

        # Where each output sample reads from, as a delay behind the write
        # pointer that ramps at (1 - ratio) and wraps every grain.
        step = (1.0 - self._ratio)
        phases = (self._phase + step * np.arange(count, dtype=np.float64))
        frac1 = np.mod(phases / self.grain, 1.0)
        frac2 = np.mod(frac1 + 0.5, 1.0)
        self._phase = float(phases[-1] + step)

        # Keep the accumulator bounded, on a grain boundary so the windows
        # stay continuous across the wrap.
        limit = self.grain * 1024.0
        if abs(self._phase) > limit:
            self._phase = math.fmod(self._phase, self.grain)

        write_positions = (self._write - count
                           + np.arange(count, dtype=np.float64))
        out = np.zeros(count, dtype=np.float64)
        for frac in (frac1, frac2):
            window = 0.5 - 0.5 * np.cos(2.0 * np.pi * frac)
            read = write_positions - frac * self.grain - self.grain
            out += window * self._read(read, size)
        return out.astype(np.float32)

    def _append(self, arr: np.ndarray) -> None:
        size = self._buffer.size
        count = arr.size
        if count >= size:
            self._buffer[:] = arr[-size:]
            self._write = 0
            return
        end = self._write + count
        if end <= size:
            self._buffer[self._write:end] = arr
        else:
            first = size - self._write
            self._buffer[self._write:] = arr[:first]
            self._buffer[:count - first] = arr[first:]
        self._write = end % size

    def _read(self, positions: np.ndarray, size: int) -> np.ndarray:
        base = np.floor(positions)
        frac = positions - base
        index0 = np.mod(base.astype(np.int64), size)
        index1 = np.mod(index0 + 1, size)
        return (self._buffer[index0] * (1.0 - frac)
                + self._buffer[index1] * frac)


class NoiseBed:
    """A continuously looping bed of room noise.

    The noise is rendered once and cycled, rather than generated per block:
    a fan does not stop between your sentences, and synthesising it inside
    the audio callback would be far too slow.
    """

    def __init__(self, sample_rate: int, sources: Dict[str, float],
                 seconds: float = 8.0, seed: int = 0) -> None:
        count = int(sample_rate * seconds)
        bed = np.zeros(count, dtype=np.float32)
        for index, (name, level_db) in enumerate(sorted(sources.items())):
            generator = NOISE_SOURCES.get(name)
            if generator is None or level_db <= -90:
                continue
            bed += generator(count, sample_rate, seed + index * 17) * \
                db_to_linear(level_db)
        # Crossfade the seam so the loop does not click once a cycle.
        fade = min(int(sample_rate * 0.25), count // 4)
        if fade > 1:
            ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            bed[:fade] = bed[:fade] * ramp + bed[-fade:] * (1.0 - ramp)
            bed = bed[:count - fade]
        self._bed = bed if bed.size else np.zeros(1, dtype=np.float32)
        self._position = 0

    def read(self, count: int) -> np.ndarray:
        if count <= 0:
            return np.zeros(0, dtype=np.float32)
        size = self._bed.size
        indices = np.mod(self._position + np.arange(count), size)
        self._position = int((self._position + count) % size)
        return self._bed[indices]


@dataclass
class LiveSettings:
    """What the low-latency path does to your voice."""

    pitch_semitones: float = 0.0
    comms: Optional[CommsProfile] = None
    output_db: float = 0.0
    noise_gate_db: float = -55.0


class LiveProcessor:
    """The whole low-latency chain, stateful across blocks."""

    def __init__(self, sample_rate: int, settings: LiveSettings) -> None:
        self.sample_rate = sample_rate
        self.settings = settings
        self._shifter = GranularPitchShifter(sample_rate,
                                             settings.pitch_semitones)
        self._stages: List[Biquad] = []
        self._noise: Optional[NoiseBed] = None
        self._gate_state = 0.0
        self._configure()

    def _configure(self) -> None:
        profile = self.settings.comms
        self._stages = []
        self._noise = None
        if profile is None or not profile.enabled:
            return
        sr = self.sample_rate
        if profile.mic_presence_db or profile.mic_body_db:
            self._stages += [
                Biquad.high_pass(sr, 180.0),
                Biquad.low_shelf(sr, 320.0, profile.mic_body_db),
                Biquad.peaking(sr, 3100.0, profile.mic_presence_db, q=1.1),
            ]
        if profile.band_low_hz > 20:
            self._stages.append(Biquad.high_pass(sr, profile.band_low_hz))
        if profile.band_high_hz and profile.band_high_hz < sr / 2:
            self._stages.append(Biquad.low_pass(sr, profile.band_high_hz))
            self._stages.append(Biquad.low_pass(sr, profile.band_high_hz))
        if profile.noise:
            self._noise = NoiseBed(sr, profile.noise, seed=profile.noise_seed)

    def update(self, settings: LiveSettings) -> None:
        self.settings = settings
        self._shifter.semitones = settings.pitch_semitones
        self._configure()

    def reset(self) -> None:
        self._shifter.reset()
        for stage in self._stages:
            stage.reset()
        self._gate_state = 0.0

    def process(self, block: np.ndarray) -> np.ndarray:
        arr = np.asarray(block, dtype=np.float32).reshape(-1)
        if arr.size == 0:
            return arr

        arr = self._gate(arr)
        arr = self._shifter.process(arr)

        profile = self.settings.comms
        if self._noise is not None:
            arr = arr + self._noise.read(arr.size)
        for stage in self._stages:
            arr = stage.process(arr)
        if profile is not None and profile.enabled:
            if profile.overdrive_db:
                arr = np.clip(arr * db_to_linear(profile.overdrive_db),
                              -1.0, 1.0).astype(np.float32)
            if profile.bits:
                levels = float(2 ** profile.bits)
                arr = (np.round(arr * levels) / levels).astype(np.float32)

        if self.settings.output_db:
            arr = (arr * db_to_linear(self.settings.output_db)).astype(np.float32)
        return np.clip(arr, -0.99, 0.99).astype(np.float32)

    def _gate(self, arr: np.ndarray) -> np.ndarray:
        """Hold the noise bed back while you are not talking.

        Without this the fan and keyboard run continuously, which is
        realistic but makes the channel unusable.
        """
        threshold = db_to_linear(self.settings.noise_gate_db)
        level = float(np.sqrt(np.mean(arr.astype(np.float64) ** 2)))
        target = 1.0 if level > threshold else 0.0
        # Fast to open, slow to close, so word endings are not clipped.
        coefficient = 0.5 if target > self._gate_state else 0.02
        self._gate_state += coefficient * (target - self._gate_state)
        return (arr * self._gate_state).astype(np.float32)
