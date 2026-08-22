"""Tests for the soundboard and for saved profiles."""

from __future__ import annotations

import numpy as np
import pytest

from ravc.config import AppConfig, Profile
from ravc.soundboard import (MAX_CLIP_SECONDS, SoundClip, Soundboard,
                             SoundboardSettings)

RATE = 48000


@pytest.fixture
def clip(tmp_path):
    """A quarter-second tone at a rate the board has to resample."""
    soundfile = pytest.importorskip("soundfile")
    path = tmp_path / "beep.wav"
    t = np.arange(int(22050 * 0.25)) / 22050
    soundfile.write(str(path), (0.5 * np.sin(2 * np.pi * 880 * t)).astype("float32"),
                    22050)
    return str(path)


def board(clip_path: str, **kwargs) -> Soundboard:
    settings = SoundboardSettings(clips=[SoundClip("beep", clip_path)], **kwargs)
    return Soundboard(RATE, settings)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0


def voice(seconds: float = 1.0, amplitude: float = 0.2) -> np.ndarray:
    n = int(RATE * seconds)
    return (amplitude * np.sin(2 * np.pi * 150 * np.arange(n) / RATE)
            ).astype(np.float32)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def test_a_clip_is_decoded_and_resampled_to_the_stream_rate(clip):
    sounds = board(clip)
    samples = sounds.load(clip)
    assert samples is not None
    # A quarter second at 22050 becomes a quarter second at 48000.
    assert abs(samples.size - RATE * 0.25) < RATE * 0.02
    assert samples.dtype == np.float32


def test_decoding_happens_once(clip):
    sounds = board(clip)
    first = sounds.load(clip)
    assert sounds.load(clip) is first      # the same array, not a re-read
    sounds.forget(clip)
    assert sounds.load(clip) is not first


def test_a_missing_or_broken_clip_does_not_take_the_voice_down(tmp_path):
    sounds = board(str(tmp_path / "nothing.wav"))
    assert sounds.trigger(0) is False
    rubbish = tmp_path / "rubbish.wav"
    rubbish.write_bytes(b"not audio at all")
    sounds = board(str(rubbish))
    assert sounds.load(str(rubbish)) is None
    assert sounds.trigger(0) is False
    # And the stream still passes through untouched.
    block = voice(0.02)
    assert np.allclose(sounds.mix(block), block)


def test_a_clip_is_truncated_rather_than_played_forever(tmp_path):
    soundfile = pytest.importorskip("soundfile")
    path = tmp_path / "long.wav"
    seconds = MAX_CLIP_SECONDS + 5
    soundfile.write(str(path),
                    np.zeros(int(8000 * seconds), dtype="float32"), 8000)
    sounds = board(str(path))
    samples = sounds.load(str(path))
    assert samples.size <= MAX_CLIP_SECONDS * RATE


def test_preload_decodes_everything_up_front(clip, tmp_path):
    sounds = Soundboard(RATE, SoundboardSettings(clips=[
        SoundClip("beep", clip), SoundClip("gone", str(tmp_path / "no.wav"))]))
    sounds.preload()
    assert clip in sounds._cache          # and the missing one did not raise


# --------------------------------------------------------------------------
# Playing
# --------------------------------------------------------------------------

def test_a_triggered_clip_is_mixed_into_the_stream(clip):
    sounds = board(clip, duck_db=0.0)
    quiet = sounds.mix(voice(0.02))
    sounds.trigger(0)
    loud = sounds.mix(voice(0.02))
    assert rms(loud) > rms(quiet) * 1.4


def test_the_clip_ends_and_the_voice_comes_back(clip):
    sounds = board(clip)
    sounds.trigger(0)
    block = voice(0.02)
    out = np.concatenate([sounds.mix(block) for _ in range(50)])
    assert not sounds.playing
    # The last stretch is the voice alone, at its original level.
    assert rms(out[-4800:]) == pytest.approx(rms(block), rel=0.05)


def test_retriggering_restarts_instead_of_stacking(clip):
    """Holding a key must not pile the same sample onto itself."""
    sounds = board(clip, duck_db=0.0)
    peaks = []
    for _ in range(6):
        sounds.trigger(0)
        peaks.append(float(np.abs(sounds.mix(voice(0.01))).max()))
    assert max(peaks) < peaks[0] * 1.6, peaks


def test_the_microphone_ducks_under_a_clip_and_recovers(clip):
    sounds = board(clip, duck_db=-14.0)
    block = voice(0.01)
    before = rms(sounds.mix(block))
    sounds.trigger(0)
    for _ in range(6):                     # let the duck reach its target
        sounds.mix(block)
    assert sounds._duck < 0.4
    sounds.stop_all()
    for _ in range(80):                    # and release, more slowly
        after = rms(sounds.mix(block))
    assert sounds._duck > 0.95
    assert after == pytest.approx(before, rel=0.05)


