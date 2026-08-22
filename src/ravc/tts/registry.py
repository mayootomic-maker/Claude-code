"""Engine selection and fallback.

The user picks a voice; this decides which backend can actually speak it
right now, and falls back gracefully when the preferred one cannot (model
not downloaded, no network, no matching system voice).
"""

from __future__ import annotations

import threading
from typing import Dict, List, Optional, Tuple

from .base import Audio, SynthRequest, TtsEngine, TtsError, Voice
from .edge_tts_engine import EdgeTtsEngine
from .piper import PiperEngine
from .sapi import SapiEngine
from . import voices as voice_catalogue

# Preference order when nothing specific is asked for: offline and
# high-quality first, network second, system voices last.
ENGINE_ORDER = ("piper", "edge", "sapi")


class VoiceRegistry:
    """Owns one instance of each backend and routes requests to them."""

    def __init__(self) -> None:
        self._engines: Dict[str, TtsEngine] = {
            "piper": PiperEngine(),
            "edge": EdgeTtsEngine(),
            "sapi": SapiEngine(),
        }
        self._lock = threading.Lock()
        self.last_engine_used: str = ""
        self.last_fallback_reason: str = ""

    # -- discovery -------------------------------------------------------

    def engine(self, name: str) -> Optional[TtsEngine]:
        return self._engines.get(name)

    def all_voices(self, language: Optional[str] = None) -> List[Voice]:
        out: List[Voice] = []
        for name in ENGINE_ORDER:
            engine = self._engines[name]
            try:
                out.extend(engine.list_voices(language))
            except Exception:
                continue
        return out

    def usable_voices(self, language: Optional[str] = None) -> List[Voice]:
        return [v for v in self.all_voices(language) if v.installed]

    def best_voice(self, language: str) -> Optional[str]:
        """The voice to use for ``language`` when the saved one will not do."""
        for voice in self.all_voices(language):
            if voice.installed:
                return voice.key
        return None

    def available_engines(self) -> List[str]:
        out = []
        for name in ENGINE_ORDER:
            try:
                if self._engines[name].is_available():
                    out.append(name)
            except Exception:
                continue
        return out

    @staticmethod
    def split_key(voice_key: str) -> Tuple[str, str]:
        if ":" in voice_key:
            engine, _, rest = voice_key.partition(":")
            if engine in ENGINE_ORDER:
                return engine, rest
        # A bare Piper model name is the historical form; keep accepting it.
        return "piper", voice_key

    # -- synthesis -------------------------------------------------------

    def synthesize(self, request: SynthRequest, language: str = "russian",
                   allow_fallback: bool = True) -> Audio:
        """Speak, falling back through the engine order if needed."""
        preferred, _rest = self.split_key(request.voice_key or "")
        order = [preferred] + [e for e in ENGINE_ORDER if e != preferred]
        errors: List[str] = []
        self.last_fallback_reason = ""

        for index, name in enumerate(order):
            engine = self._engines.get(name)
            if engine is None:
                continue
            try:
                if not engine.is_available():
                    errors.append(f"{name}: not available")
                    continue
            except Exception as exc:
                errors.append(f"{name}: {exc}")
                continue

            attempt = request
            if index > 0:
                # Falling back: the saved voice key belongs to another engine,
                # so let the fallback engine choose its own default voice.
                attempt = SynthRequest(
                    text=request.text, ipa=request.ipa,
                    voice_key=None, rate=request.rate, pitch=request.pitch,
                    volume=request.volume, plain_text=request.plain_text)
            try:
                audio = engine.synthesize(attempt)
            except Exception as exc:
                errors.append(f"{name}: {exc}")
                if not allow_fallback:
                    raise
                continue
            if audio.samples.size == 0 and index < len(order) - 1:
                errors.append(f"{name}: produced no audio")
                continue
            self.last_engine_used = name
            if index > 0:
                self.last_fallback_reason = "; ".join(errors)
            return audio

        raise TtsError("No speech engine could produce audio.\n  "
                       + "\n  ".join(errors) if errors else
                       "No speech engine is available.")

    def warm_up(self, voice_key: str = "") -> None:
        name, _ = self.split_key(voice_key or "")
        engine = self._engines.get(name)
        if engine is None:
            return
        try:
            if isinstance(engine, PiperEngine) and voice_key:
                engine.voice_key = voice_key
            if engine.is_available():
                engine.warm_up()
        except Exception:
            pass

    def close(self) -> None:
        for engine in self._engines.values():
            try:
                engine.close()
            except Exception:
                pass

    # -- diagnostics -----------------------------------------------------

    def status_lines(self, language: Optional[str] = None) -> List[str]:
        lines: List[str] = []
        piper_installed = voice_catalogue.installed_voices(language)
        if not PiperEngine.onnxruntime_available():
            lines.append("Piper: onnxruntime not installed "
                         "(pip install onnxruntime)")
        elif piper_installed:
            lines.append(f"Piper: ready ({', '.join(piper_installed)})")
        else:
            lines.append("Piper: no voice model downloaded yet")
        lines.append("Edge (online): "
                     + ("ready" if EdgeTtsEngine.is_installed()
                        else "not installed (pip install edge-tts)"))
        sapi = SapiEngine()
        if not SapiEngine.is_installed():
            lines.append("Windows SAPI: unavailable on this system")
        else:
            wanted = language or "russian"
            matching = [v for v in sapi.list_voices(wanted)
                        if v.language != "unknown"]
            lines.append("Windows SAPI: "
                         + (f"{len(matching)} {wanted.title()} voice(s)"
                            if matching else
                            f"installed, but no {wanted.title()} voice found"))
        return lines


def _first_key(engine: TtsEngine, language: str) -> Optional[str]:
    try:
        for voice in engine.list_voices(language):
            if voice.installed:
                return voice.key
    except Exception:
        pass
    return None
