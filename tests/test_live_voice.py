"""Tests for the promise Live mode actually makes: your voice, accented.

Two things went wrong here and neither was caught by anything, because
nothing tested the claim itself. Live borrowed the *character voice's*
pitch shift, so a fresh install moved the speaker down two semitones; and
the shifter it used modulated the amplitude by up to 20 per cent at a few
hertz, which is what "robotic" sounds like.
"""

from __future__ import annotations

import numpy as np
import pytest

from ravc.config import AppConfig
from ravc.dsp.filters import Biquad, apply_offline
from ravc.dsp.live import GranularPitchShifter, LiveProcessor
from ravc.realtime import LiveMode

from test_phones import BANDWIDTHS, RATE, frication, glottal

BLOCK = 960


def vowel(f0: float = 115.0, seconds: float = 3.0,
          formants=(730.0, 1090.0, 2440.0, 3400.0, 4400.0)) -> np.ndarray:
    n = int(RATE * seconds)
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    s = 1j * freqs
    response = np.ones_like(s)
    for centre, bandwidth in zip(formants, BANDWIDTHS):
        response = response * (centre * centre
                               / (s * s + bandwidth * s + centre * centre))
    out = np.fft.irfft(np.fft.rfft(glottal(f0, n)) * response, n)
    return (0.3 * out / (np.abs(out).max() + 1e-12)).astype(np.float32)


def stream(process, x, block: int = BLOCK) -> np.ndarray:
    return np.concatenate([process(x[i:i + block])
                           for i in range(0, len(x) - block, block)])


def modulation(x: np.ndarray, f0: float = 115.0) -> float:
    """Amplitude modulation in 2-40 Hz, as a fraction of the mean level.

    The low-pass matters. A moving average leaks the fundamental straight
    into the band, and measuring that way made an untouched signal look
    like it was modulated 200-fold.
    """
    audio = np.asarray(x, dtype=np.float32)
    mean = float(np.mean(np.abs(audio)))
    if mean <= 1e-9:
        return 0.0
    envelope = apply_offline([Biquad.low_pass(RATE, min(60.0, f0 / 2.0))] * 4,
                             np.abs(audio), RATE)
    envelope = envelope - envelope.mean()
    spectrum = np.abs(np.fft.rfft(envelope * np.hanning(len(envelope))))
    freqs = np.fft.rfftfreq(len(envelope), 1.0 / RATE)
    band = (freqs >= 2.0) & (freqs <= 40.0)
    return float(spectrum[band].max() / (mean * len(envelope) / 2))


def pitch_of(x: np.ndarray) -> float:
    segment = np.asarray(x[-16384:], dtype=np.float64)
    segment = segment - segment.mean()
    correlation = np.fft.irfft(np.abs(np.fft.rfft(segment)) ** 2)[:8192]
    low, high = int(RATE / 400), int(RATE / 60)
    return RATE / (low + int(np.argmax(correlation[low:high])))


SETTLED = int(RATE * 0.8)


# --------------------------------------------------------------------------
# Live keeps your voice
# --------------------------------------------------------------------------

def test_a_fresh_install_does_not_shift_your_pitch():
    """The regression that shipped in 1.4.0.

    `voice.fx` describes the character voice the *Full* path synthesises.
    Live was reading its pitch shift, so out of the box it moved the
    speaker down two semitones -- and Live's whole claim is that it keeps
    your voice.
    """
    config = AppConfig()
    assert config.voice.live_pitch_semitones == 0.0
    assert LiveMode(config)._settings().pitch_semitones == 0.0


def test_live_leaves_the_speaker_s_pitch_alone_by_default():
    config = AppConfig()
    processor = LiveProcessor(RATE, LiveMode(config)._settings())
    source = vowel()
    out = stream(processor.process, source)
    cents = 1200 * np.log2(pitch_of(out) / pitch_of(source))
    assert abs(cents) < 15.0, cents


def test_the_character_voice_still_shapes_the_full_path():
    """Separating the two must not disable the Full path's own voice."""
    config = AppConfig()
    assert config.voice.fx.pitch_semitones != 0.0


def test_live_pitch_is_still_available_when_asked_for():
    config = AppConfig()
    config.voice.live_pitch_semitones = -3.0
    settings = LiveMode(config)._settings()
    assert settings.pitch_semitones == -3.0
    out = stream(LiveProcessor(RATE, settings).process, vowel())
    cents = 1200 * np.log2(pitch_of(out) / 115.0)
    assert -400 < cents < -200, cents


# --------------------------------------------------------------------------
# The shifter, when it is used
# --------------------------------------------------------------------------

@pytest.mark.parametrize("f0", [85.0, 115.0, 165.0, 210.0])
@pytest.mark.parametrize("semitones", [-4.0, -2.0, 3.0])
def test_the_shifter_does_not_warble(f0, semitones):
    """Two taps half a grain apart comb-filter each other as the delay
    sweeps. Making the grain an even number of pitch periods stops it."""
    source = vowel(f0)
    out = stream(GranularPitchShifter(RATE, semitones).process, source)
    shifted = f0 * 2 ** (semitones / 12.0)
    assert modulation(out[SETTLED:], shifted) < 0.005, modulation(
        out[SETTLED:], shifted)


