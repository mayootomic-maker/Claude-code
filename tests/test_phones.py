"""Tests for live phone detection and the consonant substitutions.

Every signal here is synthesised from formants whose values are known, so
the assertions are about whether the code recovers the truth rather than
about whether it still does whatever it did last week. The numbers in the
docstrings and thresholds of `ravc.dsp.phones` came out of exactly these
measurements; these tests hold the code to them.
"""

from __future__ import annotations

import numpy as np
import pytest

from ravc.dsp.accentfx import (AccentFxSettings, ENGLISH_VOWELS,
                               VowelSpaceWarper, nearest_target)
from ravc.dsp.consonants import (ConsonantSettings, ConsonantShaper,
                                 TRILL_HZ, _move_resonance, _resonance)
from ravc.dsp.phones import (Frame, Phone, PhoneAnalyser, scale_from_formants,
                             smooth)

RATE = 48000
N = 4096
FREQS = np.fft.rfftfreq(N, 1.0 / RATE)
# Bandwidths widen with frequency, as real formants do.
BANDWIDTHS = [70.0, 110.0, 170.0, 250.0, 300.0]


def glottal(f0: float, n: int = N) -> np.ndarray:
    """A Rosenberg pulse train: the standard model of the voiced source.

    A harmonic stack with random phases has the same spectrum but a quite
    different autocorrelation, and linear prediction works on the
    autocorrelation -- fitted to one, formant error was 14-24%, to the
    other, 3-6%.
    """
    period = RATE / f0
    t = np.arange(n) % period / period
    open_quotient, speed = 0.6, 0.16
    pulse = np.zeros(n)
    rising = t < open_quotient
    pulse[rising] = 0.5 * (1 - np.cos(np.pi * t[rising] / open_quotient))
    falling = (t >= open_quotient) & (t < open_quotient + speed)
    pulse[falling] = np.cos(
        np.pi * (t[falling] - open_quotient) / (2 * speed))
    return np.diff(np.append(pulse[0], pulse))


def voiced(formants, f0: float = 110.0, amplitude: float = 0.3,
           n: int = N) -> np.ndarray:
    """A voiced sound with the given formants, by source-filter synthesis."""
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    s = 1j * freqs
    response = np.ones_like(s)
    for centre, bandwidth in zip(formants, BANDWIDTHS):
        response = response * (centre * centre
                               / (s * s + bandwidth * s + centre * centre))
    out = np.fft.irfft(np.fft.rfft(glottal(f0, n)) * response, n)
    return (amplitude * out / (np.abs(out).max() + 1e-12)).astype(np.float32)


def frication(low: float, high: float, amplitude: float,
              n: int = N) -> np.ndarray:
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    spectrum = np.fft.rfft(np.random.default_rng(7).standard_normal(n))
    spectrum[(freqs < low) | (freqs > high)] = 0.0
    out = np.fft.irfft(spectrum, n)
    return (amplitude * out / (np.abs(out).max() + 1e-12)).astype(np.float32)


VOWEL = [730.0, 1090.0, 2440.0, 3400.0, 4400.0]
SOUNDS = {
    "i":      [270.0, 2290.0, 3010.0, 3700.0, 4400.0],
    "a":      VOWEL,
    "u":      [300.0, 870.0, 2240.0, 3400.0, 4400.0],
    "e":      [530.0, 1840.0, 2480.0, 3500.0, 4400.0],
    "ae":     [660.0, 1720.0, 2410.0, 3400.0, 4400.0],
    "o":      [570.0, 840.0, 2410.0, 3400.0, 4400.0],
    "schwa":  [640.0, 1190.0, 2390.0, 3400.0, 4400.0],
    "m":      [280.0, 1100.0, 2400.0, 3400.0, 4400.0],
    "n":      [280.0, 1700.0, 2600.0, 3400.0, 4400.0],
    "j":      [270.0, 2100.0, 3000.0, 3600.0, 4400.0],
    "r":      [310.0, 1060.0, 1380.0, 3300.0, 4400.0],
    "r_mid":  [420.0, 1200.0, 1650.0, 3300.0, 4400.0],
    "r_weak": [490.0, 1350.0, 1750.0, 3300.0, 4400.0],
    "w":      [290.0, 610.0, 2150.0, 3400.0, 4400.0],
    "l":      [360.0, 1150.0, 2900.0, 3400.0, 4400.0],
    "l_dark": [400.0, 900.0, 2700.0, 3300.0, 4400.0],
}
EXPECTED = {
    "i": Phone.VOWEL, "a": Phone.VOWEL, "u": Phone.VOWEL, "e": Phone.VOWEL,
    "ae": Phone.VOWEL, "o": Phone.VOWEL, "schwa": Phone.VOWEL,
    "m": Phone.VOWEL, "n": Phone.VOWEL, "j": Phone.VOWEL,
    "r": Phone.R, "r_mid": Phone.R, "r_weak": Phone.R,
    "w": Phone.W, "l": Phone.L, "l_dark": Phone.L,
}
PITCHES = [95.0, 130.0, 175.0, 230.0]


