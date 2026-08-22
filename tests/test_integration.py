"""Full-stack tests that need a real Piper voice model.

Skipped unless ``RAVC_TEST_MODELS_DIR`` points at a directory containing
downloaded voices, so a plain ``pytest`` run stays fast and offline:

    ravc voices --install ru_RU-dmitri-medium de_DE-thorsten-medium
    RAVC_TEST_MODELS_DIR=~/.local/share/AccentVoiceChanger/voices pytest
"""

import os
from pathlib import Path

import numpy as np
import pytest

MODELS_DIR = os.environ.get("RAVC_TEST_MODELS_DIR")


# Set RAVC_REQUIRE_MODELS=1 where models are known to be present (CI), so a
# misconfigured path fails the build instead of quietly skipping the whole
# integration suite -- which is exactly what happened the first time.
REQUIRE = os.environ.get("RAVC_REQUIRE_MODELS") == "1"


def _unavailable(reason: str):
    if REQUIRE:
        pytest.fail(f"RAVC_REQUIRE_MODELS is set but {reason}")
    pytest.skip(reason)


@pytest.fixture
def models(monkeypatch):
    if not MODELS_DIR:
        _unavailable("RAVC_TEST_MODELS_DIR is not set")
    if not Path(MODELS_DIR).is_dir():
        _unavailable(f"RAVC_TEST_MODELS_DIR does not exist: {MODELS_DIR}")
    monkeypatch.setenv("RAVC_MODELS_DIR", MODELS_DIR)
    from ravc.tts import voices
    installed = voices.installed_voices()
    if not installed:
        _unavailable(f"no voice models in {MODELS_DIR}")
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


# --------------------------------------------------------------------------
# Calibration against real synthesised speech
# --------------------------------------------------------------------------

def _russian_speech(models):
    """A few seconds of real accented speech to measure."""
    from ravc.accent.engine import AccentEngine
    from ravc.tts.piper import PiperEngine
    from ravc.tts.base import SynthRequest
    from ravc.tts import voices

    russian = voices.installed_voices("russian")
    if not russian:
        _unavailable("no Russian voice model installed")
    engine = AccentEngine()
    result = engine.accentify(
        "Listen carefully my friend, I will only say this one time. "
        "The weather today is very cold in Moscow.")
    tts = PiperEngine(russian[0])
    return tts.synthesize(SynthRequest(text=result.native_text,
                                       ipa=engine.flat_ipa(result)))


def test_calibration_is_accurate_on_real_speech(models):
    """The tight version of the synthetic-signal tests in test_calibrate.py.

    Real speech has a glottal spectral tilt that makes the fundamental
    unambiguous, so both measurements should land within a fraction of a
    semitone -- and, crucially, moving one must not show up on the other.
    """
    from ravc.dsp import pitch as P
    from ravc.dsp.calibrate import fingerprint, match

    audio = _russian_speech(models)
    sr = audio.sample_rate
    source = fingerprint(audio.samples, sr)
    assert source.usable

    for expected in (-5.0, 4.0):
        shifted = P.pitch_shift(audio.samples, sr, expected,
                                preserve_formants=True)
        pitch, formant = match(source, fingerprint(shifted, sr))
        assert abs(pitch - expected) < 0.8, ("pitch", expected, pitch)
        assert abs(formant) < 0.8, ("formant leaked", expected, formant)

    for expected in (-4.0, 3.0, 6.0):
        shifted = P.formant_shift(audio.samples, sr, expected)
        pitch, formant = match(source, fingerprint(shifted, sr))
        assert abs(formant - expected) < 0.8, ("formant", expected, formant)
        assert abs(pitch) < 0.8, ("pitch leaked", expected, pitch)


def test_calibration_round_trip_through_the_pipeline(models):
    """Calibrating to a target voice actually moves the output onto it."""
    from ravc.config import AppConfig
    from ravc.dsp import pitch as P
    from ravc.dsp.calibrate import fingerprint, match
    from ravc.pipeline import VoiceChanger

    config = AppConfig()
    config.apply_preset("Natural")
    changer = VoiceChanger(config)
    try:
        line = "This is a recording of my natural speaking voice."
        _accented, raw = changer.render(line)
        pretend_user = P.shift(raw.samples, raw.sample_rate, 6.0, 3.0)

        pitch, formant, message = changer.calibrate(pretend_user,
                                                    raw.sample_rate)
        assert abs(pitch - 6.0) < 1.5, message
        assert abs(formant - 3.0) < 1.5, message

        _accented, processed = changer.render(line)
        residual_pitch, residual_formant = match(
            fingerprint(processed.samples, processed.sample_rate),
            fingerprint(pretend_user, raw.sample_rate))
        assert abs(residual_pitch) < 1.0, residual_pitch
        assert abs(residual_formant) < 1.2, residual_formant
    finally:
        changer.close()


def test_calibration_refuses_to_act_on_silence(models):
    from ravc.config import AppConfig
    from ravc.pipeline import VoiceChanger

    config = AppConfig()
    config.voice.fx.pitch_semitones = -3.0
    changer = VoiceChanger(config)
    try:
        pitch, formant, message = changer.calibrate(
            np.zeros(22050, dtype=np.float32), 22050)
        assert (pitch, formant) == (0.0, 0.0)
        assert "could not measure" in message.lower()
        # Settings must be left exactly as they were.
        assert config.voice.fx.pitch_semitones == -3.0
    finally:
        changer.close()


def test_multi_speaker_model_honours_the_requested_speaker(models):
    """The emotional model must give eight distinct deliveries."""
    from ravc.accent.engine import AccentEngine
    from ravc.tts.base import SynthRequest
    from ravc.tts.piper import PiperEngine
    from ravc.tts import voices

    key = "de_DE-thorsten_emotional-medium"
    if not voices.is_installed(key):
        pytest.skip(f"{key} is not installed")

    engine = AccentEngine(language="german")
    result = engine.accentify("We have ways of making you talk.")
    tts = PiperEngine(key)

    speakers = dict(tts.speakers(key))
    assert set(speakers) == {"amused", "angry", "disgusted", "drunk",
                             "neutral", "sleepy", "surprised", "whisper"}
    # An unrecognised or absent choice must land on the model's declared
    # default, not on whichever id the dictionary yielded first.
    assert tts.resolve_speaker(key, "") == speakers["neutral"]
    assert tts.resolve_speaker(key, "nonsense") == speakers["neutral"]

    rendered = {}
    for label in ("neutral", "angry", "whisper"):
        audio = tts.synthesize(SynthRequest(text=result.native_text,
                                            ipa=engine.flat_ipa(result),
                                            voice_key=key, speaker=label))
        rendered[label] = audio.samples

    for a, b in [("neutral", "angry"), ("neutral", "whisper")]:
        shorter = min(rendered[a].size, rendered[b].size)
        assert shorter > 0
        difference = np.abs(rendered[a][:shorter] - rendered[b][:shorter]).mean()
        assert difference > 1e-3, f"{a} and {b} rendered identically"

    # A whisper has no voicing at all, which is a property no amount of
    # speaker-id confusion could produce by accident.
    from ravc.dsp.pitch import estimate_f0
    assert estimate_f0(rendered["whisper"], 22050) == 0.0
    assert estimate_f0(rendered["neutral"], 22050) > 0.0