@pytest.mark.parametrize("f0", [85.0, 115.0, 210.0])
@pytest.mark.parametrize("semitones", [-4.0, -2.0, 3.0])
def test_the_shifter_still_shifts_by_what_it_was_asked(f0, semitones):
    """Snapping the read positions instead of the grain also kills the
    warble -- by cancelling the pitch shift, because reading in phase with
    the input reads the same waveform back. This is that guard."""
    out = stream(GranularPitchShifter(RATE, semitones).process, vowel(f0))
    want = f0 * 2 ** (semitones / 12.0)
    cents = 1200 * np.log2(pitch_of(out) / want)
    assert abs(cents) < 25.0, (f0, semitones, cents)


def test_the_grain_settles_on_an_even_number_of_pitch_periods():
    shifter = GranularPitchShifter(RATE, -2.0)
    source = vowel(115.0)
    for i in range(0, len(source) - BLOCK, BLOCK):
        shifter.process(source[i:i + BLOCK])
    periods = shifter.grain / (RATE / 115.0)
    assert abs(periods - round(periods)) < 0.05, periods
    assert round(periods) % 2 == 0, periods


def test_the_grain_only_glides_and_never_jumps():
    """A step in the grain moves the read position and clicks."""
    shifter = GranularPitchShifter(RATE, -2.0)
    source = vowel(115.0)
    grains = []
    for i in range(0, len(source) - BLOCK, BLOCK):
        shifter.process(source[i:i + BLOCK])
        grains.append(shifter.grain)
    steps = np.abs(np.diff(grains))
    assert steps.max() <= shifter.nominal_grain * 0.0121, steps.max()


def test_unvoiced_audio_keeps_its_grain_and_survives():
    """There is no period in frication, so there is nothing to snap to."""
    shifter = GranularPitchShifter(RATE, -2.0)
    noise = frication(3800.0, 11000.0, 0.3, n=int(RATE * 2))
    out = stream(shifter.process, noise)
    assert np.all(np.isfinite(out))
    assert 0.3 < float(np.sqrt(np.mean(out ** 2))
                       / np.sqrt(np.mean(noise ** 2))) < 2.0
    assert shifter.grain == pytest.approx(shifter.nominal_grain, rel=0.05)


def test_silence_stays_silent_and_zero_semitones_is_a_bypass():
    shifter = GranularPitchShifter(RATE, -2.0)
    quiet = stream(shifter.process, np.zeros(RATE, dtype=np.float32))
    assert float(np.abs(quiet).max()) == 0.0

    source = vowel(115.0)
    bypass = stream(GranularPitchShifter(RATE, 0.0).process, source)
    assert np.allclose(bypass, source[:len(bypass)])


def moving_pitch() -> np.ndarray:
    """A voice gliding 110 -> 160 -> 120 Hz, crossfaded at the joins."""
    parts = [vowel(f, seconds=0.7) for f in (110.0, 135.0, 160.0, 120.0)]
    source = np.concatenate(parts)
    fade = int(RATE * 0.03)
    ramp = np.hanning(2 * fade)[:fade].astype(np.float32)
    position = 0
    for _ in parts[:-1]:
        position += len(parts[0])
        source[position - fade:position] *= ramp[::-1]
        source[position:position + fade] *= ramp
    return source


def test_the_shifter_tracks_a_voice_whose_pitch_moves():
    """Real speech is not a steady tone; the grain has to follow it.

    Stated against the input rather than an absolute bound, because a
    signal whose pitch is moving is *already* modulated -- what matters is
    whether the shifter adds to it. It is also what fixes the glide rate:
    too slow and the grain cannot keep up, too fast and it chases the
    jitter in the period estimate.
    """
    source = moving_pitch()
    out = stream(GranularPitchShifter(RATE, -2.0).process, source)
    assert np.all(np.isfinite(out))
    before = modulation(source[SETTLED:], 120.0)
    after = modulation(out[SETTLED:], 120.0)
    assert after < before * 2.0, (before, after)


def test_the_grain_glide_is_fast_enough_to_be_worth_having():
    """The old fixed grain is the thing to beat, on a moving voice too."""
    source = moving_pitch()
    new = stream(GranularPitchShifter(RATE, -2.0).process, source)
    fixed = GranularPitchShifter(RATE, -2.0)
    fixed._glide_grain = lambda: None
    old = stream(fixed.process, source)
    assert (modulation(new[SETTLED:], 120.0)
            < modulation(old[SETTLED:], 120.0) * 0.75)


def test_the_period_estimate_is_sub_sample():
    """A whole-sample estimate is multiplied by the number of periods in a
    grain, so one sample of error becomes a dozen of grain wobble."""
    shifter = GranularPitchShifter(RATE, -2.0)
    source = vowel(157.0)          # deliberately not a whole-sample period
    for i in range(0, len(source) - BLOCK, BLOCK):
        shifter.process(source[i:i + BLOCK])
    period = shifter._track_period()
    assert abs(period - RATE / 157.0) < 1.0, period
    assert period != round(period)


def test_the_whole_default_chain_leaves_the_voice_recognisable():
    """End to end: same pitch, and nothing that reads as a machine."""
    config = AppConfig()
    processor = LiveProcessor(RATE, LiveMode(config)._settings())
    source = vowel()
    out = stream(processor.process, source)
    assert abs(1200 * np.log2(pitch_of(out) / pitch_of(source))) < 15.0
    assert modulation(out[SETTLED:]) < 0.01
    assert np.all(np.isfinite(out))
