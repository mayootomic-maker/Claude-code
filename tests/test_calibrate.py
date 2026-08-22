"""Tests for voice measurement and matching."""

from __future__ import annotations

import numpy as np
import pytest

from ravc.dsp import pitch as P
from ravc.dsp.calibrate import (BINS_PER_OCTAVE, VoiceFingerprint,
                                envelope_shift, fingerprint, levinson,
                                log_envelope, lpc_formants, match, semitones)
from ravc.dsp.filters import Biquad, apply_offline

SR = 22050


def synth_vowel(f0: float, formants, seconds: float = 2.0,
                seed: int = 0) -> np.ndarray:
    """A pulse train through formant resonances: a crude but honest vowel."""
    n = int(SR * seconds)
    pulse = np.zeros(n, dtype=np.float32)
    pulse[::max(1, int(SR / f0))] = 1.0
    stages = [Biquad.peaking(SR, f, 20.0, 4.0) for f in formants]
    stages.append(Biquad.low_pass(SR, 5200))
    out = apply_offline(stages, pulse, SR)
    out = out + np.random.RandomState(seed).randn(n).astype(np.float32) * 1e-4
    return (out / np.abs(out).max() * 0.5).astype(np.float32)


# --------------------------------------------------------------------------
# Linear prediction
# --------------------------------------------------------------------------

def test_levinson_rejects_silence():
    assert levinson(np.zeros(9), 8) is None


def test_lpc_recovers_known_formants():
    truth = [700.0, 1220.0, 2600.0]
    frame = synth_vowel(120, truth)[5000:5880]
    got = lpc_formants(frame, SR)[:3]
    assert len(got) == 3
    for expected, actual in zip(truth, got):
        assert abs(actual - expected) / expected < 0.10, (truth, got)


def test_lpc_returns_nothing_for_silence_and_short_frames():
    assert lpc_formants(np.zeros(880, dtype=np.float32), SR) == []
    assert lpc_formants(np.zeros(8, dtype=np.float32), SR) == []


# --------------------------------------------------------------------------
# Fingerprinting
# --------------------------------------------------------------------------

def test_fingerprint_measures_pitch_and_formants():
    fp = fingerprint(synth_vowel(115, [700, 1220, 2600]), SR)
    assert fp.usable
    assert abs(fp.median_f0 - 115) < 6
    assert len(fp.formants) == 3
    assert fp.voiced_fraction > 0.5
    assert "f0" in fp.describe()


@pytest.mark.parametrize("signal", [
    np.zeros(SR, dtype=np.float32),
    (np.random.RandomState(1).randn(SR) * 0.2).astype(np.float32),
    np.zeros(64, dtype=np.float32),
])
def test_fingerprint_rejects_unusable_audio(signal):
    """Silence and noise must not produce confident-looking numbers."""
    assert not fingerprint(signal, SR).usable


def test_unusable_fingerprint_leaves_settings_alone():
    good = fingerprint(synth_vowel(120, [700, 1220, 2600]), SR)
    assert match(good, VoiceFingerprint()) == (0.0, 0.0)
    assert match(VoiceFingerprint(), good) == (0.0, 0.0)


# --------------------------------------------------------------------------
# Envelope shift
# --------------------------------------------------------------------------

def test_envelope_shift_recovers_a_known_formant_move():
    base = synth_vowel(130, [700, 1220, 2600])
    for expected in (-4.0, 3.0, 6.0):
        moved = P.formant_shift(base, SR, expected)
        got = envelope_shift(log_envelope(base, SR), log_envelope(moved, SR))
        assert got is not None
        assert abs(got - expected) < 1.0, (expected, got)


def test_envelope_shift_of_a_signal_with_itself_is_zero():
    env = log_envelope(synth_vowel(120, [700, 1220, 2600]), SR)
    assert abs(envelope_shift(env, env)) < 0.05


def test_envelope_shift_handles_missing_input():
    env = log_envelope(synth_vowel(120, [700, 1220, 2600]), SR)
    assert envelope_shift(None, env) is None
    assert envelope_shift(env, None) is None
    assert log_envelope(np.zeros(128, dtype=np.float32), SR) is None


