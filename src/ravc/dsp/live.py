"""Streaming effects for the low-latency path.

The accent path waits for you to finish a sentence, because a few of the
substitutions really do need to know which word you said. That is fine for
a callout, and useless for banter.

This module is the other half: block-by-block processing of your own voice
with about twenty milliseconds of delay. It changes *who you sound like*
and puts you on the far end of a game voice link; the accent itself is in
`accentfx.py` (vowels) and `consonants.py` (the rolled r, w -> v, hard l),
which run in the same chain and need no lookahead.

Everything here keeps state across blocks and allocates nothing per sample,
because it runs inside the audio callback.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from .accentfx import AccentFxSettings, VowelSpaceWarper
from .comms import CommsProfile, NOISE_SOURCES
from .filters import Biquad, db_to_linear


# Pitch tracking for the grain length. Snapping is only meaningful where
# there is a period, so frication and silence keep whatever grain they had.
PERIODIC_ENOUGH = 0.30
PITCH_RANGE_HZ = (60.0, 400.0)
# How fast the grain may glide, as a fraction of itself per block. A step
# would move the read position and click, so it slides instead. The rate is
# a real trade and was measured rather than picked: too slow and the grain
# cannot keep up with a voice whose pitch is moving, which is every voice;
# too fast and it chases the jitter in the period estimate. On a signal
# gliding 110 -> 160 -> 120 Hz, 0.012 brings the output's modulation down
# to the input's own level, meaning the shifter adds nothing of its own,
# while 0.004 leaves it at nearly twice that.
MAX_GRAIN_GLIDE = 0.012
GRAIN_LIMITS = (0.55, 1.7)      # multiples of the nominal length


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

    The crossfade summing to one is not the same as the *result* being
    clean, and that distinction is where this went wrong. Summing to one
    says nothing about what the two taps contain: they read the signal half
    a grain apart, so they comb-filter each other, and as the delay sweeps
    the comb sweeps with it at ``|1 - ratio| / grain``. Measured on steady
    vowels from 85 to 250 Hz, that modulated the output's amplitude by
    3 to 20 per cent at a few hertz, against a hundredth of a per cent in
    the input. That warble is what "robotic" sounds like, and it was on by
    default, because Live borrowed the character voice's pitch shift.

    The fix is to make the grain an even number of pitch periods. The two
    taps are then a whole number of periods apart, so for a voiced sound
    they read the same waveform shape and add constructively at every sweep
    position instead of combing -- while the delay still sweeps, so the
    pitch shift itself is untouched. Same measurement: under a tenth of a
    per cent everywhere, which is 64 to 2250 times less, and the shift
    itself lands within 4 cents of where it was asked to.

    Snapping the *read positions* to whole periods instead does not work,
    and is worth recording because it looks equivalent: reading always in
    phase with the input means reading the same waveform back, so the pitch
    stops shifting at all.
    """

    def __init__(self, sample_rate: int, semitones: float = 0.0,
                 grain_ms: float = 55.0) -> None:
        self.sample_rate = sample_rate
        self.nominal_grain = max(64.0, sample_rate * grain_ms / 1000.0)
        self.grain = self.nominal_grain
        self._buffer = np.zeros(
            int(self.nominal_grain * GRAIN_LIMITS[1] * 4) + 4, dtype=np.float32)
        self._write = 0
        self._phase = 0.0
        self._period = 0.0
        self.semitones = semitones

    @property
    def semitones(self) -> float:
        return self._semitones

    @semitones.setter
    def semitones(self, value: float) -> None:
        self._semitones = float(value)
        self._ratio = 2.0 ** (self._semitones / 12.0)

    def _recent(self, count: int) -> np.ndarray:
        """The last ``count`` samples written, oldest first."""
        size = self._buffer.size
        count = min(count, size)
        start = (self._write - count) % size
        if start + count <= size:
            return self._buffer[start:start + count].astype(np.float64)
        first = size - start
        return np.concatenate(
            [self._buffer[start:], self._buffer[:count - first]]).astype(np.float64)

    def _track_period(self) -> float:
        """The speaker's pitch period in samples, or 0 where there is none.

        One transform of history already in the buffer. Unvoiced frames
        return 0 and leave the grain where it is, because a grain length
        measured off frication would be noise.
        """
        history = self._recent(int(self.nominal_grain))
        if history.size < 256:
            return 0.0
        window = history - history.mean()
        if not np.any(window):
            return 0.0
        size = 1 << int(math.ceil(math.log2(window.size * 2)))
        correlation = np.fft.irfft(np.abs(np.fft.rfft(window, size)) ** 2)
        if correlation[0] <= 1e-12:
            return 0.0
        low = max(1, int(self.sample_rate / PITCH_RANGE_HZ[1]))
        high = min(int(self.sample_rate / PITCH_RANGE_HZ[0]), window.size - 1)
        if high <= low:
            return 0.0
        best = int(np.argmax(correlation[low:high])) + low
        if correlation[best] / correlation[0] < PERIODIC_ENOUGH:
            return 0.0
        # Interpolate the peak. An integer-lag estimate is quantised to a
        # whole sample, and the grain is a dozen periods long, so a one-
        # sample error becomes a dozen samples of grain wobble -- which is
        # itself a delay modulation, which is the thing being removed.
        if low < best < high - 1:
            before, here, after = correlation[best - 1:best + 2]
            divisor = before - 2.0 * here + after
            if abs(divisor) > 1e-12:
                best += float(np.clip(0.5 * (before - after) / divisor,
                                      -0.5, 0.5))
        return float(best)

    def _glide_grain(self) -> None:
        """Move the grain towards an even number of the current period."""
        period = self._track_period()
        if period <= 0.0:
            return
        multiple = max(1, round(self.nominal_grain / (2.0 * period)))
        target = float(np.clip(2.0 * multiple * period,
                               self.nominal_grain * GRAIN_LIMITS[0],
                               self.nominal_grain * GRAIN_LIMITS[1]))
        step = self.grain * MAX_GRAIN_GLIDE
        self.grain += float(np.clip(target - self.grain, -step, step))

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
        self._glide_grain()

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
    # The live accent: moves your vowels onto Russian ones without
    # replacing your voice. See dsp/accentfx.py.
    accent: Optional[AccentFxSettings] = None


