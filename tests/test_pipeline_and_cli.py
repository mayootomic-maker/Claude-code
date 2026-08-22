"""End-to-end behaviour that does not need audio hardware or a voice model."""

import io
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pytest

from ravc.accent.engine import AccentEngine
from ravc.asr.whisper_asr import Transcript, _rejection_reason
from ravc.config import AppConfig
from ravc.pipeline import Events, State, Stats, VoiceChanger
from ravc.ui import cli


# --------------------------------------------------------------------------
# ASR guards (no model needed)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("text,duration,reason", [
    ("Thank you.", 2.0, "filler"),
    ("thanks for watching!", 2.0, "filler"),
    ("", 1.0, "no speech"),
    ("   ", 1.0, "no speech"),
    ("...", 1.0, "filler"),
    ("!!!", 1.0, "no letters"),
    ("a a a a a a a a", 2.0, "repetition loop"),
    ("x" * 200, 1.0, "implausible rate"),
    ("hello world this is a real sentence", 2.5, ""),
])
def test_hallucination_guards(text, duration, reason):
    assert _rejection_reason(text, duration) == reason


def test_transcript_ok_flag():
    assert Transcript(text="hi").ok
    assert not Transcript(text="   ").ok
    assert not Transcript().ok


# --------------------------------------------------------------------------
# Pipeline without hardware
# --------------------------------------------------------------------------

def test_start_without_audio_backend_reports_a_clear_error(monkeypatch):
    monkeypatch.setattr("ravc.pipeline.sounddevice_available", lambda: False)
    errors = []
    changer = VoiceChanger(AppConfig(), Events(on_error=errors.append))
    changer.start()
    assert changer.state == State.ERROR
    assert errors and "sounddevice" in errors[0]
    changer.close()


def test_render_without_a_voice_model_is_actionable_or_falls_back():
    """No Piper model: speak via a system voice if there is one, else say so.

    Windows always has SAPI, so the app can talk before anything is
    downloaded; on other platforms the failure must name the engines tried
    rather than blowing up with something opaque.
    """
    changer = VoiceChanger(AppConfig())
    try:
        if changer.registry.available_engines():
            _accented, audio = changer.render("hello there")
            assert audio.samples.size >= 0
            assert changer.stats.engine
        else:
            with pytest.raises(Exception) as excinfo:
                changer.render("hello there")
            assert "engine" in str(excinfo.value).lower()
    finally:
        changer.close()


def test_render_of_empty_text_is_a_no_op():
    changer = VoiceChanger(AppConfig())
    accented, audio = changer.render("   ")
    assert accented.is_empty and audio.samples.size == 0
    changer.close()


def test_speak_returns_none_for_empty_text():
    changer = VoiceChanger(AppConfig())
    assert changer.speak("") is None
    assert changer.speak("   ") is None
    changer.close()


def test_stop_is_idempotent():
    changer = VoiceChanger(AppConfig())
    changer.stop()
    changer.stop()
    changer.close()
    assert changer.state == State.STOPPED


def test_update_config_swaps_the_accent_language():
    changer = VoiceChanger(AppConfig())
    assert changer.accent.language == "russian"
    config = AppConfig()
    config.accent.language = "german"
    changer.update_config(config)
    assert changer.accent.language == "german"
    changer.close()


def test_events_never_propagate_exceptions():
    def explode(*_args):
        raise RuntimeError("callback bug")

    events = Events(on_state=explode, on_log=explode, on_error=explode)
    events.emit("on_state", "listening")
    events.emit("on_log", "hello")
    events.emit("on_missing", 1)      # unknown hook is ignored


def test_stats_serialisation():
    assert set(Stats().as_dict()) == {
        "utterances", "dropped", "asr_ms", "tts_ms", "fx_ms", "total_ms",
        "engine"}