def feed(analyser: PhoneAnalyser, signal: np.ndarray,
         block: int = 512) -> Frame:
    """Stream a sound in blocks, the way the live path does."""
    frame = Frame()
    for start in range(0, len(signal) - block + 1, block):
        frame = analyser.analyse(signal[start:start + block])
    return frame


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------

@pytest.mark.parametrize("f0", PITCHES)
def test_formants_are_recovered_within_a_few_per_cent(f0):
    """F1, F2 and F3 all come back, at every pitch an adult voice reaches.

    This is what fixes the model order at 12. At order 16 the spare poles
    invent wide shallow resonances below F1 that push every real formant a
    slot up the list, and this test fails by hundreds of Hz.
    """
    analyser = PhoneAnalyser(RATE)
    for name in ("i", "a", "u", "e", "ae", "l"):
        truth = SOUNDS[name]
        got = analyser._formants(voiced(truth, f0=f0).astype(np.float64))
        assert len(got) >= 3, (name, f0, got)
        for index in range(3):
            error = abs(got[index] - truth[index])
            # A formant cannot be located more finely than the harmonics
            # that reveal it. /u/'s F1 at 300 Hz spoken at 230 Hz lies
            # between the first and second harmonic, and no all-pole fit
            # will pin it down better than that -- the mean error over this
            # set is 2%, and every case above 8% is an F1 in that position.
            assert (error < 0.12 * truth[index] or error < f0 / 2.0), (
                name, f0, index, got[index], truth[index])


@pytest.mark.parametrize("f0", PITCHES)
def test_voicing_uses_periodicity_not_the_low_band(f0):
    """Open vowels are voiced too.

    Their F1 is above 400 Hz, so the "most energy below 400 Hz" shortcut
    calls /a/, /e/, /ae/ and /ʌ/ unvoiced. Periodicity does not.
    """
    analyser = PhoneAnalyser(RATE)
    for name in ("a", "e", "ae", "schwa", "i", "u"):
        frame = feed(analyser, voiced(SOUNDS[name], f0=f0))
        assert frame.voiced, (name, f0, frame.periodicity)
        assert frame.periodicity > 0.5
    for signal in (frication(3800.0, 11000.0, 0.30),
                   frication(1200.0, 9000.0, 0.30)):
        frame = feed(analyser, signal)
        assert not frame.voiced
        assert frame.periodicity < 0.35


@pytest.mark.parametrize("f0", PITCHES)
def test_the_r_cue_separates_r_from_everything_else(f0):
    """The 1.4-2.2 vs 2.2-3.4 kHz ratio is what /ɹ/ detection rests on.

    A low F3 vacates the band above it, and nothing else in English does.
    The margin measured 22 dB across sixteen sounds and four pitches.
    """
    analyser = PhoneAnalyser(RATE)
    dips = {name: feed(analyser, voiced(formants, f0=f0)).r_dip_db
            for name, formants in SOUNDS.items()}
    r_dips = [v for k, v in dips.items() if k.startswith("r")]
    other_dips = [v for k, v in dips.items() if not k.startswith("r")]
    assert min(r_dips) > max(other_dips) + 15.0, (f0, dips)
    assert min(r_dips) > 24.0, (f0, dips)


