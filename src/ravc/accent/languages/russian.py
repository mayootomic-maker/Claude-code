"""The Russian accent.

Substitutions modelled (all attested features of Russian-accented English):

======================  =====================================================
/θ/ think               /s/    "sink"
/ð/ this                /z/    "zis"
/w/ water               /v/    "vater"
/h/ hello               /x/    "khello"
/ŋ/ going               /n/ + word-final /k/  "goink"
/æ/ bad                 /e/    "bed"          (Russian has no /ae/)
/ɪ/ ship                /i/    "sheep"        (no lax/tense contrast)
schwa  problem          the spelling vowel    "problem", not "problm"
final  dog, was         devoiced              "dok", "vas"
/dʒ/ job                /dʐ/ then devoiced    "dzhop"
/r/  red                apical trill
/l/  look               velarised, palatal only before /i/
======================  =====================================================

Plus real Russian phonotactics: regressive voicing assimilation (with /v/
transparent, so "question" is not "gvestion"), palatalisation before front
vowels, and /i/ backing to /ɨ/ after the always-hard sibilants.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Dict, List, Sequence

from ..phones import (DEVOICED, NO_VOICE_PARTNER, REVOICED, Phone,
                      devoice, revoice)
from .base import AccentProfile, Context, LanguagePack

# Consonants that are permanently hard in Russian: a following /i/ backs.
ALWAYS_HARD = {"sh", "zh", "ts"}
# Consonants that are permanently soft.
ALWAYS_SOFT = {"ch", "shch", "j"}
# /v/ undergoes voicing assimilation but never triggers it (tvoy = [tvoj]).
NON_TRIGGERING = {"v"}

DEFAULT_FEATURES: Dict[str, bool] = {
    "th_to_s": True,
    "dh_to_z": True,
    "w_to_v": True,
    "h_to_kh": True,
    "ng_to_nk": True,
    "final_devoicing": True,
    "no_vowel_reduction": True,
    "ae_to_e": True,
    "tense_short_vowels": True,
    "palatalise": True,
    "palatalise_before_e": False,
    "hard_sibilant_backing": True,
    "dark_l": True,
    "v_to_w_hypercorrection": False,
}

FEATURE_LABELS = (
    ("th_to_s", "think → sink  (/θ/ → /s/)"),
    ("dh_to_z", "this → zis  (/ð/ → /z/)"),
    ("w_to_v", "water → vater  (/w/ → /v/)"),
    ("h_to_kh", "hello → khello  (/h/ → /x/)"),
    ("ng_to_nk", "going → goink"),
    ("final_devoicing", "dog → dok  (final devoicing)"),
    ("no_vowel_reduction", "problem stays 'problem'  (spelling vowels)"),
    ("ae_to_e", "bad → bed  (/æ/ → /ɛ/)"),
    ("tense_short_vowels", "ship → sheep"),
    ("palatalise", "soft consonants before /i/"),
    ("hard_sibilant_backing", "ship → shyp  (/ʃi/ → /ʂɨ/)"),
    ("v_to_w_hypercorrection", "very → wery  (over-correction)"),
)

_CONSONANTS: Dict[str, List[str]] = {
    "B": ["b"], "D": ["d"], "F": ["f"], "G": ["g"], "K": ["k"],
    "M": ["m"], "N": ["n"], "P": ["p"], "S": ["s"], "T": ["t"],
    "V": ["v"], "Z": ["z"], "L": ["l"], "R": ["r"],
    "SH": ["sh"], "ZH": ["zh"], "CH": ["ch"], "JH": ["dzh"], "Y": ["j"],
}

_VOWELS: Dict[str, List[str]] = {
    "AA": ["a"], "AE": ["e"], "AH": ["a"], "AO": ["o"],
    "EH": ["e"], "IH": ["i"], "IY": ["i"], "UH": ["u"], "UW": ["u"],
    "AW": ["a", "u"], "AY": ["a", "j"], "EY": ["e", "j"],
    "OW": ["o"], "OY": ["o", "j"],
}


def map_consonant(base: str, profile: AccentProfile,
                  ctx: Context) -> List[str]:
    if base == "TH":
        return ["s"] if profile.fires("th_to_s", 0.35) else ["t"]
    if base == "DH":
        return ["z"] if profile.fires("dh_to_z", 0.35) else ["d"]
    if base == "W":
        return ["v"] if profile.fires("w_to_v", 0.2) else ["u"]
    if base == "HH":
        return ["x"] if profile.fires("h_to_kh", 0.5) else ["h"]
    if base == "NG":
        if ctx.is_final:
            return ["n", "k"] if profile.fires("ng_to_nk", 0.55) else ["n", "g"]
        return ["n"]
    if base == "V" and profile.fires("v_to_w_hypercorrection", 0.8, False):
        return ["u"]
    return list(_CONSONANTS.get(base, [base.lower()]))


def map_vowel(base: str, stress: int, profile: AccentProfile,
              ctx: Context) -> List[str]:
    spelling = ctx.spelling_vowel
    # Restore the spelling vowel for reduced syllables: this single rule is
    # what turns "problem" into "prob-LEM" instead of English "prob-lm".
    if stress == 0 and base in {"AH", "IH", "UH", "ER"} and spelling:
        if profile.fires("no_vowel_reduction", 0.3):
            return [spelling, "r"] if base == "ER" else [spelling]
    if base == "ER":
        return [spelling or "e", "r"]
    if base == "AE":
        return ["e"] if profile.fires("ae_to_e", 0.4) else ["a"]
    # Spelling pronunciation of stressed <o>: English "problem"/"stop"/"job"
    # have /ɑ/, but a Russian reads the letter and says [o].
    if base in {"AA", "AO"} and spelling == "o" and profile.feature(
            "no_vowel_reduction"):
        return ["o"]
    if base in {"IH", "UH"} and not profile.feature("tense_short_vowels"):
        return list(_VOWELS[base])
    return list(_VOWELS.get(base, ["a"]))


# --------------------------------------------------------------------------
# Post-processes
# --------------------------------------------------------------------------

def assimilate_voicing(phones: List[Phone],
                       profile: AccentProfile) -> List[Phone]:
    """Final devoicing plus regressive assimilation across obstruents."""
    if not phones:
        return phones
    out = list(phones)

    if profile.fires("final_devoicing", 0.3):
        i = len(out) - 1
        while i >= 0 and out[i].is_obstruent:
            out[i] = devoice(out[i])
            i -= 1

    for i in range(len(out) - 2, -1, -1):
        cur, nxt = out[i], out[i + 1]
        if not (cur.is_obstruent and nxt.is_obstruent):
            continue
        if nxt.sym in NON_TRIGGERING:
            continue
        if nxt.sym in NO_VOICE_PARTNER:
            out[i] = devoice(cur)
            continue
        if nxt.sym in DEVOICED:      # next is voiced -> voice this one
            out[i] = revoice(cur)
        elif nxt.sym in REVOICED:    # next is voiceless -> devoice this one
            out[i] = devoice(cur)
    return out


def palatalise(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    if not profile.fires("palatalise", 0.4):
        return phones
    before_e = profile.feature("palatalise_before_e", False)
    out = list(phones)
    for i, p in enumerate(out):
        if p.is_vowel or p.sym in ALWAYS_HARD:
            continue
        if p.sym in ALWAYS_SOFT:
            out[i] = replace(p, soft=True)
            continue
        nxt = out[i + 1] if i + 1 < len(out) else None
        if nxt is None:
            continue
        if nxt.sym in ("j", "i") or (nxt.sym == "e" and before_e):
            out[i] = replace(p, soft=True)

    if profile.feature("dark_l"):
        for i, p in enumerate(out):
            if p.sym != "l":
                continue
            nxt = out[i + 1] if i + 1 < len(out) else None
            if nxt is None or nxt.sym not in {"i", "j"}:
                out[i] = replace(p, soft=False)
    return out


def back_after_hard_sibilant(phones: List[Phone],
                             profile: AccentProfile) -> List[Phone]:
    """After sh / zh / ts an /i/ becomes /ɨ/ -- Russian has no [ʃi]."""
    if not profile.fires("hard_sibilant_backing", 0.6):
        return phones
    out = list(phones)
    for i in range(1, len(out)):
        if out[i].sym == "i" and out[i - 1].sym in ALWAYS_HARD:
            out[i] = out[i].with_sym("y")
    return out


def tidy(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    out: List[Phone] = []
    for p in phones:
        if out and p.sym == out[-1].sym and not p.is_vowel:
            out[-1] = replace(out[-1], long=True)
            continue
        out.append(p)
    return out


# --------------------------------------------------------------------------
# Cyrillic rendering
# --------------------------------------------------------------------------

_CYR_CONSONANT = {
    "p": "п", "b": "б", "t": "т", "d": "д", "k": "к", "g": "г",
    "f": "ф", "v": "в", "s": "с", "z": "з", "sh": "ш", "zh": "ж",
    "x": "х", "ts": "ц", "ch": "ч", "shch": "щ", "dzh": "дж",
    "m": "м", "n": "н", "ng": "нг", "l": "л", "r": "р", "R": "р",
    "h": "г", "j": "й",
}

# vowel -> (after a hard consonant, after a soft consonant or /j/)
_CYR_VOWEL = {
    "a": ("а", "я"), "e": ("э", "е"), "i": ("и", "и"),
    "o": ("о", "ё"), "u": ("у", "ю"), "y": ("ы", "и"),
    "sch": ("а", "я"), "ar": ("ар", "яр"),
    "oe": ("ё", "ё"), "ue": ("ю", "ю"),
}

STRESS_MARK = "́"  # combining acute; Russian TTS engines honour it


def render_cyrillic(phones: Sequence[Phone], mark_stress: bool = False) -> str:
    out: List[str] = []
    n = len(phones)
    for i, p in enumerate(phones):
        nxt = phones[i + 1] if i + 1 < n else None
        prev = phones[i - 1] if i > 0 else None

        if p.is_vowel:
            iotated = bool(prev and prev.sym == "j")
            softened = bool(prev and not prev.is_vowel and prev.soft
                            and prev.sym != "j")
            hard, soft = _CYR_VOWEL.get(p.sym, ("а", "я"))
            if p.sym == "i" and prev and prev.sym in ALWAYS_HARD:
                letter = "ы"
            else:
                letter = soft if (iotated or softened) else hard
            out.append(letter)
            if mark_stress and p.stress == 1:
                out.append(STRESS_MARK)
            continue

        if p.sym == "j":
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
            # A soft sign is written only when a following iotated vowel is
            # not already carrying the softness.
            if nxt is None or not nxt.is_vowel:
                if not (nxt is not None and nxt.sym == "j"):
                    out.append("ь")
    return "".join(out)


# --------------------------------------------------------------------------
# IPA and Latin maps
# --------------------------------------------------------------------------

IPA_MAP: Dict[str, List[str]] = {
    "p": ["p"], "b": ["b"], "t": ["t"], "d": ["d"], "k": ["k"],
    "g": ["ɡ", "g"], "f": ["f"], "v": ["v"], "s": ["s"], "z": ["z"],
    "sh": ["ʂ", "ʃ"], "zh": ["ʐ", "ʒ"], "x": ["x", "h"],
    "ts": ["ts"], "ch": ["tɕ", "tʃ"], "shch": ["ɕː", "ɕ"],
    "dzh": ["dʐ", "dʒ"], "m": ["m"], "n": ["n"], "ng": ["ŋ", "n"],
    "l": ["l", "ɫ"], "r": ["r", "ɾ"], "R": ["r"], "j": ["j"], "h": ["h", "x"],
    "a": ["a", "ɐ"], "e": ["e", "ɛ"], "i": ["i", "ɪ"],
    "o": ["o", "ɔ"], "u": ["u", "ʊ"], "y": ["ɨ", "i"],
    "sch": ["ə", "a"], "ar": ["ar", "ɐ"], "oe": ["ø", "o"], "ue": ["y", "u"],
}

LATIN_MAP: Dict[str, str] = {
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g",
    "f": "f", "v": "v", "s": "s", "z": "z", "sh": "sh", "zh": "zh",
    "x": "kh", "ts": "ts", "ch": "ch", "shch": "shch", "dzh": "j",
    "m": "m", "n": "n", "ng": "ng", "l": "l", "r": "r", "R": "r",
    "j": "y", "h": "h",
    "a": "a", "e": "e", "i": "ee", "o": "o", "u": "oo", "y": "y",
    "sch": "e", "ar": "ar", "oe": "yo", "ue": "yu",
}


PACK = LanguagePack(
    key="russian",
    name="Russian",
    adjective="Russian",
    tts_language="ru-RU",
    sample_line="Listen carefully my friend, I will only say this one time.",
    map_consonant=map_consonant,
    map_vowel=map_vowel,
    post_processes=(assimilate_voicing, palatalise, back_after_hard_sibilant,
                    tidy),
    ipa_map=IPA_MAP,
    latin_map=LATIN_MAP,
    render_text=render_cyrillic,
    default_features=DEFAULT_FEATURES,
    feature_labels=FEATURE_LABELS,
    spelling_pronunciation=True,
)
