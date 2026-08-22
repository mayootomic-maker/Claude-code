"""Optional "broken English" layer, per accent language.

Russian has no articles and no present-tense copula, so Russian learners
drop both: "I am going to the store" becomes "I going to store".  German
has both, but puts negation after the verb and likes a tag question, so
"I don't know" becomes "I know not, or?".

This is **off by default**, deliberately: the phonetic accent changes how
you sound, but this changes the words you actually said, which is not
always what someone wants when talking to real people.  The GUI exposes it
as a separate "Broken English" slider.

Every decision is derived from a hash of the sentence, so the same input
always produces the same output -- no flickering between takes.
"""

from __future__ import annotations

import hashlib
import re
from typing import Dict, List, Sequence

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

# German keeps articles and the copula; only the negation moves.
_GERMAN_CONTRACTIONS = {
    "don't": "not", "doesn't": "not", "didn't": "not", "can't": "cannot",
    "won't": "will not", "i'm": "I am", "it's": "it is", "that's": "that is",
    "you're": "you are", "we're": "we are", "they're": "they are",
    "he's": "he is", "she's": "she is", "i've": "I have",
}

_KEEP_COPULA_BEFORE = {"not", "no", "never", "there"}
_PREPOSITION_SWAP = {"in": "on", "on": "in", "at": "in"}

_TOKEN_RE = re.compile(r"[\w']+|[^\w\s]")
_TERMINALS = {".", "!", "?"}


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


def _capitalise_like(token: str, pieces: List[str]) -> List[str]:
    if pieces and token[:1].isupper() and pieces[0] != "I":
        pieces = list(pieces)
        pieces[0] = pieces[0][:1].upper() + pieces[0][1:]
    return pieces


def brokenise(text: str, strength: float = 0.0,
              swap_prepositions: bool = False,
              language: str = "russian") -> str:
    """Apply learner grammar to ``text``.

    ``strength`` 0 returns the text untouched; 1 applies every rule.
    """
    if strength <= 0.0 or not text.strip():
        return text
    if language == "german":
        return _brokenise_german(text, strength)
    return _brokenise_russian(text, strength, swap_prepositions)


# --------------------------------------------------------------------------
# Russian: no articles, no present-tense copula, no do-support
# --------------------------------------------------------------------------

def _brokenise_russian(text: str, strength: float,
                       swap_prepositions: bool) -> str:
    tokens = _TOKEN_RE.findall(text)
    rolls = _rand_stream(text, len(tokens) * 2)
    out: List[str] = []

    for i, token in enumerate(tokens):
        low = token.lower()
        roll = rolls[i]

        if low in _CONTRACTIONS and roll < strength:
            out.extend(_capitalise_like(token, _CONTRACTIONS[low].split()))
            continue

        if low in ARTICLES and roll < strength:
            continue

        if low in COPULA:
            nxt = tokens[i + 1].lower() if i + 1 < len(tokens) else ""
            prev = out[-1].lower() if out else ""
            if nxt not in _KEEP_COPULA_BEFORE and prev != "there":
                if roll < strength:
                    continue

        if low in DO_SUPPORT and i + 1 < len(tokens):
            if tokens[i + 1].lower() in {"not", "n't"} and roll < strength:
                continue

        if swap_prepositions and low in _PREPOSITION_SWAP:
            if rolls[len(tokens) + i] < strength * 0.4:
                token = _PREPOSITION_SWAP[low]

        out.append(token)

    return _detokenise(out)


# --------------------------------------------------------------------------
# German: negation after the verb, time-before-place, tag questions
# --------------------------------------------------------------------------

_GERMAN_TIME_WORDS = {"tomorrow", "today", "yesterday", "tonight", "now",
                      "later", "soon", "always", "never", "often"}


def _brokenise_german(text: str, strength: float) -> str:
    tokens = _TOKEN_RE.findall(text)
    rolls = _rand_stream(text, len(tokens) + 4)
    out: List[str] = []

    i = 0
    while i < len(tokens):
        token = tokens[i]
        low = token.lower()
        roll = rolls[i]

        if low in _GERMAN_CONTRACTIONS and roll < strength:
            out.extend(_capitalise_like(token, _GERMAN_CONTRACTIONS[low].split()))
            i += 1
            continue

        # "do not know" -> "know not": German puts nicht after the verb.
        if (low in DO_SUPPORT and i + 2 < len(tokens)
                and tokens[i + 1].lower() in {"not", "n't"}
                and roll < strength):
            out.append(tokens[i + 2])
            out.append("not")
            i += 3
            continue

        out.append(token)
        i += 1

    # "I go tomorrow to the store": German orders time before place.
    out = _move_time_adverbs(out, strength, rolls)

    text_out = _detokenise(out)
    # A German speaker's tag question: "…, oder?"
    if rolls[-1] < strength * 0.35 and text_out.endswith("."):
        text_out = text_out[:-1] + ", or?"
    return text_out


def _move_time_adverbs(tokens: List[str], strength: float,
                       rolls: Sequence[float]) -> List[str]:
    """Pull a sentence-final time adverb forward, just after the verb."""
    if len(tokens) < 4 or rolls[0] >= strength * 0.6:
        return tokens
    tail = len(tokens) - 1
    while tail >= 0 and tokens[tail] in {".", "!", "?", ","}:
        tail -= 1
    if tail < 2 or tokens[tail].lower() not in _GERMAN_TIME_WORDS:
        return tokens
    adverb = tokens.pop(tail)
    insert_at = min(2, len(tokens))
    tokens.insert(insert_at, adverb)
    return tokens


# --------------------------------------------------------------------------

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