def test_quiet_fricatives_are_not_gated_away_as_silence():
    """/θ/ and /f/ run 25-30 dB below the vowels and must still register."""
    analyser = PhoneAnalyser(RATE)
    feed(analyser, voiced(VOWEL))
    frame = feed(analyser, frication(1400.0, 8000.0, 0.010))
    assert frame.phone is not Phone.SILENCE
    assert frame.phone is Phone.FRICATIVE


def test_sibilants_are_told_from_weak_fricatives_by_relative_level():
    """Relative intensity is the cue for fricative place, not spectrum shape.

    /f θ/ and /s ʃ/ overlap heavily in spectral shape; what separates them
    is that the sibilants are far louder than the non-sibilants.
    """
    analyser = PhoneAnalyser(RATE)
    for signal, expected in (
            (frication(3800.0, 11000.0, 0.30), Phone.SIBILANT),
            (frication(2200.0, 8000.0, 0.30), Phone.SIBILANT),
            (frication(1200.0, 9000.0, 0.012), Phone.FRICATIVE),
            (frication(1400.0, 8000.0, 0.010), Phone.FRICATIVE)):
        feed(analyser, voiced(VOWEL))       # warm the running level up
        frame = feed(analyser, signal)
        assert frame.phone is expected, (expected, frame.relative_db)


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------

@pytest.mark.parametrize("f0", PITCHES)
def test_every_sound_is_classified_correctly_at_every_pitch(f0):
    analyser = PhoneAnalyser(RATE)
    for name, formants in SOUNDS.items():
        frame = feed(analyser, voiced(formants, f0=f0))
        assert frame.phone is EXPECTED[name], (name, f0, frame.phone,
                                               frame.formants, frame.r_dip_db)


def test_silence_is_silence():
    analyser = PhoneAnalyser(RATE)
    assert feed(analyser, np.zeros(N, dtype=np.float32)).phone is Phone.SILENCE


@pytest.mark.parametrize("block", [256, 512, 1024, 2048])
def test_classification_does_not_depend_on_the_caller_s_block_size(block):
    """The analyser keeps its own window, so any block size gives the same
    answer -- otherwise the result would change with the audio device."""
    analyser = PhoneAnalyser(RATE)
    for name in ("a", "r", "w", "l", "i"):
        frame = feed(analyser, voiced(SOUNDS[name]), block=block)
        assert frame.phone is EXPECTED[name], (name, block, frame.phone)


@pytest.mark.parametrize("scale,pitches", [(1.0, (95.0, 130.0)),
                                           (1.17, (180.0, 220.0))])
def test_a_smaller_vocal_tract_still_works_once_scaled(scale, pitches):
    """Formants scale with tract length; the thresholds have to as well."""
    for f0 in pitches:
        analyser = PhoneAnalyser(RATE, scale=scale)
        for name in ("a", "i", "r", "w", "l"):
            formants = [f * scale for f in SOUNDS[name][:3]] + SOUNDS[name][3:]
            frame = feed(analyser, voiced(formants, f0=f0))
            assert frame.phone is EXPECTED[name], (name, scale, f0, frame.phone)


def test_noise_costs_detections_but_never_invents_them():
    """The failure direction matters more than the failure rate.

    A missed /ɹ/ is an effect that does not fire; a vowel wrongly called /ɹ/
    is an audible artefact in the middle of a word. Under noise this must
    only ever do the first.
    """
    rng = np.random.default_rng(11)
    for snr_db in (30.0, 20.0, 14.0):
        analyser = PhoneAnalyser(RATE)
        for name, formants in SOUNDS.items():
            if EXPECTED[name] is not Phone.VOWEL:
                continue
            clean = voiced(formants)
            noisy = clean + (rng.standard_normal(len(clean)).astype(np.float32)
                             * float(np.sqrt(np.mean(clean ** 2)))
                             * 10 ** (-snr_db / 20))
            frame = feed(analyser, noisy)
            assert frame.phone is not Phone.R, (name, snr_db)


