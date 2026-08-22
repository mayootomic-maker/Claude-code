"""Rule-based English letter-to-sound conversion.

This is a condensed, modernised implementation of the classic NRL
(Naval Research Laboratory) text-to-phoneme rule set.  It exists so the
accent engine keeps working on words a pronunciation dictionary has never
seen: names, gamer-tags, slang, typos and made-up words.  Accuracy is in
the high-80% range per phoneme, which is plenty once the output is going
to be deliberately mangled into a Russian accent anyway.

Rule format
-----------
Each rule is ``(left_context, match, right_context, phonemes)`` where the
contexts use the NRL meta-characters:

======  ====================================================================
``#``   one or more vowels
``:``   zero or more consonants
``^``   exactly one consonant
``.``   one voiced consonant (B D V G J L M N R W Z)
``+``   one front vowel (E I Y)
``%``   a suffix: E, ES, ED, ER, ING, ELY
``&``   one sibilant (S C G Z X J) or the digraphs CH / SH
``@``   a consonant after which "long U" is pronounced /u/ (T S R D L Z N J)
``$``   word boundary (start when in the left context, end in the right)
======  ====================================================================
"""

from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

Rule = Tuple[str, str, str, str]

_VOWEL_LETTERS = set("AEIOUY")
_CONSONANT_LETTERS = set("BCDFGHJKLMNPQRSTVWXZ")
_VOICED_CONSONANTS = set("BDVGJLMNRWZ")
_FRONT_VOWELS = set("EIY")
_SIBILANTS = set("SCGZXJ")
_LONG_U_CONSONANTS = set("TSRDLZNJ")
_SUFFIXES = ("ELY", "ING", "ED", "ES", "ER", "E")


# --------------------------------------------------------------------------
# Context matching
# --------------------------------------------------------------------------

def _match_right(text: str, pos: int, pattern: str) -> bool:
    """Does ``pattern`` match ``text`` starting at ``pos``, reading forward?"""
    i = pos
    for pi, ch in enumerate(pattern):
        if ch == "#":
            if i >= len(text) or text[i] not in _VOWEL_LETTERS:
                return False
            while i < len(text) and text[i] in _VOWEL_LETTERS:
                i += 1
        elif ch == ":":
            while i < len(text) and text[i] in _CONSONANT_LETTERS:
                i += 1
        elif ch == "^":
            if i >= len(text) or text[i] not in _CONSONANT_LETTERS:
                return False
            i += 1
        elif ch == ".":
            if i >= len(text) or text[i] not in _VOICED_CONSONANTS:
                return False
            i += 1
        elif ch == "+":
            if i >= len(text) or text[i] not in _FRONT_VOWELS:
                return False
            i += 1
        elif ch == "&":
            if i < len(text) and text[i] in _SIBILANTS:
                i += 1
            elif text[i:i + 2] in ("CH", "SH"):
                i += 2
            else:
                return False
        elif ch == "@":
            if i >= len(text) or text[i] not in _LONG_U_CONSONANTS:
                return False
            i += 1
        elif ch == "%":
            for suffix in _SUFFIXES:
                if text.startswith(suffix, i):
                    i += len(suffix)
                    break
            else:
                return False
        elif ch == "$":
            if i != len(text):
                return False
        else:
            if i >= len(text) or text[i] != ch:
                return False
            i += 1
    return True


def _match_left(text: str, pos: int, pattern: str) -> bool:
    """Does ``pattern`` match the text ending at ``pos``, reading backward?"""
    i = pos
    for ch in reversed(pattern):
        if ch == "#":
            if i <= 0 or text[i - 1] not in _VOWEL_LETTERS:
                return False
            while i > 0 and text[i - 1] in _VOWEL_LETTERS:
                i -= 1
        elif ch == ":":
            while i > 0 and text[i - 1] in _CONSONANT_LETTERS:
                i -= 1
        elif ch == "^":
            if i <= 0 or text[i - 1] not in _CONSONANT_LETTERS:
                return False
            i -= 1
        elif ch == ".":
            if i <= 0 or text[i - 1] not in _VOICED_CONSONANTS:
                return False
            i -= 1
        elif ch == "+":
            if i <= 0 or text[i - 1] not in _FRONT_VOWELS:
                return False
            i -= 1
        elif ch == "&":
            if i > 0 and text[i - 1] in _SIBILANTS:
                i -= 1
            elif i >= 2 and text[i - 2:i] in ("CH", "SH"):
                i -= 2
            else:
                return False
        elif ch == "@":
            if i <= 0 or text[i - 1] not in _LONG_U_CONSONANTS:
                return False
            i -= 1
        elif ch == "$":
            if i != 0:
                return False
        else:
            if i <= 0 or text[i - 1] != ch:
                return False
            i -= 1
    return True


