"""Dynamics and colour: gate, compressor, saturation, limiter."""

from __future__ import annotations

import math

import numpy as np

from .filters import db_to_linear, linear_to_db

_ENVELOPE_HOP = 32  # gain is computed at ~690 Hz and interpolated back up


def _envelope(x: np.ndarray, sr: int, attack_ms: float,
              release_ms: float) -> np.ndarray:
    """Attack/release envelope follower, computed on a decimated grid.

    Running the one-pole at audio rate in Python costs milliseconds per
    second of audio; running it every 32 samples and interpolating is
    inaudible for time constants of 5 ms and up, and ~30x faster.
    """
    arr = np.abs(np.asarray(x, dtype=np.float64))
    if arr.size == 0:
        return arr
    n_blocks = max(1, arr.size // _ENVELOPE_HOP)
    usable = n_blocks * _ENVELOPE_HOP
    blocks = arr[:usable].reshape(n_blocks, _ENVELOPE_HOP).max(axis=1)
    if usable < arr.size:
        blocks = np.append(blocks, arr[usable:].max())

    block_rate = sr / float(_ENVELOPE_HOP)
    a_att = math.exp(-1.0 / max(1e-6, (attack_ms / 1000.0) * block_rate))
    a_rel = math.exp(-1.0 / max(1e-6, (release_ms / 1000.0) * block_rate))

    env = np.empty_like(blocks)
    state = float(blocks[0])
    for i, value in enumerate(blocks):
        coeff = a_att if value > state else a_rel
        state = coeff * state + (1.0 - coeff) * value
        env[i] = state

    grid = np.arange(env.size) * _ENVELOPE_HOP + _ENVELOPE_HOP * 0.5
    return np.interp(np.arange(arr.size), grid, env)


def compress(x: np.ndarray, sr: int, threshold_db: float = -20.0,
             ratio: float = 3.0, attack_ms: float = 6.0,
             release_ms: float = 120.0, makeup_db: float = 0.0,
             knee_db: float = 6.0) -> np.ndarray:
    """Soft-knee feed-forward compressor."""
    arr = np.asarray(x, dtype=np.float32)
    if arr.size == 0 or ratio <= 1.0:
        return arr
    env = _envelope(arr, sr, attack_ms, release_ms)
    env_db = 20.0 * np.log10(np.maximum(env, 1e-9))

    over = env_db - threshold_db
    half_knee = knee_db / 2.0
    reduction = np.zeros_like(over)
    if knee_db > 0:
        knee_zone = (over > -half_knee) & (over < half_knee)
        reduction[knee_zone] = ((1.0 / ratio - 1.0)
                                * (over[knee_zone] + half_knee) ** 2
                                / (2.0 * knee_db))
    above = over >= half_knee
    reduction[above] = (1.0 / ratio - 1.0) * over[above]

    gain = 10.0 ** ((reduction + makeup_db) / 20.0)
    return (arr * gain).astype(np.float32)


def gate(x: np.ndarray, sr: int, threshold_db: float = -50.0,
         attack_ms: float = 3.0, release_ms: float = 90.0) -> np.ndarray:
    """Downward expander, to keep room noise out of the virtual mic."""
    arr = np.asarray(x, dtype=np.float32)
    if arr.size == 0:
        return arr
    env = _envelope(arr, sr, attack_ms, release_ms)
    env_db = 20.0 * np.log10(np.maximum(env, 1e-9))
    open_amount = np.clip((env_db - threshold_db) / 8.0, 0.0, 1.0)
    return (arr * open_amount).astype(np.float32)


def saturate(x: np.ndarray, drive: float = 0.0) -> np.ndarray:
    """Asymmetric soft clipping: adds the chest/grit a villain voice wants."""
    arr = np.asarray(x, dtype=np.float32)
    if drive <= 1e-6 or arr.size == 0:
        return arr
    amount = 1.0 + 9.0 * float(np.clip(drive, 0.0, 1.0))
    wet = np.tanh(arr * amount) / math.tanh(amount)
    mix = float(np.clip(drive, 0.0, 1.0))
    return ((1.0 - mix) * arr + mix * wet).astype(np.float32)


def limit(x: np.ndarray, sr: int, ceiling_db: float = -1.0,
          release_ms: float = 50.0) -> np.ndarray:
    """Brick-wall-ish limiter so nothing ever clips the virtual cable."""
    arr = np.asarray(x, dtype=np.float32)
    if arr.size == 0:
        return arr
    ceiling = db_to_linear(ceiling_db)
    env = _envelope(arr, sr, 0.5, release_ms)
    over = np.maximum(env / ceiling, 1.0)
    out = arr / over
    return np.clip(out, -ceiling, ceiling).astype(np.float32)


def stereo_width(x: np.ndarray, width: float = 0.0) -> np.ndarray:
    """Mono in, (n, 2) out.  ``width`` 0 is dual-mono."""
    arr = np.asarray(x, dtype=np.float32)
    if width <= 1e-6:
        return np.stack([arr, arr], axis=1)
    delay = max(1, int(width * 40))
    right = np.concatenate([np.zeros(delay, dtype=np.float32), arr])[:arr.size]
    return np.stack([arr, right], axis=1)


def loudness_match(x: np.ndarray, reference_rms: float,
                   max_gain_db: float = 12.0) -> np.ndarray:
    """Bring ``x`` to ``reference_rms``, within a sane gain range."""
    arr = np.asarray(x, dtype=np.float32)
    current = float(np.sqrt(np.mean(arr.astype(np.float64) ** 2))) if arr.size else 0.0
    if current < 1e-6 or reference_rms < 1e-6:
        return arr
    gain_db = float(np.clip(linear_to_db(reference_rms / current),
                            -max_gain_db, max_gain_db))
    return (arr * db_to_linear(gain_db)).astype(np.float32)