def test_a_single_dissenting_frame_does_not_change_the_label():
    """Hysteresis, and it is not cosmetic.

    A steady /l/ whose label drops to "vowel" for a quarter of its frames
    comes back through the overlap-add at full strength: the substitution
    measured as barely applied even though every frame that kept the label
    had it applied correctly.
    """
    analyser = PhoneAnalyser(RATE)
    feed(analyser, voiced(SOUNDS["l"]))
    assert analyser.previous.phone is Phone.L
    # One frame of something else must not flip the label.
    analyser.analyse(voiced(SOUNDS["a"], n=512)[:512])
    assert analyser.previous.phone is Phone.L
    assert analyser.previous.raw_phone is not Phone.L


def test_scale_from_formants_needs_three_formants():
    assert scale_from_formants([]) == 1.0
    assert scale_from_formants([700.0, 1200.0]) == 1.0
    assert scale_from_formants([730.0, 1090.0, 2440.0]) == pytest.approx(1.0,
                                                                        abs=0.02)
    assert scale_from_formants([850.0, 1280.0, 2860.0]) > 1.1
    assert 0.8 <= scale_from_formants([100.0, 200.0, 300.0]) <= 1.6


def test_smooth_removes_single_frame_flickers():
    labels = [Phone.VOWEL, Phone.R, Phone.VOWEL, Phone.VOWEL]
    assert smooth(labels)[1] is Phone.VOWEL
    assert smooth([Phone.R, Phone.R])[0] is Phone.R


# --------------------------------------------------------------------------
# The substitutions
# --------------------------------------------------------------------------

def sustain(formants, f0: float = 110.0, seconds: float = 1.0) -> np.ndarray:
    tile = voiced(formants, f0=f0)
    count = int(RATE * seconds)
    return np.tile(tile, int(np.ceil(count / len(tile))))[:count]


def run(signal: np.ndarray, settings: AccentFxSettings,
        block: int = 480) -> np.ndarray:
    warper = VowelSpaceWarper(RATE, settings)
    return np.concatenate([warper.process(signal[i:i + block])
                           for i in range(0, len(signal), block)])


OFF = AccentFxSettings(enabled=False,
                       consonants=ConsonantSettings(enabled=False))
ON = AccentFxSettings(strength=0.8,
                      consonants=ConsonantSettings(strength=0.85))


def band_db(signal: np.ndarray, low: float, high: float) -> float:
    power = np.abs(np.fft.rfft(signal)) ** 2
    freqs = np.fft.rfftfreq(len(signal), 1.0 / RATE)
    band = (freqs >= low) & (freqs <= high)
    return float(10 * np.log10(power[band].sum() / power.sum() + 1e-20))


def modulation_depth(signal: np.ndarray, rate_hz: float) -> float:
    """How strongly the amplitude is modulated at ``rate_hz``."""
    envelope = np.convolve(np.abs(signal.astype(np.float64)),
                           np.ones(64) / 64, mode="same")
    envelope = envelope - envelope.mean()
    if not np.any(envelope):
        return 0.0
    spectrum = np.abs(np.fft.rfft(envelope * np.hanning(len(envelope))))
    freqs = np.fft.rfftfreq(len(envelope), 1.0 / RATE)
    peak = spectrum[(freqs > rate_hz - 4) & (freqs < rate_hz + 4)].max()
    floor = spectrum[(freqs > 5) & (freqs < 200)].mean()
    return float(peak / (floor + 1e-12))


def measured_formants(signal: np.ndarray):
    analyser = PhoneAnalyser(RATE)
    return feed(analyser, signal.astype(np.float32), block=2048).formants


def test_the_trill_imposes_amplitude_modulation_at_the_trill_rate():
    """A rolled r *is* an amplitude modulation at the tongue-contact rate."""
    signal = sustain(SOUNDS["r"])
    before = modulation_depth(run(signal, OFF), TRILL_HZ)
    after = modulation_depth(run(signal, ON), TRILL_HZ)
    assert after > before * 4.0, (before, after)
    assert after > 6.0


def test_the_trill_leaves_vowels_alone():
    signal = sustain(VOWEL)
    before = modulation_depth(run(signal, OFF), TRILL_HZ)
    after = modulation_depth(run(signal, ON), TRILL_HZ)
    assert after < before * 1.5, (before, after)