def test_convert_file_rejects_a_missing_file():
    changer = VoiceChanger(AppConfig())
    with pytest.raises(Exception):
        changer.convert_file(Path("does-not-exist.wav"), Path("out.wav"))
    changer.close()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def run_cli(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_version():
    with pytest.raises(SystemExit) as excinfo:
        run_cli(["--version"])
    assert excinfo.value.code == 0


def test_say_dry_run_russian():
    code, out, _ = run_cli(["say", "--dry-run", "-l", "ru",
                            "this is a test of the system"])
    assert code == 0
    assert "зис" in out


def test_say_dry_run_german():
    code, out, _ = run_cli(["say", "--dry-run", "-l", "de",
                            "we want to stop and speak"])
    assert code == 0
    assert "wie wahnt" in out or "schtop" in out


def test_say_language_aliases():
    for alias in ("ru", "rus", "russian"):
        code, out, _ = run_cli(["say", "--dry-run", "-l", alias, "water"])
        assert code == 0 and "вотэр" in out
    for alias in ("de", "ger", "german"):
        code, out, _ = run_cli(["say", "--dry-run", "-l", alias, "water"])
        assert code == 0 and "wohter" in out


def test_say_with_no_text_is_an_error():
    code, _out, err = run_cli(["say", "--dry-run", "  "])
    assert code == 2 and "Nothing to say" in err


def test_say_strength_and_grammar_flags():
    code, out, _ = run_cli(["say", "--dry-run", "-s", "0.2", "think"])
    assert code == 0 and "синк" not in out
    code, out, _ = run_cli(["say", "--dry-run", "-g", "1.0",
                            "I am going to the store"])
    assert code == 0


def test_presets_and_models_listings():
    code, out, _ = run_cli(["presets"])
    assert code == 0 and "Bond Villain" in out
    code, out, _ = run_cli(["models"])
    assert code == 0 and "tiny.en" in out


def test_voices_listing_covers_both_languages():
    code, out, _ = run_cli(["voices"])
    assert code == 0
    assert "Russian" in out and "German" in out
    assert "ru_RU-dmitri-medium" in out and "de_DE-thorsten-medium" in out


def test_voices_install_rejects_unknown():
    code, _out, err = run_cli(["voices", "--install", "not-a-voice"])
    assert code == 2 and "Unknown voice" in err


def test_doctor_runs_and_reports_what_is_missing():
    code, out, _ = run_cli(["doctor"])
    # Exits non-zero here because no voice model is installed in the fixture.
    assert "Accent Voice Changer" in out
    assert "Accent languages" in out
    assert "Speech synthesis" in out
    assert code in (0, 1)


def test_devices_command_does_not_crash():
    code, _out, _err = run_cli(["devices"])
    assert code in (0, 1)


def test_parser_exposes_every_command():
    parser = cli.build_parser()
    actions = [a for a in parser._actions if a.dest == "command"]
    assert actions, "no subparsers"
    commands = set(actions[0].choices)
    assert {"say", "file", "live", "voices", "devices", "models", "presets",
            "doctor", "gui"} <= commands


# --------------------------------------------------------------------------
# Accent engine reuse
# --------------------------------------------------------------------------

def test_engine_is_reusable_and_stable():
    engine = AccentEngine(language="russian")
    first = engine.accentify("The quick brown fox.").native_text
    for _ in range(5):
        assert engine.accentify("The quick brown fox.").native_text == first


def test_long_input_does_not_blow_up():
    text = "This is a long sentence about many things. " * 40
    result = AccentEngine().accentify(text)
    assert len(result.words) > 300


# --------------------------------------------------------------------------
# Console encoding (Windows regression)
# --------------------------------------------------------------------------

def test_cli_prints_cyrillic_to_a_legacy_codepage_console():
    """A Windows console defaults to cp1252, where Cyrillic is unencodable.

    Without configure_console() this raised UnicodeEncodeError and `ravc say`
    exited 1 on Windows with a charmap error.
    """
    import sys as _sys

    buffer = io.BytesIO()
    legacy = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict",
                              write_through=True)
    real_stdout = _sys.stdout
    _sys.stdout = legacy
    try:
        code = cli.main(["say", "--dry-run", "-l", "ru", "hello there"])
    finally:
        try:
            legacy.flush()
        except Exception:
            pass
        _sys.stdout = real_stdout

    assert code == 0
    assert b"hello there" in buffer.getvalue()


def test_configure_console_is_safe_to_call_repeatedly():
    cli.configure_console()
    cli.configure_console()
