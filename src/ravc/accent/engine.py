"""The public accent API: English text in, accented speech data out."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

from ..phonetics.g2p import word_to_phonemes
from . import grammar, normalize
from .languages import DEFAULT_LANGUAGE, get_pack
from .languages.base import AccentProfile, LanguagePack
from .phonology import AccentedWord, accentify_word, to_audio_phones
from .render import to_eye_dialect, to_ipa, to_native_text

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z']*|[0-9]+|[^\sA-Za-z0-9]")
_SPEAKABLE_PUNCT = set(".,!?;:…—-")


@dataclass
class AccentResult:
    """Everything the synthesiser and the UI need for one utterance."""

    source: str
    spoken: str = ""
    native_text: str = ""     # Cyrillic for Russian, German spelling for German
    eye_dialect: str = ""
    language: str = DEFAULT_LANGUAGE
    words: List[AccentedWord] = field(default_factory=list)
    ipa_words: List[List[List[str]]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.words

    @property
    def cyrillic(self) -> str:
        """Backwards-compatible alias for :attr:`native_text`."""
        return self.native_text


@dataclass
class AccentEngine:
    """Hold one and reuse it -- the phonetics caches stay warm."""

    language: str = DEFAULT_LANGUAGE
    profile: Optional[AccentProfile] = None
    grammar_strength: float = 0.0
    swap_prepositions: bool = False
    mark_stress: bool = False

    def __post_init__(self) -> None:
        self._pack: LanguagePack = get_pack(self.language)
        if self.profile is None:
            self.profile = self._pack.profile()
        self.language = self._pack.key

    @property
    def pack(self) -> LanguagePack:
        return self._pack

    def set_language(self, language: str,
                     profile: Optional[AccentProfile] = None) -> None:
        self._pack = get_pack(language)
        self.language = self._pack.key
        self.profile = profile or self._pack.profile(
            self.profile.strength if self.profile else 1.0)

    def accentify(self, text: str) -> AccentResult:
        result = AccentResult(source=text, language=self.language)
        if not text or not text.strip():
            return result

        spoken = normalize.normalize(text)
        if self.grammar_strength > 0:
            spoken = grammar.brokenise(spoken, self.grammar_strength,
                                       self.swap_prepositions, self.language)
            spoken = normalize.normalize(spoken)
        result.spoken = spoken

        native_parts: List[str] = []
        eye_parts: List[str] = []

        for token in _TOKEN_RE.findall(spoken):
            if token[0].isalpha():
                phones = accentify_word(token, list(word_to_phonemes(token)),
                                        self._pack, self.profile)
                if not phones:
                    continue
                # The written form and the phoneme form diverge: a text-driven
                # voice applies its own reduction, a phoneme-driven one needs
                # it spelled out. See LanguagePack.audio_post_processes.
                audio = to_audio_phones(phones, self._pack, self.profile)
                result.words.append(AccentedWord(
                    original=token, phones=phones, audio_phones=audio))
                result.ipa_words.append(
                    to_ipa(audio, self._pack, self.mark_stress))
                native_parts.append(
                    to_native_text(phones, self._pack, self.mark_stress))
                eye_parts.append(to_eye_dialect(audio, self._pack))
            elif token in _SPEAKABLE_PUNCT:
                # Punctuation carries the prosody; glue it to the last word.
                if native_parts:
                    native_parts[-1] += token
                    eye_parts[-1] += token
                    if result.words:
                        result.words[-1].trailing_punct = token

        result.native_text = " ".join(native_parts)
        result.eye_dialect = " ".join(eye_parts)
        return result

    def flat_ipa(self, result: AccentResult) -> List[List[str]]:
        """IPA preference-lists for the whole utterance, word-separated."""
        out: List[List[str]] = []
        for i, word in enumerate(result.ipa_words):
            if i:
                out.append([" "])
            out.extend(word)
            punct = (result.words[i].trailing_punct
                     if i < len(result.words) else "")
            if punct in ".!?":
                out.append([".", " "])
            elif punct in ",;:":
                out.append([",", " "])
        return out


def accentify(text: str, language: str = DEFAULT_LANGUAGE,
              strength: float = 1.0, grammar_strength: float = 0.0,
              profile: Optional[AccentProfile] = None) -> AccentResult:
    """One-shot convenience wrapper."""
    pack = get_pack(language)
    return AccentEngine(language=pack.key,
                        profile=profile or pack.profile(strength),
                        grammar_strength=grammar_strength).accentify(text)
