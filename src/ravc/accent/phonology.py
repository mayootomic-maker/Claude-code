"""Turn English phonemes into the phonemes a Russian speaker actually produces.

This module is the reason the voice changer sounds Russian rather than
merely "foreign".  It models the substitutions that Russian L1 speakers
reliably make in English, in the order a real phonological grammar would
apply them:

============================  ==============================================
English                       Russian realisation
============================  ==============================================
/theta/  think                /s/    "sink"
/dh/     this                 /z/    "zis"
/w/      water                /v/    "vater"
/h/      hello                /x/    "khello"
/ng/     going                /n/ (+ /k/ word-finally)  "goink"
/ae/     bad                  /e/    "bed"
/ih/     ship                 /i/    "sheep"  (no lax/tense contrast)
/uh/     book                 /u/
schwa    problem              full spelling vowel  "problem", not "problm"
final    dog, was             devoiced  "dok", "vas"
/r/      red                  trilled apical [r]
/l/      look                 velarised (dark) [l], palatal before /i/
============================  ==============================================

On top of that it applies genuine Russian phonotactics -- regressive
voicing assimilation across obstruent clusters, palatalisation before
front vowels, and the /i/ -> /y/ backing after the always-hard sibilants
sh, zh and ts -- which is what makes the output sound like Russian
phonology rather than a cartoon.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Dict, List, Optional, Sequence, Tuple

from ..phonetics.arpabet import split_stress

# --------------------------------------------------------------------------
# The Russian phone inventory we compile down to
# --------------------------------------------------------------------------

VOWELS = {"a", "e", "i", "o", "u", "y"}

OBSTRUENTS = {"p", "b", "t", "d", "k", "g", "f", "v", "s", "z",
              "sh", "zh", "x", "ts", "ch", "shch", "dzh"}
VOICED = {"b": "p", "d": "t", "g": "k", "v": "f", "z": "s", "zh": "sh",
          "dzh": "ch"}
DEVOICED = dict(VOICED)
REVOICED = {v: k for k, v in VOICED.items()}
# ts / ch / shch / x have no voiced partner and never trigger voicing.
NO_VOICE_PARTNER = {"ts", "ch", "shch", "x"}
# Russian /v/ is famously "transparent": it undergoes voicing assimilation but
# never triggers it, which is why tvoy is [tvoj] and not *[dvoj].  Getting this
# wrong turns "question" into "gvestion".
NON_TRIGGERING = {"v"}

# Sibilants that are permanently hard in Russian; a following /i/ backs to /y/.
ALWAYS_HARD = {"sh", "zh", "ts"}
# Consonants that are permanently soft in Russian.
ALWAYS_SOFT = {"ch", "shch", "j"}
# /dzh/ is a foreign affricate; Russians keep it hard, as in "джаз".

FRONT_VOWELS = {"i", "e"}


@dataclass(frozen=True)
class Phone:
    """One Russian-accented segment."""

    sym: str
    soft: bool = False       # palatalised consonant
    stress: int = 0          # vowels only: 1 primary, 2 secondary, 0 none
    long: bool = False

    @property
    def is_vowel(self) -> bool:
        return self.sym in VOWELS

    @property
    def is_obstruent(self) -> bool:
        return self.sym in OBSTRUENTS

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        mark = "'" if self.soft else ""
        acc = "́" if self.stress == 1 and self.is_vowel else ""
        return f"{self.sym}{mark}{acc}"


@dataclass
class AccentProfile:
    """Knobs controlling how hard the accent is laid on.

    ``strength`` between 0 and 1 scales the whole thing; the individual
    switches let a user dial in a specific stereotype (a Bond villain wants
    every switch on, a Moscow expat who has lived in Chicago for ten years
    wants ``strength=0.35``).
    """

    strength: float = 1.0

    th_to_s: bool = True             # think -> sink        (theta -> s)
    dh_to_z: bool = True             # this  -> zis         (dh -> z)
    w_to_v: bool = True              # water -> vater
    h_to_kh: bool = True             # hello -> khello
    ng_to_nk: bool = True            # going -> goink
    final_devoicing: bool = True     # dog   -> dok
    no_vowel_reduction: bool = True  # problem stays "problem"
    ae_to_e: bool = True             # bad   -> bed  (False: bad -> "bad")
    tense_short_vowels: bool = True  # ship  -> sheep
    trilled_r: bool = True
    dark_l: bool = True
    palatalise: bool = True          # before /i/ and /j/
    palatalise_before_e: bool = False  # loanword-hard "test" stays [tɛst]
    hard_sibilant_backing: bool = True  # ship -> "shyp"
    v_to_w_hypercorrection: bool = False  # very -> "wery" (over-correction)

    def scaled(self, flag: bool, threshold: float) -> bool:
        """A switch only fires if it is on *and* the strength reaches it."""
        return flag and self.strength >= threshold


DEFAULT_PROFILE = AccentProfile()


# --------------------------------------------------------------------------
# Spelling-driven vowel restoration
# --------------------------------------------------------------------------

_VOWEL_GROUP_RE = re.compile(r"[aeiouy]+", re.I)

# Which Russian vowel a Russian speaker reads an English vowel spelling as.
_SPELLING_VOWEL = {
    "a": "a", "e": "e", "i": "i", "o": "o", "u": "u", "y": "i",
    "ou": "u", "ow": "o", "oo": "u", "ee": "i", "ea": "e", "ie": "i",
    "ai": "a", "ay": "e", "au": "a", "aw": "o", "eu": "e", "eo": "e",
    "io": "i", "ia": "i", "ua": "u", "ui": "u", "oa": "o", "oe": "o",
    "ei": "e", "ey": "e", "oi": "o", "oy": "o", "uo": "u", "iu": "i",
}


_QU_RE = re.compile(r"(?<=[qg])u(?=[aeiouy])", re.I)


def _spelling_vowels(word: str) -> List[str]:
    """Vowel letter-groups of ``word``, mapped to Russian vowel symbols.

    The <u> of <qu>/<gu> is part of the consonant, not a vowel: without
    stripping it, "quick" aligns its vowel to <ui> and comes out "kvuk".
    """
    out = []
    word = _QU_RE.sub("", word)
    for group in _VOWEL_GROUP_RE.findall(word.lower()):
        out.append(_SPELLING_VOWEL.get(group, _SPELLING_VOWEL.get(group[0], "a")))
    return out


# --------------------------------------------------------------------------
# ARPAbet -> Russian mapping
# --------------------------------------------------------------------------

_CONSONANT_MAP: Dict[str, Tuple[str, ...]] = {
    "B": ("b",), "D": ("d",), "F": ("f",), "G": ("g",), "K": ("k",),
    "M": ("m",), "N": ("n",), "P": ("p",), "S": ("s",), "T": ("t",),
    "V": ("v",), "Z": ("z",), "L": ("l",), "R": ("r",),
    "SH": ("sh",), "ZH": ("zh",), "CH": ("ch",), "JH": ("dzh",),
    "Y": ("j",),
}

_VOWEL_MAP: Dict[str, Tuple[str, ...]] = {
    "AA": ("a",), "AE": ("e",), "AH": ("a",), "AO": ("o",),
    "EH": ("e",), "IH": ("i",), "IY": ("i",), "UH": ("u",), "UW": ("u",),
    "AW": ("a", "u"), "AY": ("a", "j"), "EY": ("e", "j"),
    "OW": ("o",), "OY": ("o", "j"),
}


def _map_consonant(base: str, profile: AccentProfile,
                   word_final: bool) -> List[str]:
    if base == "TH":
        return ["s"] if profile.scaled(profile.th_to_s, 0.35) else ["t"]
    if base == "DH":
        return ["z"] if profile.scaled(profile.dh_to_z, 0.35) else ["d"]
    if base == "W":
        return ["v"] if profile.scaled(profile.w_to_v, 0.2) else ["u"]
    if base == "HH":
        return ["x"] if profile.scaled(profile.h_to_kh, 0.5) else ["h"]
    if base == "NG":
        if profile.scaled(profile.ng_to_nk, 0.55) and word_final:
            return ["n", "k"]
        return ["n", "g"] if word_final else ["n"]
    if base == "V" and profile.v_to_w_hypercorrection:
        return ["v"]  # resolved later, needs word context
    return list(_CONSONANT_MAP.get(base, (base.lower(),)))


def _map_vowel(base: str, stress: int, profile: AccentProfile,
               spelling: Optional[str]) -> List[str]:
    # Reduced vowels get their full spelling value back: this single rule is
    # what turns "problem" into "prob-LEM" instead of English "prob-lm".
    if stress == 0 and base in {"AH", "IH", "UH", "ER"} and spelling:
        if profile.scaled(profile.no_vowel_reduction, 0.3):
            if base == "ER":
                return [spelling, "r"]
            return [spelling]

    if base == "ER":
        return [(spelling or "e"), "r"]
    if base == "AE":
        if profile.scaled(profile.ae_to_e, 0.4):
            return ["e"]
        return ["a"]
    # Spelling pronunciation of stressed <o>: English "problem"/"stop"/"job"
    # have /ɑ/, but a Russian reads the letter and says [o].  This is one of
    # the most audible single features of the accent.
    if base in {"AA", "AO"} and spelling == "o" and profile.no_vowel_reduction:
        return ["o"]
    if base in {"IH", "UH"} and not profile.tense_short_vowels:
        return list(_VOWEL_MAP[base])
    return list(_VOWEL_MAP.get(base, ("a",)))


def russify_word(word: str, phones: Sequence[str],
                 profile: AccentProfile = DEFAULT_PROFILE) -> List[Phone]:
    """Convert one word's ARPAbet phones into Russian-accented phones."""
    spelling = _spelling_vowels(word)
    vowel_index = 0

    syms: List[str] = []
    stresses: List[int] = []

    last_index = len(phones) - 1
    for i, arp in enumerate(phones):
        base, stress = split_stress(arp)
        if base in _VOWEL_MAP or base == "ER":
            sp = spelling[vowel_index] if vowel_index < len(spelling) else None
            vowel_index += 1
            mapped = _map_vowel(base, max(stress, 0), profile, sp)
        else:
            word_final = i == last_index
            mapped = _map_consonant(base, profile, word_final)
            stress = -1

        for m in mapped:
            syms.append(m)
            stresses.append(max(stress, 0) if m in VOWELS else 0)

    phones_out = [Phone(sym=s, stress=st) for s, st in zip(syms, stresses)]
    phones_out = _assimilate_voicing(phones_out, profile)
    phones_out = _palatalise(phones_out, profile)
    phones_out = _back_after_hard_sibilant(phones_out, profile)
    phones_out = _tidy(phones_out)
    return phones_out