class LiveProcessor:
    """The whole low-latency chain, stateful across blocks."""

    def __init__(self, sample_rate: int, settings: LiveSettings) -> None:
        self.sample_rate = sample_rate
        self.settings = settings
        self._shifter = GranularPitchShifter(sample_rate,
                                             settings.pitch_semitones)
        self._warper = VowelSpaceWarper(sample_rate,
                                        settings.accent or AccentFxSettings())
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
        self._warper.settings = settings.accent or AccentFxSettings()
        self._configure()

    def _recent(self, count: int) -> np.ndarray:
        """The last ``count`` samples written, oldest first."""
        size = self._buffer.size
        count = min(count, size)
        start = (self._write - count) % size
        if start + count <= size:
            return self._buffer[start:start + count].astype(np.float64)
        first = size - start
        return np.concatenate(
            [self._buffer[start:], self._buffer[:count - first]]).astype(np.float64)

    def _track_period(self) -> float:
        """The speaker's pitch period in samples, or 0 where there is none.

        One transform of history already in the buffer. Unvoiced frames
        return 0 and leave the grain where it is, because a grain length
        measured off frication would be noise.
        """
        history = self._recent(int(self.nominal_grain))
        if history.size < 256:
            return 0.0
        window = history - history.mean()
        if not np.any(window):
            return 0.0
        size = 1 << int(math.ceil(math.log2(window.size * 2)))
        correlation = np.fft.irfft(np.abs(np.fft.rfft(window, size)) ** 2)
        if correlation[0] <= 1e-12:
            return 0.0
        low = max(1, int(self.sample_rate / PITCH_RANGE_HZ[1]))
        high = min(int(self.sample_rate / PITCH_RANGE_HZ[0]), window.size - 1)
        if high <= low:
            return 0.0
        best = int(np.argmax(correlation[low:high])) + low
        if correlation[best] / correlation[0] < PERIODIC_ENOUGH:
            return 0.0
        # Interpolate the peak. An integer-lag estimate is quantised to a
        # whole sample, and the grain is a dozen periods long, so a one-
        # sample error becomes a dozen samples of grain wobble -- which is
        # itself a delay modulation, which is the thing being removed.
        if low < best < high - 1:
            before, here, after = correlation[best - 1:best + 2]
            divisor = before - 2.0 * here + after
            if abs(divisor) > 1e-12:
                best += float(np.clip(0.5 * (before - after) / divisor,
                                      -0.5, 0.5))
        return float(best)

    def _glide_grain(self) -> None:
        """Move the grain towards an even number of the current period."""
        period = self._track_period()
        if period <= 0.0:
            return
        multiple = max(1, round(self.nominal_grain / (2.0 * period)))
        target = float(np.clip(2.0 * multiple * period,
                               self.nominal_grain * GRAIN_LIMITS[0],
                               self.nominal_grain * GRAIN_LIMITS[1]))
        step = self.grain * MAX_GRAIN_GLIDE
        self.grain += float(np.clip(target - self.grain, -step, step))

    def reset(self) -> None:
        self._shifter.reset()
        self._warper.reset()
        for stage in self._stages:
            stage.reset()
        self._gate_state = 0.0

    def process(self, block: np.ndarray) -> np.ndarray:
        arr = np.asarray(block, dtype=np.float32).reshape(-1)
        if arr.size == 0:
            return arr

        arr = self._gate(arr)
        # The accent goes first, on the cleanest version of the voice: the
        # formant tracker needs an unprocessed signal to find the vowel.
        accent = self.settings.accent
        if accent is not None and accent.enabled and accent.strength > 0.01:
            arr = self._warper.process(arr)
            if arr.size == 0:
                return arr
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
