"""Render accented phone sequences into the three target notations.

* :func:`to_native_text` -- text the accent's own TTS language can read.
  This is the trick that makes the whole thing work: a native Russian
  neural voice reading "зис ис зэ бэст" produces authentic Russian-accented
  English, complete with details no amount of DSP can fake -- the missing
  aspiration on stops, the apical trill, the vowel qualities.
* :func:`to_ipa` -- espeak-style IPA, used to drive Piper voices directly
  through their phoneme table, bypassing text normalisation entirely.
* :func:`to_eye_dialect` -- readable Latin spelling for the subtitle strip
  ("Ay vant to tok viz yu").
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Sequence

from .languages import DEFAULT_LANGUAGE, get_pack
from .languages.base import LanguagePack
from .phones import Phone

PRIMARY_STRESS = "ˈ"
SECONDARY_STRESS = "ˌ"
LENGTH_MARK = "ː"
PALATAL_MARK = "ʲ"


def _pack(pack: Optional[LanguagePack]) -> LanguagePack:
    return pack or get_pack(DEFAULT_LANGUAGE)


def to_native_text(phones: Sequence[Phone], pack: Optional[LanguagePack] = None,
                   mark_stress: bool = False) -> str:
    return _pack(pack).render_text(phones, mark_stress)


# Kept as a name because the Russian path is the common one.
def to_cyrillic(phones: Sequence[Phone], mark_stress: bool = False) -> str:
    return get_pack("russian").render_text(phones, mark_stress)


# --------------------------------------------------------------------------
# IPA
# --------------------------------------------------------------------------

def to_ipa(phones: Sequence[Phone], pack: Optional[LanguagePack] = None,
           mark_stress: bool = True) -> List[List[str]]:
    """Return one preference list per output symbol.

    The Piper backend resolves each preference list against the loaded
    voice's own phoneme inventory, so a voice that spells /ʃ/ as ``ʂ`` and
    one that spells it ``ʃ`` both work from the same renderer.
    """
    language = _pack(pack)
    ipa_map = language.ipa_map
    ipa_long = language.ipa_long

    symbols: List[List[str]] = []
    stressed_at: Optional[int] = None
    secondary_at: Optional[int] = None
    for i, p in enumerate(phones):
        if not p.is_vowel:
            continue
        if p.stress == 1 and stressed_at is None:
            stressed_at = i
        elif p.stress == 2 and secondary_at is None:
            secondary_at = i

    def onset_of(vowel_idx: int) -> int:
        """Start of the stressed syllable, under a maximal-onset rule."""
        j = vowel_idx
        while j > 0 and not phones[j - 1].is_vowel and vowel_idx - j < 2:
            j -= 1
        # A sonorant at the front of a two-consonant onset belongs to the
        # previous syllable's coda: com-PU-ter, not co-MPU-ter.
        if vowel_idx - j == 2 and phones[j].is_sonorant:
            j += 1
        return j

    stress_positions = {}
    if mark_stress and stressed_at is not None:
        stress_positions[onset_of(stressed_at)] = PRIMARY_STRESS
    if mark_stress and secondary_at is not None:
        stress_positions.setdefault(onset_of(secondary_at), SECONDARY_STRESS)

    for i, p in enumerate(phones):
        if i in stress_positions:
            symbols.append([stress_positions[i]])

        base = ipa_map.get(p.sym)
        if base is None:
            continue

        if p.is_vowel:
            candidates: List[str] = []
            if p.long:
                long_base = ipa_long.get(p.sym, base)
                if language.mark_length:
                    candidates.extend(c + LENGTH_MARK for c in long_base)
                candidates.extend(long_base)
            candidates.extend(base)
            symbols.append(_dedupe(candidates))
            continue

        if p.soft and p.sym != "j":
            symbols.append(_dedupe([c + PALATAL_MARK for c in base] + list(base)))
        else:
            symbols.append(list(base))
    return symbols


def _dedupe(items: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


# --------------------------------------------------------------------------
# Latin eye-dialect (display only)
# --------------------------------------------------------------------------

_INHERENTLY_SOFT = {"ch", "shch", "dzh", "j"}


def to_eye_dialect(phones: Sequence[Phone],
                   pack: Optional[LanguagePack] = None) -> str:
    """A readable Latin approximation, for the live subtitle strip."""
    language = _pack(pack)
    latin = language.latin_map
    latin_long = language.latin_long
    out: List[str] = []
    n = len(phones)
    for i, p in enumerate(phones):
        nxt = phones[i + 1] if i + 1 < n else None
        letter = latin.get(p.sym)
        if letter is None:
            continue

        if p.is_vowel:
            # Long vowels get their digraph; short ones stay short, so the
            # subtitles distinguish "sheep" from "ship".
            if p.long and p.sym in latin_long:
                letter = latin_long[p.sym]
            out.append(letter)
            continue

        if p.sym == "j" and nxt is not None and nxt.is_vowel:
            out.append("y")
            continue
        out.append(letter)
        if (p.soft and p.sym not in _INHERENTLY_SOFT
                and nxt is not None and nxt.is_vowel and nxt.sym != "i"):
            out.append("y")
    return "".join(out)


def join_words(rendered: Iterable[str], separator: str = " ") -> str:
    return separator.join(r for r in rendered if r)