# --------------------------------------------------------------------------
# Phonological post-processes
# --------------------------------------------------------------------------

def _assimilate_voicing(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    """Russian obstruent clusters agree in voicing with their *last* member,
    and word-final obstruents devoice unconditionally."""
    if not phones:
        return phones
    out = list(phones)

    if profile.scaled(profile.final_devoicing, 0.3):
        i = len(out) - 1
        while i >= 0 and out[i].is_obstruent:
            if out[i].sym in DEVOICED:
                out[i] = replace(out[i], sym=DEVOICED[out[i].sym])
            i -= 1

    # Regressive assimilation, right to left.
    for i in range(len(out) - 2, -1, -1):
        cur, nxt = out[i], out[i + 1]
        if not (cur.is_obstruent and nxt.is_obstruent):
            continue
        if nxt.sym in NON_TRIGGERING:
            continue
        if nxt.sym in NO_VOICE_PARTNER:
            if cur.sym in DEVOICED:
                out[i] = replace(cur, sym=DEVOICED[cur.sym])
            continue
        if nxt.sym in REVOICED and cur.sym in REVOICED:
            continue
        if nxt.sym in VOICED and cur.sym in DEVOICED:
            continue  # both voiced already
        if nxt.sym in VOICED:  # next is voiced -> voice this one
            if cur.sym in REVOICED:
                out[i] = replace(cur, sym=REVOICED[cur.sym])
        else:                  # next is voiceless -> devoice this one
            if cur.sym in DEVOICED:
                out[i] = replace(cur, sym=DEVOICED[cur.sym])
    return out


def _palatalise(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    if not profile.scaled(profile.palatalise, 0.4):
        return phones
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
        if nxt.sym == "j":
            out[i] = replace(p, soft=True)
        elif nxt.sym == "i":
            out[i] = replace(p, soft=True)
        elif nxt.sym == "e" and profile.palatalise_before_e:
            out[i] = replace(p, soft=True)
    # A dark /l/ is the default; only the palatal environment softens it.
    if profile.dark_l:
        for i, p in enumerate(out):
            if p.sym != "l":
                continue
            nxt = out[i + 1] if i + 1 < len(out) else None
            if nxt is None or nxt.sym not in {"i", "j"}:
                out[i] = replace(p, soft=False)
    return out


def _back_after_hard_sibilant(phones: List[Phone],
                              profile: AccentProfile) -> List[Phone]:
    """After sh / zh / ts an /i/ becomes /y/ -- Russian simply has no [ʃi]."""
    if not profile.scaled(profile.hard_sibilant_backing, 0.6):
        return phones
    out = list(phones)
    for i in range(1, len(out)):
        if out[i].sym == "i" and out[i - 1].sym in ALWAYS_HARD:
            out[i] = replace(out[i], sym="y")
    return out


def _tidy(phones: List[Phone]) -> List[Phone]:
    """Drop illegal or redundant sequences."""
    out: List[Phone] = []
    for p in phones:
        if out and p.sym == out[-1].sym and not p.is_vowel:
            # Geminate consonants are not contrastive here; lengthen instead.
            out[-1] = replace(out[-1], long=True)
            continue
        if p.sym == "j" and out and out[-1].sym == "j":
            continue
        out.append(p)
    return out


# --------------------------------------------------------------------------
# Whole-utterance driver
# --------------------------------------------------------------------------

@dataclass
class AccentedWord:
    original: str
    phones: List[Phone] = field(default_factory=list)
    trailing_punct: str = ""


def russify_words(words: Sequence[Tuple[str, Sequence[str]]],
                  profile: AccentProfile = DEFAULT_PROFILE) -> List[AccentedWord]:
    return [AccentedWord(original=w, phones=russify_word(w, ph, profile))
            for w, ph in words]
