"""The low-latency path: your own voice, changed as you speak.

The accent path is inherently slow, because an accent is a property of
words and words are only known once you have said them. This path gives up
the accent to get the delay down to a few tens of milliseconds: it changes
who you sound like and puts you on the far end of a game voice link.

Structure is deliberately the same as the accent pipeline -- capture
thread, worker, output router -- so devices, routing and the virtual cable
behave identically whichever mode is running.
"""

from __future__ import annotations

import threading
from typing import Callable, Optional

import numpy as np

from . import diagnostics
from .audio.capture import CaptureConfig, MicrophoneCapture
from .audio.devices import (AudioUnavailable, find_device_by_name,
                            find_virtual_cable, sounddevice_available)
from .audio.playback import OutputRouter, PlaybackConfig
from .config import AppConfig
from .dsp.live import LiveProcessor, LiveSettings
from .soundboard import Soundboard

LIVE_RATE = 48000
BLOCK_MS = 20

# If the output falls this far behind, the ring buffer is dropped rather
# than allowed to grow: in a live conversation, late audio is worse than
# missing audio.
MAX_LATENCY_SECONDS = 0.25


class LiveMode:
    """Real-time microphone effects, routed to the virtual cable."""

    def __init__(self, config: Optional[AppConfig] = None,
                 on_state: Optional[Callable[[str], None]] = None,
                 on_level: Optional[Callable[[float], None]] = None,
                 on_output_level: Optional[Callable[[float], None]] = None,
                 on_error: Optional[Callable[[str], None]] = None,
                 on_log: Optional[Callable[[str], None]] = None) -> None:
        self.config = config or AppConfig()
        self.on_state = on_state
        self.on_level = on_level
        # The output level is worth showing separately: a mic meter that
        # moves while the channel stays silent is the commonest way this
        # goes wrong, and without both you cannot see which side it is.
        self.on_output_level = on_output_level
        self.on_error = on_error
        self.on_log = on_log

        self._capture: Optional[MicrophoneCapture] = None
        self._router: Optional[OutputRouter] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._processor: Optional[LiveProcessor] = None
        # The soundboard mixes into the outgoing stream, so clips arrive on
        # the microphone rather than out of your own speakers.
        self.soundboard = Soundboard(LIVE_RATE, self.config.soundboard)
        self._lock = threading.Lock()
        self.running = False
        self.dropped_blocks = 0

    # -- settings --------------------------------------------------------

    def _settings(self) -> LiveSettings:
        voice = self.config.voice
        # One language setting drives both modes: picking German on the
        # Accent page changes what Live does to your vowels and your r too,
        # rather than leaving Live quietly Russian.
        voice.live_accent.language = self.config.accent.language
        return LiveSettings(
            pitch_semitones=voice.live_pitch_semitones,
            comms=voice.comms_profile,
            output_db=voice.fx.output_db,
            noise_gate_db=voice.live_gate_db,
            accent=voice.live_accent,
        )

    def update_config(self, config: AppConfig) -> None:
        self.config = config
        self.soundboard.settings = config.soundboard
        with self._lock:
            if self._processor is not None:
                self._processor.update(self._settings())

    # -- lifecycle -------------------------------------------------------

    def _emit(self, callback, *args) -> None:
        if callback is None:
            return
        try:
            callback(*args)
        except Exception:
            pass

    def start(self) -> None:
        if self.running:
            return
        if not sounddevice_available():
            self._emit(self.on_error,
                       "Audio backend unavailable: install 'sounddevice'.")
            return
        self._stop.clear()
        try:
            self._open_output()
            self._open_input()
        except AudioUnavailable as exc:
            diagnostics.log_exception("live mode start", exc)
            self._emit(self.on_error, str(exc))
            self.stop()
            return

        self._processor = LiveProcessor(LIVE_RATE, self._settings())
        self._thread = threading.Thread(target=self._loop, name="ravc-live",
                                        daemon=True)
        self._thread.start()
        self.running = True
        self._emit(self.on_state, "live")
        self._emit(self.on_log,
                   f"Live mode: about {BLOCK_MS * 2} ms of delay, no accent.")

    def _open_output(self) -> None:
        router = OutputRouter()
        audio = self.config.audio
        target = None
        if audio.output_device:
            target = find_device_by_name(audio.output_device, want_input=False)
        if target is None:
            target = find_virtual_cable()
        router.add(PlaybackConfig(
            device_index=target.index if target else None,
            sample_rate=LIVE_RATE, block_size=int(LIVE_RATE * BLOCK_MS / 1000)))
        if audio.monitor_enabled and audio.monitor_device:
            monitor = find_device_by_name(audio.monitor_device, want_input=False)
            if monitor is not None and (target is None
                                        or monitor.index != target.index):
                router.add(PlaybackConfig(
                    device_index=monitor.index, sample_rate=LIVE_RATE,
                    block_size=int(LIVE_RATE * BLOCK_MS / 1000), volume=0.85))
        if not router.players:
            raise AudioUnavailable("Could not open an output device.\n"
                                   + "\n".join(router.errors))
        self._router = router

    def _open_input(self) -> None:
        audio = self.config.audio
        index = None
        if audio.input_device:
            device = find_device_by_name(audio.input_device, want_input=True)
            if device is not None:
                index = device.index
        capture = MicrophoneCapture(
            CaptureConfig(device_index=index, sample_rate=LIVE_RATE,
                          block_ms=BLOCK_MS, gain_db=audio.input_gain_db),
            on_level=self.on_level)
        capture.start()
        self._capture = capture

    def stop(self) -> None:
        self._stop.set()
        capture, self._capture = self._capture, None
        if capture is not None:
            capture.stop()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=2.0)
        router, self._router = self._router, None
        if router is not None:
            router.stop()
        self._processor = None
        self.running = False
        self._emit(self.on_state, "stopped")

    # -- the loop --------------------------------------------------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            capture = self._capture
            router = self._router
            if capture is None or router is None:
                break
            block = capture.read(timeout=0.2)
            if block is None:
                continue
            try:
                with self._lock:
                    processor = self._processor
                    processed = (processor.process(block)
                                 if processor is not None else block)
            except Exception as exc:  # noqa: BLE001
                diagnostics.log_exception("live processing", exc)
                continue
            try:
                processed = self.soundboard.mix(processed)
            except Exception as exc:  # noqa: BLE001
                # A bad clip must not take the voice down with it.
                diagnostics.log_exception("soundboard", exc)

            # Never let the queue grow: latency you cannot recover from is
            # worse than a dropped block nobody notices.
            if router.queued_seconds > MAX_LATENCY_SECONDS:
                router.flush()
                self.dropped_blocks += 1
            if self.on_output_level is not None and processed.size:
                peak = float(np.abs(processed).max())
                self._emit(self.on_output_level, min(peak, 1.0))
            router.play(processed, LIVE_RATE)

    @property
    def latency_estimate_ms(self) -> float:
        """Roughly what the listener hears, capture plus output buffering."""
        router = self._router
        queued = router.queued_seconds * 1000 if router is not None else 0.0
        return BLOCK_MS + queued
