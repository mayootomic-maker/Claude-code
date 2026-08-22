"""Biquad filters and a few small signal utilities."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

try:  # scipy is optional; it only makes the streaming path faster
    from scipy.signal import lfilter as _scipy_lfilter
    _HAVE_SCIPY = True
except Exception:  # pragma: no cover - scipy is not a declared dependency
    _HAVE_SCIPY = False


@dataclass
class Biquad:
    """Direct-form-I biquad with persistent state (safe for block streaming)."""

    b0: float = 1.0
    b1: float = 0.0
    b2: float = 0.0
    a1: float = 0.0
    a2: float = 0.0

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._x1 = self._x2 = self._y1 = self._y2 = 0.0

    @property
    def coefficients(self) -> Tuple[np.ndarray, np.ndarray]:
        return (np.array([self.b0, self.b1, self.b2], dtype=np.float64),
                np.array([1.0, self.a1, self.a2], dtype=np.float64))

    def response(self, freqs: np.ndarray, sr: int) -> np.ndarray:
        """Complex frequency response at ``freqs`` Hz."""
        z = np.exp(-2j * np.pi * np.asarray(freqs, dtype=np.float64) / sr)
        num = self.b0 + self.b1 * z + self.b2 * z * z
        den = 1.0 + self.a1 * z + self.a2 * z * z
        return num / np.where(np.abs(den) < 1e-18, 1e-18, den)

    def process(self, x: np.ndarray) -> np.ndarray:
        """Filter a block, carrying state across calls."""
        x = np.asarray(x, dtype=np.float64)
        if _HAVE_SCIPY and x.size > 64:
            b, a = self.coefficients
            zi = np.array([
                self.b1 * self._x1 + self.b2 * self._x2
                - self.a1 * self._y1 - self.a2 * self._y2,
                self.b2 * self._x1 - self.a2 * self._y1,
            ], dtype=np.float64)
            y, _ = _scipy_lfilter(b, a, x, zi=zi)
            if x.size >= 2:
                self._x1, self._x2 = float(x[-1]), float(x[-2])
                self._y1, self._y2 = float(y[-1]), float(y[-2])
            return y.astype(np.float32)
        y = np.empty_like(x)
        x1, x2, y1, y2 = self._x1, self._x2, self._y1, self._y2
        b0, b1, b2, a1, a2 = self.b0, self.b1, self.b2, self.a1, self.a2
        for i in range(x.size):
            xi = x[i]
            yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1 = x1, xi
            y2, y1 = y1, yi
            y[i] = yi
        self._x1, self._x2, self._y1, self._y2 = x1, x2, y1, y2
        return y.astype(np.float32)

    # -- designers -------------------------------------------------------

    @classmethod
    def low_shelf(cls, sr: int, freq: float, gain_db: float,
                  q: float = 0.7071) -> "Biquad":
        a = 10 ** (gain_db / 40.0)
        w0 = 2 * math.pi * freq / sr
        cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
        alpha = sin_w0 / (2 * q)
        two_sqrt_a_alpha = 2 * math.sqrt(a) * alpha
        b0 = a * ((a + 1) - (a - 1) * cos_w0 + two_sqrt_a_alpha)
        b1 = 2 * a * ((a - 1) - (a + 1) * cos_w0)
        b2 = a * ((a + 1) - (a - 1) * cos_w0 - two_sqrt_a_alpha)
        a0 = (a + 1) + (a - 1) * cos_w0 + two_sqrt_a_alpha
        a1 = -2 * ((a - 1) + (a + 1) * cos_w0)
        a2 = (a + 1) + (a - 1) * cos_w0 - two_sqrt_a_alpha
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    @classmethod
    def high_shelf(cls, sr: int, freq: float, gain_db: float,
                   q: float = 0.7071) -> "Biquad":
        a = 10 ** (gain_db / 40.0)
        w0 = 2 * math.pi * freq / sr
        cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
        alpha = sin_w0 / (2 * q)
        two_sqrt_a_alpha = 2 * math.sqrt(a) * alpha
        b0 = a * ((a + 1) + (a - 1) * cos_w0 + two_sqrt_a_alpha)
        b1 = -2 * a * ((a - 1) + (a + 1) * cos_w0)
        b2 = a * ((a + 1) + (a - 1) * cos_w0 - two_sqrt_a_alpha)
        a0 = (a + 1) - (a - 1) * cos_w0 + two_sqrt_a_alpha
        a1 = 2 * ((a - 1) - (a + 1) * cos_w0)
        a2 = (a + 1) - (a - 1) * cos_w0 - two_sqrt_a_alpha
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    @classmethod
    def peaking(cls, sr: int, freq: float, gain_db: float,
                q: float = 1.0) -> "Biquad":
        a = 10 ** (gain_db / 40.0)
        w0 = 2 * math.pi * freq / sr
        alpha = math.sin(w0) / (2 * q)
        cos_w0 = math.cos(w0)
        b0 = 1 + alpha * a
        b1 = -2 * cos_w0
        b2 = 1 - alpha * a
        a0 = 1 + alpha / a
        a1 = -2 * cos_w0
        a2 = 1 - alpha / a
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    @classmethod
    def high_pass(cls, sr: int, freq: float, q: float = 0.7071) -> "Biquad":
        w0 = 2 * math.pi * freq / sr
        cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
        alpha = sin_w0 / (2 * q)
        b0 = (1 + cos_w0) / 2
        b1 = -(1 + cos_w0)
        b2 = (1 + cos_w0) / 2
        a0 = 1 + alpha
        a1 = -2 * cos_w0
        a2 = 1 - alpha
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    @classmethod
    def low_pass(cls, sr: int, freq: float, q: float = 0.7071) -> "Biquad":
        w0 = 2 * math.pi * freq / sr
        cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
        alpha = sin_w0 / (2 * q)
        b0 = (1 - cos_w0) / 2
        b1 = 1 - cos_w0
        b2 = (1 - cos_w0) / 2
        a0 = 1 + alpha
        a1 = -2 * cos_w0
        a2 = 1 - alpha
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


class BiquadChain:
    """A series of biquads applied in order."""

    def __init__(self, *stages: Biquad) -> None:
        self.stages = list(stages)

    def reset(self) -> None:
        for stage in self.stages:
            stage.reset()

    def process(self, x: np.ndarray) -> np.ndarray:
        out = np.asarray(x, dtype=np.float32)
        for stage in self.stages:
            out = stage.process(out)
        return out


# --------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------

def apply_offline(stages, x: np.ndarray, sr: int) -> np.ndarray:
    """Apply a cascade of biquads to a whole buffer via FFT.

    The per-sample recursion in :meth:`Biquad.process` is the right thing for
    a live 20 ms block but far too slow in pure Python for a three-second
    utterance.  Multiplying by the exact complex response gives the same
    result (bar the initial transient, which the zero padding absorbs) in a
    fraction of the time, so the offline path uses this instead.
    """
    arr = np.asarray(x, dtype=np.float32)
    stages = list(stages)
    if arr.size == 0 or not stages:
        return arr
    n_fft = 1
    target = arr.size + 256
    while n_fft < target:
        n_fft <<= 1
    spectrum = np.fft.rfft(arr, n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    for stage in stages:
        spectrum = spectrum * stage.response(freqs, sr)
    out = np.fft.irfft(spectrum, n=n_fft)[:arr.size]
    return out.astype(np.float32)


def db_to_linear(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def linear_to_db(x: float) -> float:
    return float(20.0 * math.log10(max(x, 1e-12)))


def fade(samples: np.ndarray, sr: int, fade_in: float = 0.005,
         fade_out: float = 0.010) -> np.ndarray:
    """Taper the edges so blocks butt together without clicks."""
    out = np.array(samples, dtype=np.float32, copy=True)
    n_in = min(int(fade_in * sr), out.size // 2)
    n_out = min(int(fade_out * sr), out.size // 2)
    if n_in > 0:
        out[:n_in] *= np.linspace(0.0, 1.0, n_in, dtype=np.float32)
    if n_out > 0:
        out[-n_out:] *= np.linspace(1.0, 0.0, n_out, dtype=np.float32)
    return out


def pad(samples: np.ndarray, sr: int, before: float = 0.0,
        after: float = 0.0) -> np.ndarray:
    head = np.zeros(int(before * sr), dtype=np.float32)
    tail = np.zeros(int(after * sr), dtype=np.float32)
    return np.concatenate([head, np.asarray(samples, dtype=np.float32), tail])


def normalize_peak(samples: np.ndarray, target: float = 0.89) -> np.ndarray:
    arr = np.asarray(samples, dtype=np.float32)
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak <= 1e-6:
        return arr
    return (arr * (target / peak)).astype(np.float32)


def rms(samples: np.ndarray) -> float:
    arr = np.asarray(samples, dtype=np.float64)
    return float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
