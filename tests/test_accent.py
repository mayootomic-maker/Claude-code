"""The accent engine: substitutions, phonology, rendering, both languages."""

import pathlib

import pytest

from ravc.accent import grammar, normalize
from ravc.accent.engine import AccentEngine, accentify
from ravc.accent.languages import PACKS, available, get_pack
from ravc.accent.languages import german as german_pack
from ravc.accent.languages import russian as russian_pack
from ravc.accent.phonology import accentify_word, spelling_vowels
from ravc.accent.render import to_ipa, to_native_text
from ravc.phonetics.g2p import word_to_phonemes


def ru(word):
    pack = get_pack("russian")
    return accentify_word(word, list(word_to_phonemes(word)), pack,
                          pack.profile())


def de(word):
    pack = get_pack("german")
    return accentify_word(word, list(word_to_phonemes(word)), pack,
                          pack.profile())


def syms(phones):
    return [p.sym for p in phones]


THRESHOLDS = {"russian": russian_pack.THRESHOLDS,
              "german": german_pack.THRESHOLDS}


# --------------------------------------------------------------------------
# Russian
# --------------------------------------------------------------------------

@pytest.mark.parametrize("word,expected", [
    ("think", "синк"),      # theta -> s
    ("this", "зис"),        # dh -> z
    ("the", "зэ"),
    ("water", "вотэр"),     # w -> v
    ("hello", "хэло"),      # h -> kh
    ("going", "гоинк"),     # final ng -> nk
    ("bad", "бэт"),         # ae -> e, final devoicing
    ("dog", "док"),         # final devoicing
    ("was", "вас"),
    ("ship", "шып"),        # hard sibilant backs /i/
    ("problem", "проблэм"),  # spelling vowels, no reduction
    ("vodka", "вотка"),     # regressive devoicing in the cluster
    ("job", "джоп"),
    ("computer", "компьютэр"),
])
def test_russian_words(word, expected):
    assert to_native_text(ru(word), get_pack("russian")) == expected


def test_russian_v_does_not_trigger_voicing():
    """Russian /v/ assimilates but never triggers: question is not gvestion."""
    assert to_native_text(ru("question"), get_pack("russian")) == "квэсчин"


def test_russian_final_devoicing_runs_through_a_cluster():
    assert syms(ru("legs"))[-2:] == ["k", "s"]


def test_russian_palatalisation_before_i():
    phones = ru("teeth")
    assert phones[0].sym == "t" and phones[0].soft


def test_russian_dark_l_is_hard_before_back_vowels():
    for phone in ru("look"):
        if phone.sym == "l":
            assert not phone.soft


# --------------------------------------------------------------------------
# German
# --------------------------------------------------------------------------

@pytest.mark.parametrize("word,expected_syms", [
    ("we", ["v", "i"]),               # w -> v
    ("stop", ["sh", "t", "o", "p"]),  # st- -> sht-
    ("speak", ["sh", "p", "i", "k"]),  # sp- -> shp-
    ("see", ["z", "i"]),              # initial s + vowel -> z
    ("think", ["s", "i", "ng", "k"]),
    ("job", ["ch", "o", "p"]),        # dzh -> tsh, final devoicing
])
def test_german_substitutions(word, expected_syms):
    assert syms(de(word)) == expected_syms


def test_german_keeps_schwa_but_russian_does_not():
    """The packs must differ here, or German sounds Slavic."""
    assert "sch" in syms(de("problem"))
    assert "sch" not in syms(ru("problem"))


def test_german_does_not_tense_lax_i():
    """German has /ɪ/, so 'ship' must not become 'sheep'."""
    german_i = [p for p in de("ship") if p.sym == "i"]
    assert german_i and not german_i[0].long


def test_german_vowel_length_is_phonemic():
    assert any(p.long for p in de("name"))     # [neːm]
    assert not any(p.long for p in de("is"))   # [ɪs]


def test_german_coda_r_vocalises_but_onset_r_does_not():
    assert "ar" in syms(de("better"))
    assert "R" in syms(de("red"))


def test_german_final_devoicing():
    assert syms(de("dog"))[-1] == "k"
    assert syms(de("have"))[-1] == "f"


# --------------------------------------------------------------------------
# Strength and feature switches
# --------------------------------------------------------------------------

def test_strength_zero_disables_the_loudest_substitutions():
    pack = get_pack("russian")
    weak = pack.profile(0.0)
    phones = accentify_word("think", list(word_to_phonemes("think")), pack, weak)
    assert phones[0].sym != "s"