def test_the_trill_erases_the_english_r_signature():
    """Russian /r/ has no lowered F3, so the band it empties gets refilled."""
    signal = sustain(SOUNDS["r"])
    def dip(x):
        return band_db(x, 1400.0, 2200.0) - band_db(x, 2200.0, 3400.0)
    assert dip(run(signal, ON)) < dip(run(signal, OFF)) - 3.0


def test_w_gains_the_frication_that_makes_it_a_v():
    signal = sustain(SOUNDS["w"])
    before = band_db(run(signal, OFF), 1500.0, 6000.0)
    after = band_db(run(signal, ON), 1500.0, 6000.0)
    assert after > before + 4.0, (before, after)


def test_l_is_velarised_towards_the_russian_hard_l():
    """F2 drops by roughly a third: that is what velarisation is."""
    signal = sustain(SOUNDS["l"])
    before = measured_formants(run(signal, OFF))
    after = measured_formants(run(signal, ON))
    assert before[1] > 1050.0, before
    assert after[1] < 900.0, after


def test_a_vowel_s_formants_are_not_touched_by_the_consonant_stage():
    signal = sustain(VOWEL)
    only_consonants = AccentFxSettings(
        enabled=True, strength=0.0, consonants=ConsonantSettings(strength=0.85))
    before = measured_formants(run(signal, OFF))
    after = measured_formants(run(signal, only_consonants))
    assert abs(after[1] - before[1]) < 80.0, (before, after)


def test_each_substitution_can_be_switched_off_independently():
    signal = sustain(SOUNDS["r"])
    no_trill = AccentFxSettings(
        strength=0.8, consonants=ConsonantSettings(trill=False))
    assert modulation_depth(run(signal, no_trill), TRILL_HZ) < 6.0
    disabled = AccentFxSettings(
        strength=0.8, consonants=ConsonantSettings(enabled=False))
    assert modulation_depth(run(signal, disabled), TRILL_HZ) < 6.0


def test_settings_report_whether_anything_is_active():
    assert ConsonantSettings().any_active()
    assert not ConsonantSettings(enabled=False).any_active()
    assert not ConsonantSettings(trill=False, w_to_v=False,
                                 dark_l=False).any_active()


def test_the_output_stays_finite_and_bounded():
    """Whatever it is fed -- silence, noise, a pure tone -- nothing blows up."""
    tone = (0.4 * np.sin(2 * np.pi * 220 * np.arange(RATE) / RATE)).astype(np.float32)
    cases = [np.zeros(RATE, dtype=np.float32), tone,
             (np.random.default_rng(3).standard_normal(RATE) * 0.3).astype(np.float32),
             sustain(SOUNDS["r"]), sustain(SOUNDS["w"]), sustain(SOUNDS["l"])]
    for signal in cases:
        out = run(signal, ON)
        assert np.all(np.isfinite(out))
        assert np.abs(out).max() < 4.0


def test_a_resonance_move_only_touches_its_own_neighbourhood():
    """Why the warp map was replaced: it moved everything between anchors."""
    freqs = np.linspace(0.0, 8000.0, 2000)
    gain = _move_resonance(freqs, 1400.0, 2400.0)
    assert gain[np.argmin(np.abs(freqs - 2400.0))] > 1.5
    assert gain[np.argmin(np.abs(freqs - 1400.0))] < 0.7
    # F1 and F2 territory is left alone.
    for untouched in (300.0, 700.0):
        assert abs(gain[np.argmin(np.abs(freqs - untouched))] - 1.0) < 0.25
    assert np.all(np.isfinite(gain))
    assert np.allclose(_move_resonance(freqs, 1400.0, 1400.0), 1.0)
    assert np.allclose(_move_resonance(freqs, 0.0, 2400.0), 1.0)


def test_a_resonance_peaks_at_its_centre():
    freqs = np.linspace(0.0, 8000.0, 4000)
    response = _resonance(freqs, 1500.0)
    assert abs(freqs[int(np.argmax(response))] - 1500.0) < 60.0
    assert response[0] == pytest.approx(1.0, abs=0.01)


