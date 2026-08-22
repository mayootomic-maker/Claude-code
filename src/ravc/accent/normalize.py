"""Text normalisation: turn written English into speakable English.

The accent engine works on words, so anything that is not a word has to be
spelled out first -- "$4.50" has to become "four dollars fifty cents"
before it can be given a Russian accent.
"""

from __future__ import annotations

import re
from typing import List

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven",
         "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
         "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
         "eighty", "ninety"]
_SCALES = [(10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand"),
           (100, "hundred")]

_ORDINALS = {
    "one": "first", "two": "second", "three": "third", "five": "fifth",
    "eight": "eighth", "nine": "ninth", "twelve": "twelfth",
}

_ABBREVIATIONS = {
    "mr": "mister", "mrs": "missus", "ms": "miz", "dr": "doctor",
    "prof": "professor", "st": "saint", "vs": "versus", "etc": "et cetera",
    "e.g": "for example", "i.e": "that is", "approx": "approximately",
    "dept": "department", "govt": "government", "inc": "incorporated",
    "ltd": "limited", "jr": "junior", "sr": "senior", "no": "number",
    "&": "and", "%": "percent", "+": "plus", "=": "equals", "@": "at",
    "#": "number", "~": "about", "w/": "with", "w/o": "without",
}

_SYMBOL_WORDS = {
    "$": ("dollar", "dollars"), "£": ("pound", "pounds"),
    "€": ("euro", "euros"), "¥": ("yen", "yen"), "₽": ("rouble", "roubles"),
}


def number_to_words(n: int) -> str:
    """Cardinal number in English, handling negatives and scale groups."""
    if n < 0:
        return "minus " + number_to_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, rest = divmod(n, 10)
        return _TENS[tens] + ("" if rest == 0 else " " + _ONES[rest])
    for value, name in _SCALES:
        if n >= value:
            count, rest = divmod(n, value)
            words = number_to_words(count) + " " + name
            if rest:
                joiner = " and " if rest < 100 and value == 100 else " "
                words += joiner + number_to_words(rest)
            return words
    return str(n)


def ordinal_to_words(n: int) -> str:
    words = number_to_words(n)
    parts = words.rsplit(" ", 1)
    last = parts[-1]
    if last in _ORDINALS:
        last = _ORDINALS[last]
    elif last.endswith("y"):
        last = last[:-1] + "ieth"
    else:
        last = last + "th"
    parts[-1] = last
    return " ".join(parts)


def _year_to_words(n: int) -> str:
    """1984 -> "nineteen eighty four"; 2005 -> "two thousand five"."""
    if 1100 <= n <= 1999 or 2100 <= n <= 2999:
        hi, lo = divmod(n, 100)
        if lo == 0:
            return number_to_words(hi) + " hundred"
        if lo < 10:
            return number_to_words(hi) + " oh " + number_to_words(lo)
        return number_to_words(hi) + " " + number_to_words(lo)
    return number_to_words(n)


_MONEY_RE = re.compile(r"([$£€¥₽])\s?(\d[\d,]*)(?:\.(\d{1,2}))?")
_TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
_ORDINAL_RE = re.compile(r"\b(\d+)(st|nd|rd|th)\b", re.I)
_PERCENT_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s?%")
_DECIMAL_RE = re.compile(r"\b(\d[\d,]*)\.(\d+)\b")
_INT_RE = re.compile(r"\b\d[\d,]*\b")
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]+")
_MARKDOWN_RE = re.compile(r"[*_`~]{1,3}")
_WS_RE = re.compile(r"\s+")


def _int(text: str) -> int:
    return int(text.replace(",", ""))


def normalize(text: str) -> str:
    """Expand everything unspeakable into ordinary words."""
    if not text:
        return ""

    text = _EMOJI_RE.sub(" ", text)
    text = _MARKDOWN_RE.sub("", text)
    text = _URL_RE.sub(" link ", text)
    text = _EMAIL_RE.sub(
        lambda m: m.group(0).replace("@", " at ").replace(".", " dot "), text)

    def money(m: re.Match) -> str:
        sym, whole, cents = m.group(1), _int(m.group(2)), m.group(3)
        singular, plural = _SYMBOL_WORDS[sym]
        out = number_to_words(whole) + " " + (singular if whole == 1 else plural)
        if cents:
            c = int(cents.ljust(2, "0"))
            if c:
                out += " " + number_to_words(c) + (" cent" if c == 1 else " cents")
        return out

    text = _MONEY_RE.sub(money, text)
    text = _PERCENT_RE.sub(
        lambda m: _spoken_number(m.group(1)) + " percent", text)
    text = _TIME_RE.sub(
        lambda m: number_to_words(int(m.group(1))) + (
            " o'clock" if m.group(2) == "00"
            else (" oh " if int(m.group(2)) < 10 else " ")
            + number_to_words(int(m.group(2)))), text)
    text = _ORDINAL_RE.sub(lambda m: ordinal_to_words(_int(m.group(1))), text)
    text = _DECIMAL_RE.sub(
        lambda m: number_to_words(_int(m.group(1))) + " point " +
        " ".join(_ONES[int(d)] for d in m.group(2)), text)
    text = _INT_RE.sub(lambda m: _spoken_number(m.group(0)), text)

    # Abbreviations: match the token with an optional trailing period.
    def abbrev(m: re.Match) -> str:
        key = m.group(0).rstrip(".").lower()
        return _ABBREVIATIONS.get(key, m.group(0))

    text = re.sub(r"\b[A-Za-z]{1,6}\.(?=\s|$)", abbrev, text)
    for sym, word in _ABBREVIATIONS.items():
        if not sym.isalpha():
            text = text.replace(sym, f" {word} ")

    return _WS_RE.sub(" ", text).strip()


def _spoken_number(raw: str) -> str:
    value = _int(raw)
    digits = raw.replace(",", "")
    if len(digits) == 4 and not raw.count(","):
        return _year_to_words(value)
    return number_to_words(value)


def split_sentences(text: str) -> List[str]:
    """Split into speakable chunks, keeping the terminating punctuation."""
    parts = re.split(r"(?<=[.!?…])\s+", text)
    return [p.strip() for p in parts if p.strip()]
