"""Optional "broken English" layer.

Russian has no articles and no present-tense copula, so Russian learners of
English drop both -- "I am going to the store" becomes "I going to store".
This module reproduces that interlanguage grammar.

It is **off by default**, deliberately: the phonetic accent changes how you
sound, but this changes the words you actually said, which is not always
what someone wants when they are using a voice changer to talk to real
people.  The GUI exposes it as a separate "Broken English" slider.

Every decision is derived from a hash of the sentence, so the same input
always produces the same output -- no flickering between takes.
"""

from __future__ import annotations

import hashlib
import re
from typing import List, Sequence

ARTICLES = {"a", "an", "the"}

COPULA = {"is", "are", "am", "'s", "'re", "'m"}

DO_SUPPORT = {"do", "does", "did"}

_CONTRACTIONS = {
    "don't": "not", "doesn't": "not", "didn't": "not",
    "isn't": "not", "aren't": "not", "wasn't": "not", "weren't": "not",
    "i'm": "I", "you're": "you", "we're": "we", "they're": "they",
    "he's": "he", "she's": "she", "it's": "it", "that's": "that",
    "there's": "there", "i've": "I have", "can't": "cannot",
}

# Words that must keep the copula, because dropping it destroys the sentence.
_KEEP_COPULA_BEFORE = {"not", "no", "never", "there"}

_PREPOSITION_SWAP = {"in": "on", "on": "in", "at": "in"}

_TOKEN_RE = re.compile(r"[\w']+|[^\w\s]")


def _rand_stream(seed_text: str, count: int) -> List[float]:
    """Deterministic pseudo-random floats derived from the sentence text."""
    out: List[float] = []
    counter = 0
    while len(out) < count:
        digest = hashlib.blake2b(
            f"{seed_text}|{counter}".encode("utf-8"), digest_size=32).digest()
        for i in range(0, 32, 4):
            out.append(int.from_bytes(digest[i:i + 4], "big") / 2 ** 32)
            if len(out) >= count:
                break
        counter += 1
    return out


def _is_word(token: str) -> bool:
    return bool(token) and (token[0].isalpha() or token[0] == "'")


def brokenise(text: str, strength: float = 0.0,
              swap_prepositions: bool = False) -> str:
    """Apply Russian-learner grammar to ``text``.

    ``strength`` 0 returns the text untouched; 1 drops every article and
    every present-tense copula.
    """
    if strength <= 0.0 or not text.strip():
        return text

    tokens = _TOKEN_RE.findall(text)
    rolls = _rand_stream(text, len(tokens) * 2)
    out: List[str] = []

    for i, token in enumerate(tokens):
        low = token.lower()
        roll = rolls[i]

        # Expand contractions first so the rules below can see the pieces.
        if low in _CONTRACTIONS and roll < strength:
            replacement = _CONTRACTIONS[low]
            if replacement:
                pieces = replacement.split()
                if token[0].isupper() and pieces[0] != "I":
                    pieces[0] = pieces[0][0].upper() + pieces[0][1:]
                out.extend(pieces)
            continue

        if low in ARTICLES and _is_word(token):
            if roll < strength:
                continue

        if low in COPULA:
            nxt = tokens[i + 1].lower() if i + 1 < len(tokens) else ""
            prev = out[-1].lower() if out else ""
            # "is" as a main verb of existence, or a negated copula, must stay.
            if nxt not in _KEEP_COPULA_BEFORE and prev != "there":
                if roll < strength:
                    continue

        if low in DO_SUPPORT and i + 1 < len(tokens):
            nxt = tokens[i + 1].lower()
            if nxt in {"not", "n't"} and roll < strength:
                continue  # "do not know" -> "not know"

        if swap_prepositions and low in _PREPOSITION_SWAP:
            if rolls[len(tokens) + i] < strength * 0.4:
                token = _PREPOSITION_SWAP[low]

        out.append(token)

    return _detokenise(out)


def _detokenise(tokens: Sequence[str]) -> str:
    parts: List[str] = []
    for token in tokens:
        if not parts:
            parts.append(token)
            continue
        if token in {",", ".", "!", "?", ";", ":", "'", "…", "%", ")"}:
            parts[-1] = parts[-1] + token
        elif token in {"(", "$", "£", "€"}:
            parts.append(token)
        elif token.startswith("'"):
            parts[-1] = parts[-1] + token
        else:
            parts.append(token)
    text = " ".join(parts)
    text = re.sub(r"\s+([,.!?;:…])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    return re.sub(r"\s{2,}", " ", text).strip()