def test_strength_ladder_is_ordered():
    """Substitutions must switch on as strength rises, never off."""
    def has_th_to_s(strength):
        return accentify("think", "russian", strength=strength
                         ).eye_dialect.startswith("s")

    switched_on = [has_th_to_s(s) for s in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert switched_on == sorted(switched_on), switched_on
    assert switched_on[-1] and not switched_on[0]


def test_feature_override_turns_one_rule_off():
    pack = get_pack("russian")
    profile = pack.profile(1.0, {"w_to_v": False})
    assert syms(accentify_word("water", list(word_to_phonemes("water")),
                               pack, profile))[0] != "v"


def test_every_pack_declares_defaults_for_its_labels():
    for pack in PACKS.values():
        for name, _label in pack.feature_labels:
            assert name in pack.default_features, (pack.key, name)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def test_ipa_candidates_are_non_empty_for_every_symbol():
    for language in ("russian", "german"):
        result = AccentEngine(language=language).accentify(
            "The quick brown fox jumps over thirty lazy dogs, judging "
            "everything with sharp measured pleasure.")
        for candidates in AccentEngine(language=language).flat_ipa(result):
            assert candidates and all(isinstance(c, str) for c in candidates)


def test_ipa_marks_exactly_one_primary_stress_per_word():
    pack = get_pack("russian")
    flat = [c[0] for c in to_ipa(ru("computer"), pack)]
    assert flat.count("ˈ") == 1


def test_eye_dialect_is_plain_ascii():
    for language in ("russian", "german"):
        text = accentify("Hello there, my good friend!", language).eye_dialect
        assert text.isascii(), text


def test_native_text_scripts():
    assert any("Ѐ" <= ch <= "ӿ"
               for ch in accentify("hello", "russian").native_text)
    assert accentify("hello", "german").native_text.isascii()


# --------------------------------------------------------------------------
# Engine plumbing
# --------------------------------------------------------------------------

def test_empty_and_punctuation_only_input():
    for text in ("", "   ", "!!!", "..."):
        result = accentify(text)
        assert result.is_empty
        assert result.native_text == ""


def test_punctuation_is_preserved_for_prosody():
    result = accentify("Hello, world! Yes?")
    assert result.native_text.endswith("?")
    assert "," in result.native_text


def test_numbers_are_spoken():
    result = accentify("I have 3 dogs")
    assert "3" not in result.spoken
    assert "three" in result.spoken


def test_engine_language_switch_keeps_working():
    engine = AccentEngine(language="russian")
    first = engine.accentify("water").native_text
    engine.set_language("german")
    second = engine.accentify("water").native_text
    assert first != second
    assert second.isascii()


def test_cyrillic_alias_still_works():
    assert accentify("hello").cyrillic == accentify("hello").native_text


def test_all_registered_languages_round_trip():
    for key, _name in available():
        result = accentify("This is a test of the system.", key)
        assert result.native_text and result.eye_dialect


def test_spelling_vowels_ignores_qu():
    assert spelling_vowels("quick") == ["i"]
    assert spelling_vowels("guest") == ["e"]


# --------------------------------------------------------------------------
# Normalisation and grammar
# --------------------------------------------------------------------------

@pytest.mark.parametrize("raw,needle", [
    ("$4.50", "four dollars fifty cents"),
    ("3:30", "three thirty"),
    ("21st", "twenty first"),
    ("75%", "seventy five percent"),
    ("1984", "nineteen eighty four"),
    ("Dr. Ivanov", "doctor"),
    ("3.14", "three point one four"),
])
def test_normalisation(raw, needle):
    assert needle in normalize.normalize(raw)


def test_normalisation_is_idempotent():
    once = normalize.normalize("I paid $4.50 at 3:30 on the 21st")
    assert normalize.normalize(once) == once


def test_grammar_off_by_default():
    text = "I am going to the store."
    assert grammar.brokenise(text, 0.0) == text
    assert accentify(text).spoken == normalize.normalize(text)


def test_russian_grammar_drops_articles_and_copula():
    out = grammar.brokenise("I am going to the store.", 1.0, language="russian")
    assert "the" not in out.lower()
    assert " am " not in out


def test_german_grammar_moves_negation_after_the_verb():
    out = grammar.brokenise("I don't know that.", 1.0, language="german")
    assert "know not" in out.lower()


def test_german_grammar_keeps_articles():
    out = grammar.brokenise("I am going to the store.", 1.0, language="german")
    assert "the" in out.lower()


def test_grammar_is_deterministic():
    text = "She is a very good friend of mine."
    runs = {grammar.brokenise(text, 0.6) for _ in range(20)}
    assert len(runs) == 1


# --------------------------------------------------------------------------
# Strength ladder
# --------------------------------------------------------------------------

@pytest.mark.parametrize("language", ["russian", "german"])
def test_strength_slider_is_progressive(language):
    """The slider must have real intermediate positions, not three states."""
    probe = ("Hello, I am thinking about washing the ship at the information "
             "station, and the dog is going bad.")
    renderings = [accentify(probe, language, strength=s / 10).eye_dialect
                  for s in range(11)]
    assert len(set(renderings)) >= 5, set(renderings)
    assert renderings[0] != renderings[-1]


@pytest.mark.parametrize("language", ["russian", "german"])
def test_features_only_ever_switch_on_as_strength_rises(language):
    """A feature that fires at strength X must still fire at X + delta."""
    pack = get_pack(language)
    for name, threshold in THRESHOLDS[language].items():
        below = pack.profile(max(0.0, threshold - 0.01))
        above = pack.profile(min(1.0, threshold + 0.01))
        default = pack.default_features.get(name, True)
        if not default:
            continue
        assert not below.fires(name, threshold), (language, name)
        assert above.fires(name, threshold), (language, name)


@pytest.mark.parametrize("language", ["russian", "german"])
def test_every_feature_has_a_threshold(language):
    pack = get_pack(language)
    for name in pack.default_features:
        assert name in THRESHOLDS[language], (language, name)


def test_thresholds_are_spread_over_the_range():
    for language, thresholds in THRESHOLDS.items():
        values = sorted(thresholds.values())
        assert values[0] < 0.2 and values[-1] > 0.85
        # No large empty stretch, or the slider feels dead in that region.
        gaps = [b - a for a, b in zip(values, values[1:])]
        assert max(gaps) < 0.2, sorted(thresholds.items(), key=lambda kv: kv[1])


# --------------------------------------------------------------------------
# Features that were previously declared but not implemented
# --------------------------------------------------------------------------

def test_russian_tense_switch_actually_changes_the_vowel():
    # Not "ship": after a hard sibilant the vowel backs to /ɨ/, which has no
    # length contrast in Russian, so the switch correctly has no effect there.
    pack = get_pack("russian")
    phones = list(word_to_phonemes("bit"))
    tense = accentify_word("bit", phones, pack,
                           pack.profile(1.0, {"tense_short_vowels": True}))
    lax = accentify_word("bit", phones, pack,
                         pack.profile(1.0, {"tense_short_vowels": False}))
    assert [p.long for p in tense] != [p.long for p in lax]
    tense_ipa = "".join(c[0] for c in to_ipa(tense, pack))
    lax_ipa = "".join(c[0] for c in to_ipa(lax, pack))
    assert tense_ipa != lax_ipa
    assert "ɪ" in lax_ipa and "ɪ" not in tense_ipa


def test_russian_does_not_write_a_length_mark():
    """espeak-ru never emits it, so the voice was never trained on it."""
    pack = get_pack("russian")
    ipa = "".join(c[0] for c in to_ipa(ru("sheep"), pack))
    assert "ː" not in ipa


def test_german_does_write_a_length_mark():
    pack = get_pack("german")
    assert "ː" in "".join(c[0] for c in to_ipa(de("name"), pack))


@pytest.mark.parametrize("word,expected", [
    ("nation", "netsion"),
    ("station", "shtetsion"),
    ("vision", "vizion"),
])
def test_german_tion_suffix(word, expected):
    assert accentify(word, "german").eye_dialect == expected


def test_german_tion_switch_can_be_turned_off():
    pack = get_pack("german")
    off = pack.profile(1.0, {"tion_to_tsion": False})
    phones = accentify_word("nation", list(word_to_phonemes("nation")),
                            pack, off)
    assert "ts" not in [p.sym for p in phones]


@pytest.mark.parametrize("word,expected_start", [
    ("question", ["k", "v"]),   # Quelle is [kv], never [kf]
    ("quick", ["k", "v"]),
    ("swim", ["s", "v"]),       # <sw> is foreign in German, so [s] not [ʃ]
    ("sweet", ["s", "v"]),
])
def test_german_v_resists_progressive_devoicing(word, expected_start):
    assert syms(de(word))[:2] == expected_start


def test_german_only_sp_and_st_become_sh():
    """<sp>/<st> are [ʃp]/[ʃt]; <sk>, <sl>, <sm>, <sw> stay [s]."""
    assert syms(de("stop"))[0] == "sh"
    assert syms(de("speak"))[0] == "sh"
    for word in ("small", "skill", "sleep", "snow"):
        assert syms(de(word))[0] == "s", word


def test_german_v_still_devoices_word_finally():
    assert syms(de("brave"))[-1] == "f"
    assert syms(de("have"))[-1] == "f"


# --------------------------------------------------------------------------
# Documentation
# --------------------------------------------------------------------------

README_SENTENCE = ("I think this water is bad, and the dog is going to the "
                   "station.")


def test_readme_examples_match_the_engine():
    """The worked examples in README.md must be what the engine produces."""
    readme = (pathlib.Path(__file__).resolve().parents[1] / "README.md"
              ).read_text(encoding="utf-8")
    for language in ("russian", "german"):
        result = accentify(README_SENTENCE, language)
        assert result.eye_dialect in readme, (language, result.eye_dialect)
        assert result.native_text in readme, (language, result.native_text)


def test_readme_headline_example_matches():
    readme = (pathlib.Path(__file__).resolve().parents[1] / "README.md"
              ).read_text(encoding="utf-8")
    headline = "This is the best voice changer in the world!"
    for language in ("russian", "german"):
        assert accentify(headline, language).native_text in readme, language
