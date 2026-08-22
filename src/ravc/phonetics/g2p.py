"""Grapheme-to-phoneme conversion.

Lookup order, cheapest and most accurate first:

1. the vendored CMU pronouncing dictionary (126k words, offline, no deps);
2. morphological decomposition (``streamers`` -> ``stream`` + ``-er`` + ``-s``);
3. compound splitting (``moonbeam`` -> ``moon`` + ``beam``);
4. the NRL letter-to-sound rules in :mod:`ravc.phonetics.lts`.

Everything is cached, so the hot path for real speech is a dict hit.
"""

from __future__ import annotations

import gzip
import re
import threading
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

from . import lts
from .arpabet import DEVOICE_MAP, is_vowel, split_stress

_DATA = Path(__file__).resolve().parent.parent / "data" / "cmudict.txt.gz"

_dict: Optional[Dict[str, str]] = None
_dict_lock = threading.Lock()

_WORD_RE = re.compile(r"[A-Za-z']+")


def _load() -> Dict[str, str]:
    global _dict
    if _dict is not None:
        return _dict
    with _dict_lock:
        if _dict is not None:
            return _dict
        data: Dict[str, str] = {}
        try:
            with gzip.open(_DATA, "rt", encoding="utf-8") as fh:
                for line in fh:
                    word, _, phones = line.rstrip("\n").partition("\t")
                    if word and phones:
                        data[word] = phones
        except OSError:
            data = {}
        _dict = data
        return _dict


def dictionary_size() -> int:
    return len(_load())


# --------------------------------------------------------------------------
# Suffix handling
# --------------------------------------------------------------------------

# (suffix, stem transforms to try, phones to append, phones appended when the
#  rule is "voicing sensitive" -- resolved in _apply_suffix)
_SUFFIX_RULES = [
    ("'S", ["", "E"], None),        # possessive, voicing-sensitive
    ("S", ["", "E"], None),         # plural / 3sg, voicing-sensitive
    ("ES", ["", "E"], None),
    ("IES", ["Y"], None),
    ("ED", ["", "E"], "ED"),
    ("IED", ["Y"], "ED"),
    ("ING", ["", "E"], "ING"),
    ("LY", [""], "LY"),
    ("NESS", [""], "NESS"),
    ("MENT", [""], "MENT"),
    ("LESS", [""], "LESS"),
    ("FUL", [""], "FUL"),
    ("ABLE", ["", "E"], "ABLE"),
    ("ER", ["", "E"], "ER"),
    ("EST", ["", "E"], "EST"),
    ("ERS", ["", "E"], "ERS"),
]

_SUFFIX_PHONES = {
    "ED": ["D"],
    "ING": ["IH0", "NG"],
    "LY": ["L", "IY0"],
    "NESS": ["N", "AH0", "S"],
    "MENT": ["M", "AH0", "N", "T"],
    "LESS": ["L", "AH0", "S"],
    "FUL": ["F", "AH0", "L"],
    "ABLE": ["AH0", "B", "AH0", "L"],
    "ER": ["ER0"],
    "EST": ["IH0", "S", "T"],
    "ERS": ["ER0", "Z"],
}

# For -s and -ed the realisation depends on the final phone of the stem.
_S_SIBILANTS = {"S", "Z", "SH", "ZH", "CH", "JH"}
_VOICELESS = set(DEVOICE_MAP.values()) | {"TH"}


def _inflect_s(stem: List[str]) -> List[str]:
    if not stem:
        return ["S"]
    last = split_stress(stem[-1])[0]
    if last in _S_SIBILANTS:
        return ["IH0", "Z"]
    if last in _VOICELESS:
        return ["S"]
    return ["Z"]


def _inflect_ed(stem: List[str]) -> List[str]:
    if not stem:
        return ["D"]
    last = split_stress(stem[-1])[0]
    if last in {"T", "D"}:
        return ["IH0", "D"]
    if last in _VOICELESS:
        return ["T"]
    return ["D"]


def _lookup_raw(word: str) -> Optional[List[str]]:
    entry = _load().get(word.lower())
    return entry.split() if entry else None


def _try_suffix(word: str) -> Optional[List[str]]:
    upper = word.upper()
    for suffix, stem_endings, phone_key in _SUFFIX_RULES:
        if not upper.endswith(suffix) or len(upper) <= len(suffix) + 1:
            continue
        base = upper[: -len(suffix)]
        candidates = [base + ending for ending in stem_endings]
        # Undo consonant doubling: "running" -> "run", "bigger" -> "big".
        if len(base) >= 3 and base[-1] == base[-2] and base[-1] not in "AEIOU":
            candidates.append(base[:-1])
        for cand in candidates:
            stem = _lookup_raw(cand)
            if not stem:
                continue
            if phone_key is None:
                return stem + _inflect_s(stem)
            if phone_key == "ED":
                return stem + _inflect_ed(stem)
            return stem + _SUFFIX_PHONES[phone_key]
    return None


def _try_compound(word: str) -> Optional[List[str]]:
    upper = word.upper()
    if len(upper) < 6:
        return None
    best = None
    for cut in range(3, len(upper) - 2):
        left, right = upper[:cut], upper[cut:]
        lp = _lookup_raw(left)
        rp = _lookup_raw(right)
        if lp and rp:
            score = min(len(left), len(right))
            if best is None or score > best[0]:
                best = (score, lp + _demote(rp))
    return best[1] if best else None


def _demote(phones: List[str]) -> List[str]:
    """Turn primary stress into secondary (for the tail of a compound)."""
    return [p[:-1] + "2" if p.endswith("1") else p for p in phones]


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

@lru_cache(maxsize=65536)
def word_to_phonemes(word: str) -> tuple:
    """Return ARPAbet phones (with stress digits) for one orthographic word."""
    token = word.strip()
    if not token:
        return ()

    core = "".join(ch for ch in token if ch.isalpha() or ch in "'-")
    if not core:
        return ()

    # Hyphenated compounds: pronounce the parts.
    if "-" in core and len(core) > 1:
        out: List[str] = []
        for part in core.split("-"):
            out.extend(word_to_phonemes(part))
        if out:
            return tuple(out)

    for candidate in (core, core.replace("'", "")):
        phones = _lookup_raw(candidate)
        if phones:
            return tuple(phones)

    # ALLCAPS that is not a dictionary word: probably an initialism.
    if token.isupper() and len(core) <= 5 and not _lookup_raw(core):
        out = []
        for ch in core:
            letter = _lookup_raw(ch)
            if letter:
                out.extend(_demote(letter))
        if out:
            if any(p.endswith("2") for p in out):
                for i in range(len(out) - 1, -1, -1):
                    if out[i].endswith("2"):
                        out[i] = out[i][:-1] + "1"
                        break
            return tuple(out)

    phones = _try_suffix(core)
    if phones:
        return tuple(phones)

    phones = _try_compound(core)
    if phones:
        return tuple(phones)

    return tuple(lts.word_to_phonemes(core))


def phrase_to_phonemes(text: str) -> List[List[str]]:
    """Phonemise every word of ``text``; returns one phone list per word."""
    return [list(word_to_phonemes(w)) for w in _WORD_RE.findall(text)]


def in_dictionary(word: str) -> bool:
    return word.lower() in _load()
