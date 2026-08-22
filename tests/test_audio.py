"""Capture, playback and voice-activity detection."""

import numpy as np
import pytest

from ravc.audio.capture import Reframer
from ravc.audio.devices import (Device, VIRTUAL_CABLE_HINTS,
                                describe_routing, find_virtual_cable,
                                sounddevice_available)
from ravc.audio.playback import OutputRouter, _RingBuffer
from ravc.audio.vad import (Endpointer, VadConfig, VoiceActivityDetector,
                            frame_energy_db, spectral_flatness,
                            zero_crossing_rate)

SR = 16000


def frames_of(kind, count, cfg):
    length = cfg.frame_length
    rng = np.random.RandomState(hash(kind) % 2 ** 31)
    if kind == "noise":
        return list((rng.randn(count * length) * 0.002)
                    .astype(np.float32).reshape(count, length))
    t = np.arange(count * length) / cfg.sample_rate
    speech = (np.sin(2 * np.pi * 130 * t) + 0.5 * np.sin(2 * np.pi * 260 * t)
              + 0.3 * np.sin(2 * np.pi * 520 * t)) * 0.15
    speech = speech * (1 + 0.4 * np.sin(2 * np.pi * 4 * t))
    return list(speech.astype(np.float32).reshape(count, length))


# --------------------------------------------------------------------------
# Ring buffer
# --------------------------------------------------------------------------

def test_ring_buffer_reads_back_what_was_written():
    ring = _RingBuffer(1000)
    ring.write(np.arange(600, dtype=np.float32))
    assert np.array_equal(ring.read(400), np.arange(400))
    ring.write(np.arange(600, 700, dtype=np.float32))
    assert np.array_equal(ring.read(300), np.arange(400, 700))


def test_ring_buffer_underrun_returns_silence():
    ring = _RingBuffer(100)
    assert np.array_equal(ring.read(50), np.zeros(50))


def test_ring_buffer_oversize_write_keeps_the_newest():
    ring = _RingBuffer(1000)
    ring.write(np.arange(1500, dtype=np.float32))
    assert np.array_equal(ring.read(1000), np.arange(500, 1500))


def test_ring_buffer_partial_overflow_keeps_the_newest():
    ring = _RingBuffer(1000)
    ring.write(np.arange(800, dtype=np.float32))
    ring.write(np.arange(800, 1200, dtype=np.float32))
    assert np.array_equal(ring.read(1000), np.arange(200, 1200))


def test_ring_buffer_wraps_without_losing_count():
    ring = _RingBuffer(1000)
    for i in range(50):
        ring.write(np.full(37, i, dtype=np.float32))
    assert ring.available == 1000
    ring.clear()
    assert ring.available == 0


# --------------------------------------------------------------------------
# Reframer
# --------------------------------------------------------------------------

def test_reframer_emits_fixed_size_frames():
    reframer = Reframer(320)
    out = []
    for n in (100, 700, 50, 1000, 13):
        out += reframer.push(np.arange(n, dtype=np.float32))
    assert out and all(frame.size == 320 for frame in out)


def test_reframer_loses_no_samples():
    reframer = Reframer(64)
    total = np.arange(1000, dtype=np.float32)
    frames = []
    for i in range(0, 1000, 97):
        frames += reframer.push(total[i:i + 97])
    joined = np.concatenate(frames) if frames else np.zeros(0)
    assert np.array_equal(joined, total[:joined.size])


def test_reframer_reset():
    reframer = Reframer(100)
    reframer.push(np.zeros(50, dtype=np.float32))
    reframer.reset()
    assert reframer.push(np.zeros(100, dtype=np.float32))[0].size == 100


# --------------------------------------------------------------------------
# VAD
# --------------------------------------------------------------------------

def test_speech_is_more_tonal_than_noise():
    cfg = VadConfig(sample_rate=SR)
    assert spectral_flatness(frames_of("speech", 1, cfg)[0]) < 0.1
    assert spectral_flatness(frames_of("noise", 1, cfg)[0]) > 0.3


def test_energy_and_zcr_helpers():
    assert frame_energy_db(np.zeros(0)) == -120.0
    assert frame_energy_db(np.ones(100)) == pytest.approx(0.0, abs=1e-6)
    assert zero_crossing_rate(np.array([1.0])) == 0.0
    alternating = np.array([1.0, -1.0] * 50)
    assert zero_crossing_rate(alternating) > 0.9