def test_the_shaper_needs_no_spectral_envelope():
    """Moving a resonance is analytic, so no envelope has to be estimated."""
    freqs = np.fft.rfftfreq(1024, 1.0 / RATE)
    shaper = ConsonantShaper(RATE, freqs, ConsonantSettings())
    spectrum = np.fft.rfft(voiced(SOUNDS["l"], n=1024) * np.hanning(1024))
    frame = Frame(phone=Phone.L, formants=(360.0, 1150.0, 2900.0))
    out = shaper.spectrum(spectrum, frame)
    assert np.all(np.isfinite(out))
    # F2 comes down, and F1 is left where it was.
    def at(spec, hz):
        return float(np.abs(spec[np.argmin(np.abs(freqs - hz))]))
    assert at(out, 1150.0) < at(spectrum, 1150.0) * 0.8
    assert at(out, 360.0) == pytest.approx(at(spectrum, 360.0), rel=0.25)
    # A frame with no substitution to make passes straight through.
    assert np.allclose(shaper.spectrum(spectrum, Frame(phone=Phone.VOWEL)),
                       spectrum)


def test_the_trill_oscillator_is_continuous_across_blocks():
    """A roll spanning several blocks has to stay one roll, not restart."""
    freqs = np.fft.rfftfreq(1024, 1.0 / RATE)
    shaper = ConsonantShaper(RATE, freqs, ConsonantSettings())
    shaper._target_depth = 1.0
    shaper._depth = 1.0
    ones = np.ones(4096, dtype=np.float32)
    joined = np.concatenate([shaper.modulate(ones[i:i + 512])
                             for i in range(0, 4096, 512)])
    shaper.reset()
    shaper._target_depth = 1.0
    shaper._depth = 1.0
    whole = shaper.modulate(ones)
    assert np.allclose(joined, whole, atol=1e-6)


def test_modulation_is_a_no_op_when_nothing_is_rolling():
    freqs = np.fft.rfftfreq(1024, 1.0 / RATE)
    shaper = ConsonantShaper(RATE, freqs, ConsonantSettings())
    block = np.ones(512, dtype=np.float32)
    assert np.allclose(shaper.modulate(block), block)
    assert shaper.modulate(np.zeros(0, dtype=np.float32)).size == 0


# --------------------------------------------------------------------------
# The vowel warp, measured with the tracker that is tested above
# --------------------------------------------------------------------------

VOWEL_TESTS = {
    "ɪ bit":   [370.0, 2090.0, 2600.0, 3400.0, 4400.0],
    "æ bad":   [860.0, 1550.0, 2400.0, 3400.0, 4400.0],
    "ʌ but":   [680.0, 1310.0, 2400.0, 3400.0, 4400.0],
    "u boot":  [300.0, 870.0, 2240.0, 3400.0, 4400.0],
    "ɔ bought": [570.0, 840.0, 2410.0, 3400.0, 4400.0],
}
VOWELS_ONLY = ConsonantSettings(enabled=False)


@pytest.mark.parametrize("language", ["russian", "german"])
def test_vowels_land_on_the_target_this_accent_uses(language):
    """The test that would have caught the formant tracker being broken.

    It was: the warper had its own all-pole fit with no pre-emphasis, which
    reported /æ/ (860, 1550) as (216, 858) -- F1 read as F2, behind an
    invented pole at 210 Hz. Every vowel was therefore matched to the wrong
    English vowel and warped towards the wrong target, and nothing caught
    it, because the tests measured the input and the output with that same
    tracker and so only ever checked it was self-consistent.
    """
    for name, formants in VOWEL_TESTS.items():
        signal = sustain(formants)
        source = measured_formants(run(signal, OFF))
        target = nearest_target(source[0], source[1], language)
        settings = AccentFxSettings(strength=1.0, language=language,
                                    consonants=VOWELS_ONLY)
        got = measured_formants(run(signal, settings))
        assert len(got) >= 2, (name, language, got)
        if abs(target[1] - source[1]) > 100.0:
            reached = ((got[1] - source[1]) / (target[1] - source[1]))
            assert reached > 0.7, (name, language, source, target, got)
        assert abs(got[1] - target[1]) < 220.0, (name, language, source,
                                                 target, got)


