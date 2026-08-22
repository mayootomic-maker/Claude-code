"""The generic accent engine.

English phonemes go in, the phonemes a non-native speaker actually produces
come out.  Which substitutions apply is entirely decided by the
:class:`~ravc.accent.languages.base.LanguagePack` passed in, so adding an
accent means writing a pack, not touching this file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from ..phonetics.arpabet import split_stress
from .languages import DEFAULT_LANGUAGE, get_pack
from .languages.base import AccentProfile, Context, LanguagePack
from .phones import (CONSONANTS, DEVOICED, FRONT_VOWELS, OBSTRUENTS, Phone,
                     REVOICED, VOWELS)

__all__ = ["AccentProfile", "AccentedWord", "Context", "LanguagePack", "Phone",
           "accentify_word", "russify_word", "default_profile", "VOWELS"]

# --------------------------------------------------------------------------
# Spelling-driven vowel restoration
# --------------------------------------------------------------------------

_VOWEL_GROUP_RE = re.compile(r"[aeiouy]+", re.I)
_QU_RE = re.compile(r"(?<=[qg])u(?=[aeiouy])", re.I)

# What vowel a non-native reader takes an English vowel spelling to be.
_SPELLING_VOWEL: Dict[str, str] = {
    "a": "a", "e": "e", "i": "i", "o": "o", "u": "u", "y": "i",
    "ou": "u", "ow": "o", "oo": "u", "ee": "i", "ea": "e", "ie": "i",
    "ai": "a", "ay": "e", "au": "a", "aw": "o", "eu": "e", "eo": "e",
    "io": "i", "ia": "i", "ua": "u", "ui": "u", "oa": "o", "oe": "o",
    "ei": "e", "ey": "e", "oi": "o", "oy": "o", "uo": "u", "iu": "i",
}


def spelling_vowels(word: str) -> List[str]:
    """Vowel letter-groups of ``word``, mapped to phone symbols.

    The <u> of <qu>/<gu> is part of the consonant, not a vowel: without
    stripping it, "quick" aligns its vowel to <ui> and comes out "kvuk".
    """
    stripped = _QU_RE.sub("", word)
    out: List[str] = []
    for group in _VOWEL_GROUP_RE.findall(stripped.lower()):
        out.append(_SPELLING_VOWEL.get(group,
                                       _SPELLING_VOWEL.get(group[0], "a")))
    return out


# --------------------------------------------------------------------------
# Word-level conversion
# --------------------------------------------------------------------------

@dataclass
class AccentedWord:
    original: str
    phones: List[Phone] = field(default_factory=list)
    trailing_punct: str = ""


def default_profile(language: str = DEFAULT_LANGUAGE,
                    strength: float = 1.0) -> AccentProfile:
    return get_pack(language).profile(strength)


def accentify_word(word: str, phones: Sequence[str],
                   pack: Optional[LanguagePack] = None,
                   profile: Optional[AccentProfile] = None) -> List[Phone]:
    """Convert one word's ARPAbet phones into accented phones."""
    pack = pack or get_pack(DEFAULT_LANGUAGE)
    profile = profile or pack.profile()

    spelling = spelling_vowels(word) if pack.spelling_pronunciation else []
    vowel_index = 0
    total = len(phones)

    symbols: List[str] = []
    stresses: List[int] = []

    for i, arp in enumerate(phones):
        base, stress = split_stress(arp)
        ctx = Context(
            word=word, index=i, total=total,
            prev_arp=phones[i - 1] if i > 0 else None,
            next_arp=phones[i + 1] if i + 1 < total else None,
            spelling_vowel=(spelling[vowel_index]
                            if vowel_index < len(spelling) else None),
        )
        if _is_vowel_phoneme(base):
            vowel_index += 1
            mapped = pack.map_vowel(base, max(stress, 0), profile, ctx)
        else:
            mapped = pack.map_consonant(base, profile, ctx)
            stress = -1

        for sym in mapped:
            symbols.append(sym)
            stresses.append(max(stress, 0) if sym.rstrip(":") in VOWELS else 0)

    # A trailing ":" is how a pack marks a phonemically long vowel, so that
    # length is decided by the substitution itself rather than guessed from
    # syllable shape afterwards.
    out = []
    for sym, st in zip(symbols, stresses):
        long = sym.endswith(":")
        out.append(Phone(sym=sym.rstrip(":"), stress=st, long=long))
    for process in pack.post_processes:
        out = process(out, profile)
    return out


_ENGLISH_VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
                   "IH", "IY", "OW", "OY", "UH", "UW"}


def _is_vowel_phoneme(base: str) -> bool:
    return base in _ENGLISH_VOWELS


def russify_word(word: str, phones: Sequence[str],
                 profile: Optional[AccentProfile] = None) -> List[Phone]:
    """Backwards-compatible shortcut for the Russian pack."""
    pack = get_pack("russian")
    return accentify_word(word, phones, pack, profile or pack.profile())


def accentify_words(words: Sequence[Tuple[str, Sequence[str]]],
                    pack: Optional[LanguagePack] = None,
                    profile: Optional[AccentProfile] = None
                    ) -> List[AccentedWord]:
    return [AccentedWord(original=w, phones=accentify_word(w, ph, pack, profile))
            for w, ph in words]
