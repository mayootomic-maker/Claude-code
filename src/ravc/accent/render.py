"""Render Russian-accented phone sequences into three target notations.

* :func:`to_cyrillic` -- text a Russian TTS voice can read.  This is the
  trick that makes the whole thing work: feeding "хэллоу, хау ар ю" to a
  native Russian neural voice produces authentic Russian-accented English,
  complete with untrained-for details like the missing aspiration on stops
  and the apical trill, which no amount of DSP can fake.
* :func:`to_ipa` -- espeak-style IPA, used to drive Piper voices directly
  through their phoneme table, bypassing text normalisation entirely.
* :func:`to_eye_dialect` -- readable Latin spelling for the subtitle strip
  in the UI ("Ay vant to tok viz yu").
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Sequence

from .phonology import ALWAYS_HARD, Phone

# --------------------------------------------------------------------------
# Cyrillic
# --------------------------------------------------------------------------

_CYR_CONSONANT = {
    "p": "п", "b": "б", "t": "т", "d": "д", "k": "к", "g": "г",
    "f": "ф", "v": "в", "s": "с", "z": "з", "sh": "ш", "zh": "ж",
    "x": "х", "ts": "ц", "ch": "ч", "shch": "щ", "dzh": "дж",
    "m": "м", "n": "н", "l": "л", "r": "р", "h": "г",
}

# vowel -> (after hard consonant, after soft consonant / after j)
_CYR_VOWEL = {
    "a": ("а", "я"),
    "e": ("э", "е"),
    "i": ("и", "и"),
    "o": ("о", "ё"),
    "u": ("у", "ю"),
    "y": ("ы", "и"),
}

STRESS_MARK = "́"  # combining acute; Russian TTS engines honour it


def to_cyrillic(phones: Sequence[Phone], mark_stress: bool = False) -> str:
    """Render one word's phones as Russian orthography."""
    out: List[str] = []
    n = len(phones)
    for i, p in enumerate(phones):
        nxt = phones[i + 1] if i + 1 < n else None
        prev = phones[i - 1] if i > 0 else None

        if p.is_vowel:
            iotated = bool(prev and prev.sym == "j")
            softened = bool(prev and not prev.is_vowel and prev.soft
                            and prev.sym != "j")
            hard, soft = _CYR_VOWEL[p.sym]
            if p.sym == "i" and prev and prev.sym in ALWAYS_HARD:
                letter = "ы"
            elif iotated:
                letter = soft
            elif softened:
                letter = soft
            else:
                letter = hard
            out.append(letter)
            if mark_stress and p.stress == 1:
                out.append(STRESS_MARK)
            continue

        if p.sym == "j":
            # A yod before a vowel is absorbed into the iotated vowel letter;
            # elsewhere it is a plain й.
            if nxt is not None and nxt.is_vowel:
                if prev is not None and not prev.is_vowel and prev.soft:
                    out.append("ь")
                continue
            out.append("й")
            continue

        letter = _CYR_CONSONANT.get(p.sym)
        if letter is None:
            continue
        out.append(letter)
        if p.long:
            out.append(letter)
        if p.soft and p.sym not in ("ch", "shch"):
            # A soft sign is only written when the softness is not already
            # carried by a following iotated vowel.
            if nxt is None or not nxt.is_vowel:
                if not (nxt is not None and nxt.sym == "j"):
                    out.append("ь")
    return "".join(out)


# --------------------------------------------------------------------------
# IPA (espeak flavour, for Piper phoneme tables)
# --------------------------------------------------------------------------

# Each entry is a preference list; the Piper backend picks the first symbol
# that actually exists in the loaded voice's phoneme table.
_IPA_CONSONANT = {
    "p": ["p"], "b": ["b"], "t": ["t"], "d": ["d"], "k": ["k"],
    "g": ["ɡ", "g"], "f": ["f"], "v": ["v"], "s": ["s"], "z": ["z"],
    "sh": ["ʂ", "ʃ"], "zh": ["ʐ", "ʒ"], "x": ["x", "h"],
    "ts": ["ts", "t͡s"], "ch": ["tɕ", "t͡ɕ", "tʃ"], "shch": ["ɕː", "ɕ"],
    "dzh": ["dʐ", "d͡ʐ", "dʒ"],
    "m": ["m"], "n": ["n"], "l": ["l"], "r": ["r", "ɾ"], "j": ["j"],
    "h": ["h", "x"],
}

