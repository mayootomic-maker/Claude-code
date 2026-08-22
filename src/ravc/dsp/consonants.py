"""Live consonant substitutions.

Vowels carry most of an accent, but not the part people imitate. What makes
a Russian accent *recognisable* is the rolled r, and that is a consonant.
:mod:`ravc.dsp.phones` can now name the sounds this needs from a single
frame, so these can run live, on your own voice, without knowing the word.

Three substitutions are implemented, each because Russian phonology forces
it and each because the sound it applies to can be identified acoustically:

*The r.* Neither language has the English one, and they replace it with
opposite things, so this is two substitutions sharing a detector.

Russian /r/ is an alveolar trill: the tongue tip vibrates against the ridge,
2-3 contacts per segment, each briefly shutting the airflow. That is an
amplitude modulation at roughly 25-30 Hz -- the acoustic definition of a
trill, and what the ear hears as "rolled".

German /r/ is uvular, [ʁ]: a constriction right at the back of the mouth,
with audible friction and no contact at all. So it gets no modulation --
imposing one would make it Russian -- and instead gains turbulence low in
the spectrum, where a uvular constriction puts it.

Both share one change. The English /ɹ/'s signature is its very low F3, and
neither replacement has that, so both put F3 back up around 2400 Hz.

*/w/ becoming /v/.* Russian has no /w/, and the nearest thing in its
inventory is /v/, so "water" comes out "vater". /w/ is a voiced glide with
no frication; /v/ is a voiced labiodental fricative. The change is to add
frication in the band where /v/ has it and lift the spectrum out of the very
low F2 that makes a /w/ a /w/.

*The dark l.* Russian's plain /l/ is far more velarised than any English
/l/, tongue body pulled right back -- it is the "miluk" in a stage Russian
saying "milk". Velarisation is a large drop in F2, so this is a formant
move like the vowel warp, just applied to a consonant.

One substitution that belongs on this list is deliberately absent. Russians
famously replace /θ/ with /s/ ("sink" for "think"), but /θ/ cannot be told
from /f/ acoustically -- they are the classic confusable pair, near chance
from spectral cues, which is why English listeners mishear them too. A live
detector would turn "for" into "sor" as often as it fixed "think", so the
/θ/ substitution stays on the transcription path, where the word is known.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from .phones import Frame, Phone

RUSSIAN = "russian"
GERMAN = "german"

# Russian trill rate. Published measurements put the tongue-tip contact rate
# at roughly 25-30 Hz; below about 20 Hz it stops fusing into a roll and is
# heard as separate taps.
TRILL_HZ = 27.0
TRILL_FLOOR = 0.18       # how far the amplitude drops during a contact
TRILL_SHARPNESS = 4.0    # higher = briefer closures, longer open phases
RUSSIAN_R_F3_HZ = 2400.0
ENGLISH_R_F3_HZ = 1600.0    # fallback when the fit did not return an F3

# /v/ frication: a labiodental has a broad, weak, high-passed noise.
V_NOISE_BAND_HZ = (1500.0, 6000.0)
V_NOISE_LEVEL = 0.35        # relative to the frame's own magnitude

# The German uvular [ʁ]: friction from a constriction at the back of the
# mouth, which puts it far lower than any front fricative.
UVULAR_NOISE_BAND_HZ = (1000.0, 2600.0)
UVULAR_NOISE_LEVEL = 0.55
V_F2_LIFT = 1.35            # /w/'s F2 is ~610; /v/ has no such low resonance

# Velarisation. A Russian hard /l/ sits near 700 Hz where an English clear
# /l/ is near 1150, so F2 drops by roughly a third.
DARK_L_F2_HZ = 720.0


@dataclass
class ConsonantSettings:
    """Which substitutions to apply, and how hard."""

    enabled: bool = True
    trill: bool = True          # /ɹ/ -> rolled Russian /r/, or German [ʁ]
    w_to_v: bool = True         # /w/ -> /v/ (both languages lack /w/)
    dark_l: bool = True         # /l/ -> velarised hard /l/ (Russian only)
    strength: float = 0.85      # 0 = untouched, 1 = fully substituted

    def any_active(self) -> bool:
        return self.enabled and (self.trill or self.w_to_v or self.dark_l)


RESONANCE_Q = 8.0        # formant bandwidths run ~1/8 of centre frequency


def _resonance(freqs: np.ndarray, centre: float) -> np.ndarray:
    """Magnitude response of one formant resonance, flat at DC."""
    bandwidth = max(90.0, centre / RESONANCE_Q)
    return (centre * centre
            / np.abs(centre * centre - freqs * freqs
                     + 1j * bandwidth * freqs))


def _move_resonance(freqs: np.ndarray, old: float, new: float) -> np.ndarray:
    """Gain that takes a resonance at ``old`` and puts it at ``new``.

    This replaced a frequency-warping map, which is the obvious approach and
    the wrong one here. Warping stretches everything between two anchors, so
    moving F3 from 1372 Hz up to 2245 stretched the narrow F2-F3 valley by a
    factor of four and smeared F2's flank right across the 1.4-2.2 kHz band
    -- the band the substitution exists to empty. Measured, it made the /ɹ/
    signature *stronger*. Dividing out one resonance and multiplying in
    another touches only the two neighbourhoods and leaves the rest alone.
    """
    if old <= 0 or new <= 0 or abs(new - old) < 1.0:
        return np.ones_like(freqs)
    return _resonance(freqs, new) / np.maximum(_resonance(freqs, old), 1e-9)


class ConsonantShaper:
    """Applies the substitutions, frame by frame and sample by sample.

    Spectral changes (moving F3 for the trill, lifting /w/, darkening /l/)
    happen per STFT frame. The trill's amplitude modulation does not: at
    27 Hz a cycle is 37 ms, and imposing it frame-by-frame would let the
    overlap-add smear it back out. It is applied to the output stream
    instead, from a phase-continuous oscillator, so the roll survives.
    """

    RAMP_SECONDS = 0.012   # fade the trill in and out; a step would click

    def __init__(self, sample_rate: int, freqs: np.ndarray,
                 settings: Optional[ConsonantSettings] = None,
                 scale: float = 1.0, language: str = RUSSIAN) -> None:
        self.sample_rate = sample_rate
        self.settings = settings or ConsonantSettings()
        self.scale = float(scale)
        self.language = language
        self._freqs = freqs
        self._nyquist = sample_rate / 2.0
        self._noise_band = ((freqs >= V_NOISE_BAND_HZ[0] * self.scale)
                            & (freqs <= V_NOISE_BAND_HZ[1] * self.scale))
        self._uvular_band = ((freqs >= UVULAR_NOISE_BAND_HZ[0] * self.scale)
                             & (freqs <= UVULAR_NOISE_BAND_HZ[1] * self.scale))
        self._rng = np.random.default_rng(0x5253)
        self._phase = 0.0
        self._depth = 0.0
        self._target_depth = 0.0
        self._taper: Optional[np.ndarray] = None

    def reset(self) -> None:
        self._phase = 0.0
        self._depth = 0.0
        self._target_depth = 0.0

    def handles(self, phone: Phone) -> bool:
        """Will this shaper substitute ``phone``, given its settings?"""
        settings = self.settings
        if not settings.enabled:
            return False
        if phone is Phone.R:
            return settings.trill
        if phone is Phone.W:
            return settings.w_to_v
        if phone is Phone.L:
            return settings.dark_l and self.language != GERMAN
        return False

    # -- per-frame spectral work ------------------------------------------

    def spectrum(self, spectrum: np.ndarray, frame: Frame,
                 taper: Optional[np.ndarray] = None) -> np.ndarray:
        """Return ``spectrum`` with this frame's consonant substitution.

        Needs no spectral envelope, which is worth saying because the two
        earlier attempts did. Warping an envelope requires estimating one,
        and both estimators fail here: a cepstral envelope cannot resolve
        110 Hz harmonics in a 21 ms frame, so its ratio came out a comb that
        lifted the spectral nulls by 50 dB, and an all-pole one costs a fit
        per frame. Moving a resonance analytically needs neither.
        """
        settings = self.settings
        if not settings.enabled:
            self._target_depth = 0.0
            return spectrum
        strength = float(np.clip(settings.strength, 0.0, 1.0))

        rolling = (settings.trill and frame.phone is Phone.R
                   and self.language != GERMAN)
        self._target_depth = strength if rolling else 0.0
        self._taper = taper

        if frame.phone is Phone.R and settings.trill:
            # Put F3 back where a non-English /r/ has it. The English /ɹ/'s
            # signature *is* the lowered F3, so undoing it is most of what
            # stops the sound reading as English, in either accent.
            source = frame.f3 if frame.f3 > 0 else ENGLISH_R_F3_HZ * self.scale
            target = source + (RUSSIAN_R_F3_HZ * self.scale - source) * strength
            moved = self._warp(spectrum, frame.formants, 2, target)
            if self.language == GERMAN:
                # [ʁ] is a fricative, and the modulation stays off: a
                # rolled German r is a Russian speaking German.
                return self._fricate(moved, strength, self._uvular_band,
                                     UVULAR_NOISE_LEVEL)
            return moved

        if frame.phone is Phone.W and settings.w_to_v:
            lifted = self._warp(spectrum, frame.formants, 1,
                                frame.f2 * (1.0 + (V_F2_LIFT - 1.0) * strength))
            return self._fricate(lifted, strength)

        if (frame.phone is Phone.L and settings.dark_l
                and self.language != GERMAN):
            # German /l/ is clear, close to the English one; velarising it
            # would be importing a Russian feature.
            target = DARK_L_F2_HZ * self.scale
            return self._warp(spectrum, frame.formants, 1,
                              frame.f2 + (target - frame.f2) * strength)
        return spectrum

    def _warp(self, spectrum: np.ndarray, formants: Sequence[float],
              index: int, target: float) -> np.ndarray:
        """Move formant ``index`` to ``target``, holding the others still."""
        source = [f for f in formants if f > 0]
        if index >= len(source):
            return spectrum
        target = float(np.clip(target, 150.0, self._nyquist * 0.9))
        gain = np.clip(_move_resonance(self._freqs, source[index], target),
                       0.1, 10.0)
        if self._taper is not None:
            # The all-pole model only describes the band it was fitted to;
            # fade the correction out above it rather than stepping.
            gain = 1.0 + (gain - 1.0) * self._taper
        return spectrum * gain

    def _fricate(self, spectrum: np.ndarray, strength: float,
                 band: Optional[np.ndarray] = None,
                 level: float = V_NOISE_LEVEL) -> np.ndarray:
        """Add frication in ``band`` -- what makes a fricative not a glide."""
        band = self._noise_band if band is None else band
        if not band.any():
            return spectrum
        # Measured against the whole frame, not against the band itself: a
        # /w/ has almost no energy up there, so a fraction of the band's own
        # level is a fraction of nothing and added just 1 dB. What makes a
        # /v/ audible as a fricative is frication loud relative to the voice.
        reference = float(np.abs(spectrum).mean())
        if reference <= 0.0:
            return spectrum
        level = reference * level * strength
        phase = self._rng.uniform(0.0, 2 * math.pi, int(band.sum()))
        out = spectrum.copy()
        out[band] = out[band] + level * np.exp(1j * phase)
        return out

    # -- the roll ---------------------------------------------------------

    def modulate(self, block: np.ndarray) -> np.ndarray:
        """Impose the trill's amplitude modulation on output samples.

        The depth follows the detector with a short ramp rather than
        switching, and the oscillator phase carries across calls, so a roll
        spanning several blocks stays one continuous roll.
        """
        arr = np.asarray(block, dtype=np.float32)
        if arr.size == 0 or not self.settings.enabled:
            return arr
        if self._depth <= 1e-4 and self._target_depth <= 1e-4:
            self._phase = 0.0
            return arr

        count = arr.size
        step = 1.0 / max(1.0, self.RAMP_SECONDS * self.sample_rate)
        depths = np.clip(
            self._depth + np.arange(1, count + 1)
            * (step if self._target_depth > self._depth else -step),
            min(self._depth, self._target_depth),
            max(self._depth, self._target_depth))
        self._depth = float(depths[-1])

        increment = 2 * math.pi * TRILL_HZ / self.sample_rate
        phases = self._phase + increment * np.arange(1, count + 1)
        self._phase = float(phases[-1] % (2 * math.pi))

        # A narrow dip per cycle: the tongue is clear of the ridge for most
        # of it and shuts the airflow briefly, which is what a trill is.
        closure = ((1.0 + np.cos(phases)) * 0.5) ** TRILL_SHARPNESS
        envelope = 1.0 - depths * (1.0 - TRILL_FLOOR) * closure
        return (arr * envelope).astype(np.float32)