# --------------------------------------------------------------------------
# Rule table, indexed by first letter of the match for speed
# --------------------------------------------------------------------------

_RULES: Sequence[Rule] = (
    # ---- A -------------------------------------------------------------
    ("$", "A", "$", "AH0"),
    ("", "ARE", "$", "AA1 R"),
    ("", "AR", "O", "AH0 R"),
    ("", "AR", "#", "EH1 R"),
    ("^", "AS", "#", "EY1 S"),
    ("", "A", "WA", "AH0"),
    ("", "AW", "", "AO1"),
    (":", "ANY", "", "EH1 N IY0"),
    ("", "A", "^+#", "EY1"),
    ("#:", "ALLY", "", "AH0 L IY0"),
    ("$", "AL", "#", "AH0 L"),
    ("", "AGAIN", "", "AH0 G EH1 N"),
    ("#:", "AG", "E", "IH0 JH"),
    ("", "A", "^+:#", "AE1"),
    (":", "A", "^+ ", "EY1"),
    ("", "A", "^%", "EY1"),
    ("", "ARR", "", "ER0"),
    ("", "AR", "", "AA1 R"),
    ("", "AIR", "", "EH1 R"),
    ("", "AI", "", "EY1"),
    ("", "AY", "", "EY1"),
    ("", "AU", "", "AO1"),
    ("#:", "AL", "$", "AH0 L"),
    ("#:", "ALS", "$", "AH0 L Z"),
    ("", "ALK", "", "AO1 K"),
    ("", "AL", "^", "AO1 L"),
    ("$:", "ABLE", "", "EY1 B AH0 L"),
    ("", "ABLE", "", "AH0 B AH0 L"),
    ("", "ANG", "+", "EY1 N JH"),
    ("#:", "A", "$", "AH0"),
    ("^", "A", "$", "AH0"),
    ("", "A", "", "AE0"),

    # ---- B -------------------------------------------------------------
    ("$", "BE", "^#", "B IH0"),
    ("", "BEING", "", "B IY1 IH0 NG"),
    ("$", "BOTH", "$", "B OW1 TH"),
    ("$", "BUS", "#", "B IH1 Z"),
    ("", "BUIL", "", "B IH1 L"),
    ("", "B", "", "B"),

    # ---- C -------------------------------------------------------------
    ("$", "CH", "^", "K"),
    ("^E", "CH", "", "K"),
    ("", "CH", "", "CH"),
    (" S", "CI", "#", "S AY1"),
    ("", "CI", "A", "SH"),
    ("", "CI", "O", "SH"),
    ("", "CI", "EN", "SH"),
    ("", "CITY", "", "S IH1 T IY0"),
    ("", "C", "+", "S"),
    ("", "CK", "", "K"),
    ("", "COM", "%", "K AH1 M"),
    ("", "C", "", "K"),

    # ---- D -------------------------------------------------------------
    ("#:", "DED", "$", "D IH0 D"),
    (".E", "D", "$", "D"),
    ("#:^E", "D", "$", "T"),
    ("$", "DE", "^#", "D IH0"),
    ("$", "DO", "$", "D UW1"),
    ("$", "DOES", "", "D AH1 Z"),
    ("$", "DOING", "", "D UW1 IH0 NG"),
    ("$", "DOW", "", "D AW1"),
    ("", "DU", "A", "JH UW1"),
    ("", "D", "", "D"),

    # ---- E -------------------------------------------------------------
    ("#:", "E", "$", ""),
    ("':^", "E", "$", ""),
    (" :", "E", "$", "IY1"),
    ("#", "ED", "$", "D"),
    ("#:", "E", "D$", ""),
    ("", "EV", "ER", "EH1 V"),
    ("", "E", "^%", "IY1"),
    ("", "ERI", "#", "IY1 R IY0"),
    ("", "ERI", "", "EH1 R IH0"),
    ("#:", "ER", "#", "ER1"),
    ("", "ER", "#", "EH1 R"),
    ("", "ER", "", "ER0"),
    ("$", "EVEN", "", "IY1 V EH0 N"),
    ("#:", "E", "W", ""),
    ("T", "EW", "", "UW1"),
    ("S", "EW", "", "UW1"),
    ("R", "EW", "", "UW1"),
    ("D", "EW", "", "UW1"),
    ("L", "EW", "", "UW1"),
    ("Z", "EW", "", "UW1"),
    ("N", "EW", "", "UW1"),
    ("J", "EW", "", "UW1"),
    ("TH", "EW", "", "UW1"),
    ("CH", "EW", "", "UW1"),
    ("SH", "EW", "", "UW1"),
    ("", "EW", "", "Y UW1"),
    ("", "E", "O", "IY0"),
    ("#:S", "ES", "$", "IH0 Z"),
    ("#:C", "ES", "$", "IH0 Z"),
    ("#:G", "ES", "$", "IH0 Z"),
    ("#:Z", "ES", "$", "IH0 Z"),
    ("#:X", "ES", "$", "IH0 Z"),
    ("#:J", "ES", "$", "IH0 Z"),
    ("#:CH", "ES", "$", "IH0 Z"),
    ("#:SH", "ES", "$", "IH0 Z"),
    ("#:", "E", "S$", ""),
    ("#:", "ELY", "$", "L IY0"),
    ("#:", "EMENT", "", "M EH0 N T"),
    ("", "EFUL", "", "F UH1 L"),
    ("", "EE", "", "IY1"),
    ("", "EARN", "", "ER1 N"),
    ("$", "EAR", "^", "ER1"),
    ("", "EAD", "", "EH1 D"),
    ("#:", "EA", "$", "IY1 AH0"),
    ("", "EA", "SU", "EH1"),
    ("", "EA", "", "IY1"),
    ("", "EIGH", "", "EY1"),
    ("", "EI", "", "IY1"),
    ("$", "EYE", "", "AY1"),
    ("", "EY", "", "IY0"),
    ("", "EU", "", "Y UW1"),
    ("", "E", "", "EH0"),

    # ---- F -------------------------------------------------------------
    ("", "FUL", "", "F UH1 L"),
    ("", "F", "", "F"),

    # ---- G -------------------------------------------------------------
    ("", "GIV", "", "G IH1 V"),
    ("$", "G", "I^", "G"),
    ("", "GE", "T", "G EH1"),
    ("SU", "GGES", "", "G JH EH1 S"),
    ("", "GG", "", "G"),
    (" B#", "G", "", "G"),
    ("", "G", "+", "JH"),
    ("", "GREAT", "", "G R EY1 T"),
    ("#", "GH", "", ""),
    ("", "GN", "$", "N"),
    ("", "G", "", "G"),

    # ---- H -------------------------------------------------------------
    ("$", "HAV", "", "HH AE1 V"),
    ("$", "HERE", "", "HH IY1 R"),
    ("$", "HOUR", "", "AW1 ER0"),
    ("", "HOW", "", "HH AW1"),
    ("", "H", "#", "HH"),
    ("", "H", "", ""),

    # ---- I -------------------------------------------------------------
    ("$", "IN", "", "IH0 N"),
    ("$", "I", "$", "AY1"),
    ("", "IN", "D", "AY1 N"),
    ("", "IER", "", "IY1 ER0"),
    ("#:R", "IED", "$", "IY0 D"),
    ("", "IED", "$", "AY1 D"),
    ("", "IEN", "", "IY0 EH0 N"),
    ("", "IE", "T", "AY1 EH0"),
    (" :", "I", "%", "AY1"),
    ("", "I", "%", "IY1"),
    ("", "IE", "", "IY1"),
    ("", "I", "^+:#", "IH1"),
    ("", "IR", "#", "AY1 R"),
    ("", "IZ", "%", "AY1 Z"),
    ("", "IS", "%", "AY1 Z"),
    ("", "I", "D%", "AY1"),
    ("+^", "I", "^+", "IH1"),
    ("", "I", "T%", "AY1"),
    ("#:^", "I", "^+", "IH1"),
    ("", "I", "^+", "AY1"),
    ("", "IR", "", "ER1"),
    ("", "IGH", "", "AY1"),
    ("", "ILD", "", "AY1 L D"),
    ("", "IGN", "$", "AY1 N"),
    ("", "IGN", "^", "AY1 N"),
    ("", "IGN", "%", "AY1 N"),
    ("", "IQUE", "", "IY1 K"),
    ("", "I", "", "IH0"),

    # ---- J -------------------------------------------------------------
    ("", "J", "", "JH"),

    # ---- K -------------------------------------------------------------
    ("$", "K", "N", ""),
    ("", "K", "", "K"),

    # ---- L -------------------------------------------------------------
    ("", "LO", "C#", "L OW1"),
    ("L", "L", "", ""),
    ("#:^", "L", "%", "AH0 L"),
    ("", "LEAD", "", "L IY1 D"),
    ("", "L", "", "L"),

    # ---- M -------------------------------------------------------------
    ("", "MOV", "", "M UW1 V"),
    ("", "M", "", "M"),

    # ---- N -------------------------------------------------------------
    ("E", "NG", "+", "N JH"),
    ("", "NG", "R", "NG G"),
    ("", "NG", "#", "NG G"),
    ("", "NGL", "%", "NG G AH0 L"),
    ("", "NG", "", "NG"),
    ("", "NK", "", "NG K"),
    ("$", "NOW", "$", "N AW1"),
    ("", "N", "", "N"),

    # ---- O -------------------------------------------------------------
    ("", "OF", "$", "AH1 V"),
    ("", "OROUGH", "", "ER1 OW0"),
    ("#:", "OR", "$", "ER0"),
    ("#:", "ORS", "$", "ER0 Z"),
    ("", "OR", "", "AO1 R"),
    ("$", "ONE", "", "W AH1 N"),
    ("", "OW", "", "OW1"),
    ("$", "OVER", "", "OW1 V ER0"),
    ("", "OV", "", "AH1 V"),
    ("", "O", "^%", "OW1"),
    ("", "O", "^EN", "OW1"),
    ("", "O", "^I#", "OW1"),
    ("", "OL", "D", "OW1 L"),
    ("", "OUGHT", "", "AO1 T"),
    ("", "OUGH", "", "AH1 F"),
    ("$", "OU", "", "AW1"),
    ("H", "OU", "S#", "AW1"),
    ("", "OUS", "", "AH0 S"),
    ("", "OUR", "", "AO1 R"),
    ("", "OULD", "", "UH1 D"),
    ("^", "OU", "^L", "AH1"),
    ("", "OUP", "", "UW1 P"),
    ("", "OU", "", "AW1"),
    ("", "OY", "", "OY1"),
    ("", "OING", "", "OW1 IH0 NG"),
    ("", "OI", "", "OY1"),
    ("", "OOR", "", "AO1 R"),
    ("", "OOK", "", "UH1 K"),
    ("", "OOD", "", "UH1 D"),
    ("", "OO", "", "UW1"),
    ("", "O", "E", "OW1"),
    ("", "O", "$", "OW1"),
    ("", "OA", "", "OW1"),
    ("$", "ONLY", "", "OW1 N L IY0"),
    ("$", "ONCE", "", "W AH1 N S"),
    ("", "ON'T", "", "OW1 N T"),
    ("C", "O", "N", "AA1"),
    ("", "O", "NG", "AO1"),
    (" :^", "O", "N", "AH1"),
    ("I", "ON", "", "AH0 N"),
    ("#:", "ON", "$", "AH0 N"),
    ("#^", "ON", "", "AH0 N"),
    ("", "O", "ST ", "OW1"),
    ("", "OF", "^", "AO1 F"),
    ("", "OTHER", "", "AH1 DH ER0"),
    ("", "OSS", "$", "AO1 S"),
    ("#:^", "OM", "", "AH1 M"),
    ("", "O", "", "AA1"),

    # ---- P -------------------------------------------------------------
    ("", "PH", "", "F"),
    ("", "PEOP", "", "P IY1 P"),
    ("", "POW", "", "P AW1"),
    ("", "PUT", "$", "P UH1 T"),
    ("$", "P", "S", ""),
    ("$", "P", "N", ""),
    ("", "P", "", "P"),

    # ---- Q -------------------------------------------------------------
    ("", "QUAR", "", "K W AO1 R"),
    ("", "QU", "", "K W"),
    ("", "Q", "", "K"),

    # ---- R -------------------------------------------------------------
    ("$", "RE", "^#", "R IY0"),
    ("", "R", "", "R"),

    # ---- S -------------------------------------------------------------
    ("", "SH", "", "SH"),
    ("#", "SION", "", "ZH AH0 N"),
    ("", "SION", "", "SH AH0 N"),
    ("", "SOME", "", "S AH1 M"),
    ("#", "SUR", "#", "ZH ER0"),
    ("", "SUR", "#", "SH ER0"),
    ("#", "SU", "#", "ZH UW1"),
    ("#", "SSU", "#", "SH UW1"),
    ("#", "SED", "$", "Z D"),
    ("#", "S", "#", "Z"),
    ("", "SAID", "", "S EH1 D"),
    ("^", "SION", "", "SH AH0 N"),
    ("", "S", "S", ""),
    (".", "S", "$", "Z"),
    ("#:.E", "S", "$", "Z"),
    ("#:^##", "S", "$", "Z"),
    ("#:^#", "S", "$", "S"),
    ("U", "S", "$", "S"),
    (" :#", "S", "$", "Z"),
    ("$", "SCH", "", "S K"),
    ("", "S", "C+", ""),
    ("#", "SM", "$", "Z AH0 M"),
    ("#", "SN", "'", "Z AH0 N"),
    ("", "STLE", "", "S AH0 L"),
    ("", "S", "", "S"),

    # ---- T -------------------------------------------------------------
    ("$", "THE", "$", "DH AH0"),
    ("", "TO", "$", "T UW1"),
    ("", "THAT", "$", "DH AE1 T"),
    ("$", "THIS", "$", "DH IH1 S"),
    ("$", "THEY", "", "DH EY1"),
    ("$", "THERE", "", "DH EH1 R"),
    ("", "THER", "", "DH ER0"),
    ("", "THEIR", "", "DH EH1 R"),
    ("$", "THAN", "$", "DH AE1 N"),
    ("$", "THEM", "$", "DH EH1 M"),
    ("", "THESE", "$", "DH IY1 Z"),
    ("$", "THEN", "", "DH EH1 N"),
    ("", "THROUGH", "", "TH R UW1"),
    ("", "THOSE", "", "DH OW1 Z"),
    ("", "THOUGH", "$", "DH OW1"),
    ("$", "THUS", "", "DH AH1 S"),
    ("", "TH", "", "TH"),
    ("#:", "TED", "$", "T IH0 D"),
    ("S", "TI", "#N", "CH"),
    ("", "TI", "O", "SH"),
    ("", "TI", "A", "SH"),
    ("", "TIEN", "", "SH AH0 N"),
    ("", "TUR", "#", "CH ER0"),
    ("", "TU", "A", "CH UW1"),
    ("$", "TWO", "", "T UW1"),
    ("", "T", "", "T"),

    # ---- U -------------------------------------------------------------
    ("$", "UN", "I", "Y UW1 N"),
    ("$", "UN", "", "AH1 N"),
    ("$", "UPON", "", "AH0 P AO1 N"),
    ("@", "UR", "#", "UH1 R"),
    ("", "UR", "#", "Y UH1 R"),
    ("", "UR", "", "ER1"),
    ("", "U", "^ ", "AH1"),
    ("", "U", "^^", "AH1"),
    ("", "UY", "", "AY1"),
    (" G", "U", "#", ""),
    ("G", "U", "%", ""),
    ("G", "U", "#", "W"),
    ("#N", "U", "", "Y UW1"),
    ("@", "U", "", "UW1"),
    ("", "U", "", "Y UW1"),

    # ---- V -------------------------------------------------------------
    ("", "VIEW", "", "V Y UW1"),
    ("", "V", "", "V"),

    # ---- W -------------------------------------------------------------
    ("$", "WERE", "", "W ER1"),
    ("", "WA", "S", "W AA1"),
    ("", "WA", "T", "W AA1"),
    ("", "WHERE", "", "W EH1 R"),
    ("", "WHAT", "", "W AA1 T"),
    ("", "WHOL", "", "HH OW1 L"),
    ("", "WHO", "", "HH UW1"),
    ("", "WH", "", "W"),
    ("", "WAR", "", "W AO1 R"),
    ("", "WOR", "^", "W ER1"),
    ("", "WR", "", "R"),
    ("", "W", "", "W"),

    # ---- X -------------------------------------------------------------
    ("$", "X", "", "Z"),
    ("", "X", "", "K S"),

    # ---- Y -------------------------------------------------------------
    ("", "YOUNG", "", "Y AH1 NG"),
    ("$", "YOU", "", "Y UW1"),
    ("$", "YES", "", "Y EH1 S"),
    ("$", "Y", "", "Y"),
    ("#:^", "Y", "$", "IY0"),
    ("#:^", "Y", "I", "IY0"),
    (" :", "Y", "$", "AY1"),
    (" :", "Y", "#", "AY1"),
    (" :", "Y", "^+:#", "IH1"),
    (" :", "Y", "^#", "AY1"),
    ("", "Y", "", "IH0"),

    # ---- Z -------------------------------------------------------------
    ("", "Z", "", "Z"),

    # ---- digits & symbols ----------------------------------------------
    ("", "0", "", "Z IY1 R OW0"),
    ("", "1", "", "W AH1 N"),
    ("", "2", "", "T UW1"),
    ("", "3", "", "TH R IY1"),
    ("", "4", "", "F AO1 R"),
    ("", "5", "", "F AY1 V"),
    ("", "6", "", "S IH1 K S"),
    ("", "7", "", "S EH1 V AH0 N"),
    ("", "8", "", "EY1 T"),
    ("", "9", "", "N AY1 N"),
    ("", "'", "", ""),
    ("", "-", "", ""),
)


