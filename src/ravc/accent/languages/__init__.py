"""Accent language packs."""

from __future__ import annotations

from typing import Dict, List, Tuple

from .base import AccentProfile, Context, LanguagePack
from . import german, russian

PACKS: Dict[str, LanguagePack] = {
    russian.PACK.key: russian.PACK,
    german.PACK.key: german.PACK,
}

DEFAULT_LANGUAGE = russian.PACK.key


def get_pack(key: str) -> LanguagePack:
    return PACKS.get((key or "").lower(), PACKS[DEFAULT_LANGUAGE])


def available() -> List[Tuple[str, str]]:
    """``[(key, display name), …]`` for the UI."""
    return [(pack.key, pack.name) for pack in PACKS.values()]


__all__ = ["AccentProfile", "Context", "LanguagePack", "PACKS",
           "DEFAULT_LANGUAGE", "get_pack", "available"]
