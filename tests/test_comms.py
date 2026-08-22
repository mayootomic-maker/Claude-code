"""Tests for the voice-chat emulation."""

from __future__ import annotations

import numpy as np
import pytest

from ravc.dsp.comms import (PROFILES, CommsProfile, bitcrush, codec_bandwidth,
                            fan_noise, get_profile, keyboard_noise,
                            microphone_response, overdrive, packet_loss,
                            pink_noise, profile_names, television_noise)

SR = 22050


def speech_like(seconds: float = 2.0, seed: int = 0) -> np.ndarray:
    """Broadband voiced-ish signal with energy well above the codec band."""
    t = np.arange(int(SR * seconds)) / SR
    rng = np.random.RandomState(seed)
    out = sum(np.sin(2 * np.pi * 130 * k * t + rng.uniform(0, 6.28)) / k
              for k in range(1, 60))
    return (out / np.abs(out).max() * 0.5).astype(np.float32)


def band_energy(x: np.ndarray, sr: int, lo: float, hi: float) -> float:
    spectrum = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    mask = (freqs >= lo) & (freqs < hi)
    return float(np.sqrt(np.mean(spectrum[mask] ** 2))) if mask.any() else 0.0


# --------------------------------------------------------------------------
# Noise sources
# --------------------------------------------------------------------------

def test_noise_sources_have_the_right_spectral_shape():
    """A fan rumbles, a keyboard clatters. If those are the wrong way round
    the result sounds like neither."""
    fan = fan_noise(SR * 2, SR)
    keys = keyboard_noise(SR * 2, SR)
    telly = television_noise(SR * 2, SR)

    def tilt(x):
        return (20 * np.log10(max(band_energy(x, SR, 2000, 8000), 1e-9)
                              / max(band_energy(x, SR, 50, 300), 1e-9)))

    assert tilt(fan) < -20, "fan should be dominated by low frequencies"
    assert tilt(keys) > 20, "keyboard should be dominated by high frequencies"
    assert tilt(telly) < -10, "a television next door should be muffled"


def test_noise_sources_are_deterministic_and_bounded():
    for source in (pink_noise, lambda n, s=0: fan_noise(n, SR, s),
                   lambda n, s=0: keyboard_noise(n, SR, s),
                   lambda n, s=0: television_noise(n, SR, s)):
        first, second = source(SR), source(SR)
        assert np.array_equal(first, second)
        assert np.abs(first).max() <= 1.0 + 1e-6
        assert source(0).size == 0


# --------------------------------------------------------------------------
# Link degradations
# --------------------------------------------------------------------------

def test_codec_bandwidth_removes_everything_above_half_the_rate():
    x = speech_like()
    out = codec_bandwidth(x, SR, 8000)
    assert out.size == x.size
    above = band_energy(out, SR, 5000, 11000)
    below = band_energy(out, SR, 300, 3500)
    assert 20 * np.log10(above / below) < -40


def test_codec_bandwidth_is_a_no_op_at_or_above_the_source_rate():
    x = speech_like()
    assert np.array_equal(codec_bandwidth(x, SR, SR), x)
    assert np.array_equal(codec_bandwidth(x, SR, 0), x)


@pytest.mark.parametrize("bits", [4.0, 6.0, 8.0])
def test_bitcrush_quantises_to_the_requested_resolution(bits):
    x = speech_like()
    out = bitcrush(x, bits)
    distinct = np.unique(np.round(out / np.abs(out).max() * 2 ** bits))
    assert distinct.size <= 2 ** (bits + 1) + 2


def test_bitcrush_is_a_no_op_outside_its_range():
    x = speech_like()
    assert np.array_equal(bitcrush(x, 0), x)
    assert np.array_equal(bitcrush(x, 16), x)


def test_overdrive_clips_but_never_exceeds_full_scale():
    out = overdrive(speech_like(), 20.0)
    assert np.abs(out).max() <= 1.0
    # Clipping creates harmonics that were not in the source.
    assert band_energy(out, SR, 6000, 10000) > band_energy(speech_like(), SR, 6000, 10000)


def test_packet_loss_removes_frames_and_is_deterministic():
    x = speech_like(4.0)
    a = packet_loss(x, SR, 0.15, seed=3)
    b = packet_loss(x, SR, 0.15, seed=3)
    assert np.array_equal(a, b)
    assert np.count_nonzero(a == 0.0) > np.count_nonzero(x == 0.0)
    assert np.array_equal(packet_loss(x, SR, 0.0), x)


def test_microphone_response_cuts_bass_and_lifts_presence():
    x = speech_like()
    out = microphone_response(x, SR, presence_db=8.0, body_db=-10.0)
    bass = 20 * np.log10(max(band_energy(out, SR, 60, 150), 1e-9)
                         / max(band_energy(x, SR, 60, 150), 1e-9))
    presence = 20 * np.log10(max(band_energy(out, SR, 2800, 3400), 1e-9)
                             / max(band_energy(x, SR, 2800, 3400), 1e-9))
    assert bass < -10
    assert presence > 3


# --------------------------------------------------------------------------
# Profiles
# --------------------------------------------------------------------------

def test_off_profile_changes_nothing():
    x = speech_like()
    assert np.array_equal(PROFILES["Off"].apply(x, SR), x)


@pytest.mark.parametrize("name", [n for n in profile_names() if n != "Off"])
def test_every_profile_produces_sane_audio(name):
    x = speech_like()
    out = PROFILES[name].apply(x, SR)
    assert out.size == x.size
    assert np.all(np.isfinite(out))
    assert np.abs(out).max() <= 1.0
    # Must not come out far quieter than it went in, or it is inaudible
    # under a game.
    loudness = 20 * np.log10(max(float(np.sqrt(np.mean(out.astype(np.float64) ** 2))), 1e-9)
                             / max(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))), 1e-9))
    assert -8 < loudness < 8, f"{name} changed loudness by {loudness:.1f} dB"


def test_csgo_profiles_are_narrowband():
    x = speech_like()
    for name in ("CS:GO teammate", "CS:GO, awful mic"):
        out = PROFILES[name].apply(x, SR)
        above = band_energy(out, SR, 6000, 11000)
        inside = band_energy(out, SR, 400, 3000)
        assert 20 * np.log10(above / inside) < -25, name


def test_profiles_round_trip_through_a_dict():
    for name in profile_names():
        restored = CommsProfile.from_dict(PROFILES[name].to_dict())
        assert restored == PROFILES[name]
    # Unknown and malformed keys are tolerated, as saved settings age.
    assert CommsProfile.from_dict({"bogus": 1, "noise": "nonsense"}).noise == {}
    assert get_profile("does not exist").enabled is False


def test_empty_input_is_handled():
    empty = np.zeros(0, dtype=np.float32)
    for name in profile_names():
        assert PROFILES[name].apply(empty, SR).size == 0
