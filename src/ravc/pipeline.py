"""The live pipeline: microphone in, accented voice out.

Stages run on separate threads so a slow transcription never stalls audio
capture:

    PortAudio callback -> capture queue
        -> listen thread : reframe, VAD, endpoint  -> utterance queue
            -> work thread : ASR, accent, TTS, FX  -> output router

Two behaviours that matter in practice and are easy to get wrong:

* **Feedback suppression.**  While the changed voice is playing on your
  monitor speakers, the microphone hears it.  Without a guard the pipeline
  transcribes its own output and re-speaks it, forever.  Capture is muted
  for the duration of playback plus a short tail.
* **Backlog dropping.**  If you talk faster than the machine synthesises,
  queuing everything means replies arriving a minute late.  The utterance
  queue is small and drops the oldest, so the voice stays current.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Callable, List, Optional

import numpy as np

from .accent.engine import AccentEngine, AccentResult
from .accent.languages import get_pack
from .asr.whisper_asr import ASR_RATE, AsrConfig, WhisperAsr
from .audio.capture import CaptureConfig, MicrophoneCapture, Reframer
from .audio.devices import (AudioUnavailable, find_device_by_name,
                            find_virtual_cable, sounddevice_available)
from .audio.playback import OutputRouter, PlaybackConfig
from .audio.vad import Endpointer, Utterance, VadConfig
from .config import AppConfig
from .dsp.calibrate import VoiceFingerprint, fingerprint, match
from .dsp.chain import VoiceFx
from .tts.base import Audio, SynthRequest
from .tts.registry import VoiceRegistry


class State:
    STOPPED = "stopped"
    STARTING = "starting"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    ERROR = "error"


@dataclass
class Stats:
    utterances: int = 0
    dropped: int = 0
    asr_ms: float = 0.0
    tts_ms: float = 0.0
    fx_ms: float = 0.0
    total_ms: float = 0.0
    engine: str = ""

    def as_dict(self) -> dict:
        return {"utterances": self.utterances, "dropped": self.dropped,
                "asr_ms": round(self.asr_ms), "tts_ms": round(self.tts_ms),
                "fx_ms": round(self.fx_ms), "total_ms": round(self.total_ms),
                "engine": self.engine}


@dataclass
class Events:
    """UI hooks.  Every one is optional and must never raise."""

    on_state: Optional[Callable[[str], None]] = None
    on_level: Optional[Callable[[float], None]] = None
    on_utterance: Optional[Callable[[str, AccentResult], None]] = None
    on_error: Optional[Callable[[str], None]] = None
    on_log: Optional[Callable[[str], None]] = None
    on_stats: Optional[Callable[[dict], None]] = None

    def emit(self, name: str, *args) -> None:
        handler = getattr(self, name, None)
        if handler is None:
            return
        try:
            handler(*args)
        except Exception:
            pass


class VoiceChanger:
    """Owns the whole live pipeline."""

    def __init__(self, config: Optional[AppConfig] = None,
                 events: Optional[Events] = None) -> None:
        self.config = config or AppConfig()
        self.events = events or Events()
        self.stats = Stats()

        self.registry = VoiceRegistry()
        self.asr = WhisperAsr(self._asr_config())
        self.accent = self._accent_engine()

        self._capture: Optional[MicrophoneCapture] = None
        self._router: Optional[OutputRouter] = None
        self._utterances: "Queue[Utterance]" = Queue(
            maxsize=max(1, self.config.behaviour.max_queue))
        self._threads: List[threading.Thread] = []
        self._stop = threading.Event()
        self._state = State.STOPPED
        self._mute_until = 0.0
        self._lock = threading.Lock()

    # -- configuration ---------------------------------------------------

    def _asr_config(self) -> AsrConfig:
        rec = self.config.recognition
        return AsrConfig(model_size=rec.model_size, device=rec.device,
                         beam_size=rec.beam_size)

    def _accent_engine(self) -> AccentEngine:
        acc = self.config.accent
        return AccentEngine(language=acc.language,
                            profile=acc.to_profile(),
                            grammar_strength=acc.grammar_strength,
                            swap_prepositions=acc.swap_prepositions)

    def _vad_config(self) -> VadConfig:
        rec = self.config.recognition
        return VadConfig(sample_rate=ASR_RATE,
                         frame_ms=self.config.audio.mic_block_ms,
                         threshold_db=rec.vad_threshold_db,
                         speech_onset_ms=rec.speech_onset_ms,
                         silence_hangover_ms=rec.silence_hangover_ms,
                         max_utterance_s=rec.max_utterance_s)

    def update_config(self, config: AppConfig) -> None:
        """Apply new settings.  Audio-device changes need a restart."""
        with self._lock:
            was_running = self.running
            needs_restart = (
                config.audio != self.config.audio
                or config.recognition.model_size != self.config.recognition.model_size)
            self.config = config
            self.accent = self._accent_engine()
            self.asr.config = self._asr_config()
        if needs_restart and was_running:
            self.restart()

    # -- state -----------------------------------------------------------

    @property
    def state(self) -> str:
        return self._state

    @property
    def running(self) -> bool:
        return self._state not in (State.STOPPED, State.ERROR)

    def _set_state(self, state: str) -> None:
        if state == self._state:
            return
        self._state = state
        self.events.emit("on_state", state)

    def _log(self, message: str) -> None:
        self.events.emit("on_log", message)

    # -- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if self.running:
            return
        if not sounddevice_available():
            self._fail("Audio backend unavailable: install 'sounddevice' "
                       "(pip install sounddevice).")
            return
        self._stop.clear()
        self._set_state(State.STARTING)
        try:
            self._open_output()
            self._open_input()
        except AudioUnavailable as exc:
            self._fail(str(exc))
            return

        self._threads = [
            threading.Thread(target=self._listen_loop, name="ravc-listen",
                             daemon=True),
            threading.Thread(target=self._work_loop, name="ravc-work",
                             daemon=True),
        ]
        for thread in self._threads:
            thread.start()
        self._set_state(State.LISTENING)
        adjective = get_pack(self.config.accent.language).adjective
        self._log(f"Listening. Speak English; you will come out {adjective}.")
        threading.Thread(target=self._warm_up, name="ravc-warmup",
                         daemon=True).start()

    def _voice_installed(self, voice_key: str, language: str) -> bool:
        for voice in self.registry.all_voices(language):
            if voice.key == voice_key:
                return voice.installed
        return False

    def _warm_up(self) -> None:
        try:
            self.registry.warm_up(self.config.active_voice_key)
        except Exception:
            pass
        try:
            self.asr.warm_up()
        except Exception as exc:
            self._log(f"Speech model not ready: {exc}")

    def _open_output(self) -> None:
        audio = self.config.audio
        router = OutputRouter()

        target = None
        if audio.output_device:
            target = find_device_by_name(audio.output_device, want_input=False)
        if target is None:
            target = find_virtual_cable()
        if target is not None:
            router.add(PlaybackConfig(device_index=target.index,
                                      sample_rate=audio.output_sample_rate))
            self._log(f"Output -> {target.name}")
        else:
            router.add(PlaybackConfig(sample_rate=audio.output_sample_rate))
            self._log("No virtual cable found; using the default output "
                      "device. Other apps will not hear the changed voice "
                      "until you install one.")

        if audio.monitor_enabled and audio.monitor_device:
            monitor = find_device_by_name(audio.monitor_device, want_input=False)
            if monitor is not None and (target is None
                                        or monitor.index != target.index):
                router.add(PlaybackConfig(device_index=monitor.index,
                                          sample_rate=audio.output_sample_rate,
                                          volume=0.85))
                self._log(f"Monitor -> {monitor.name}")

        if not router.players:
            raise AudioUnavailable(
                "Could not open any audio output device.\n"
                + "\n".join(router.errors))
        self._router = router

    def _open_input(self) -> None:
        audio = self.config.audio
        index = None
        if audio.input_device:
            device = find_device_by_name(audio.input_device, want_input=True)
            if device is not None:
                index = device.index
                self._log(f"Microphone -> {device.name}")
        capture = MicrophoneCapture(
            CaptureConfig(device_index=index, sample_rate=ASR_RATE,
                          block_ms=audio.mic_block_ms,
                          gain_db=audio.input_gain_db),
            on_level=lambda peak: self.events.emit("on_level", peak))
        capture.start()
        self._capture = capture

    def stop(self) -> None:
        self._stop.set()
        capture, self._capture = self._capture, None
        if capture is not None:
            capture.stop()
        for thread in self._threads:
            thread.join(timeout=2.5)
        self._threads = []
        router, self._router = self._router, None
        if router is not None:
            router.stop()
        while not self._utterances.empty():
            try:
                self._utterances.get_nowait()
            except Empty:
                break
        self._set_state(State.STOPPED)

    def restart(self) -> None:
        self.stop()
        self.start()

    def close(self) -> None:
        self.stop()
        self.registry.close()
        self.asr.close()

    def _fail(self, message: str) -> None:
        self._set_state(State.ERROR)
        self.events.emit("on_error", message)

    # -- threads ---------------------------------------------------------

    def _listen_loop(self) -> None:
        vad_config = self._vad_config()
        endpointer = Endpointer(vad_config)
        reframer = Reframer(vad_config.frame_length)

        while not self._stop.is_set():
            capture = self._capture
            if capture is None:
                break
            block = capture.read(timeout=0.2)
            if block is None:
                continue

            # Ignore the microphone while our own voice is playing, or we
            # transcribe ourselves and loop forever.
            if time.monotonic() < self._mute_until:
                endpointer.reset()
                reframer.reset()
                continue

            for frame in reframer.push(block):
                utterance = endpointer.push(frame)
                if utterance is not None:
                    self._enqueue(utterance)

        final = endpointer.flush()
        if final is not None:
            self._enqueue(final)

    def _enqueue(self, utterance: Utterance) -> None:
        try:
            self._utterances.put_nowait(utterance)
        except Full:
            self.stats.dropped += 1
            try:
                self._utterances.get_nowait()
                self._utterances.put_nowait(utterance)
            except (Empty, Full):
                pass
            self._log("Dropped an utterance: synthesis is behind. "
                      "Try a smaller speech model.")

    def _settle_state(self) -> None:
        if self._stop.is_set():
            return
        if time.monotonic() >= self._mute_until:
            self._set_state(State.LISTENING)

    def _work_loop(self) -> None:
        while not self._stop.is_set():
            # Drop back to "listening" only once our own audio has finished
            # playing, or the UI says "listening" while it is still speaking.
            self._settle_state()
            try:
                utterance = self._utterances.get(timeout=0.25)
            except Empty:
                continue
            try:
                self._process(utterance)
            except Exception as exc:  # noqa: BLE001
                self.events.emit("on_error", f"Processing failed: {exc}")

    def _process(self, utterance: Utterance) -> None:
        started = time.perf_counter()
        self._set_state(State.THINKING)

        t0 = time.perf_counter()
        transcript = self.asr.transcribe(utterance.samples, utterance.sample_rate)
        self.stats.asr_ms = (time.perf_counter() - t0) * 1000
        if not transcript.ok:
            self._log(f"(ignored: {transcript.rejected_reason or 'no speech'})")
            return

        result = self.speak(transcript.text, blocking=False)
        if result is None:
            return
        self.stats.utterances += 1
        self.stats.total_ms = (time.perf_counter() - started) * 1000
        self.events.emit("on_stats", self.stats.as_dict())

    # -- speaking --------------------------------------------------------

    def render(self, text: str) -> tuple:
        """Text -> (AccentResult, processed Audio).  No playback."""
        accented = self.accent.accentify(text)
        if accented.is_empty:
            return accented, Audio(np.zeros(0, dtype=np.float32), 22050)

        language = self.config.accent.language
        voice_key = self.config.active_voice_key
        if not self._voice_installed(voice_key, language):
            fallback = self.registry.best_voice(language)
            if fallback:
                voice_key = fallback

        t0 = time.perf_counter()
        audio = self.registry.synthesize(SynthRequest(
            text=accented.native_text,
            ipa=self.accent.flat_ipa(accented),
            voice_key=voice_key,
            speaker=self.config.voice.speaker_for(voice_key),
            rate=self.config.voice.speaking_rate,
            plain_text=text), language=language)
        self.stats.tts_ms = (time.perf_counter() - t0) * 1000
        self.stats.engine = self.registry.last_engine_used

        t0 = time.perf_counter()
        fx: VoiceFx = self.config.voice.fx
        audio = fx.apply(audio)
        self.stats.fx_ms = (time.perf_counter() - t0) * 1000
        return accented, audio

    def speak(self, text: str, blocking: bool = True) -> Optional[AccentResult]:
        """Accent ``text`` and play it out.  Used by both live and typed input."""
        if not text or not text.strip():
            return None
        accented, audio = self.render(text)
        if audio.samples.size == 0:
            return None

        self.events.emit("on_utterance", text, accented)
        router = self._router
        if router is None:
            return accented

        self._set_state(State.SPEAKING)
        router.play(audio.samples, audio.sample_rate)
        # Keep the mic closed for the playback plus a little room-decay tail.
        self._mute_until = max(self._mute_until,
                               time.monotonic() + audio.duration + 0.35)
        if blocking:
            deadline = time.monotonic() + audio.duration + 0.5
            while time.monotonic() < deadline and not self._stop.is_set():
                time.sleep(0.05)
        return accented

    # -- calibration -----------------------------------------------------

    CALIBRATION_LINE = ("The quick brown fox jumps over the lazy dog. "
                        "I am recording my voice so it can be measured.")

    def voice_fingerprint(self) -> VoiceFingerprint:
        """Measure the *raw* character voice, before any effects.

        The effects chain is what calibration solves for, so the reference
        has to be taken upstream of it -- fingerprinting the processed
        output would measure the shift already applied and converge on
        doing nothing.
        """
        accented = self.accent.accentify(self.CALIBRATION_LINE)
        language = self.config.accent.language
        voice_key = self.config.active_voice_key
        audio = self.registry.synthesize(SynthRequest(
            text=accented.native_text,
            ipa=self.accent.flat_ipa(accented),
            voice_key=voice_key,
            speaker=self.config.voice.speaker_for(voice_key),
            rate=self.config.voice.speaking_rate), language=language)
        return fingerprint(audio.samples, audio.sample_rate)

    def calibrate(self, samples: np.ndarray, sample_rate: int,
                  apply: bool = True) -> tuple:
        """Match the character voice to the speaker in ``samples``.

        Returns ``(pitch_semitones, formant_semitones, message)``. On a
        recording with too little voiced speech the shifts come back zero
        and nothing is changed, rather than the settings being wrecked by a
        measurement of room noise.
        """
        target = fingerprint(samples, sample_rate)
        if not target.usable:
            return 0.0, 0.0, ("Could not measure that recording — "
                              "too little clear speech. Try again, speaking "
                              "normally for about five seconds.")
        source = self.voice_fingerprint()
        if not source.usable:
            return 0.0, 0.0, ("Could not measure the character voice. "
                              "Check that a voice model is downloaded.")

        pitch, formant = match(source, target)
        if apply:
            self.config.voice.fx.pitch_semitones = pitch
            self.config.voice.fx.formant_semitones = formant
        return pitch, formant, (
            f"Matched to your voice: pitch {pitch:+.1f} semitones, "
            f"formant {formant:+.1f}. "
            f"You: {target.describe()}. Voice: {source.describe()}.")

    def record(self, seconds: float = 6.0,
               on_level: Optional[Callable[[float], None]] = None) -> tuple:
        """Capture a short mono clip from the configured microphone."""
        audio_config = self.config.audio
        index = None
        if audio_config.input_device:
            device = find_device_by_name(audio_config.input_device,
                                         want_input=True)
            if device is not None:
                index = device.index

        capture = MicrophoneCapture(
            CaptureConfig(device_index=index, sample_rate=ASR_RATE,
                          block_ms=audio_config.mic_block_ms,
                          gain_db=audio_config.input_gain_db),
            on_level=on_level)
        capture.start()
        collected: List[np.ndarray] = []
        deadline = time.monotonic() + seconds
        try:
            while time.monotonic() < deadline:
                block = capture.read(timeout=0.3)
                if block is not None:
                    collected.append(block)
        finally:
            capture.stop()
        if not collected:
            return np.zeros(0, dtype=np.float32), ASR_RATE
        return np.concatenate(collected), ASR_RATE

    # -- offline ---------------------------------------------------------

    def convert_file(self, source: Path, destination: Path,
                     progress: Optional[Callable[[str], None]] = None) -> Path:
        """Transcribe an audio file and re-speak it with the accent."""
        import soundfile as sf

        source, destination = Path(source), Path(destination)
        data, sample_rate = sf.read(str(source), dtype="float32", always_2d=True)
        mono = data.mean(axis=1).astype(np.float32)

        if progress:
            progress("Transcribing…")
        transcript = self.asr.transcribe(mono, sample_rate)
        if not transcript.ok:
            raise RuntimeError(
                f"No speech recognised in {source.name} "
                f"({transcript.rejected_reason or 'silent'}).")
        if progress:
            progress(f"Heard: {transcript.text}")

        accented, audio = self.render(transcript.text)
        if audio.samples.size == 0:
            raise RuntimeError("Nothing to synthesise.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(destination), audio.samples, audio.sample_rate)
        if progress:
            progress(f"Wrote {destination}")
        return destination

    def render_to_file(self, text: str, destination: Path) -> Path:
        """Type-to-speak, straight to a wav file."""
        import soundfile as sf

        _accented, audio = self.render(text)
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(destination), audio.samples, audio.sample_rate)
        return destination
