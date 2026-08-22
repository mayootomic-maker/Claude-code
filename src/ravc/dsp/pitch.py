"""Pitch and formant shifting.

Two independent controls, which is what you want for a voice changer:

* **pitch** moves the fundamental -- how high or low the voice sits;
* **formant** moves the resonances of the vocal tract -- how *big* the
  speaker seems.  Dropping formants without dropping pitch is what turns a
  neutral voice into a large, chest-heavy one, and it is the difference
  between "sped-up/slowed-down tape" and a believable different person.

Both are implemented with a phase vocoder plus cepstral envelope warping,
in plain numpy, so there is no scipy/librosa dependency to package.
"""

from __future__ import annotations

import math
from typing import Optional, Tuple

import numpy as np

N_FFT = 2048
HOP = N_FFT // 4


def _window(n: int) -> np.ndarray:
    return np.hanning(n + 1)[:n].astype(np.float64)


def stft(x: np.ndarray, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    """Complex STFT, frames along axis 1."""
    x = np.asarray(x, dtype=np.float64)
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    win = _window(n_fft)
    padded = np.pad(x, (n_fft // 2, n_fft // 2), mode="reflect")
    # Pad the tail out to a whole number of hops plus one frame, so every
    # input sample is covered by a full overlap-add and the reconstruction is
    # exact at the edges rather than just in the interior.
    remainder = (padded.size - n_fft) % hop
    if remainder:
        padded = np.pad(padded, (0, hop - remainder))
    padded = np.pad(padded, (0, n_fft))
    n_frames = 1 + (padded.size - n_fft) // hop
    idx = np.arange(n_fft)[:, None] + hop * np.arange(n_frames)[None, :]
    frames = padded[idx] * win[:, None]
    return np.fft.rfft(frames, n=n_fft, axis=0)


def istft(spec: np.ndarray, n_fft: int = N_FFT, hop: int = HOP,
          length: Optional[int] = None) -> np.ndarray:
    """Inverse STFT with Hann window-sum normalisation (COLA)."""
    win = _window(n_fft)
    frames = np.fft.irfft(spec, n=n_fft, axis=0) * win[:, None]
    n_frames = frames.shape[1]
    out_len = n_fft + hop * (n_frames - 1)
    out = np.zeros(out_len, dtype=np.float64)
    norm = np.zeros(out_len, dtype=np.float64)
    for i in range(n_frames):
        start = i * hop
        out[start:start + n_fft] += frames[:, i]
        norm[start:start + n_fft] += win * win
    floor = 1e-8 * max(float(norm.max()), 1e-12)
    out = out / np.where(norm < floor, 1.0, norm)
    out = out[n_fft // 2: out.size - n_fft // 2]
    if length is not None:
        if out.size < length:
            out = np.pad(out, (0, length - out.size))
        out = out[:length]
    return out


def phase_vocoder(spec: np.ndarray, rate: float, hop: int = HOP) -> np.ndarray:
    """Time-stretch an STFT by ``rate`` (>1 = faster/shorter)."""
    if abs(rate - 1.0) < 1e-6:
        return spec
    n_bins, n_frames = spec.shape
    n_fft = 2 * (n_bins - 1)
    time_steps = np.arange(0, n_frames, rate)
    expected = 2.0 * np.pi * hop * np.arange(n_bins) / n_fft

    magnitude = np.abs(spec)
    phase = np.angle(spec)
    out = np.zeros((n_bins, time_steps.size), dtype=np.complex128)
    acc = phase[:, 0].copy()

    padded_mag = np.concatenate([magnitude, magnitude[:, -1:]], axis=1)
    padded_phase = np.concatenate([phase, phase[:, -1:]], axis=1)

    for i, step in enumerate(time_steps):
        left = int(np.floor(step))
        frac = step - left
        mag = (1.0 - frac) * padded_mag[:, left] + frac * padded_mag[:, left + 1]
        out[:, i] = mag * np.exp(1j * acc)
        delta = padded_phase[:, left + 1] - padded_phase[:, left] - expected
        delta = delta - 2.0 * np.pi * np.round(delta / (2.0 * np.pi))
        acc = acc + expected + delta
    return out


def _resample(x: np.ndarray, ratio: float) -> np.ndarray:
    """Linear resample; ``ratio`` > 1 makes the signal longer (lower pitch)."""
    if abs(ratio - 1.0) < 1e-9 or x.size == 0:
        return x
    out_len = max(1, int(round(x.size * ratio)))
    src = np.linspace(0.0, x.size - 1.0, out_len)
    return np.interp(src, np.arange(x.size), x)


# --------------------------------------------------------------------------
# Spectral envelope
# --------------------------------------------------------------------------

def spectral_envelope(magnitude: np.ndarray, quefrency: int = 40) -> np.ndarray:
    """Cepstrally-smoothed spectral envelope of a magnitude spectrogram.

    Low-quefrency liftering keeps the slow variation across frequency (the
    formants) and discards the fast ripple (the harmonics of f0), which is
    exactly the split needed to move one without moving the other.
    """
    log_mag = np.log(np.maximum(magnitude, 1e-8))
    cepstrum = np.fft.irfft(log_mag, axis=0)
    lifter = np.zeros(cepstrum.shape[0])
    q = min(quefrency, cepstrum.shape[0] // 2)
    lifter[:q] = 1.0
    lifter[-q + 1:] = 1.0 if q > 1 else 0.0
    smoothed = np.fft.rfft(cepstrum * lifter[:, None], axis=0)
    envelope = np.exp(np.real(smoothed))
    # Floor each frame relative to its own peak.  An absolute floor lets the
    # envelope collapse to ~0 in bands where the signal is silent, and the
    # division in formant_shift then amplifies pure numerical noise.
    frame_floor = envelope.max(axis=0, keepdims=True) * 1e-4
    return np.maximum(envelope, np.maximum(frame_floor, 1e-9))


def warp_envelope(envelope: np.ndarray, ratio: float) -> np.ndarray:
    """Stretch the envelope along the frequency axis by ``ratio``."""
    if abs(ratio - 1.0) < 1e-6:
        return envelope
    n_bins = envelope.shape[0]
    bins = np.arange(n_bins, dtype=np.float64)
    src = np.clip(bins / ratio, 0.0, n_bins - 1.0)
    lo = np.floor(src).astype(int)
    hi = np.minimum(lo + 1, n_bins - 1)
    frac = (src - lo)[:, None]
    return (1.0 - frac) * envelope[lo, :] + frac * envelope[hi, :]


def formant_shift(x: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """Move the formants by ``semitones`` without touching the pitch."""
    if abs(semitones) < 1e-6 or x.size == 0:
        return np.asarray(x, dtype=np.float32)
    ratio = 2.0 ** (semitones / 12.0)
    spec = stft(x)
    magnitude = np.abs(spec)
    phase = np.angle(spec)
    envelope = spectral_envelope(magnitude)
    warped = warp_envelope(envelope, ratio)
    # Clamp the correction: +-24 dB is far more than any real formant move
    # needs, and it stops silent bands turning into hiss.
    gain = np.clip(warped / envelope, 10 ** (-24 / 20), 10 ** (24 / 20))
    new_mag = magnitude * gain
    out = istft(new_mag * np.exp(1j * phase), length=int(x.size))
    return out.astype(np.float32)


def pitch_shift(x: np.ndarray, sr: int, semitones: float,
                preserve_formants: bool = True) -> np.ndarray:
    """Shift pitch by ``semitones``, keeping the duration."""
    if abs(semitones) < 1e-6 or x.size == 0:
        return np.asarray(x, dtype=np.float32)
    rate = 2.0 ** (semitones / 12.0)

    stretched = istft(phase_vocoder(stft(x), 1.0 / rate))
    shifted = _resample(stretched, 1.0 / rate)

    if shifted.size < x.size:
        shifted = np.pad(shifted, (0, x.size - shifted.size))
    shifted = shifted[:x.size]

    if preserve_formants:
        shifted = formant_shift(shifted, sr, -semitones)
    return np.asarray(shifted, dtype=np.float32)


def shift(x: np.ndarray, sr: int, pitch_semitones: float = 0.0,
          formant_semitones: float = 0.0) -> np.ndarray:
    """Apply an independent pitch and formant shift."""
    out = np.asarray(x, dtype=np.float32)
    if abs(pitch_semitones) > 1e-6:
        out = pitch_shift(out, sr, pitch_semitones, preserve_formants=True)
    if abs(formant_semitones) > 1e-6:
        out = formant_shift(out, sr, formant_semitones)
    return out


def estimate_f0(x: np.ndarray, sr: int, fmin: float = 60.0,
                fmax: float = 400.0) -> float:
    """Rough autocorrelation f0 estimate (used by tests and the level meter)."""
    arr = np.asarray(x, dtype=np.float64)
    if arr.size < int(sr / fmin) * 2:
        return 0.0
    arr = arr - arr.mean()
    corr = np.correlate(arr, arr, mode="full")[arr.size - 1:]
    lo, hi = int(sr / fmax), min(int(sr / fmin), corr.size - 1)
    if hi <= lo:
        return 0.0
    peak = int(np.argmax(corr[lo:hi])) + lo
    return float(sr) / peak if peak else 0.0
