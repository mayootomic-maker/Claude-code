"""Real-time accent on your own voice.

The text-to-speech path replaces you with someone else. This does not: it
keeps your voice, your pitch and your timing, and moves only the thing
that carries most of an accent -- where your vowels sit.

Why this works. English has around eleven monophthongs; Russian has five
(/i e a o u/, plus a disputed sixth /ɨ/). A Russian speaker of English has
no separate slot for the extra six, so they land on the nearest Russian
vowel: /ɪ/ and /iː/ both come out as [i], which is "ship" said as "sheep";
/æ/ and /ɛ/ both come out as [e], which is "bad" said as "bed". Those are
not stylised effects, they are the actual substitutions, and they are
audible as *vowel positions*.

A vowel's identity is carried almost entirely by its first two formants:
F1 tracks tongue height, F2 tracks how far forward the tongue is. So the
substitution can be performed acoustically -- find where the speaker's
vowel currently sits in (F1, F2), find the Russian vowel nearest to it,
and warp the spectral envelope so the formants move there. Shifting F1 and
F2 towards another accent's averages is a known way to change *perceived*
accent, and because only the envelope moves and the excitation is
untouched, the pitch and glottal character that make the voice recognisably
yours survive intact.

None of this needs to know which word you are saying, so unlike the
accent-by-transcription path it runs live.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from .calibrate import levinson
from .consonants import ConsonantSettings, ConsonantShaper
from .phones import Frame, Phone, PhoneAnalyser

# --------------------------------------------------------------------------
# Vowel targets
# --------------------------------------------------------------------------

# English monophthongs, male averages, in Hz. Standard reference values:
# F1 rises as the tongue lowers, F2 falls as the tongue retracts.
ENGLISH_VOWELS: dict = {
    "i":  (280, 2230),   # beat
    "ɪ":  (370, 2090),   # bit
    "e":  (405, 2080),   # bait
    "ɛ":  (600, 1930),   # bet
    "æ":  (860, 1550),   # bat
    "ɑ":  (830, 1170),   # bot
    "ʌ":  (680, 1310),   # but
    "ɔ":  (560, 820),    # bought
    "o":  (430, 980),    # boat
    "ʊ":  (400, 1100),   # book
    "u":  (330, 1260),   # boot
}

# The five Russian vowels these collapse onto (Fant's classic measurements
# for a male speaker), plus /ɨ/, the retracted allophone of /i/ after a hard
# consonant -- the one that makes "ship" come out closer to "shyp".
RUSSIAN_VOWELS: dict = {
    "i": (240, 2250),
    "e": (440, 1800),
    "ɨ": (300, 1480),
    "a": (700, 1080),
    "o": (500, 850),
    "u": (300, 700),
}

# Which Russian vowel each English one lands on. This mapping is the accent:
# six English distinctions disappear.
SUBSTITUTIONS: dict = {
    "i": "i", "ɪ": "i",            # beat / bit  -> both [i]
    "e": "e", "ɛ": "e", "æ": "e",  # bait / bet / bat -> all [e]
    "ɑ": "a", "ʌ": "a",            # bot / but   -> both [a]
    "ɔ": "o", "o": "o",            # bought / boat -> both [o]
    "ʊ": "u", "u": "u",            # book / boot -> both [u]
}


def _build_target_table() -> List[Tuple[float, float, float, float]]:
    """``[(source F1, source F2, target F1, target F2), ...]``."""
    table = []
    for english, russian in SUBSTITUTIONS.items():
        source = ENGLISH_VOWELS[english]
        target = RUSSIAN_VOWELS[russian]
        table.append((float(source[0]), float(source[1]),
                      float(target[0]), float(target[1])))
    return table


TARGETS = _build_target_table()

# Classes the consonant stage owns. Everything else falls through to the
# vowel warp, nasals included -- they were treated as vowels before this
# existed and moving their formants does them no harm.
CONSONANT_PHONES = frozenset({Phone.R, Phone.W, Phone.L})

# Formant tracking. Speech formants live below about 4 kHz, so the analysis
# is band-limited there and the model order chosen to give roughly two
# poles per expected formant.
ANALYSIS_BAND_HZ = 4000.0
LPC_ORDER = 12
MIN_FORMANT_HZ = 180.0
MAX_FORMANT_HZ = 3400.0


def plausible_vowel(f1: float, f2: float) -> bool:
    """Could a human vowel actually sit at ``(f1, f2)``?

    The vowel space is a triangle, not a rectangle: the top-right corner is
    empty, because a tongue low enough to give a high F1 cannot also be far
    enough forward to give a high F2. Rejecting that corner catches the
    tracker's worst failures -- for a back vowel whose F1 and F2 are close
    together the two can merge into a single pole, and the pair returned is
    then a low formant and some higher resonance, which is confidently
    wrong rather than noisy. A frame that fails this is left unwarped.
    """
    if not (MIN_FORMANT_HZ <= f1 <= 1000.0):
        return False
    if not (600.0 <= f2 <= 2800.0):
        return False
    return f2 <= 3000.0 - 1.5 * f1


def nearest_target(f1: float, f2: float) -> Tuple[float, float]:
    """The Russian vowel position nearest to ``(f1, f2)``.

    Distance is measured in log-frequency, because that is much closer to
    how the ear judges vowel similarity than raw Hz -- 100 Hz matters
    enormously at F1 and not at all at F2.
    """
    if f1 <= 0 or f2 <= 0:
        return f1, f2
    best = None
    log1, log2 = math.log(f1), math.log(f2)
    for source_f1, source_f2, target_f1, target_f2 in TARGETS:
        distance = ((log1 - math.log(source_f1)) ** 2
                    + 0.6 * (log2 - math.log(source_f2)) ** 2)
        if best is None or distance < best[0]:
            best = (distance, target_f1, target_f2)
    return (best[1], best[2]) if best else (f1, f2)


# --------------------------------------------------------------------------
# Streaming vowel-space warping
# --------------------------------------------------------------------------

@dataclass
class AccentFxSettings:
    strength: float = 0.8         # 0 = untouched, 1 = fully on the Russian target
    enabled: bool = True
    # Cap on how far a formant may move, as a fraction of its own value.
    # Measured: at 0.35 the vowels still reach ~88% of the way to their
    # Russian targets while costing only 1.4 dB of harmonic structure; at
    # 0.6 the damage nearly doubles for almost no extra movement.
    max_shift: float = 0.4
    # The consonant substitutions -- the rolled r above all. See
    # dsp/consonants.py.
    consonants: ConsonantSettings = field(default_factory=ConsonantSettings)
    # Vocal-tract scale, 1.0 for an adult male. Every frequency threshold in
    # the phone detector is stated for that tract and multiplied by this, so
    # a voice of a different size is measured against its own numbers rather
    # than someone else's. `scale_from_formants` derives it from the voice
    # calibration the app already performs.
    scale: float = 1.0


class VowelSpaceWarper:
    """Moves a speaker's vowels onto Russian targets, frame by frame.

    Analysis and resynthesis are a plain overlap-added STFT. The spectral
    envelope is estimated by cepstral smoothing, its first two peaks are
    taken as F1 and F2, and the envelope is then warped along frequency by
    a piecewise-linear map that carries those two peaks to the Russian
    positions. The residual (the harmonics themselves) is divided out and
    multiplied back, so the pitch and the glottal source are untouched --
    which is what keeps it sounding like you.
    """

    def __init__(self, sample_rate: int, settings: Optional[AccentFxSettings] = None,
                 n_fft: int = 1024, hop: Optional[int] = None) -> None:
        self.sample_rate = sample_rate
        self.settings = settings or AccentFxSettings()
        self.n_fft = n_fft
        self.hop = hop or n_fft // 4
        self._window = np.hanning(n_fft + 1)[:n_fft].astype(np.float64)
        self._input = np.zeros(0, dtype=np.float32)
        self._output = np.zeros(n_fft, dtype=np.float64)
        self._norm = np.zeros(n_fft, dtype=np.float64)
        self._freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
        self._analysis_rate = 2.0 * ANALYSIS_BAND_HZ
        # Fade the correction out over the top octave of the modelled band.
        self._band_taper = np.clip(
            (ANALYSIS_BAND_HZ * 1.05 - self._freqs) / (ANALYSIS_BAND_HZ * 0.25),
            0.0, 1.0)
        self._smoothed: Optional[Tuple[float, float]] = None
        self._scale = self.settings.scale
        self._analyser = PhoneAnalyser(sample_rate, scale=self._scale)
        self._shaper = ConsonantShaper(sample_rate, self._freqs,
                                       self.settings.consonants, self._scale)

    def _rescale(self) -> None:
        """Rebuild the detector when calibration changes the tract size.

        Both objects precompute frequency masks from the scale, so a change
        has to be applied by rebuilding them, not by assignment.
        """
        if abs(self.settings.scale - self._scale) < 1e-6:
            return
        self._scale = self.settings.scale
        self._analyser = PhoneAnalyser(self.sample_rate, scale=self._scale)
        self._shaper = ConsonantShaper(self.sample_rate, self._freqs,
                                       self.settings.consonants, self._scale)

    def reset(self) -> None:
        self._input = np.zeros(0, dtype=np.float32)
        self._output = np.zeros(self.n_fft, dtype=np.float64)
        self._norm = np.zeros(self.n_fft, dtype=np.float64)
        self._smoothed = None
        self._analyser.reset()
        self._shaper.reset()

    @property
    def latency_samples(self) -> int:
        return self.n_fft

    # -- analysis ---------------------------------------------------------

    def _lpc(self, power: np.ndarray) -> Optional[np.ndarray]:
        """All-pole coefficients for one frame, from its power spectrum.

        The autocorrelation comes free from the power spectrum by the
        Wiener-Khinchin theorem; zeroing the band above the analysis limit
        and then resampling the lags is equivalent to decimating, which is
        what lets a low model order spend all its poles on speech.
        """
        band_limited = power.copy()
        band_limited[self._freqs > ANALYSIS_BAND_HZ] = 0.0
        autocorrelation = np.fft.irfft(band_limited)

        step = self.sample_rate / self._analysis_rate
        lags = np.arange(LPC_ORDER + 1) * step
        if lags[-1] >= autocorrelation.size:
            return None
        r = np.interp(lags, np.arange(autocorrelation.size), autocorrelation)
        if r[0] <= 1e-12:
            return None
        return levinson(r, LPC_ORDER)

    def _envelope_from_lpc(self, coefficients: np.ndarray) -> np.ndarray:
        """The all-pole model's own magnitude response, on the FFT grid.

        The envelope has to come from the *same* model as the formants.
        A cepstral envelope was used at first and its peaks sit in different
        places from the LPC roots -- warping one model's curve using the
        other model's landmarks tears the spectrum apart, which is what made
        vowels needing an upward F2 move end up far below where they started.
        """
        # The model was fitted to a signal decimated to _analysis_rate, so
        # its frequency axis runs 0..analysis_rate/2 = ANALYSIS_BAND_HZ.
        omega = np.pi * np.clip(self._freqs / ANALYSIS_BAND_HZ, 0.0, 1.0)
        z = np.exp(-1j * omega)
        response = np.zeros_like(z)
        for power_index, coefficient in enumerate(coefficients):
            response = response + coefficient * z ** power_index
        return 1.0 / np.maximum(np.abs(response), 1e-9)

    def _formants(self, coefficients: np.ndarray) -> Optional[Tuple[float, float]]:
        """F1 and F2 from the all-pole model's roots.

        Peak-picking a cepstral envelope was tried first and is not good
        enough: its ripple throws up spurious maxima between the real
        formants, and picking one of those puts the vowel in completely the
        wrong place -- /ɪ/ was read as F2 = 1200 Hz instead of 2090, which
        mapped it to /u/ and warped it away from its target. Linear
        prediction is the tool actually designed for this.
        """
        target_rate = self._analysis_rate
        try:
            roots = np.roots(coefficients)
        except (np.linalg.LinAlgError, ValueError):
            return None

        candidates = []
        for root in roots:
            if root.imag <= 0:
                continue
            magnitude = abs(root)
            if magnitude >= 1.0 or magnitude <= 1e-9:
                continue
            frequency = math.atan2(root.imag, root.real) * target_rate / (2 * math.pi)
            bandwidth = -math.log(magnitude) * target_rate / math.pi
            if MIN_FORMANT_HZ <= frequency <= MAX_FORMANT_HZ and bandwidth < 500:
                candidates.append(frequency)
        if len(candidates) < 2:
            return None
        candidates.sort()
        f1, f2 = candidates[0], candidates[1]
        if f2 <= f1 * 1.15:
            return None
        if not plausible_vowel(f1, f2):
            return None
        return float(f1), float(f2)

    # -- the warp ---------------------------------------------------------

    def _warp_map(self, f1: float, f2: float) -> np.ndarray:
        """Frequencies to read the old envelope at, for each output bin.

        A piecewise-linear map pinned at 0, F1, F2 and the Nyquist rate:
        everything between the formants is stretched or squeezed smoothly
        rather than jumping, which would tear the envelope apart.
        """
        settings = self.settings
        target_f1, target_f2 = nearest_target(f1, f2)
        strength = float(np.clip(settings.strength, 0.0, 1.0))

        def blend(current: float, target: float) -> float:
            moved = current + (target - current) * strength
            # Never move a formant by more than max_shift of its own value.
            lowest = current * (1.0 - settings.max_shift)
            highest = current * (1.0 + settings.max_shift)
            return float(np.clip(moved, lowest, highest))

        new_f1 = blend(f1, target_f1)
        new_f2 = blend(f2, target_f2)
        if new_f2 <= new_f1 * 1.05:
            new_f2 = new_f1 * 1.05

        nyquist = self.sample_rate / 2.0
        # Output positions -> where to sample the source envelope.
        knots_out = np.array([0.0, new_f1, new_f2, nyquist])
        knots_in = np.array([0.0, f1, f2, nyquist])
        return np.interp(self._freqs, knots_out, knots_in)

    def _process_frame(self, frame: np.ndarray) -> np.ndarray:
        spectrum = np.fft.rfft(frame * self._window)
        magnitude = np.abs(spectrum)
        self._shaper.settings = self.settings.consonants
        measured = self._analyser.previous or Frame()
        if not self.settings.enabled or magnitude.max() < 1e-7:
            self._shaper.spectrum(spectrum, measured)
            return np.fft.irfft(spectrum, self.n_fft)

        # A consonant is not a vowel: warping /r/ towards /a/ because its
        # formants happen to sit near one is exactly the artefact the phone
        # detector exists to prevent. Consonants get their own substitution
        # and skip the vowel stage entirely -- including its all-pole fit,
        # which they have no use for.
        if measured.phone in CONSONANT_PHONES:
            self._smoothed = None
            return np.fft.irfft(
                self._shaper.spectrum(spectrum, measured, self._band_taper),
                self.n_fft)
        self._shaper.spectrum(spectrum, measured)

        coefficients = self._lpc(magnitude ** 2)
        envelope = (self._envelope_from_lpc(coefficients)
                    if coefficients is not None else None)
        formants = self._formants(coefficients) if coefficients is not None else None
        if formants is None:
            self._smoothed = None
            return np.fft.irfft(spectrum, self.n_fft)

        # Smooth the estimate across frames: raw per-frame formants jitter,
        # and a jittering warp sounds like a bad chorus pedal.
        if self._smoothed is None:
            self._smoothed = formants
        else:
            alpha = 0.35
            self._smoothed = (
                self._smoothed[0] + alpha * (formants[0] - self._smoothed[0]),
                self._smoothed[1] + alpha * (formants[1] - self._smoothed[1]),
            )
        f1, f2 = self._smoothed

        assert envelope is not None
        source_positions = self._warp_map(f1, f2)
        warped = np.interp(source_positions, self._freqs, envelope)
        # Divide the old envelope out and multiply the new one in, leaving
        # the harmonics -- and therefore the speaker -- untouched.
        gain = np.clip(warped / np.maximum(envelope, 1e-9), 0.1, 10.0)
        # The model only describes the band it was fitted to; above that,
        # leave the signal alone, fading the correction out so there is no
        # step at the boundary.
        gain = 1.0 + (gain - 1.0) * self._band_taper
        return np.fft.irfft(spectrum * gain, self.n_fft)

    # -- streaming --------------------------------------------------------

    def process(self, block: np.ndarray) -> np.ndarray:
        arr = np.asarray(block, dtype=np.float32).reshape(-1)
        if arr.size == 0:
            return arr

        self._rescale()
        self._input = np.concatenate([self._input, arr])
        produced: List[np.ndarray] = []

        while self._input.size >= self.n_fft:
            # Advance the phone detector by exactly the samples about to be
            # consumed. It keeps its own longer window, so handing it the
            # whole overlapping frame each hop would feed it the same audio
            # four times over.
            self._analyser.analyse(self._input[:self.hop])
            frame = self._input[:self.n_fft].astype(np.float64)
            result = self._process_frame(frame) * self._window

            self._output[:self.n_fft] += result
            self._norm[:self.n_fft] += self._window * self._window

            ready = self._output[:self.hop]
            weight = self._norm[:self.hop]
            produced.append(np.divide(ready, weight, out=np.zeros_like(ready),
                                      where=weight > 1e-6))

            self._output = np.concatenate(
                [self._output[self.hop:], np.zeros(self.hop)])
            self._norm = np.concatenate(
                [self._norm[self.hop:], np.zeros(self.hop)])
            self._input = self._input[self.hop:]

        if not produced:
            return np.zeros(0, dtype=np.float32)
        out = np.concatenate(produced).astype(np.float32)
        # The roll is an amplitude modulation at 27 Hz -- a 37 ms cycle. It
        # has to be imposed on the output stream rather than per frame,
        # because the overlap-add would otherwise average it away.
        return self._shaper.modulate(out)
