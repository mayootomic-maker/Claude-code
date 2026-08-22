"""Telling one kind of speech sound from another, live.

The accent-by-transcription path knows which word you said, so it can apply
any substitution it likes. The live path does not -- but it does not need to
for the substitutions that carry a Russian accent, because those sounds have
acoustic signatures measurable in a single frame.

Getting the measurements right mattered more than choosing them. Three
things had to be fixed before any of this worked, each found by running the
classifier against synthesised sounds with known formants rather than by
listening:

*Model order.* Linear prediction over a 4.8 kHz band wants two poles per
formant plus a spare pair -- order 12. Order 16 is not a safer choice: the
extra poles do not find extra formants, they invent wide shallow ones below
F1 that shift every real formant one slot up the list, so the reported "F2"
is really F1. With order 12 and a bandwidth gate at 400 Hz (real formants
here measure 70-310 Hz wide, invented ones 500-2200) F1, F2 and F3 all come
back within a few per cent from 95 Hz up to 230 Hz.

*Voicing.* The usual shortcut -- most of the energy lies below 400 Hz, the
"voicing bar" -- calls /a/, /e/, /ae/ and /ʌ/ unvoiced, because their F1 is
itself above 400 Hz. Periodicity, the normalised autocorrelation peak, does
not have that flaw: 0.62-0.87 on vowels at every pitch against 0.10-0.14 on
frication.

*Speaker size.* Formants scale inversely with vocal-tract length, so every
threshold here is stated for an adult male and multiplied by `scale`. Left
unscaled the /ɹ/ cue below falls from 36 dB to 8 dB on a female voice.

======================  ==================================================
sound                   what gives it away
======================  ==================================================
/ɹ/ (red)               F3 falls to ~1500 Hz and vacates the region above
                        it, leaving a hole between F3 and F4 that nothing
                        else in English makes. Comparing the 1.4-2.2 kHz
                        band against 2.2-3.4 kHz separates /ɹ/ from every
                        vowel, /l/, dark /l/, /w/, /j/ and the nasals by
                        22 dB, and keeps working at pitches where picking
                        F3 off the fit fails outright.
/w/ (water)             voiced, F1 and F2 both very low (F2 600-750 Hz)
/l/ (look)              voiced, mid F2, low F1, and F3 above 2.5 kHz --
                        that last is the only thing separating a dark /l/
                        from /u/, which sits within 30 Hz of it in F1 and
                        F2. (Which is exactly why English speakers vocalise
                        /l/ to [u] in "milk".)
/s ʃ z ʒ/ sibilants     turbulence close in level to the neighbouring
                        vowels
/f θ v ð/ non-sibilants the same turbulence 25-30 dB down -- relative
                        intensity is the classic cue for fricative place
======================  ==================================================

Nasals are deliberately not a class. Nothing in the accent substitutes them,
and the cue that would identify them -- a weak F2 from the oral
antiresonance -- is the same cue a close front vowel trips. They label as
vowels, which is what the live path treated them as anyway.

Where it fails, it fails safe. Under noise and across speaker sizes the
errors are overwhelmingly missed detections, not false ones: an /ɹ/ that
does not get trilled, rather than a vowel that does.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Tuple

import numpy as np

from .calibrate import autocorrelation, levinson


class Phone(Enum):
    """Coarse classes -- only the distinctions the accent acts on."""

    SILENCE = "silence"
    VOWEL = "vowel"
    R = "r"                  # English /ɹ/, the one with the low F3
    W = "w"                  # /w/
    L = "l"                  # /l/
    SIBILANT = "sibilant"    # /s ʃ z ʒ/
    FRICATIVE = "fricative"  # /f θ v ð/ -- the weak ones
    STOP = "stop"
    OTHER = "other"


@dataclass
class Frame:
    """Everything measured about one analysis frame."""

    energy_db: float = -120.0
    voiced: bool = False
    periodicity: float = 0.0         # normalised autocorrelation peak
    voicing_ratio: float = 0.0       # share of energy below 400 Hz
    zero_crossing_rate: float = 0.0
    centroid_hz: float = 0.0
    sibilance: float = 0.0           # share of energy in the 3.5-9 kHz band
    r_dip_db: float = 0.0            # 1.4-2.2 kHz over 2.2-3.4 kHz
    relative_db: float = 0.0         # level against the running speech level
    formants: Tuple[float, ...] = ()
    phone: Phone = Phone.SILENCE       # after hysteresis; use this
    raw_phone: Phone = Phone.SILENCE   # this frame alone, before hysteresis

    @property
    def f1(self) -> float:
        return self.formants[0] if len(self.formants) > 0 else 0.0

    @property
    def f2(self) -> float:
        return self.formants[1] if len(self.formants) > 1 else 0.0

    @property
    def f3(self) -> float:
        return self.formants[2] if len(self.formants) > 2 else 0.0


# Thresholds. Each is either a published acoustic description or a number
# measured against synthesised sounds with known formants; the comments say
# which, and `tests/test_phones.py` holds the measurements to the claim.
# /θ/ and /f/ are the quietest sounds in English, running 25-30 dB below the
# vowels around them: measured at -52.7 dBFS against a vowel at -19.4. A gate
# at -52 swallowed them outright, so the floor sits below any real speech and
# room noise is left to the live path's own noise gate, which is adjustable.
SILENCE_DB = -65.0
VOICING_BAND_HZ = 400.0        # reported for interest; not classified on

# Voicing is periodicity, not low-frequency energy. The "voicing bar below
# 400 Hz" shortcut fails on open vowels, whose F1 is itself above 400 -- it
# called /a/, /e/, /ae/ and /ʌ/ unvoiced. The normalised autocorrelation peak
# measured 0.62-0.87 on vowels at every pitch from 95 to 230 Hz and 0.10-0.14
# on frication, so the threshold sits in a wide empty gap.
VOICED_PERIODICITY = 0.35
PITCH_RANGE_HZ = (60.0, 400.0)

# The /ɹ/ hole. Non-/ɹ/ sounds measured -7 to +13 dB, the three /ɹ/ variants
# 35 to 41 dB. 24 dB sits in the middle of a 22 dB gap.
R_LOW_BAND = (1400.0, 2200.0)
R_HIGH_BAND = (2200.0, 3400.0)
R_MIN_DIP_DB = 24.0
R_F2_RANGE = (700.0, 1600.0)   # /ɹ/ F2 is 1060-1350; this is a sanity bound

# /w/: F2 610 Hz against /u/ at 870 and back /o/ at 840, the nearest rivals.
W_MAX_F2 = 760.0
W_MAX_F1 = 450.0

# /l/: mid F2, low F1 and a high F3. The F3 test is what separates a dark
# /l/ from /u/ -- they sit within 30 Hz of each other in F1 and F2 (which is
# why English speakers vocalise /l/ to [u] in "milk"), and apart only in F3,
# measured at 2680-2950 for the two /l/s against 2210-2290 for /u/.
L_F2_RANGE = (820.0, 1500.0)
L_MAX_F1 = 470.0
L_MIN_F3 = 2500.0

# Frication. The share of energy above 3.5 kHz says *whether* the frame is
# turbulence; how loud it is against the neighbouring vowels says whether it
# is a sibilant. Sibilants run ~10-15 dB below adjacent vowels, non-sibilants
# ~25-30 dB below (the "relative intensity" cue for fricative place).
SIBILANT_BAND = (3500.0, 9000.0)
FRICATION_MIN = 0.30
SIBILANT_MIN_RELATIVE_DB = -22.0
FRICATIVE_MIN_ZCR = 0.16
LEVEL_DECAY = 0.995            # ~2 s memory of the running speech level

# How many consecutive frames must agree before the label changes. A phone
# lasts 50-100 ms and the classifier runs every few, so a single dissenting
# frame is a misfire, not a new sound -- and it is not harmless: a steady /l/
# that drops to "vowel" for a quarter of its frames comes back through the
# overlap-add at full strength, and the substitution measured as barely
# applied even though it was applied correctly to every frame that kept the
# label. Silence is exempt: it is a level test, and holding through it would
# leave an effect running into the gap.
CONFIRM_FRAMES = 2

# Two poles per formant over a 4.8 kHz band, plus a pair of spares. Order 16
# was measurably worse, not better: the extra poles do not find extra
# formants, they invent wide, shallow ones below F1 that shift every real
# formant a slot up the list. Real formants here measure 70-310 Hz wide and
# the invented ones 500-2200, so the bandwidth gate finishes the job.
MAX_BANDWIDTH_HZ = 400.0


# Every threshold above describes an adult male tract. Formants scale
# roughly inversely with vocal-tract length, so a female speaker's whole
# pattern sits ~17% higher and a child's ~35%; left unscaled, the /ɹ/ bands
# straddle the wrong part of the spectrum and the cue collapses from 36 dB to
# 8 dB. `scale` multiplies every frequency threshold, and
# :func:`scale_from_formants` derives it from the voice calibration the app
# already performs.
REFERENCE_F3_HZ = 2450.0       # adult male mean over Peterson & Barney vowels
SCALE_RANGE = (0.80, 1.60)

ANALYSIS_SECONDS = 0.043       # ~4 pitch periods at the lowest male voices


def _window_for(sample_rate: int) -> int:
    """A power-of-two analysis window of about :data:`ANALYSIS_SECONDS`."""
    wanted = max(256.0, sample_rate * ANALYSIS_SECONDS)
    return int(2 ** round(math.log2(wanted)))


def scale_from_formants(formants: Sequence[float]) -> float:
    """Vocal-tract scale for a speaker, from their measured formants."""
    values = [f for f in formants if f > 0]
    if len(values) < 3:
        return 1.0
    return float(min(max(values[2] / REFERENCE_F3_HZ, SCALE_RANGE[0]),
                     SCALE_RANGE[1]))


class PhoneAnalyser:
    """Measures frames and labels them, keeping a little history."""

    ANALYSIS_HZ = 9600.0        # twice the 4.8 kHz formant range
    LPC_ORDER = 12

    def __init__(self, sample_rate: int, n_fft: int = 0,
                 scale: float = 1.0) -> None:
        self.sample_rate = sample_rate
        # Phone identity changes on a ~50 ms timescale, so the classifier
        # analyses its own window rather than whatever length the caller
        # happens to hand it. At 1024 samples (21 ms) a 95 Hz voice gets two
        # pitch periods, too few to measure periodicity or to resolve F3;
        # accuracy measured 76/85 there against 85/85 at 43 ms.
        self.n_fft = int(n_fft) if n_fft else _window_for(sample_rate)
        n_fft = self.n_fft
        self.scale = float(min(max(scale, SCALE_RANGE[0]), SCALE_RANGE[1]))
        self._history = np.zeros(n_fft, dtype=np.float64)
        self._analysis_window = np.hanning(n_fft)
        self._freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
        self._low = self._freqs < VOICING_BAND_HZ
        self._min_lag = max(1, int(sample_rate / PITCH_RANGE_HZ[1]))
        self._max_lag = int(sample_rate / PITCH_RANGE_HZ[0])
        self._sib = ((self._freqs >= SIBILANT_BAND[0])
                     & (self._freqs <= SIBILANT_BAND[1]))
        k = self.scale
        self._r_low = ((self._freqs >= R_LOW_BAND[0] * k)
                       & (self._freqs <= R_LOW_BAND[1] * k))
        self._r_high = ((self._freqs >= R_HIGH_BAND[0] * k)
                        & (self._freqs <= R_HIGH_BAND[1] * k))
        self._r_f2 = (R_F2_RANGE[0] * k, R_F2_RANGE[1] * k)
        self._w_f2, self._w_f1 = W_MAX_F2 * k, W_MAX_F1 * k
        self._l_f2 = (L_F2_RANGE[0] * k, L_F2_RANGE[1] * k)
        self._l_f1, self._l_f3 = L_MAX_F1 * k, L_MIN_F3 * k
        self._window = np.hamming(0)
        self._reference_db = -120.0
        self._previous: Optional[Frame] = None
        self._held = Phone.SILENCE
        self._candidate = Phone.SILENCE
        self._agreed = 0

    def reset(self) -> None:
        self._previous = None
        self._reference_db = -120.0
        self._history[:] = 0.0
        self._held = Phone.SILENCE
        self._candidate = Phone.SILENCE
        self._agreed = 0

    def _hold(self, raw: Phone) -> Phone:
        """Only change label once `CONFIRM_FRAMES` frames agree."""
        if raw is Phone.SILENCE or raw is self._held:
            self._held = raw
            self._candidate = raw
            self._agreed = 0
            return raw
        if raw is self._candidate:
            self._agreed += 1
        else:
            self._candidate = raw
            self._agreed = 1
        if self._agreed >= CONFIRM_FRAMES:
            self._held = raw
            self._agreed = 0
        return self._held

    @property
    def previous(self) -> Optional[Frame]:
        return self._previous

    # -- measurement ------------------------------------------------------

    def analyse(self, samples: np.ndarray) -> Frame:
        """Measure and label the most recent audio, `samples` included."""
        arr = np.asarray(samples, dtype=np.float64).reshape(-1)
        if arr.size >= self.n_fft:
            self._history[:] = arr[-self.n_fft:]
        elif arr.size:
            self._history[:-arr.size] = self._history[arr.size:]
            self._history[-arr.size:] = arr
        window = self._history

        power = np.abs(np.fft.rfft(window * self._analysis_window)) ** 2
        total = float(power.sum())
        frame = Frame()

        rms = float(np.sqrt(np.mean(window ** 2)))
        frame.energy_db = 20.0 * math.log10(max(rms, 1e-9))
        if frame.energy_db < SILENCE_DB or total <= 1e-12:
            frame.phone = self._hold(Phone.SILENCE)
            self._previous = frame
            return frame

        frame.voicing_ratio = float(power[self._low].sum() / total)
        frame.periodicity = self._periodicity(power)
        frame.voiced = frame.periodicity > VOICED_PERIODICITY
        frame.centroid_hz = float((power * self._freqs).sum() / total)
        frame.sibilance = float(power[self._sib].sum() / total)
        frame.zero_crossing_rate = float(
            np.mean(np.abs(np.diff(np.signbit(window).astype(np.int8)))))
        frame.r_dip_db = 10.0 * math.log10(
            (float(power[self._r_low].sum()) + 1e-20)
            / (float(power[self._r_high].sum()) + 1e-20))

        # The running speech level tracks the loud (voiced) frames, so a
        # fricative's level is judged against the voice around it rather
        # than against an absolute that any gain change would invalidate.
        if frame.voiced and frame.energy_db > self._reference_db:
            self._reference_db = frame.energy_db
        else:
            self._reference_db = max(
                self._reference_db * LEVEL_DECAY
                + (1.0 - LEVEL_DECAY) * frame.energy_db, -120.0)
        frame.relative_db = frame.energy_db - self._reference_db

        frame.formants = self._formants(window)
        frame.raw_phone = self._classify(frame)
        frame.phone = self._hold(frame.raw_phone)
        self._previous = frame
        return frame

    def _periodicity(self, power: np.ndarray) -> float:
        """How periodic the frame is: 1 for a pure tone, ~0 for noise.

        The autocorrelation is the inverse transform of the power spectrum,
        which is already to hand, so this costs one inverse FFT.
        """
        correlation = np.fft.irfft(power)
        if correlation.size <= self._min_lag or correlation[0] <= 1e-20:
            return 0.0
        top = min(self._max_lag, correlation.size - 1)
        if top <= self._min_lag:
            return 0.0
        return float(np.max(correlation[self._min_lag:top]) / correlation[0])

    def _formants(self, samples: np.ndarray) -> Tuple[float, ...]:
        """F1 and F2 by linear prediction, following the Praat recipe.

        Pre-emphasis flattens the glottal tilt so the fit describes the
        vocal tract and not the voice's overall slope; leaving it out was
        what made the first version of this report F2 several hundred Hz
        low. Decimation is done by truncating the spectrum, which is exact
        rather than the filter-and-interpolate approximation.
        """
        x = np.asarray(samples, dtype=np.float64)
        if x.size < 64:
            return ()
        x = np.append(x[0], x[1:] - 0.97 * x[:-1])

        rate = float(self.sample_rate)
        if rate > self.ANALYSIS_HZ:
            out_len = max(64, int(round(x.size * self.ANALYSIS_HZ / rate)))
            x = np.fft.irfft(np.fft.rfft(x)[:out_len // 2 + 1], out_len)
            rate = self.ANALYSIS_HZ
        if x.size != self._window.size:
            self._window = np.hamming(x.size)
        x = x * self._window
        if not np.any(x):
            return ()

        order = max(8, min(self.LPC_ORDER, x.size // 2))
        coefficients = levinson(autocorrelation(x, order), order)
        if coefficients is None:
            return ()
        try:
            roots = np.roots(coefficients)
        except (np.linalg.LinAlgError, ValueError):
            return ()

        found: List[float] = []
        for root in roots:
            if root.imag <= 0:
                continue
            magnitude = abs(root)
            if not 1e-9 < magnitude < 1.0:
                continue
            frequency = math.atan2(root.imag, root.real) * rate / (2 * math.pi)
            bandwidth = -math.log(magnitude) * rate / math.pi
            if 150.0 <= frequency <= 4500.0 and bandwidth < MAX_BANDWIDTH_HZ:
                found.append(frequency)
        found.sort()
        return tuple(found[:4])

    # -- classification ---------------------------------------------------

    def _classify(self, frame: Frame) -> Phone:
        if frame.sibilance > FRICATION_MIN and not frame.voiced:
            # Turbulence. Relative intensity separates the sibilants from
            # the far quieter /f θ/, which share the same spectral shape.
            if frame.relative_db > SIBILANT_MIN_RELATIVE_DB:
                return Phone.SIBILANT
            return Phone.FRICATIVE
        if not frame.voiced:
            if (frame.zero_crossing_rate > FRICATIVE_MIN_ZCR
                    or frame.centroid_hz > 2200.0):
                return Phone.FRICATIVE
            return Phone.STOP

        f1, f2 = frame.f1, frame.f2
        if f1 <= 0 or f2 <= 0:
            return Phone.OTHER

        # A voiced sound with strong turbulence on top is /z ʒ/.
        if frame.sibilance > FRICATION_MIN:
            return Phone.SIBILANT

        # /ɹ/ first: the hole above F3 is the most specific cue available.
        if (frame.r_dip_db >= R_MIN_DIP_DB
                and self._r_f2[0] <= f2 <= self._r_f2[1]):
            return Phone.R
        if f2 < self._w_f2 and f1 < self._w_f1:
            return Phone.W
        if (self._l_f2[0] <= f2 <= self._l_f2[1] and f1 < self._l_f1
                and frame.f3 > self._l_f3):
            return Phone.L
        return Phone.VOWEL


def smooth(labels: List[Phone], span: int = 2) -> List[Phone]:
    """Remove single-frame flickers from a label sequence.

    A phone lasts tens of milliseconds, so a class that appears for one
    frame between two frames of something else is a misfire, and acting on
    it would produce an audible click.
    """
    if len(labels) < 3:
        return list(labels)
    out = list(labels)
    for index in range(1, len(labels) - 1):
        if labels[index - 1] == labels[index + 1] != labels[index]:
            out[index] = labels[index - 1]
    return out