def test_ducking_ramps_rather_than_steps(clip):
    """A hard switch would click."""
    sounds = board(clip, duck_db=-20.0)
    sounds.trigger(0)
    envelope = sounds._duck_envelope(480, 0.1)
    assert np.all(np.diff(envelope) <= 0)
    assert abs(float(np.diff(envelope).max())) < 0.01


def test_switching_the_board_off_silences_it(clip):
    sounds = board(clip)
    sounds.trigger(0)
    sounds.settings.enabled = False
    block = voice(0.02)
    assert np.allclose(sounds.mix(block), block)
    assert sounds.trigger(0) is False


def test_reading_more_than_is_left_does_not_run_off_the_end(clip):
    sounds = board(clip)
    sounds.trigger(0)
    out = sounds.read(RATE * 2)            # far longer than the clip
    assert out.size == RATE * 2
    assert np.all(np.isfinite(out))
    assert sounds.read(0).size == 0
    assert not sounds.playing


def test_triggering_out_of_range_is_refused(clip):
    sounds = board(clip)
    assert sounds.trigger(-1) is False
    assert sounds.trigger(99) is False


def test_read_is_safe_to_call_from_another_thread(clip):
    """`trigger` comes from the hotkey thread while `read` is in the audio
    loop, so the two must not corrupt each other."""
    import threading
    sounds = board(clip)
    errors = []

    def hammer():
        try:
            for _ in range(400):
                sounds.trigger(0)
        except Exception as exc:           # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=hammer) for _ in range(4)]
    for thread in threads:
        thread.start()
    for _ in range(400):
        assert np.all(np.isfinite(sounds.read(960)))
    for thread in threads:
        thread.join()
    assert not errors


# --------------------------------------------------------------------------
# Profiles
# --------------------------------------------------------------------------

def test_a_profile_captures_and_restores_the_accent_and_voice():
    config = AppConfig()
    config.accent.strength = 0.31
    config.voice.fx.pitch_semitones = -4.0
    config.save_profile("CS:GO")

    config.accent.strength = 0.95
    config.voice.fx.pitch_semitones = 7.0
    assert config.apply_profile("CS:GO")
    assert config.accent.strength == 0.31
    assert config.voice.fx.pitch_semitones == -4.0


def test_a_profile_is_a_copy_not_a_view():
    """Changing the live settings afterwards must not rewrite the profile."""
    config = AppConfig()
    config.accent.strength = 0.2
    config.save_profile("one")
    config.accent.strength = 0.8
    assert config.profiles[0].accent.strength == 0.2


def test_saving_over_a_profile_replaces_it_in_place():
    config = AppConfig()
    config.save_profile("a")
    config.save_profile("b")
    config.accent.strength = 0.5
    config.save_profile("a")
    assert [p.name for p in config.profiles] == ["a", "b"]
    assert config.profiles[0].accent.strength == 0.5


def test_deleting_and_applying_unknown_profiles_is_harmless():
    config = AppConfig()
    assert config.apply_profile("nope") is False
    assert config.delete_profile("nope") is False
    config.save_profile("real")
    assert config.delete_profile("real") is True
    assert config.profiles == []


def test_profiles_and_clips_survive_being_saved_and_reloaded(tmp_path):
    """Lists of dataclasses, which the loader did not used to rebuild.

    An empty list default says nothing about what goes in it, so without
    reading the annotation these came back as lists of plain dicts -- right
    values, and an AttributeError at the first use.
    """
    config = AppConfig()
    config.accent.strength = 0.37
    config.save_profile("CS:GO")
    config.soundboard.clips = [
        SoundClip(name="airhorn", path="/tmp/a.wav", hotkey="ctrl+alt+1",
                  gain_db=-2.0)]
    config.soundboard.duck_db = -9.0
    path = tmp_path / "config.json"
    config.save(path)

    loaded = AppConfig.load(path)
    assert isinstance(loaded.profiles[0], Profile)
    assert loaded.profiles[0].name == "CS:GO"
    assert loaded.profiles[0].accent.strength == 0.37
    assert isinstance(loaded.soundboard.clips[0], SoundClip)
    assert loaded.soundboard.clips[0].hotkey == "ctrl+alt+1"
    assert loaded.soundboard.clips[0].gain_db == -2.0
    assert loaded.soundboard.duck_db == -9.0
    # And the profile's own nested settings are typed too.
    assert loaded.profiles[0].voice.live_accent.consonants.trill is True
