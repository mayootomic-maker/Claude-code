"""Tests for the real-time accent.

The property that matters is narrow and checkable: vowels must move
towards their Russian counterparts, and the voice must survive doing it.
"""

from __future__ import annotations

import numpy as np
import pytest

from ravc.dsp.accentfx import (ENGLISH_VOWELS, GERMAN_SUBSTITUTIONS,
                               GERMAN_VOWELS, RUSSIAN_VOWELS, SUBSTITUTIONS,
                               AccentFxSettings, VowelSpaceWarper,
                               nearest_target, plausible_vowel)
from ravc.dsp.filters import Biquad, apply_offline
from ravc.dsp.phones import fit_lpc, formants_from_lpc

SR = 22050


def vowel(f1: float, f2: float, f0: float = 120.0,
          seconds: float = 1.2) -> np.ndarray:
    """A synthetic vowel with known formants and a known pitch."""
    n = int(SR * seconds)
    t = np.arange(n) / SR
    source = sum(np.sin(2 * np.pi * f0 * k * t) / (k ** 1.1)
                 for k in range(1, int(SR / 2 / f0)))
    stages = [Biquad.peaking(SR, f1, 22.0, 6.0),
              Biquad.peaking(SR, f2, 20.0, 7.0),
              Biquad.peaking(SR, 2600, 10.0, 6.0),
              Biquad.low_pass(SR, 5000)]
    out = apply_offline(stages, source.astype(np.float32), SR)
    return (out / np.abs(out).max() * 0.5).astype(np.float32)


def run(x: np.ndarray, settings: AccentFxSettings) -> np.ndarray:
    warper = VowelSpaceWarper(SR, settings)
    blocks = [warper.process(x[i:i + 256]) for i in range(0, len(x) - 256, 256)]
    return np.concatenate([b for b in blocks if b.size])


def track(x: np.ndarray):
    """Median (F1, F2), measured independently of the code under test.

    This used to call the warper's own tracker, and so measured the input
    and the output with the same ruler. That hid the fact that the ruler
    was wrong -- it reported /æ/ (860, 1550) as (216, 858) -- and the
    movement tests passed on self-consistency while the accent warped every
    vowel towards the wrong target. Measuring with `phones.fit_lpc`, which
    is tested directly against known formants, is the point.
    """
    f1s, f2s = [], []
    window = 2048
    for i in range(SR // 4, len(x) - window, 512):
        coefficients = fit_lpc(x[i:i + window], SR)
        if coefficients is None:
            continue
        found = formants_from_lpc(coefficients)
        if len(found) >= 2:
            f1s.append(found[0])
            f2s.append(found[1])
    return (float(np.median(f1s)), float(np.median(f2s))) if f1s else (0.0, 0.0)


def harmonic_ratio(x: np.ndarray, f0: float = 120.0) -> float:
    segment = x[SR // 3:SR // 3 + 8192]
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment))))
    freqs = np.fft.rfftfreq(len(segment), 1 / SR)
    mask = np.zeros(len(freqs), dtype=bool)
    for k in range(1, int(SR / 2 / f0)):
        mask |= np.abs(freqs - k * f0) < f0 * 0.2
    return 10 * np.log10(np.sum(spectrum[mask] ** 2)
                         / max(np.sum(spectrum[~mask] ** 2), 1e-12))


# --------------------------------------------------------------------------
# The vowel map
# --------------------------------------------------------------------------

def test_english_vowels_collapse_onto_the_russian_five():
    """The accent *is* this collapse: eleven distinctions become five."""
    assert len(ENGLISH_VOWELS) == 11
    landing = {SUBSTITUTIONS[v] for v in SUBSTITUTIONS}
    assert landing <= set(RUSSIAN_VOWELS)
    assert len(landing) == 5
    # The two substitutions people actually notice.
    assert SUBSTITUTIONS["ɪ"] == SUBSTITUTIONS["i"]      # ship -> sheep
    assert SUBSTITUTIONS["æ"] == SUBSTITUTIONS["ɛ"]      # bad  -> bed


def test_nearest_target_maps_each_english_vowel_somewhere_russian():
    russian_positions = {(f1, f2) for f1, f2 in RUSSIAN_VOWELS.values()}
    for f1, f2 in ENGLISH_VOWELS.values():
        assert nearest_target(f1, f2) in russian_positions


def test_plausible_vowel_rejects_the_empty_corner():
    """A tongue low enough for a high F1 cannot also be far enough forward
    for a high F2, so that corner of the space is empty."""
    assert plausible_vowel(860, 1550)     # real /æ/
    assert plausible_vowel(280, 2230)     # real /i/
    assert not plausible_vowel(818, 2597)  # impossible: tracker failure
    assert not plausible_vowel(120, 1000)  # F1 below the human range
    assert not plausible_vowel(400, 400)   # F2 below the human range


# --------------------------------------------------------------------------
# Formant tracking
# --------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["ɪ", "ɛ", "æ", "ɑ", "ʌ", "ʊ", "u"])
def test_tracker_finds_the_synthesised_formants(name):
    f1, f2 = ENGLISH_VOWELS[name]
    got_f1, got_f2 = track(vowel(f1, f2))
    assert abs(got_f1 - f1) / f1 < 0.20, (name, f1, got_f1)
    assert abs(got_f2 - f2) / f2 < 0.15, (name, f2, got_f2)