def test_vad_separates_speech_from_room_noise():
    cfg = VadConfig(sample_rate=SR)
    vad = VoiceActivityDetector(cfg)
    for frame in frames_of("noise", 30, cfg):
        vad.is_speech(frame)
    assert all(vad.is_speech(f) for f in frames_of("speech", 10, cfg))


def test_endpointer_finds_each_utterance():
    cfg = VadConfig(sample_rate=SR)
    endpointer = Endpointer(cfg)
    sequence = (frames_of("noise", 40, cfg) + frames_of("speech", 60, cfg)
                + frames_of("noise", 50, cfg) + frames_of("speech", 45, cfg)
                + frames_of("noise", 50, cfg))
    found = [u for u in (endpointer.push(f) for f in sequence) if u]
    assert len(found) == 2
    assert all(0.8 < u.duration < 2.5 for u in found)


def test_endpointer_ignores_a_blip():
    cfg = VadConfig(sample_rate=SR, min_utterance_ms=800)
    endpointer = Endpointer(cfg)
    sequence = (frames_of("noise", 30, cfg) + frames_of("speech", 9, cfg)
                + frames_of("noise", 60, cfg))
    assert not [u for u in (endpointer.push(f) for f in sequence) if u]


def test_endpointer_cuts_a_monologue():
    cfg = VadConfig(sample_rate=SR, max_utterance_s=1.0)
    endpointer = Endpointer(cfg)
    sequence = frames_of("noise", 20, cfg) + frames_of("speech", 300, cfg)
    found = [u for u in (endpointer.push(f) for f in sequence) if u]
    assert len(found) >= 2
    assert all(u.duration <= 1.4 for u in found)


def test_endpointer_flush_closes_an_open_utterance():
    cfg = VadConfig(sample_rate=SR)
    endpointer = Endpointer(cfg)
    for frame in frames_of("noise", 30, cfg) + frames_of("speech", 60, cfg):
        endpointer.push(frame)
    assert endpointer.flush() is not None
    assert endpointer.flush() is None


def test_endpointer_reset():
    cfg = VadConfig(sample_rate=SR)
    endpointer = Endpointer(cfg)
    for frame in frames_of("speech", 40, cfg):
        endpointer.push(frame)
    endpointer.reset()
    assert endpointer.flush() is None


# --------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------

def test_virtual_cable_detection_prefers_vb_cable():
    devices = [
        Device(0, "Speakers (Realtek)", 0, 2, 48000),
        Device(1, "VoiceMeeter Input (VB-Audio)", 0, 2, 48000),
        Device(2, "CABLE Input (VB-Audio Virtual Cable)", 0, 2, 48000),
    ]
    found = find_virtual_cable(devices)
    assert found is not None and found.index == 2
    assert found.virtual_cable_brand == "VB-Audio Virtual Cable"


def test_no_virtual_cable():
    assert find_virtual_cable([Device(0, "Speakers", 0, 2, 48000)]) is None


def test_input_only_device_is_not_a_cable_output():
    assert find_virtual_cable([Device(0, "CABLE Output", 2, 0, 48000)]) is None


def test_every_hint_matches_itself():
    for hint, brand in VIRTUAL_CABLE_HINTS:
        device = Device(0, hint.upper(), 0, 2, 48000)
        assert device.virtual_cable_brand == brand


def test_device_flags_and_label():
    device = Device(3, "Mic", 2, 0, 44100, "WASAPI")
    assert device.is_input and not device.is_output
    assert "WASAPI" in device.label


def test_describe_routing_never_raises():
    assert isinstance(describe_routing(), str)


def test_output_router_is_inert_without_a_backend():
    router = OutputRouter()
    assert not router.active
    router.play(np.zeros(100, dtype=np.float32), 48000)   # must not raise
    router.flush()
    router.stop()


@pytest.mark.skipif(not sounddevice_available(),
                    reason="PortAudio not installed")
def test_device_listing_works_when_available():
    from ravc.audio.devices import list_devices
    assert isinstance(list_devices(), list)
