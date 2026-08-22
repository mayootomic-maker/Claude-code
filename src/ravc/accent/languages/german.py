"""The German accent.

Substitutions modelled (all attested features of German-accented English):

========================  ===================================================
/w/ we want               /v/     "ve vant"      (German <w> is [v])
/θ/ think                 /s/     "sink"         (or /t/: "tink")
/ð/ this, the             /z/     "zis", "ze"    (or /d/: "dis")
initial /s/ + vowel       /z/     "see" -> "zee" (German <s> is [z] there)
initial /st/, /sp/        /ʃt/, /ʃp/  "stop" -> "shtop", "speak" -> "shpeak"
final voiced obstruents   devoiced  "dog" -> "dok", "have" -> "haf"
/dʒ/ job                  /tʃ/    "tschob"       (German has no /dʒ/)
/ʒ/ measure               /ʃ/     "meashure"
/æ/ bad                   /ɛ/     "bed"
/ʌ/ but                   /a/     "bat"
/eɪ/ name, /oʊ/ go        long monophthongs [eː], [oː]
/r/ red                   uvular [ʁ]
coda /r/ better, car      vocalised to [ɐ]
/l/ well                  always clear, never dark
-tion  nation             [tsi̯oːn]  "natsion"
========================  ===================================================

Note what is deliberately *not* here.  German has a schwa and a lax /ɪ/, so
unlike the Russian pack this one keeps English vowel reduction and does not
tense "ship" into "sheep" -- copying those over would make a German speaker
sound Slavic.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Dict, List, Sequence

from ..phones import NO_VOICE_PARTNER, REVOICED, Phone, devoice
from .base import AccentProfile, Context, LanguagePack

# Where each feature switches on as the strength slider rises, ordered by
# how persistent it is in real speakers: the habits that outlast decades of
# immersion (final devoicing, <w> as [v], the uvular r) come in first, while
# the ones that mark a beginner ("shtop", "natsion") appear near the top.
THRESHOLDS: Dict[str, float] = {
    "w_to_v": 0.12,
    "final_devoicing": 0.20,
    "uvular_r": 0.26,
    "th_to_s": 0.34,
    "th_to_t": 0.34,
    "dh_to_z": 0.40,
    "dh_to_d": 0.40,
    "ae_to_e": 0.46,
    "vocalise_coda_r": 0.52,
    "zh_to_sh": 0.58,
    "dzh_to_tsh": 0.64,
    "monophthongise": 0.70,
    "initial_s_to_z": 0.76,
    "s_cluster_to_sh": 0.82,
    "tion_to_tsion": 0.88,
    "no_vowel_reduction": 0.90,
    "ng_to_ngk": 0.93,
    "v_to_w_hypercorrection": 0.96,
}


def fires(profile: AccentProfile, name: str, default: bool = True) -> bool:
    return profile.fires(name, THRESHOLDS.get(name, 0.5), default)


# /v/ keeps its voicing after a voiceless obstruent: Quelle is [kvɛlə] and
# schwarz is [ʃvaʁts].  It still devoices word-finally (brav -> [braːf]).
TRANSPARENT = {"v"}

# Words whose <-tion>/<-sion> ending a German reads as [tsi̯oːn] / [zi̯oːn].
_TION = ("tion", "tions")
_SION = ("sion", "sions")


def _tion_ending(word: str):
    low = word.lower()
    if low.endswith(_TION):
        return "tion"
    if low.endswith(_SION):
        return "sion"
    return None


DEFAULT_FEATURES: Dict[str, bool] = {
    "th_to_s": True,
    "th_to_t": False,          # alternative realisation: "tink"
    "dh_to_z": True,
    "dh_to_d": False,          # alternative realisation: "dis"
    "w_to_v": True,
    "initial_s_to_z": True,
    "s_cluster_to_sh": True,
    "final_devoicing": True,
    "ae_to_e": True,
    "monophthongise": True,
    "uvular_r": True,
    "vocalise_coda_r": True,
    "dzh_to_tsh": True,
    "zh_to_sh": True,
    "ng_to_ngk": False,
    "tion_to_tsion": True,
    "v_to_w_hypercorrection": False,
    "no_vowel_reduction": False,
}

FEATURE_LABELS = (
    ("w_to_v", "we want → ve vant  (/w/ → /v/)"),
    ("th_to_s", "think → sink  (/θ/ → /s/)"),
    ("dh_to_z", "this → zis, the → ze  (/ð/ → /z/)"),
    ("dh_to_d", "…or this → dis  (/ð/ → /d/)"),
    ("th_to_t", "…or think → tink  (/θ/ → /t/)"),
    ("initial_s_to_z", "see → zee  (initial /s/ → /z/)"),
    ("s_cluster_to_sh", "stop → shtop, speak → shpeak"),
    ("final_devoicing", "dog → dok  (final devoicing)"),
    ("ae_to_e", "bad → bed  (/æ/ → /ɛ/)"),
    ("monophthongise", "name → nehm, go → goh"),
    ("uvular_r", "uvular [ʁ]"),
    ("vocalise_coda_r", "better → bettuh  (coda /r/ → [ɐ])"),
    ("dzh_to_tsh", "job → tschob  (/dʒ/ → /tʃ/)"),
    ("tion_to_tsion", "nation → natsion"),
    ("v_to_w_hypercorrection", "video → wideo  (over-correction)"),
)

_CONSONANTS: Dict[str, List[str]] = {
    "B": ["b"], "D": ["d"], "F": ["f"], "G": ["g"], "K": ["k"],
    "M": ["m"], "N": ["n"], "P": ["p"], "S": ["s"], "T": ["t"],
    "V": ["v"], "Z": ["z"], "L": ["l"], "HH": ["h"],
    "SH": ["sh"], "CH": ["ch"], "Y": ["j"], "NG": ["ng"],
}

# A trailing ":" marks a phonemically long vowel.  German vowel length is
# contrastive, and getting it from the English phoneme is far more accurate
# than guessing it from syllable shape: "name" is long [neːm] while "is" is
# short [ɪs], and both are stressed vowels before a single consonant.
_VOWELS: Dict[str, List[str]] = {
    "AA": ["a:"], "AE": ["e"], "AH": ["a"], "AO": ["o:"],
    "EH": ["e"], "IH": ["i"], "IY": ["i:"], "UH": ["u"], "UW": ["u:"],
    "AW": ["a", "u"], "AY": ["a", "j"], "EY": ["e:"],
    "OW": ["o:"], "OY": ["o", "j"],
}


def map_consonant(base: str, profile: AccentProfile,
                  ctx: Context) -> List[str]:
    if base == "TH":
        if fires(profile, "th_to_t", False):
            return ["t"]
        return ["s"] if fires(profile, "th_to_s") else ["t"]
    if base == "DH":
        if fires(profile, "dh_to_d", False):
            return ["d"]
        return ["z"] if fires(profile, "dh_to_z") else ["d"]
    if base == "W":
        return ["v"] if fires(profile, "w_to_v") else ["u"]
    if base == "V" and fires(profile, "v_to_w_hypercorrection", False):
        return ["v"]
    if base == "R":
        # A coda /r/ vocalises: "better" ends in [ɐ], not a consonant.
        if fires(profile, "vocalise_coda_r"):
            next_is_vowel = _is_vowel_arp(ctx.next_arp)
            if not next_is_vowel:
                return ["ar"]
        return ["R"] if fires(profile, "uvular_r") else ["r"]
    if base == "JH":
        return ["ch"] if fires(profile, "dzh_to_tsh") else ["dzh"]
    if base == "ZH":
        if _tion_ending(ctx.word) == "sion" and fires(profile, "tion_to_tsion"):
            return ["z"]
        return ["sh"] if fires(profile, "zh_to_sh") else ["zh"]
    if base == "SH":
        # <-tion> is [tsi̯oːn] and <-sion> is [zi̯oːn] in German; the vowel
        # half is added by map_vowel when it sees this consonant before it.
        ending = _tion_ending(ctx.word)
        if ending and fires(profile, "tion_to_tsion"):
            return ["ts"] if ending == "tion" else ["z"]
        return ["sh"]
    if base == "S":
        # German <s> is [z] before a vowel at the start of a word, and the
        # clusters <st>/<sp> are [ʃt]/[ʃp] there.
        if ctx.is_initial and fires(profile, "s_cluster_to_sh"):
            if ctx.next_arp in {"T", "P"}:
                return ["sh"]
        if (ctx.is_initial and _is_vowel_arp(ctx.next_arp)
                and fires(profile, "initial_s_to_z")):
            return ["z"]
        return ["s"]
    if base == "NG":
        if ctx.is_final and fires(profile, "ng_to_ngk", False):
            return ["ng", "k"]
        return ["ng"]
    return list(_CONSONANTS.get(base, [base.lower()]))


def map_vowel(base: str, stress: int, profile: AccentProfile,
              ctx: Context) -> List[str]:
    if base == "ER":
        # Stressed "bird" keeps a vowel plus uvular r; unstressed "better"
        # is just the vocalised [ɐ].
        if stress == 0 and fires(profile, "vocalise_coda_r"):
            return ["ar"]
        r = "R" if fires(profile, "uvular_r") else "r"
        if fires(profile, "vocalise_coda_r"):
            return ["e", "ar"]
        return ["e", r]
    if base == "AE":
        return ["e"] if fires(profile, "ae_to_e") else ["a"]
    if base == "AH" and stress == 0:
        # The vowel half of <-tion>/<-sion>: [i̯oː].
        if (ctx.prev_arp in {"SH", "ZH"} and _tion_ending(ctx.word)
                and fires(profile, "tion_to_tsion")):
            return ["i", "o:"]
        # German has a schwa, so reduction survives -- this is a real
        # difference from the Russian pack, which restores the full vowel.
        if not fires(profile, "no_vowel_reduction", False):
            return ["sch"]
        return [ctx.spelling_vowel or "a"]
    # Spelling pronunciation of <o>: English "stop"/"job"/"hot" have /ɑ/,
    # but a German reads the letter and says a short [ɔ].
    if base in {"AA", "AO"} and ctx.spelling_vowel == "o":
        return ["o"]
    if base in {"EY", "OW"} and not fires(profile, "monophthongise"):
        return ["e", "j"] if base == "EY" else ["o", "u"]
    return list(_VOWELS.get(base, ["a"]))


def _is_vowel_arp(arp) -> bool:
    if not arp:
        return False
    base = arp[:-1] if arp[-1].isdigit() else arp
    return base in _VOWELS or base == "ER"


# --------------------------------------------------------------------------
# Post-processes
# --------------------------------------------------------------------------

def shorten_unstressed(phones: List[Phone],
                       profile: AccentProfile) -> List[Phone]:
    """Only a stressed syllable carries full German vowel length."""
    return [replace(p, long=False) if p.is_vowel and p.long and p.stress == 0
            else p for p in phones]


def assimilate_voicing(phones: List[Phone],
                       profile: AccentProfile) -> List[Phone]:
    """German Auslautverhaertung plus progressive cluster devoicing."""
    if not phones:
        return phones
    out = list(phones)

    if fires(profile, "final_devoicing"):
        i = len(out) - 1
        while i >= 0 and out[i].is_obstruent:
            out[i] = devoice(out[i])
            i -= 1

    # German assimilates progressively: a voiceless obstruent devoices what
    # follows it.  /v/ is the exception -- <qu> is [kv] and <schw> is [ʃv],
    # so without excluding it "question" comes out "kfestion".
    for i in range(1, len(out)):
        prev, cur = out[i - 1], out[i]
        if not (prev.is_obstruent and cur.is_obstruent):
            continue
        if cur.sym in TRANSPARENT:
            continue
        if prev.sym in REVOICED or prev.sym in NO_VOICE_PARTNER:
            out[i] = devoice(cur)
    return out


def clear_l(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    """German /l/ is always clear; nothing is velarised."""
    return [replace(p, soft=False) if p.sym == "l" else p for p in phones]


def tidy(phones: List[Phone], profile: AccentProfile) -> List[Phone]:
    out: List[Phone] = []
    for p in phones:
        if out and p.sym == out[-1].sym and not p.is_vowel:
            out[-1] = replace(out[-1], long=True)
            continue
        # [ɐ] straight after another vowel just lengthens it.
        if p.sym == "ar" and out and out[-1].is_vowel and out[-1].sym == "ar":
            continue
        out.append(p)
    return out


# --------------------------------------------------------------------------
# German orthography rendering (for text-driven TTS voices)
# --------------------------------------------------------------------------

_DE_CONSONANT = {
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g",
    "f": "f", "v": "w", "s": "s", "z": "s", "sh": "sch", "zh": "sch",
    "x": "ch", "ts": "z", "ch": "tsch", "shch": "schtsch", "dzh": "dsch",
    "m": "m", "n": "n", "ng": "ng", "l": "l", "r": "r", "R": "r",
    "h": "h", "j": "j",
}

# vowel -> (short spelling, long spelling)
_DE_VOWEL = {
    "a": ("a", "ah"), "e": ("e", "eh"), "i": ("i", "ie"),
    "o": ("o", "oh"), "u": ("u", "uh"), "y": ("i", "ie"),
    "oe": ("ö", "öh"), "ue": ("ü", "üh"),
    "sch": ("e", "e"), "ax": ("a", "a"), "ar": ("er", "er"),
}


def render_german(phones: Sequence[Phone], mark_stress: bool = False) -> str:
    """Spell the phones the way German orthography would, so that a German
    TTS voice reading the text produces the intended sounds."""
    out: List[str] = []
    n = len(phones)
    i = 0
    while i < n:
        p = phones[i]
        nxt = phones[i + 1] if i + 1 < n else None
        prev = phones[i - 1] if i > 0 else None

        if p.is_vowel:
            # Genuine diphthongs get their German digraph.
            if nxt is not None and nxt.sym == "j" and p.sym in ("a", "o"):
                out.append("ei" if p.sym == "a" else "eu")
                i += 2
                continue
            if nxt is not None and nxt.sym == "u" and p.sym == "a":
                out.append("au")
                i += 2
                continue
            short, long_form = _DE_VOWEL.get(p.sym, ("e", "eh"))
            out.append(long_form if p.long else short)
            i += 1
            continue

        letter = _DE_CONSONANT.get(p.sym)
        if letter is not None:
            # Intervocalic [s] needs <ss>, or German reads it as [z].
            if (p.sym == "s" and prev is not None and prev.is_vowel
                    and nxt is not None and nxt.is_vowel):
                letter = "ss"
            out.append(letter)
            if p.long and p.sym not in ("sh", "ch", "ts"):
                out.append(letter)
        i += 1
    return "".join(out)


# --------------------------------------------------------------------------
# IPA and Latin maps
# --------------------------------------------------------------------------

IPA_MAP: Dict[str, List[str]] = {
    "p": ["p"], "b": ["b"], "t": ["t"], "d": ["d"], "k": ["k"],
    "g": ["ɡ", "g"], "f": ["f"], "v": ["v"], "s": ["s"], "z": ["z"],
    "sh": ["ʃ"], "zh": ["ʒ", "ʃ"], "x": ["x", "ç"], "h": ["h"],
    "ts": ["ts"], "ch": ["tʃ"], "shch": ["ʃ"], "dzh": ["dʒ", "tʃ"],
    "m": ["m"], "n": ["n"], "ng": ["ŋ"], "l": ["l"],
    "r": ["r", "ʁ"], "R": ["ʁ", "ʀ", "r"], "j": ["j"],
    "a": ["a", "ɐ"], "e": ["ɛ", "e"], "i": ["ɪ", "i"],
    "o": ["ɔ", "o"], "u": ["ʊ", "u"], "y": ["ɪ", "i"],
    "sch": ["ə"], "ax": ["ɐ", "a"], "ar": ["ɐ", "a"], "oe": ["ø", "œ"], "ue": ["y", "ʏ"],
}

# Long vowels use a different base symbol in the espeak German inventory.
IPA_LONG: Dict[str, List[str]] = {
    "a": ["a"], "e": ["e"], "i": ["i"], "o": ["o"], "u": ["u"],
    "oe": ["ø"], "ue": ["y"],
}

LATIN_MAP: Dict[str, str] = {
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g",
    "f": "f", "v": "v", "s": "s", "z": "z", "sh": "sh", "zh": "zh",
    "x": "ch", "ts": "ts", "ch": "tsch", "shch": "shch", "dzh": "j",
    "m": "m", "n": "n", "ng": "ng", "l": "l", "r": "r", "R": "r",
    "h": "h", "j": "y",
    "a": "a", "e": "e", "i": "i", "o": "o", "u": "u", "y": "i",
    "sch": "uh", "ax": "a", "ar": "ah", "oe": "oe", "ue": "ue",
}


PACK = LanguagePack(
    key="german",
    name="German",
    adjective="German",
    tts_language="de-DE",
    sample_line="Ve have vays of making you talk, my friend.",
    map_consonant=map_consonant,
    map_vowel=map_vowel,
    post_processes=(shorten_unstressed, assimilate_voicing, clear_l,
                    tidy),
    ipa_map=IPA_MAP,
    latin_map=LATIN_MAP,
    render_text=render_german,
    ipa_long=IPA_LONG,
    default_features=DEFAULT_FEATURES,
    feature_labels=FEATURE_LABELS,
    spelling_pronunciation=True,
)