def test_the_two_accents_send_the_same_vowel_to_different_places():
    """/ɪ/ is the clearest case, and it is the accent difference itself.

    Russian has five vowels and merges /ɪ/ with /i/ -- "ship" said as
    "sheep". German has a slot for /ɪ/ and leaves it broadly alone.
    """
    signal = sustain(VOWEL_TESTS["ɪ bit"])

    def out(language):
        return measured_formants(run(signal, AccentFxSettings(
            strength=1.0, language=language, consonants=VOWELS_ONLY)))

    russian, german = out("russian"), out("german")
    assert russian[0] < german[0] - 60.0, (russian, german)
    assert russian[1] > german[1] + 100.0, (russian, german)


def test_every_english_vowel_has_a_target_in_both_accents():
    for vowel_symbol, (f1, f2) in ENGLISH_VOWELS.items():
        for language in ("russian", "german"):
            target = nearest_target(f1, f2, language)
            assert 200.0 < target[0] < 900.0, (vowel_symbol, language, target)
            assert 600.0 < target[1] < 2400.0, (vowel_symbol, language, target)
    # An unknown language falls back rather than raising in the audio thread.
    assert nearest_target(860.0, 1550.0, "klingon") == nearest_target(
        860.0, 1550.0, "russian")


# --------------------------------------------------------------------------
# German is a different accent, not a weaker Russian one
# --------------------------------------------------------------------------

def german(strength: float = 0.85) -> AccentFxSettings:
    return AccentFxSettings(strength=0.8, language="german",
                            consonants=ConsonantSettings(strength=strength))


def test_german_does_not_roll_the_r():
    """German /r/ is uvular. Rolling it would be a Russian speaking German."""
    signal = sustain(SOUNDS["r"])
    rolled = modulation_depth(run(signal, ON), TRILL_HZ)
    uvular = modulation_depth(run(signal, german()), TRILL_HZ)
    assert rolled > 6.0
    assert uvular < rolled / 3.0, (rolled, uvular)


def test_german_fricates_the_r_instead():
    """[ʁ] is a fricative, and a uvular constriction puts its noise low."""
    signal = sustain(SOUNDS["r"])
    plain = band_db(run(signal, OFF), 1600.0, 2600.0)
    uvular = band_db(run(signal, german()), 1600.0, 2600.0)
    assert uvular > plain + 3.0, (plain, uvular)


def test_both_accents_turn_w_into_v():
    """Neither language has /w/, so this one is shared."""
    signal = sustain(SOUNDS["w"])
    plain = band_db(run(signal, OFF), 1500.0, 6000.0)
    for settings in (ON, german()):
        assert band_db(run(signal, settings), 1500.0, 6000.0) > plain + 4.0


def test_german_leaves_the_l_clear():
    """German /l/ is close to the English one; velarising it would be wrong."""
    signal = sustain(SOUNDS["l"])
    plain = measured_formants(run(signal, OFF))[1]
    assert measured_formants(run(signal, ON))[1] < plain - 200.0
    assert measured_formants(run(signal, german()))[1] > plain - 100.0


def test_a_declined_consonant_is_left_alone_not_treated_as_a_vowel():
    """Switching a substitution off must not hand the sound to the vowel warp.

    A consonant is not a vowel whether or not there is a substitution for
    it, and the difference is audible: /l/ handed to the vowel stage lands
    on the nearest back vowel, which velarises it -- exactly the change
    German is declining to make.
    """
    for phone_name, off in (("r", ConsonantSettings(trill=False)),
                            ("l", ConsonantSettings(dark_l=False)),
                            ("w", ConsonantSettings(w_to_v=False))):
        signal = sustain(SOUNDS[phone_name])
        plain = measured_formants(run(signal, OFF))
        got = measured_formants(run(
            signal, AccentFxSettings(strength=1.0, consonants=off)))
        assert abs(got[1] - plain[1]) < 60.0, (phone_name, plain, got)

    # And the shaper still reports what it would do, for the caller's sake.
    shaper = ConsonantShaper(RATE, np.fft.rfftfreq(1024, 1.0 / RATE),
                             ConsonantSettings(trill=False))
    assert not shaper.handles(Phone.R)
    assert shaper.handles(Phone.W)
    assert not shaper.handles(Phone.VOWEL)