# --------------------------------------------------------------------------
# Warping
# --------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["ɪ", "ɛ", "æ", "ʌ", "ʊ", "u"])
def test_vowels_move_towards_their_russian_target(name):
    f1, f2 = ENGLISH_VOWELS[name]
    source = vowel(f1, f2)
    before_f1, before_f2 = track(source)
    target_f1, target_f2 = nearest_target(before_f1, before_f2)

    after_f1, after_f2 = track(run(source, AccentFxSettings(strength=1.0)))

    if abs(target_f2 - before_f2) > 30:
        progress = (after_f2 - before_f2) / (target_f2 - before_f2)
        assert progress > 0.35, (name, before_f2, target_f2, after_f2)
        assert progress < 1.8, ("overshot", name, before_f2, target_f2, after_f2)


def test_strength_scales_the_movement():
    f1, f2 = ENGLISH_VOWELS["æ"]
    source = vowel(f1, f2)
    before = track(source)[1]
    moves = []
    for strength in (0.0, 0.5, 1.0):
        after = track(run(source, AccentFxSettings(strength=strength)))[1]
        moves.append(abs(after - before))
    assert moves[0] < 40, "zero strength should barely move anything"
    assert moves[0] < moves[1] < moves[2] + 40, moves


def test_disabled_is_a_passthrough():
    """Once the overlap-add has filled, disabled output is the input.

    The first window's worth of samples is skipped: at the very start only
    one Hann window overlaps and its edge values are ~0, so there is
    nothing to normalise by and the stream fades in. That is inherent to
    overlap-add, lasts about 20 ms once, and is inaudible.
    """
    source = vowel(*ENGLISH_VOWELS["æ"])
    warper = VowelSpaceWarper(SR, AccentFxSettings(enabled=False))
    out = run(source, AccentFxSettings(enabled=False))
    settled = warper.n_fft
    shared = min(len(out), len(source))
    difference = np.abs(out[settled:shared] - source[settled:shared]).max()
    assert difference < 1e-3, difference


def test_startup_transient_is_short():
    """However long the fade-in is, it must not be a large fraction of a
    sentence -- a voice channel that swallows the first word is useless."""
    source = vowel(*ENGLISH_VOWELS["æ"])
    out = run(source, AccentFxSettings(enabled=False))
    loud = np.abs(out) > np.abs(source).max() * 0.25
    first_loud = int(np.argmax(loud)) if loud.any() else len(out)
    assert first_loud < SR * 0.06, f"{first_loud / SR * 1000:.0f} ms of silence"


@pytest.mark.parametrize("name", ["ɪ", "æ", "ʌ", "ʊ", "u"])
def test_the_voice_survives(name):
    """Pitch and harmonic structure must be preserved -- that is the whole
    point of doing it this way rather than with text-to-speech."""
    source = vowel(*ENGLISH_VOWELS[name])
    out = run(source, AccentFxSettings(strength=1.0))

    def period(x):
        segment = x[SR // 3:SR // 3 + 8192].astype(np.float64)
        segment = segment - segment.mean()
        correlation = np.correlate(segment, segment, "full")[len(segment) - 1:]
        low, high = int(SR / 300), int(SR / 60)
        return SR / (int(np.argmax(correlation[low:high])) + low)

    assert abs(period(out) - period(source)) < 3.0, "pitch changed"
    assert harmonic_ratio(out) > harmonic_ratio(source) - 6.0, "voice degraded"


def test_streaming_matches_regardless_of_block_size():
    """The audio callback hands over whatever size it likes."""
    source = vowel(*ENGLISH_VOWELS["æ"])
    settings = AccentFxSettings(strength=0.8)

    def stream(block_size):
        warper = VowelSpaceWarper(SR, settings)
        parts = [warper.process(source[i:i + block_size])
                 for i in range(0, len(source) - block_size, block_size)]
        return np.concatenate([p for p in parts if p.size])

    a, b = stream(256), stream(1024)
    shared = min(a.size, b.size)
    assert shared > SR // 2
    assert np.abs(a[:shared] - b[:shared]).max() < 0.05


def test_silence_and_noise_do_not_explode():
    for signal in (np.zeros(SR, dtype=np.float32),
                   (np.random.RandomState(0).randn(SR) * 0.3).astype(np.float32)):
        out = run(signal, AccentFxSettings(strength=1.0))
        assert np.all(np.isfinite(out))
        assert np.abs(out).max() < 4.0


def test_empty_block_is_handled():
    warper = VowelSpaceWarper(SR, AccentFxSettings())
    assert warper.process(np.zeros(0, dtype=np.float32)).size == 0


# --------------------------------------------------------------------------
# The two accents are different accents
# --------------------------------------------------------------------------

def test_german_keeps_the_vowels_russian_collapses():
    """Russian has five monophthongs; German has more than English.

    So a German accent is not a weaker Russian one. Almost nothing
    collapses -- what marks it out is the two vowels German lacks.
    """
    assert len(set(GERMAN_SUBSTITUTIONS.values())) == 9
    assert len(set(SUBSTITUTIONS.values())) == 5
    # ship / sheep merge in Russian and stay apart in German.
    assert SUBSTITUTIONS["ɪ"] == SUBSTITUTIONS["i"]
    assert GERMAN_SUBSTITUTIONS["ɪ"] != GERMAN_SUBSTITUTIONS["i"]
    # The German markers: no /æ/ ("bad" -> "bed") and no /ʌ/.
    assert GERMAN_SUBSTITUTIONS["æ"] == GERMAN_SUBSTITUTIONS["ɛ"] == "ɛ"
    assert GERMAN_SUBSTITUTIONS["ʌ"] == GERMAN_SUBSTITUTIONS["ɑ"] == "a"
    assert set(GERMAN_SUBSTITUTIONS.values()) <= set(GERMAN_VOWELS)
