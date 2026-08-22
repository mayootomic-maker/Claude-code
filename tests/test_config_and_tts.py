"""Settings persistence, the voice catalogue, and engine selection."""

import json

import numpy as np
import pytest

from ravc.accent.languages import available
from ravc.config import AppConfig, config_path
from ravc.dsp.chain import VoiceFx
from ravc.tts import voices as catalogue
from ravc.tts.base import Audio, SynthRequest, TtsEngine, Voice, resample
from ravc.tts.piper import PiperEngine
from ravc.tts.registry import VoiceRegistry


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

def test_defaults_are_sane():
    config = AppConfig()
    assert config.accent.language == "russian"
    assert 0.0 <= config.accent.strength <= 1.0
    assert config.accent.grammar_strength == 0.0, "broken English must be opt-in"
    assert config.active_voice_key.startswith("piper:")


def test_round_trip_keeps_nested_types():
    config = AppConfig()
    config.accent.language = "german"
    config.accent.strength = 0.7
    config.accent.set_feature("s_cluster_to_sh", False)
    config.apply_preset("Bond Villain")
    config.voice.fx.pitch_semitones = -6.0
    config.voice.set_voice("german", "piper:de_DE-karlsson-low")
    config.save()

    loaded = AppConfig.load()
    assert loaded.accent.language == "german"
    assert loaded.accent.strength == 0.7
    assert loaded.accent.overrides() == {"s_cluster_to_sh": False}
    assert isinstance(loaded.voice.fx, VoiceFx)
    assert loaded.voice.fx.pitch_semitones == -6.0
    assert loaded.active_voice_key == "piper:de_DE-karlsson-low"
    assert loaded.voice.preset == "Bond Villain"


def test_corrupt_file_falls_back_to_defaults():
    AppConfig().save()
    config_path().write_text("{ this is not json", encoding="utf-8")
    assert AppConfig.load().voice.preset == AppConfig().voice.preset


def test_unknown_keys_are_ignored():
    AppConfig().save()
    config_path().write_text(json.dumps({
        "voice": {"preset": "KGB Radio", "removed_setting": 1},
        "some_future_section": {"a": 1},
    }), encoding="utf-8")
    assert AppConfig.load().voice.preset == "KGB Radio"


def test_missing_file_gives_defaults():
    assert not config_path().exists()
    assert AppConfig.load().accent.language == "russian"


def test_save_is_atomic(monkeypatch):
    config = AppConfig()
    config.save()
    original = config_path().read_text(encoding="utf-8")

    import os
    real_replace = os.replace

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        config.save()
    monkeypatch.setattr(os, "replace", real_replace)
    # The previous settings survived, and no .tmp litter was left behind.
    assert config_path().read_text(encoding="utf-8") == original
    assert not list(config_path().parent.glob("*.tmp"))


def test_profile_reflects_feature_overrides():
    config = AppConfig()
    config.accent.set_feature("w_to_v", False)
    assert config.accent.to_profile().feature("w_to_v") is False


def test_voice_defaults_per_language():
    config = AppConfig()
    for key, _name in available():
        config.accent.language = key
        assert config.active_voice_key


# --------------------------------------------------------------------------
# Voice catalogue
# --------------------------------------------------------------------------

def test_catalogue_covers_every_accent_language():
    languages = {key for key, _ in available()}
    covered = {model.language for model in catalogue.CATALOGUE.values()}
    assert languages <= covered


def test_catalogue_urls_are_well_formed():
    for key, model in catalogue.CATALOGUE.items():
        assert model.onnx_url.endswith(f"{key}.onnx"), key
        assert model.config_url.endswith(f"{key}.onnx.json"), key
        assert f"/{model.lang_dir}/{model.locale}/" in model.onnx_url, key
        assert model.filename == f"{key}.onnx"


def test_default_voice_exists_for_each_language():
    for key, _name in available():
        assert catalogue.default_voice(key) in catalogue.CATALOGUE


def test_installed_filter_is_language_aware():
    assert catalogue.installed_voices("russian") == []
    assert catalogue.is_installed("nonexistent-voice") is False


