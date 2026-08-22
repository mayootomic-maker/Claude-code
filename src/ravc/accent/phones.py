"""The shared phone inventory used by every accent language pack.

This is deliberately a union of what all the supported accents need, rather
than a strict phoneme set for any one language: /x/ exists for Russian, /ʁ/
and the front rounded vowels for German, and both share the Latin core.
Each language pack only ever emits the symbols it cares about.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Dict, Set

# --------------------------------------------------------------------------
# Inventory
# --------------------------------------------------------------------------

VOWELS: Set[str] = {
    "a", "e", "i", "o", "u",
    "y",    # Russian ы  (back unrounded)
    "oe",   # German  ö  /ø/
    "ue",   # German  ü  /y/
    "sch",  # schwa   ə
    "ax",   # near-open central ɐ (Russian pre-tonic reduction)
    "ar",   # German vocalised r  /ɐ/
}

CONSONANTS: Set[str] = {
    "p", "b", "t", "d", "k", "g",
    "f", "v", "s", "z", "sh", "zh", "x", "h",
    "ts", "ch", "dzh", "shch",
    "m", "n", "ng", "l",
    "r",    # apical trill (Russian)
    "R",    # uvular fricative (German)
    "j",
}

OBSTRUENTS: Set[str] = {
    "p", "b", "t", "d", "k", "g", "f", "v", "s", "z",
    "sh", "zh", "x", "ts", "ch", "shch", "dzh",
}

# Voiced obstruent -> its voiceless partner.  Both Russian and German devoice
# these at the end of a word, which is why the mapping lives here.
DEVOICED: Dict[str, str] = {
    "b": "p", "d": "t", "g": "k", "v": "f", "z": "s",
    "zh": "sh", "dzh": "ch",
}
REVOICED: Dict[str, str] = {v: k for k, v in DEVOICED.items()}

# Voiceless-only obstruents: they never trigger voicing in a cluster.
NO_VOICE_PARTNER: Set[str] = {"ts", "ch", "shch", "x"}

SONORANTS: Set[str] = {"m", "n", "ng", "l", "r", "R", "j"}

FRONT_VOWELS: Set[str] = {"i", "e", "oe", "ue"}


@dataclass(frozen=True)
class Phone:
    """One segment of accented speech."""

    sym: str
    soft: bool = False    # palatalised (Russian)
    stress: int = 0       # vowels: 1 primary, 2 secondary, 0 none
    long: bool = False    # German vowel length / geminate consonant

    @property
    def is_vowel(self) -> bool:
        return self.sym in VOWELS

    @property
    def is_consonant(self) -> bool:
        return self.sym in CONSONANTS

    @property
    def is_obstruent(self) -> bool:
        return self.sym in OBSTRUENTS

    @property
    def is_sonorant(self) -> bool:
        return self.sym in SONORANTS

    def with_sym(self, sym: str) -> "Phone":
        return replace(self, sym=sym)

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        mark = "ʲ" if self.soft else ""
        length = "ː" if self.long else ""
        accent = "́" if self.stress == 1 and self.is_vowel else ""
        return f"{self.sym}{mark}{length}{accent}"


def devoice(phone: Phone) -> Phone:
    return phone.with_sym(DEVOICED.get(phone.sym, phone.sym))


def revoice(phone: Phone) -> Phone:
    return phone.with_sym(REVOICED.get(phone.sym, phone.sym))
