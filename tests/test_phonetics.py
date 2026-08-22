"""Grapheme-to-phoneme: the dictionary, the fallback rules, and the glue."""

import pytest

from ravc.phonetics import g2p, lts
from ravc.phonetics.arpabet import (count_syllables, is_vowel,
                                    primary_stress_index, split_stress,
                                    syllabify)


def test_dictionary_is_bundled():
    assert g2p.dictionary_size() > 100_000


@pytest.mark.parametrize("word,expected", [
    ("hello", "HH AH0 L OW1"),
    ("computer", "K AH0 M P Y UW1 T ER0"),
    ("think", "TH IH1 NG K"),
    ("vodka", "V AA1 D K AH0"),
    ("question", "K W EH1 S CH AH0 N"),
])
def test_dictionary_lookups(word, expected):
    assert " ".join(g2p.word_to_phonemes(word)) == expected


def test_lookup_is_case_insensitive():
    assert g2p.word_to_phonemes("Hello") == g2p.word_to_phonemes("hello")


@pytest.mark.parametrize("word,stem", [
    ("streamers", "stream"),
    ("running", "run"),
    ("biggest", "big"),
    ("hopelessness", "hope"),
])
def test_morphology_reaches_the_stem(word, stem):
    """Out-of-dictionary inflections should still start with the stem."""
    derived = g2p.word_to_phonemes(word)
    base = g2p.word_to_phonemes(stem)
    assert derived[:len(base)] == base


def test_compound_splitting():
    assert g2p.word_to_phonemes("moonbeam")[:3] == g2p.word_to_phonemes("moon")


def test_unknown_words_still_produce_phonemes():
    for word in ("xzibit", "krabbypattie", "zzyzx", "glorbnak"):
        phones = g2p.word_to_phonemes(word)
        assert phones, word
        assert any(is_vowel(p) for p in phones), word


def test_hyphenated_words():
    assert g2p.word_to_phonemes("well-known") == (
        g2p.word_to_phonemes("well") + g2p.word_to_phonemes("known"))


def test_empty_input():
    assert g2p.word_to_phonemes("") == ()
    assert g2p.word_to_phonemes("   ") == ()
    assert g2p.word_to_phonemes("!!!") == ()


def test_lts_always_has_a_vowel_and_one_primary_stress():
    for word in ("bkxq", "strngth", "hello", "zzz", "qwerty"):
        phones = lts.word_to_phonemes(word)
        assert any(is_vowel(p) for p in phones), word
        assert sum(1 for p in phones if p.endswith("1")) == 1, word


def test_lts_terminates_on_junk():
    """Non-alphanumeric input must not spin the rule matcher forever."""
    assert lts.word_to_phonemes("???---") == []
    assert lts.word_to_phonemes("") == []


def test_split_stress():
    assert split_stress("AH0") == ("AH", 0)
    assert split_stress("K") == ("K", -1)


def test_syllabify_covers_every_phone():
    phones = ["K", "AH0", "M", "P", "Y", "UW1", "T", "ER0"]
    syllables = syllabify(phones)
    assert [p for syl in syllables for p in syl] == phones
    assert len(syllables) == count_syllables(phones) == 3


def test_primary_stress_index():
    assert primary_stress_index(["K", "AH0", "M", "P", "UW1"]) == 4
    assert primary_stress_index(["K", "AH0", "M"]) == 1   # falls back
    assert primary_stress_index(["K", "M"]) == -1


def test_phrase_to_phonemes():
    words = g2p.phrase_to_phonemes("hello there")
    assert len(words) == 2
