"""ARPAbet phoneme inventory and helpers.

The whole accent engine works on phoneme sequences rather than letters,
because English spelling tells you almost nothing about how a Russian
speaker will mangle a word.  ARPAbet is used as the interchange format
because that is what CMUdict ships and what the letter-to-sound fallback
in :mod:`ravc.phonetics.lts` produces.
"""

from __future__ import annotations

from typing import Iterable, List, Tuple

# --------------------------------------------------------------------------
# Inventory
# --------------------------------------------------------------------------

VOWELS = {
    "AA",  # f-a-ther     ɑ
    "AE",  # c-a-t        æ
    "AH",  # b-u-t / comm-a  ʌ / ə  (stress digit disambiguates)
    "AO",  # th-ough-t    ɔ
    "AW",  # c-ow         aʊ
    "AY",  # h-i-de       aɪ
    "EH",  # b-e-d        ɛ
    "ER",  # b-ir-d       ɝ
    "EY",  # s-ay         eɪ
    "IH",  # b-i-t        ɪ
    "IY",  # b-ea-t       i
    "OW",  # b-oa-t       oʊ
    "OY",  # b-oy         ɔɪ
    "UH",  # b-oo-k       ʊ
    "UW",  # b-oo-t       u
}

CONSONANTS = {
    "B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG",
    "P", "R", "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH",
}

PHONEMES = VOWELS | CONSONANTS

# Obstruents that have a voiced/voiceless partner.  Russian devoices every
# voiced obstruent at the end of a word ("Auslautverhaertung"), and the habit
# carries straight over into English: dog -> "dok", was -> "vas".
DEVOICE_MAP = {
    "B": "P",
    "D": "T",
    "G": "K",
    "V": "F",
    "Z": "S",
    "ZH": "SH",
    "JH": "CH",
    "DH": "TH",
}
VOICE_MAP = {v: k for k, v in DEVOICE_MAP.items()}

VOICED_OBSTRUENTS = set(DEVOICE_MAP)
VOICELESS_OBSTRUENTS = set(VOICE_MAP)
SONORANTS = {"L", "M", "N", "NG", "R", "W", "Y"}

# Consonants a Russian speaker palatalises before a front vowel or /j/.
PALATALISABLE = {"T", "D", "N", "S", "Z", "L", "R", "P", "B", "M", "F", "V", "K", "G"}

FRONT_VOWELS = {"IY", "IH", "EY", "EH", "AE"}


# --------------------------------------------------------------------------
# Stress handling
# --------------------------------------------------------------------------

def split_stress(phone: str) -> Tuple[str, int]:
    """Split ``"AH0"`` into ``("AH", 0)``.  Consonants get stress ``-1``."""
    if phone and phone[-1].isdigit():
        return phone[:-1], int(phone[-1])
    return phone, -1


def strip_stress(phones: Iterable[str]) -> List[str]:
    return [split_stress(p)[0] for p in phones]


def is_vowel(phone: str) -> bool:
    return split_stress(phone)[0] in VOWELS


def is_consonant(phone: str) -> bool:
    return split_stress(phone)[0] in CONSONANTS


def is_schwa(phone: str) -> bool:
    """True for a genuinely reduced vowel (unstressed AH / IH / ER)."""
    base, stress = split_stress(phone)
    return stress == 0 and base in {"AH", "IH", "ER", "UH"}


def count_syllables(phones: Iterable[str]) -> int:
    return sum(1 for p in phones if is_vowel(p))


def primary_stress_index(phones: List[str]) -> int:
    """Index of the primary-stressed vowel, or the first vowel, or ``-1``."""
    first_vowel = -1
    for i, p in enumerate(phones):
        base, stress = split_stress(p)
        if base not in VOWELS:
            continue
        if first_vowel < 0:
            first_vowel = i
        if stress == 1:
            return i
    return first_vowel


def syllabify(phones: List[str]) -> List[List[str]]:
    """Very light syllabification: maximal-onset, good enough for stress work.

    Each returned syllable is a list of phones; every syllable contains
    exactly one vowel (except a trailing consonant-only remnant, which is
    appended to the previous syllable).
    """
    if not phones:
        return []
    vowel_positions = [i for i, p in enumerate(phones) if is_vowel(p)]
    if not vowel_positions:
        return [list(phones)]

    syllables: List[List[str]] = []
    start = 0
    for n, vpos in enumerate(vowel_positions):
        if n == len(vowel_positions) - 1:
            syllables.append(list(phones[start:]))
            break
        next_vpos = vowel_positions[n + 1]
        cluster = phones[vpos + 1:next_vpos]
        # Maximal onset: give as much of the cluster to the next syllable as a
        # legal Russian onset allows (Russian tolerates big onsets, so we give
        # away everything but the first consonant of a 2+ cluster).
        if len(cluster) <= 1:
            keep = 0
        else:
            keep = 1
        cut = vpos + 1 + keep
        syllables.append(list(phones[start:cut]))
        start = cut
    return syllables
