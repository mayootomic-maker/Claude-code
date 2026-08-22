"""Signal processing: filters, pitch/formant shifting, dynamics, presets."""

import numpy as np
import pytest

from ravc.dsp import effects, pitch
from ravc.dsp.chain import PRESETS, VoiceFx, get_preset, preset_names
from ravc.dsp.filters import (Biquad, apply_offline, db_to_linear, fade,
                              linear_to_db, normalize_peak, rms)
from ravc.tts.base import Audio, resample

SR = 22050


@pytest.fixture
def voice_like():
    """A pulse train through three formants: crudely voice-shaped."""
    pulse = np.zeros(SR * 2, dtype=np.float32)
    pulse[::int(SR / 110)] = 1.0
    shaped = apply_offline([Biquad.peaking(SR, 700, 18, 2.0),
                            Biquad.peaking(SR, 1200, 15, 2.5),
                            Biquad.peaking(SR, 2600, 12, 3.0),
                            Biquad.low_pass(SR, 5000)], pulse, SR)
    return (shaped / np.abs(shaped).max() * 0.5).astype(np.float32)


def band_energy(x, lo, hi):
    spectrum = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    mask = (freqs >= lo) & (freqs < hi)
    return float(np.sqrt(np.mean(spectrum[mask] ** 2)))


def centroid(x):
    spectrum = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    return float((spectrum * freqs).sum() / spectrum.sum())


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

def test_low_shelf_lifts_only_the_low_band():
    noise = np.random.RandomState(0).randn(SR).astype(np.float32) * 0.1
    out = apply_offline([Biquad.low_shelf(SR, 200, 12.0)], noise, SR)
    assert 10.0 < linear_to_db(band_energy(out, 50, 120)
                               / band_energy(noise, 50, 120)) < 13.0
    assert abs(linear_to_db(band_energy(out, 3000, 6000)
                            / band_energy(noise, 3000, 6000))) < 0.5


def test_high_pass_attenuates_below_the_corner():
    noise = np.random.RandomState(1).randn(SR).astype(np.float32) * 0.1
    out = apply_offline([Biquad.high_pass(SR, 1000)], noise, SR)
    assert linear_to_db(band_energy(out, 80, 150)
                        / band_energy(noise, 80, 150)) < -20


def test_fft_path_matches_the_recursion():
    noise = np.random.RandomState(2).randn(SR).astype(np.float32) * 0.1
    stages = [Biquad.low_shelf(SR, 200, 9.0), Biquad.high_pass(SR, 80)]
    fft_out = apply_offline(stages, noise, SR)
    for stage in stages:
        stage.reset()
    iir_out = noise
    for stage in stages:
        iir_out = stage.process(iir_out)
    # Skip the initial transient the zero padding absorbs.
    assert np.abs(fft_out[1000:] - iir_out[1000:]).max() < 1e-5


def test_biquad_state_carries_across_blocks():
    noise = np.random.RandomState(3).randn(4096).astype(np.float32) * 0.1
    whole = Biquad.low_pass(SR, 800)
    expected = whole.process(noise)
    blocked = Biquad.low_pass(SR, 800)
    chunks = [blocked.process(noise[i:i + 256]) for i in range(0, 4096, 256)]
    assert np.abs(np.concatenate(chunks) - expected).max() < 1e-5


def test_db_conversions_round_trip():
    for db in (-40.0, -6.0, 0.0, 6.0):
        assert linear_to_db(db_to_linear(db)) == pytest.approx(db, abs=1e-9)


