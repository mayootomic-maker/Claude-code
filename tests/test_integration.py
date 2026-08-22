"""Full-stack tests that need a real Piper voice model.

Skipped unless ``RAVC_TEST_MODELS_DIR`` points at a directory containing
downloaded voices, so a plain ``pytest`` run stays fast and offline:

    ravc voices --install ru_RU-dmitri-medium de_DE-thorsten-medium
    RAVC_TEST_MODELS_DIR=~/.local/share/RussianAccentVoiceChanger/voices pytest
"""

import os
from pathlib import Path

import numpy as np
import pytest

MODELS_DIR = os.environ.get("RAVC_TEST_MODELS_DIR")


@pytest.fixture
def models(monkeypatch):
    if not MODELS_DIR or not Path(MODELS_DIR).is_dir():
        pytest.skip("set RAVC_TEST_MODELS_DIR to a voices directory")
    monkeypatch.setenv("RAVC_MODELS_DIR", MODELS_DIR)
    from ravc.tts import voices
    installed = voices.installed_voices()
    if not installed:
        pytest.skip(f"no voice models in {MODELS_DIR}")
    return installed


def languages_with_models(installed):
    from ravc.tts import voices
    return sorted({voices.CATALOGUE[key].language for key in installed})


def test_every_ipa_symbol_resolves_against_the_real_voice_tables(models):
    """The renderer must never emit a phoneme the voice cannot say."""
    from ravc.accent.engine import AccentEngine
    from ravc.tts import voices
    from ravc.tts.piper import PiperEngine

    probe = (
        "The quick brown fox jumps over thirty lazy dogs. She sells sea "
        "shells; judge Wolfgang measured the strange pleasure of watching "
        "eight singers speak. This is a question about computers, vodka, "
        "language, and the weather in the world."
    )
    for key in models:
        language = voices.CATALOGUE[key].language
        engine = AccentEngine(language=language)
        piper = PiperEngine(key)
        piper._ensure_loaded(key)
        result = engine.accentify(probe)
        unresolved = {tuple(c) for c in engine.flat_ipa(result)
                      if piper.resolve_symbol(c) is None}
        assert not unresolved, (key, unresolved)


def test_synthesis_produces_plausible_speech(models):
    from ravc.accent.engine import AccentEngine
    from ravc.tts import voices
    from ravc.tts.base import SynthRequest
    from ravc.tts.piper import PiperEngine

    for key in models:
        language = voices.CATALOGUE[key].language
        engine = AccentEngine(language=language)
        result = engine.accentify(
            "Listen carefully my friend, I will only say this one time.")
        audio = PiperEngine(key).synthesize(SynthRequest(
            text=result.native_text, ipa=engine.flat_ipa(result),
            voice_key=key))
        assert 1.5 < audio.duration < 8.0, (key, audio.duration)
        assert np.isfinite(audio.samples).all(), key
        peak = float(np.abs(audio.samples).max())
        assert 0.05 < peak <= 1.0, (key, peak)


def test_pipeline_render_and_file_round_trip(models, tmp_path):
    from ravc.config import AppConfig
    from ravc.pipeline import VoiceChanger
    from ravc.tts import voices

    for language in languages_with_models(models):
        config = AppConfig()
        config.accent.language = language
        config.apply_preset("Bond Villain")
        changer = VoiceChanger(config)
        try:
            out = tmp_path / f"{language}.wav"
            changer.render_to_file("The installer works, my friend.", out)
            assert out.is_file() and out.stat().st_size > 20_000

            import soundfile as sf
            samples, rate = sf.read(str(out), dtype="float32")
            assert rate > 8000
            assert 1.0 < len(samples) / rate < 8.0
            assert float(np.abs(samples).max()) > 0.3
            assert changer.stats.engine == "piper"
        finally:
            changer.close()


def test_presets_all_synthesise(models):
    from ravc.config import AppConfig
    from ravc.dsp.chain import preset_names
    from ravc.pipeline import VoiceChanger

    config = AppConfig()
    changer = VoiceChanger(config)
    try:
        for name in preset_names():
            config.apply_preset(name)
            changer.update_config(config)
            _accented, audio = changer.render("Testing the preset.")
            assert audio.samples.size > 0, name
            assert np.isfinite(audio.samples).all(), name
    finally:
        changer.close()


def test_synthesis_is_fast_enough_for_live_use(models):
    """Synthesis must run well under real time or the pipeline falls behind."""
    import time

    from ravc.accent.engine import AccentEngine
    from ravc.tts.base import SynthRequest
    from ravc.tts.piper import PiperEngine

    key = models[0]
    from ravc.tts import voices
    engine = AccentEngine(language=voices.CATALOGUE[key].language)
    piper = PiperEngine(key)
    piper.warm_up()
    result = engine.accentify(
        "This sentence is long enough to give a meaningful measurement of "
        "how quickly the synthesiser can produce speech on this machine.")

    start = time.perf_counter()
    audio = piper.synthesize(SynthRequest(text=result.native_text,
                                          ipa=engine.flat_ipa(result),
                                          voice_key=key))
    elapsed = time.perf_counter() - start
    assert elapsed < audio.duration, (
        f"{elapsed:.2f}s to synthesise {audio.duration:.2f}s of audio")