def test_log_envelope_grid_is_log_spaced():
    from ravc.dsp.calibrate import LOG_GRID
    ratios = LOG_GRID[1:] / LOG_GRID[:-1]
    assert np.allclose(ratios, 2 ** (1 / BINS_PER_OCTAVE), rtol=1e-6)


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------

def test_semitones():
    assert semitones(2.0) == pytest.approx(12.0)
    assert semitones(1.0) == pytest.approx(0.0)
    assert semitones(0.0) == 0.0


def test_match_recovers_a_pitch_and_formant_difference():
    """Recovery on a synthetic vowel.

    The tolerance here is looser than the algorithm actually achieves. A
    pulse train through resonators is a deliberately hard case: every
    harmonic has similar amplitude, so moving the formants changes which
    harmonic dominates and the pitch tracker can latch onto a different
    period. Real speech has a glottal spectral tilt that makes the
    fundamental unambiguous -- measured against the real voice models this
    lands within about 0.2 semitones, which
    ``test_calibration_is_accurate_on_real_speech`` in the integration
    suite asserts.
    """
    voice = synth_vowel(120, [700, 1220, 2600])
    source = fingerprint(voice, SR)
    for pitch_st, formant_st in [(-6.0, -3.0), (5.0, 2.0), (2.0, -2.0)]:
        moved = P.shift(voice, SR, pitch_st, formant_st)
        pitch, formant = match(source, fingerprint(moved, SR))
        assert abs(pitch - pitch_st) < 1.0, ("pitch", pitch_st, pitch)
        assert abs(formant - formant_st) < 2.0, ("formant", formant_st, formant)


def test_match_is_clamped():
    low = fingerprint(synth_vowel(80, [500, 900, 2200]), SR)
    high = fingerprint(synth_vowel(300, [1100, 2000, 3400], seed=2), SR)
    assert low.usable and high.usable
    pitch, formant = match(low, high, max_pitch=3.0, max_formant=2.0)
    assert pitch == pytest.approx(3.0)
    assert formant == pytest.approx(2.0)


def test_match_of_a_voice_with_itself_is_a_no_op():
    fp = fingerprint(synth_vowel(140, [650, 1300, 2500]), SR)
    pitch, formant = match(fp, fp)
    assert abs(pitch) < 0.05
    assert abs(formant) < 0.05


def test_a_pitch_shift_does_not_read_as_a_formant_shift():
    """Moving one dial must not show up on the other.

    Only the pitch-shift direction is asserted on synthetic input; see
    ``test_match_recovers_a_pitch_and_formant_difference`` for why the
    formant-shift direction is checked against real speech instead.
    """
    base = synth_vowel(130, [700, 1220, 2600])
    source = fingerprint(base, SR)
    pitch_only = P.pitch_shift(base, SR, 5.0, preserve_formants=True)
    pitch, formant = match(source, fingerprint(pitch_only, SR))
    assert abs(pitch - 5.0) < 1.2
    assert abs(formant) < 1.5


def test_deep_voices_are_measurable():
    """A low male voice must not silently fail to measure.

    This regressed once already: f0 was only recorded for frames where the
    formant fit also succeeded, so a vowel whose F1 and F2 merged into a
    single LPC pole discarded a perfectly good pitch reading, and voices
    around 80 Hz came back unmeasurable.
    """
    for f0, formants in [(80, [500, 900, 2200]), (95, [520, 1000, 2400])]:
        fp = fingerprint(synth_vowel(f0, formants), SR)
        assert fp.usable, f0
        assert abs(fp.median_f0 - f0) < 5, (f0, fp.median_f0)


def test_octave_errors_are_folded_in():
    from ravc.dsp.calibrate import _octave_corrected_median
    assert _octave_corrected_median([100, 101, 99, 200, 50]) == pytest.approx(100, abs=2)
    assert _octave_corrected_median([]) == 0.0