def test_helpers():
    assert normalize_peak(np.array([0.1, -0.2], dtype=np.float32)).max() \
        == pytest.approx(0.445, abs=1e-3)
    assert normalize_peak(np.zeros(10, dtype=np.float32)).max() == 0.0
    assert rms(np.zeros(0)) == 0.0
    faded = fade(np.ones(SR, dtype=np.float32), SR)
    assert faded[0] == 0.0 and faded[-1] == 0.0 and faded[SR // 2] == 1.0


def test_empty_input_is_safe():
    empty = np.zeros(0, dtype=np.float32)
    assert apply_offline([Biquad.low_pass(SR, 1000)], empty, SR).size == 0
    assert effects.compress(empty, SR).size == 0
    assert effects.limit(empty, SR).size == 0
    assert pitch.pitch_shift(empty, SR, -5).size == 0


# --------------------------------------------------------------------------
# Pitch and formants
# --------------------------------------------------------------------------

def test_stft_round_trip_is_exact():
    x = np.random.RandomState(4).randn(SR).astype(np.float32) * 0.2
    back = pitch.istft(pitch.stft(x), length=x.size)
    assert np.abs(back - x).max() < 1e-9


@pytest.mark.parametrize("semitones", [-7, -4, 4, 7])
def test_pitch_shift_hits_the_target_f0(voice_like, semitones):
    shifted = pitch.pitch_shift(voice_like, SR, semitones)
    expected = 110.0 * 2 ** (semitones / 12.0)
    assert pitch.estimate_f0(shifted, SR) == pytest.approx(expected, rel=0.03)


def test_pitch_shift_preserves_duration(voice_like):
    assert pitch.pitch_shift(voice_like, SR, -5).size == voice_like.size


def test_pitch_shift_preserves_formants(voice_like):
    """That is the whole point of the envelope correction."""
    before = centroid(voice_like)
    after = centroid(pitch.pitch_shift(voice_like, SR, -5))
    assert after == pytest.approx(before, rel=0.12)


@pytest.mark.parametrize("semitones", [-6, -3, 3, 6])
def test_formant_shift_leaves_pitch_alone(voice_like, semitones):
    shifted = pitch.formant_shift(voice_like, SR, semitones)
    assert pitch.estimate_f0(shifted, SR) == pytest.approx(110.0, rel=0.03)


def test_formant_shift_moves_the_spectrum_the_right_way(voice_like):
    down = centroid(pitch.formant_shift(voice_like, SR, -6))
    base = centroid(voice_like)
    up = centroid(pitch.formant_shift(voice_like, SR, 6))
    assert down < base < up


def test_zero_shift_is_a_no_op(voice_like):
    assert np.array_equal(pitch.shift(voice_like, SR, 0.0, 0.0), voice_like)


def test_phase_vocoder_stretches(voice_like):
    spec = pitch.stft(voice_like)
    assert pitch.phase_vocoder(spec, 0.5).shape[1] > spec.shape[1]
    assert pitch.phase_vocoder(spec, 2.0).shape[1] < spec.shape[1]


def test_estimate_f0_on_too_short_input():
    assert pitch.estimate_f0(np.zeros(10, dtype=np.float32), SR) == 0.0


# --------------------------------------------------------------------------
# Dynamics
# --------------------------------------------------------------------------

def test_compressor_reduces_loud_and_leaves_quiet_alone():
    loud = np.random.RandomState(5).randn(SR).astype(np.float32) * 0.3
    quiet = np.random.RandomState(6).randn(SR).astype(np.float32) * 0.005
    assert rms(effects.compress(loud, SR, -20, 4)) < rms(loud) * 0.6
    assert rms(effects.compress(quiet, SR, -20, 4)) == pytest.approx(
        rms(quiet), rel=0.05)


def test_limiter_respects_the_ceiling():
    hot = np.random.RandomState(7).randn(SR).astype(np.float32) * 1.2
    out = effects.limit(hot, SR, ceiling_db=-1.0)
    assert linear_to_db(float(np.abs(out).max())) <= -0.99


def test_gate_closes_below_the_threshold():
    noise = np.random.RandomState(8).randn(SR).astype(np.float32) * 0.0005
    assert rms(effects.gate(noise, SR, -50)) < rms(noise) * 0.5


def test_saturation_adds_harmonics():
    tone = np.sin(2 * np.pi * 300 * np.arange(SR) / SR).astype(np.float32) * 0.5
    driven = effects.saturate(tone, 0.9)
    assert band_energy(driven, 850, 950) > band_energy(tone, 850, 950) * 5


def test_stereo_width():
    mono = np.random.RandomState(9).randn(1000).astype(np.float32)
    assert effects.stereo_width(mono, 0.0).shape == (1000, 2)
    wide = effects.stereo_width(mono, 0.5)
    assert not np.array_equal(wide[:, 0], wide[:, 1])


# --------------------------------------------------------------------------
# Presets
# --------------------------------------------------------------------------

def test_every_preset_produces_usable_audio(voice_like):
    source = Audio(voice_like, SR)
    for name in preset_names():
        out = get_preset(name).apply(source)
        assert out.samples.size > 0, name
        assert np.isfinite(out.samples).all(), name
        peak = float(np.abs(out.samples).max())
        assert 0.3 < peak <= 1.0, (name, peak)


def test_presets_shift_pitch_as_declared(voice_like):
    source = Audio(voice_like, SR)
    for name, fx in PRESETS.items():
        if abs(fx.pitch_semitones) < 1:
            continue
        out = fx.apply(source)
        expected = 110.0 * 2 ** (fx.pitch_semitones / 12.0)
        assert pitch.estimate_f0(out.samples, SR) == pytest.approx(
            expected, rel=0.06), name


def test_voice_fx_round_trips_through_a_dict():
    fx = VoiceFx(pitch_semitones=-3.5, drive=0.4)
    assert VoiceFx.from_dict(fx.to_dict()) == fx
    assert VoiceFx.from_dict({"pitch_semitones": -2, "bogus": 1}
                             ).pitch_semitones == -2


def test_fx_on_silence_does_not_blow_up():
    out = get_preset("Bond Villain").apply(Audio(np.zeros(SR, np.float32), SR))
    assert np.isfinite(out.samples).all()
    assert float(np.abs(out.samples).max()) < 0.05


def test_resample_changes_length_and_keeps_rate():
    audio = Audio(np.random.RandomState(10).randn(SR).astype(np.float32), SR)
    out = resample(audio, 48000)
    assert out.sample_rate == 48000
    assert out.samples.size == pytest.approx(SR * 48000 / SR, rel=0.01)
    assert resample(audio, SR) is not None
