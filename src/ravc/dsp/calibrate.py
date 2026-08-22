"""Measure a voice, so the character voice can be matched to the speaker.

The weak point of an accent changer built on text-to-speech is that it
replaces you: whatever you sound like, out comes Dmitri. This module
narrows that gap without any neural voice conversion, using the two
measurements that carry most of a speaker's identity:

* **f0** -- how high or low the voice sits;
* **vocal tract length** -- how *large* the speaker seems, which shows up
  as a near-uniform scaling of the formant frequencies. A long tract puts
  the formants low, a short one puts them high; the ratio between two
  speakers' formant patterns estimates the ratio of their tract lengths.
  This is the same insight behind vocal-tract-length normalisation in
  speech recognition, run in reverse.

Given a fingerprint of the user and one of the synthetic voice, the pitch
and formant shifts already in the DSP chain can be solved for directly.
Formants are estimated by linear prediction: fit an all-pole filter to the
signal and read the resonances off the roots of its polynomial.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

from .filters import Biquad, apply_offline
from .pitch import estimate_f0, spectral_envelope, stft

# Speech resonances of interest. F1-F3 carry the vowel identity and the
# tract length; above F4 the estimate gets noisy and voice-dependent.
MIN_FORMANT_HZ = 200.0
MAX_FORMANT_HZ = 4000.0
MIN_BANDWIDTH_HZ = 400.0   # roots broader than this are not real formants


# The log-frequency grid the envelope is sampled on. A change of vocal
# tract length scales every formant by the same factor, which on a log
# axis is a pure translation -- so comparing two voices becomes a matter of
# finding one lag, rather than pairing up individually-estimated formants.
ENVELOPE_LOW_HZ = 250.0
ENVELOPE_HIGH_HZ = 4000.0
BINS_PER_OCTAVE = 48


def _log_frequency_grid() -> np.ndarray:
    octaves = math.log2(ENVELOPE_HIGH_HZ / ENVELOPE_LOW_HZ)
    count = int(round(octaves * BINS_PER_OCTAVE)) + 1
    return ENVELOPE_LOW_HZ * 2.0 ** (np.arange(count) / BINS_PER_OCTAVE)


LOG_GRID = _log_frequency_grid()


@dataclass
class VoiceFingerprint:
    """What we can measure about a voice from a few seconds of speech."""

    median_f0: float = 0.0          # Hz, 0 if nothing voiced was found
    formant_scale: float = 0.0      # geometric mean of F1..F3, Hz
    voiced_fraction: float = 0.0    # how much of the sample was voiced
    frames: int = 0
    formants: List[float] = field(default_factory=list)
    envelope: Optional[np.ndarray] = None   # mean log-magnitude on LOG_GRID

    @property
    def usable(self) -> bool:
        """Enough voiced speech to trust the numbers."""
        return (self.median_f0 > 0.0 and self.envelope is not None
                and self.frames >= 6 and self.voiced_fraction >= 0.15)

    def describe(self) -> str:
        if not self.usable:
            return "not enough voiced speech to measure"
        return (f"f0 {self.median_f0:.0f} Hz, "
                f"formant centre {self.formant_scale:.0f} Hz, "
                f"{self.voiced_fraction * 100:.0f}% voiced")


# --------------------------------------------------------------------------
# Linear prediction
# --------------------------------------------------------------------------

def autocorrelation(frame: np.ndarray, order: int) -> np.ndarray:
    x = np.asarray(frame, dtype=np.float64)
    full = np.correlate(x, x, mode="full")[len(x) - 1:]
    return full[:order + 1]


def levinson(r: np.ndarray, order: int) -> Optional[np.ndarray]:
    """Levinson-Durbin recursion: autocorrelation -> LPC coefficients.

    Returns the denominator polynomial ``[1, a1, ..., ap]``, or None if the
    frame is degenerate (silence, or a numerically unstable fit).
    """
    if r[0] <= 1e-12:
        return None
    a = np.zeros(order + 1, dtype=np.float64)
    a[0] = 1.0
    error = float(r[0])
    for i in range(1, order + 1):
        acc = r[i] + float(np.dot(a[1:i], r[i - 1:0:-1])) if i > 1 else r[i]
        k = -acc / error
        if not np.isfinite(k) or abs(k) >= 1.0:
            return None
        a_prev = a[1:i].copy()
        a[1:i] = a_prev + k * a_prev[::-1]
        a[i] = k
        error *= (1.0 - k * k)
        if error <= 1e-12:
            return None
    return a


N_FORMANTS = 5


def _decimate(x: np.ndarray, sr: int, target_sr: int) -> np.ndarray:
    """Band-limit and resample, so the LPC fit spends its poles on speech."""
    if sr <= target_sr * 1.05:
        return x
    cutoff = target_sr * 0.45
    x = apply_offline([Biquad.low_pass(sr, cutoff),
                       Biquad.low_pass(sr, cutoff)], x, sr)
    out_len = max(16, int(round(x.size * target_sr / sr)))
    return np.interp(np.linspace(0.0, x.size - 1.0, out_len),
                     np.arange(x.size), x)


def lpc_formants(frame: np.ndarray, sr: int,
                 order: Optional[int] = None) -> List[float]:
    """Formant frequencies of one frame, in Hz, ascending.

    Follows the standard recipe (as in Praat): band-limit to the formant
    range and resample to twice it, then fit roughly two poles per expected
    formant. Fitting at the full 22 kHz instead wastes most of the poles on
    the empty band above 4 kHz, and the speech resonances come out so broad
    they are indistinguishable from the spectral tilt.
    """
    x = np.asarray(frame, dtype=np.float64)
    if x.size < 64:
        return []
    # Pre-emphasis flattens the glottal source tilt so the fit describes the
    # vocal tract rather than the voice's overall spectral slope.
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])

    analysis_sr = int(2 * MAX_FORMANT_HZ)
    x = _decimate(x, sr, analysis_sr)
    if x.size < 64:
        return []
    sr = min(sr, analysis_sr)

    x = x * np.hamming(x.size)
    if not np.any(x):
        return []

    if order is None:
        order = 2 * N_FORMANTS + 2
    order = max(8, min(order, x.size // 2, 40))

    coefficients = levinson(autocorrelation(x, order), order)
    if coefficients is None:
        return []
    try:
        roots = np.roots(coefficients)
    except (np.linalg.LinAlgError, ValueError):
        return []

    formants: List[float] = []
    for root in roots:
        if root.imag <= 0:
            continue  # conjugate pairs: keep one of each
        magnitude = abs(root)
        if magnitude >= 1.0 or magnitude <= 1e-9:
            continue
        frequency = math.atan2(root.imag, root.real) * sr / (2 * math.pi)
        bandwidth = -math.log(magnitude) * sr / math.pi
        if MIN_FORMANT_HZ <= frequency <= MAX_FORMANT_HZ and bandwidth < MIN_BANDWIDTH_HZ:
            formants.append(frequency)
    return sorted(formants)


# --------------------------------------------------------------------------
# Fingerprinting
# --------------------------------------------------------------------------

def log_envelope(samples: np.ndarray, sr: int) -> Optional[np.ndarray]:
    """Mean spectral envelope of the loud frames, on a log-frequency axis."""
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if audio.size < 1024:
        return None
    spec = stft(audio)
    magnitude = np.abs(spec)
    if magnitude.size == 0:
        return None
    # Ignore quiet frames: silence contributes a flat envelope that drags
    # the average towards nothing in particular.
    energy = magnitude.sum(axis=0)
    if energy.max() <= 1e-9:
        return None
    loud = energy >= energy.max() * 0.2
    if loud.sum() < 2:
        return None

    envelope = spectral_envelope(magnitude[:, loud])
    mean_envelope = np.exp(np.mean(np.log(np.maximum(envelope, 1e-9)), axis=1))

    n_fft = 2 * (magnitude.shape[0] - 1)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    resampled = np.interp(LOG_GRID, freqs, mean_envelope)
    out = np.log(np.maximum(resampled, 1e-9))
    return out - out.mean()


def envelope_shift(source: np.ndarray, target: np.ndarray,
                   max_semitones: float = 12.0) -> Optional[float]:
    """How far ``target``'s envelope sits above ``source``'s, in semitones.

    Cross-correlation on the log-frequency axis: the lag that best aligns
    the two envelopes is the uniform frequency ratio between them.
    """
    if source is None or target is None or source.shape != target.shape:
        return None
    max_lag = int(round(max_semitones * BINS_PER_OCTAVE / 12.0))
    max_lag = min(max_lag, source.size // 3)
    if max_lag < 2:
        return None

    lags = np.arange(-max_lag, max_lag + 1)
    scores = np.empty(lags.size)
    for index, lag in enumerate(lags):
        if lag >= 0:
            a, b = source[:source.size - lag], target[lag:]
        else:
            a, b = source[-lag:], target[:target.size + lag]
        if a.size < 8:
            scores[index] = -np.inf
            continue
        denominator = np.linalg.norm(a) * np.linalg.norm(b)
        scores[index] = float(np.dot(a, b) / denominator) if denominator > 1e-12 else -np.inf

    best = int(np.argmax(scores))
    if not np.isfinite(scores[best]):
        return None
    # Parabolic interpolation around the peak for sub-bin resolution.
    offset = 0.0
    if 0 < best < lags.size - 1:
        left, middle, right = scores[best - 1], scores[best], scores[best + 1]
        denominator = left - 2 * middle + right
        if abs(denominator) > 1e-12:
            offset = 0.5 * (left - right) / denominator
    return float((lags[best] + offset) * 12.0 / BINS_PER_OCTAVE)


def fingerprint(samples: np.ndarray, sr: int, frame_ms: float = 40.0,
                hop_ms: float = 20.0) -> VoiceFingerprint:
    """Measure f0 and formant scale over the voiced parts of a recording."""
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if audio.size < sr // 8:
        return VoiceFingerprint()

    frame_length = max(256, int(sr * frame_ms / 1000))
    hop = max(128, int(sr * hop_ms / 1000))
    if audio.size < frame_length:
        return VoiceFingerprint()

    # Only measure frames with real energy; silence and breath produce
    # confident-looking nonsense from an LPC fit.
    starts = range(0, audio.size - frame_length + 1, hop)
    energies = np.array([float(np.sqrt(np.mean(
        audio[i:i + frame_length].astype(np.float64) ** 2))) for i in starts])
    if energies.size == 0 or energies.max() <= 1e-6:
        return VoiceFingerprint()
    threshold = max(energies.max() * 0.18, 1e-4)

    f0_values: List[float] = []
    scale_values: List[float] = []
    formant_rows: List[List[float]] = []
    considered = 0

    for index, start in enumerate(starts):
        considered += 1
        if energies[index] < threshold:
            continue
        frame = audio[start:start + frame_length]
        # f0 and formants are measured independently. Coupling them means a
        # vowel whose F1 and F2 sit close enough to merge into one LPC pole
        # throws away a perfectly good pitch reading -- which silently broke
        # measurement of deep voices entirely.
        f0 = estimate_f0(frame, sr)
        if f0 > 0:
            f0_values.append(f0)
        formants = lpc_formants(frame, sr)
        if len(formants) >= 3:
            formant_rows.append(formants[:3])
            # Geometric mean of F1..F3: a uniform tract-length change scales
            # all three by the same factor, so their geometric mean tracks it
            # while the vowel being spoken largely cancels out.
            scale_values.append(float(np.exp(np.mean(np.log(formants[:3])))))

    if not f0_values:
        return VoiceFingerprint(voiced_fraction=0.0, frames=0)

    return VoiceFingerprint(
        median_f0=_octave_corrected_median(f0_values),
        formant_scale=(float(np.exp(np.median(np.log(scale_values))))
                       if scale_values else 0.0),
        voiced_fraction=len(f0_values) / max(1, considered),
        frames=len(f0_values),
        formants=([float(v) for v in np.median(np.array(formant_rows), axis=0)]
                  if formant_rows else []),
        envelope=log_envelope(audio, sr),
    )


def _octave_corrected_median(values: Sequence[float]) -> float:
    """Median f0, after folding octave errors back onto the main cluster.

    Even a good pitch tracker occasionally locks onto twice or half the true
    period on a frame where a harmonic dominates. Those frames are not noise
    to be averaged out -- they are off by exactly a factor of two, so fold
    them in rather than letting them drag the median.
    """
    array = np.asarray(list(values), dtype=np.float64)
    if array.size == 0:
        return 0.0
    reference = float(np.median(array))
    if reference <= 0:
        return 0.0
    folded = array.copy()
    for _ in range(3):  # an estimate can be out by two octaves at worst
        too_high = folded > reference * 1.5
        too_low = folded < reference / 1.5
        if not (too_high.any() or too_low.any()):
            break
        folded[too_high] /= 2.0
        folded[too_low] *= 2.0
    return float(np.median(folded))


# --------------------------------------------------------------------------
# Solving for the shift
# --------------------------------------------------------------------------

MAX_PITCH_SHIFT = 12.0
MAX_FORMANT_SHIFT = 8.0


def semitones(ratio: float) -> float:
    if ratio <= 0:
        return 0.0
    return 12.0 * math.log2(ratio)


def match(voice: VoiceFingerprint, target: VoiceFingerprint,
          max_pitch: float = MAX_PITCH_SHIFT,
          max_formant: float = MAX_FORMANT_SHIFT) -> Tuple[float, float]:
    """Pitch and formant shift (semitones) that move ``voice`` towards ``target``.

    ``voice`` is the synthetic character, ``target`` is the user. Returns
    ``(0.0, 0.0)`` when either measurement is not trustworthy, so a bad
    recording leaves the settings alone rather than mangling them.
    """
    if not (voice.usable and target.usable):
        return 0.0, 0.0
    pitch = semitones(target.median_f0 / voice.median_f0)

    # Prefer the envelope cross-correlation: it measures the uniform scaling
    # directly. Individually-estimated formants are a fallback -- pairing
    # them up across two speakers saying different things is noisier, and
    # under-reads when a formant crosses the edge of the analysis band.
    formant = envelope_shift(voice.envelope, target.envelope, max_formant)
    if formant is None:
        formant = semitones(target.formant_scale / voice.formant_scale)

    return (float(np.clip(pitch, -max_pitch, max_pitch)),
            float(np.clip(formant, -max_formant, max_formant)))