def _build_index() -> Dict[str, List[Rule]]:
    index: Dict[str, List[Rule]] = {}
    for rule in _RULES:
        index.setdefault(rule[1][0], []).append(rule)
    return index


_RULE_INDEX = _build_index()


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def word_to_phonemes(word: str) -> List[str]:
    """Convert a single orthographic word to a list of ARPAbet phones."""
    text = "".join(ch for ch in word.upper() if ch.isalnum() or ch == "'")
    if not text:
        return []

    phones: List[str] = []
    pos = 0
    guard = 0
    while pos < len(text) and guard < 4096:
        guard += 1
        letter = text[pos]
        for left, match, right, out in _RULE_INDEX.get(letter, ()):
            if not text.startswith(match, pos):
                continue
            if left and not _match_left(text, pos, left):
                continue
            if right and not _match_right(text, pos + len(match), right):
                continue
            if out:
                phones.extend(out.split())
            pos += len(match)
            break
        else:
            # No rule fired: skip the character rather than looping forever.
            pos += 1

    return _postprocess(phones)


def _postprocess(phones: List[str]) -> List[str]:
    """Clean-ups the rule table cannot express locally."""
    if not phones:
        return phones

    # Collapse identical adjacent consonants (LTS sometimes doubles them).
    cleaned: List[str] = []
    for p in phones:
        if cleaned and p == cleaned[-1] and not p[-1].isdigit():
            continue
        cleaned.append(p)

    # Guarantee at least one vowel, otherwise TTS has nothing to sing.
    if not any(p[-1].isdigit() for p in cleaned):
        cleaned.append("AH0")

    # Exactly one primary stress: promote the first stressable vowel if the
    # rules produced none, demote extras to secondary.
    seen_primary = False
    for i, p in enumerate(cleaned):
        if not p[-1].isdigit():
            continue
        if p.endswith("1"):
            if seen_primary:
                cleaned[i] = p[:-1] + "2"
            else:
                seen_primary = True
    if not seen_primary:
        for i, p in enumerate(cleaned):
            if p[-1].isdigit():
                cleaned[i] = p[:-1] + "1"
                break

    return cleaned
