"""The language-pack interface.

An accent is fully described by: how each English phoneme is substituted,
what phonological processes then apply, and how the result is written down
for a text-driven TTS voice.  Everything else -- grapheme-to-phoneme, text
normalisation, synthesis, DSP -- is shared.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from ..phones import Phone


@dataclass
class Context:
    """Where a phoneme sits in its word, for context-sensitive substitutions."""

    word: str
    index: int
    total: int
    prev_arp: Optional[str] = None
    next_arp: Optional[str] = None
    spelling_vowel: Optional[str] = None

    @property
    def is_initial(self) -> bool:
        return self.index == 0

    @property
    def is_final(self) -> bool:
        return self.index == self.total - 1


@dataclass
class AccentProfile:
    """How hard to lay the accent on, and which features to use.

    ``strength`` scales everything: a feature only fires when its switch is
    on *and* strength has reached that feature's threshold, so turning one
    dial down softens the accent in a realistic order (the most stereotyped
    substitutions go first, the subtle phonotactics last).
    """

    language: str = "russian"
    strength: float = 1.0
    features: Dict[str, bool] = field(default_factory=dict)

    def feature(self, name: str, default: bool = True) -> bool:
        return bool(self.features.get(name, default))

    def fires(self, name: str, threshold: float = 0.0,
              default: bool = True) -> bool:
        return self.feature(name, default) and self.strength >= threshold

    def with_features(self, **overrides: bool) -> "AccentProfile":
        merged = dict(self.features)
        merged.update(overrides)
        return AccentProfile(language=self.language, strength=self.strength,
                             features=merged)


PostProcess = Callable[[List[Phone], AccentProfile], List[Phone]]


@dataclass
class LanguagePack:
    """Everything that makes one accent different from another."""

    key: str
    name: str                       # "Russian"
    adjective: str                  # "Russian" (for UI copy)
    tts_language: str               # "ru-RU"
    sample_line: str                # shown in the UI preview button

    map_consonant: Callable[[str, AccentProfile, Context], List[str]]
    map_vowel: Callable[[str, int, AccentProfile, Context], List[str]]
    post_processes: Sequence[PostProcess]

    ipa_map: Dict[str, List[str]]
    latin_map: Dict[str, str]
    render_text: Callable[[Sequence[Phone], bool], str]

    # Optional: symbols to prefer for phonemically long vowels.  German
    # spells short /ɛ/ and long /eː/ with different base symbols, so the
    # length flag has to pick a different candidate, not just add a colon.
    ipa_long: Dict[str, List[str]] = field(default_factory=dict)

    default_features: Dict[str, bool] = field(default_factory=dict)
    feature_labels: Sequence[Tuple[str, str]] = ()
    spelling_pronunciation: bool = True

    def profile(self, strength: float = 1.0,
                overrides: Optional[Dict[str, bool]] = None) -> AccentProfile:
        features = dict(self.default_features)
        if overrides:
            features.update(overrides)
        return AccentProfile(language=self.key, strength=strength,
                             features=features)
