"""The public accent API: English text in, Russian-accented speech data out."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

from ..phonetics.g2p import word_to_phonemes
from . import grammar, normalize
from .phonology import (DEFAULT_PROFILE, AccentedWord, AccentProfile, Phone,
                        russify_word)
from .render import to_cyrillic, to_eye_dialect, to_ipa

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z']*|[0-9]+|[^\sA-Za-z0-9]")
_SPEAKABLE_PUNCT = set(".,!?;:…—-")


@dataclass
class AccentResult:
    """Everything the synthesiser and the UI need for one utterance."""

    source: str
    spoken: str = ""
    cyrillic: str = ""
    eye_dialect: str = ""
    words: List[AccentedWord] = field(default_factory=list)
    ipa_words: List[List[List[str]]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.words


@dataclass
class AccentEngine:
    """Stateless-ish facade; hold one and reuse it (the caches are warm)."""

    profile: AccentProfile = field(default_factory=lambda: DEFAULT_PROFILE)
    grammar_strength: float = 0.0
    swap_prepositions: bool = False
    mark_stress: bool = False

    def accentify(self, text: str) -> AccentResult:
        result = AccentResult(source=text)
        if not text or not text.strip():
            return result

        spoken = normalize.normalize(text)
        if self.grammar_strength > 0:
            spoken = grammar.brokenise(
                spoken, self.grammar_strength, self.swap_prepositions)
            # Grammar may reintroduce contractions worth re-normalising.
            spoken = normalize.normalize(spoken)
        result.spoken = spoken

        cyr_parts: List[str] = []
        eye_parts: List[str] = []

        for token in _TOKEN_RE.findall(spoken):
            if token[0].isalpha():
                phones = russify_word(
                    token, list(word_to_phonemes(token)), self.profile)
                if not phones:
                    continue
                word = AccentedWord(original=token, phones=phones)
                result.words.append(word)
                result.ipa_words.append(to_ipa(phones, self.mark_stress))
                cyr_parts.append(to_cyrillic(phones, self.mark_stress))
                eye_parts.append(to_eye_dialect(phones))
            elif token in _SPEAKABLE_PUNCT:
                # Punctuation carries the prosody; glue it to the last word.
                if cyr_parts:
                    cyr_parts[-1] += token
                    eye_parts[-1] += token
                    if result.words:
                        result.words[-1].trailing_punct = token

        result.cyrillic = " ".join(cyr_parts)
        result.eye_dialect = " ".join(eye_parts)
        return result

    def flat_ipa(self, result: AccentResult) -> List[List[str]]:
        """IPA symbol preference-lists for the whole utterance, word-separated."""
        out: List[List[str]] = []
        for i, word in enumerate(result.ipa_words):
            if i:
                out.append([" "])
            out.extend(word)
            punct = result.words[i].trailing_punct if i < len(result.words) else ""
            if punct in ".!?":
                out.append([".", " "])
            elif punct in ",;:":
                out.append([",", " "])
        return out


def accentify(text: str, strength: float = 1.0,
              grammar_strength: float = 0.0,
              profile: Optional[AccentProfile] = None) -> AccentResult:
    """One-shot convenience wrapper."""
    prof = profile or AccentProfile(strength=strength)
    return AccentEngine(profile=prof,
                        grammar_strength=grammar_strength).accentify(text)