_IPA_VOWEL = {
    "a": ["a", "ɐ", "ə"],
    "e": ["e", "ɛ", "ɪ"],
    "i": ["i", "ɪ"],
    "o": ["o", "ɔ"],
    "u": ["u", "ʊ"],
    "y": ["ɨ", "i"],
}

PRIMARY_STRESS = "ˈ"
SECONDARY_STRESS = "ˌ"


def to_ipa(phones: Sequence[Phone], mark_stress: bool = True) -> List[List[str]]:
    """Return one preference list per output symbol.

    The Piper backend resolves each preference list against the voice's own
    phoneme inventory, so an inventory that spells /ʃ/ as ``ʂ`` and one that
    spells it ``ʃ`` both work without special-casing.
    """
    symbols: List[List[str]] = []
    stressed_at: Optional[int] = None
    secondary_at: Optional[int] = None

    for i, p in enumerate(phones):
        if p.is_vowel and p.stress == 1 and stressed_at is None:
            stressed_at = i
        elif p.is_vowel and p.stress == 2 and secondary_at is None:
            secondary_at = i

    def onset_of(vowel_idx: int) -> int:
        """Start of the stressed syllable, under a maximal-onset rule."""
        j = vowel_idx
        while j > 0 and not phones[j - 1].is_vowel and vowel_idx - j < 2:
            j -= 1
        # A sonorant at the front of a two-consonant onset belongs to the
        # previous syllable's coda: com-PU-ter, not co-MPU-ter.
        if vowel_idx - j == 2 and phones[j].sym in {"m", "n", "l", "r"}:
            j += 1
        return j

    stress_positions = {}
    if mark_stress and stressed_at is not None:
        stress_positions[onset_of(stressed_at)] = PRIMARY_STRESS
    if mark_stress and secondary_at is not None:
        pos = onset_of(secondary_at)
        stress_positions.setdefault(pos, SECONDARY_STRESS)

    for i, p in enumerate(phones):
        if i in stress_positions:
            symbols.append([stress_positions[i]])
        if p.is_vowel:
            symbols.append(list(_IPA_VOWEL.get(p.sym, ["a"])))
            continue
        base = _IPA_CONSONANT.get(p.sym)
        if base is None:
            continue
        if p.soft and p.sym != "j":
            softened = [b + "ʲ" for b in base]
            symbols.append(softened + base)
        else:
            symbols.append(list(base))
    return symbols


# --------------------------------------------------------------------------
# Latin eye-dialect (display only)
# --------------------------------------------------------------------------

_EYE_CONSONANT = {
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g",
    "f": "f", "v": "v", "s": "s", "z": "z", "sh": "sh", "zh": "zh",
    "x": "kh", "ts": "ts", "ch": "ch", "shch": "shch", "dzh": "j",
    "m": "m", "n": "n", "l": "l", "r": "r", "j": "y", "h": "h",
}

_EYE_VOWEL = {"a": "a", "e": "e", "i": "ee", "o": "o", "u": "oo", "y": "y"}


def to_eye_dialect(phones: Sequence[Phone]) -> str:
    """A readable Latin approximation, for the live subtitle strip."""
    out: List[str] = []
    n = len(phones)
    for i, p in enumerate(phones):
        nxt = phones[i + 1] if i + 1 < n else None
        if p.is_vowel:
            # "ee" is only worth writing when it is the stressed nucleus,
            # otherwise the subtitles turn into soup.
            if p.sym == "i" and p.stress != 1:
                out.append("i")
            elif p.sym == "u" and p.stress != 1:
                out.append("u")
            else:
                out.append(_EYE_VOWEL[p.sym])
            continue
        letter = _EYE_CONSONANT.get(p.sym)
        if letter is None:
            continue
        if p.sym == "j" and nxt is not None and nxt.is_vowel:
            out.append("y")
            continue
        out.append(letter)
        # ch/shch/dzh are inherently soft in Russian; writing "chy" in the
        # subtitles just makes them hard to read.
        if (p.soft and p.sym not in {"ch", "shch", "dzh"}
                and nxt is not None and nxt.is_vowel and nxt.sym != "i"):
            out.append("y")
    return "".join(out)


def join_words(rendered: Iterable[str], separator: str = " ") -> str:
    return separator.join(r for r in rendered if r)
