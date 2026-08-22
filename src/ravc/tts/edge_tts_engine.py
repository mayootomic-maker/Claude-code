"""Microsoft Edge neural voices (online).

Optional, but the best-sounding option when there is a network connection:
these are the same neural voices Edge's Read Aloud uses.  They read the
Cyrillic transcription produced by the accent engine, which is what gives
the authentic Russian delivery.
"""

from __future__ import annotations

import asyncio
import io
import threading
from typing import List, Optional

import numpy as np

from .._optional import have
from .base import Audio, SynthRequest, TtsEngine, TtsError, Voice

EDGE_VOICES = [
    ("ru-RU-DmitryNeural", "Dmitry", "male", "russian",
     "Warm male neural voice"),
    ("ru-RU-SvetlanaNeural", "Svetlana", "female", "russian",
     "Clear female neural voice"),
    ("ru-RU-DariyaNeural", "Dariya", "female", "russian",
     "Brighter female neural voice"),
    ("de-DE-ConradNeural", "Conrad", "male", "german",
     "Deep male neural voice"),
    ("de-DE-KillianNeural", "Killian", "male", "german",
     "Lighter male neural voice"),
    ("de-DE-KatjaNeural", "Katja", "female", "german",
     "Clear female neural voice"),
    ("de-DE-AmalaNeural", "Amala", "female", "german",
     "Warmer female neural voice"),
]

DEFAULT_EDGE_VOICES = {
    "russian": "ru-RU-DmitryNeural",
    "german": "de-DE-ConradNeural",
}
DEFAULT_EDGE_VOICE = DEFAULT_EDGE_VOICES["russian"]


class EdgeTtsEngine(TtsEngine):
    name = "edge"

    def __init__(self, voice_key: str = DEFAULT_EDGE_VOICE) -> None:
        self.voice_key = voice_key
        self._lock = threading.Lock()

    @staticmethod
    def is_installed() -> bool:
        return have("edge_tts")

    def is_available(self) -> bool:
        return self.is_installed()

    def list_voices(self, language: Optional[str] = None) -> List[Voice]:
        return [Voice(key=f"edge:{key}", name=name, engine="edge",
                      gender=gender, language=key.rsplit("-", 1)[0],
                      accent=accent, description=desc, offline=False,
                      installed=self.is_installed())
                for key, name, gender, accent, desc in EDGE_VOICES
                if not language or accent == language]

    def synthesize(self, request: SynthRequest) -> Audio:
        if not self.is_installed():
            raise TtsError("edge-tts is not installed (pip install edge-tts)")
        text = (request.text or "").strip()
        if not text:
            return Audio(np.zeros(0, dtype=np.float32), 24000)

        voice = _strip_prefix(request.voice_key or self.voice_key)
        rate_pct = int(round((request.rate - 1.0) * 100))
        rate = f"{rate_pct:+d}%"
        pitch_hz = int(round(request.pitch * 8))
        pitch = f"{pitch_hz:+d}Hz"

        with self._lock:
            payload = _run_async(_fetch(text, voice, rate, pitch))
        if not payload:
            raise TtsError("edge-tts returned no audio (check your connection)")
        samples, sample_rate = _decode(payload)
        if request.volume != 1.0:
            samples = samples * float(request.volume)
        return Audio(samples, sample_rate)


async def _fetch(text: str, voice: str, rate: str, pitch: str) -> bytes:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    chunks: List[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    return b"".join(chunks)


def _run_async(coro):
    """Run a coroutine even if the caller already has a running loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            result["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "error" in result:
        raise result["error"]
    return result.get("value")


def _decode(payload: bytes):
    """MP3 bytes -> mono float32.

    Tries libsndfile first (it gained MP3 support in 1.1.0), then PyAV, which
    is already present as a faster-whisper dependency.
    """
    try:
        import soundfile as sf

        data, sample_rate = sf.read(io.BytesIO(payload), dtype="float32",
                                    always_2d=True)
        return data.mean(axis=1).astype(np.float32), int(sample_rate)
    except Exception:
        pass

    try:
        import av

        with av.open(io.BytesIO(payload)) as container:
            stream = container.streams.audio[0]
            sample_rate = int(stream.codec_context.sample_rate or 24000)
            frames = [f.to_ndarray().astype(np.float32)
                      for f in container.decode(audio=0)]
        if not frames:
            raise TtsError("could not decode edge-tts audio")
        joined = np.concatenate([f.reshape(f.shape[0], -1) for f in frames],
                                axis=1)
        mono = joined.mean(axis=0)
        peak = float(np.max(np.abs(mono))) if mono.size else 0.0
        if peak > 1.5:  # integer PCM came through un-normalised
            mono = mono / 32768.0
        return mono.astype(np.float32), sample_rate
    except TtsError:
        raise
    except Exception as exc:
        raise TtsError(
            "Could not decode the audio returned by edge-tts. Install a "
            "recent 'soundfile' (pip install -U soundfile) or use an offline "
            "Piper voice instead."
        ) from exc


def _strip_prefix(key: Optional[str]) -> str:
    if not key:
        return DEFAULT_EDGE_VOICE
    return key.split(":", 1)[1] if key.startswith("edge:") else key