def test_download_rejects_unknown_keys():
    with pytest.raises(KeyError):
        catalogue.download_voice("not-a-real-voice")


# --------------------------------------------------------------------------
# Engines
# --------------------------------------------------------------------------

def test_registry_lists_voices_per_language():
    registry = VoiceRegistry()
    for key, _name in available():
        voices = registry.all_voices(key)
        assert voices
        assert all(v.accent == key for v in voices)


def test_registry_key_splitting():
    registry = VoiceRegistry()
    assert registry.split_key("piper:ru_RU-dmitri-medium")[0] == "piper"
    assert registry.split_key("edge:ru-RU-DmitryNeural")[0] == "edge"
    assert registry.split_key("sapi:Microsoft Irina")[0] == "sapi"
    assert registry.split_key("ru_RU-irina-medium")[0] == "piper"
    assert registry.split_key("")[0] == "piper"


def test_registry_reports_a_clear_error_when_nothing_is_installed():
    registry = VoiceRegistry()
    with pytest.raises(Exception) as excinfo:
        registry.synthesize(SynthRequest(text="тест", ipa=[["t"]]))
    assert "engine" in str(excinfo.value).lower()


def test_status_lines_never_raise():
    registry = VoiceRegistry()
    for key, _name in available():
        assert registry.status_lines(key)


def test_piper_reports_missing_model_helpfully():
    engine = PiperEngine("ru_RU-dmitri-medium")
    assert engine.is_available() is False
    with pytest.raises(Exception) as excinfo:
        engine.synthesize(SynthRequest(text="тест", ipa=[["t"]]))
    assert "not downloaded" in str(excinfo.value)


def test_piper_symbol_resolution_prefers_available_characters():
    engine = PiperEngine()
    engine._id_map = {"t": [1], "ɕ": [2], "ʲ": [3], "_": [0], "^": [4], "$": [5]}
    assert engine.resolve_symbol(["tɕ", "tʃ"]) == "tɕ"
    assert engine.resolve_symbol(["ʃ", "tɕ"]) == "tɕ"
    assert engine.resolve_symbol(["ʒ"]) is None
    assert engine.resolve_symbol([]) is None


def test_piper_phoneme_ids_are_bracketed_and_padded():
    engine = PiperEngine()
    engine._id_map = {"^": [1], "$": [2], "_": [0], "a": [3], "b": [4]}
    ids = engine.phoneme_ids([["a"], ["b"], ["nope"]])
    assert ids[0] == 1 and ids[-1] == 2
    assert ids == [1, 3, 0, 4, 0, 2]


# --------------------------------------------------------------------------
# Audio containers
# --------------------------------------------------------------------------

def test_audio_normalises_shape_and_dtype():
    audio = Audio(np.zeros((10, 1), dtype=np.float64), 22050)
    assert audio.samples.dtype == np.float32
    assert audio.samples.ndim == 1
    assert audio.duration == pytest.approx(10 / 22050)


def test_audio_silence_helper():
    assert Audio.silence(0.5, 16000).samples.size == 8000


def test_resample_up_and_down():
    audio = Audio(np.random.RandomState(0).randn(1000).astype(np.float32), 16000)
    assert resample(audio, 48000).samples.size == 3000
    assert resample(audio, 8000).samples.size == 500
    assert resample(audio, 16000).samples.size == 1000
    assert resample(Audio(np.zeros(0, np.float32), 16000), 48000).samples.size == 0


def test_voice_label():
    label = Voice(key="k", name="Dmitri", engine="piper", gender="male").label
    assert label.startswith("Dmitri") and "male" in label and "offline" in label
    missing = Voice(key="k", name="Eva", engine="piper", gender="female",
                    offline=False, installed=False).label
    assert "online" in missing and "not downloaded" in missing


def test_engine_interface_is_complete():
    for engine_class in (PiperEngine,):
        assert issubclass(engine_class, TtsEngine)
        for method in ("is_available", "list_voices", "synthesize"):
            assert callable(getattr(engine_class, method))
