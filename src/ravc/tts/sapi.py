"""Windows SAPI5 fallback.

Last resort: it only sounds properly accented if a voice in the target
language is installed (for example "Microsoft Irina" for Russian or
"Microsoft Hedda" for German), which needs that Windows language pack.  It
exists so the app can still speak on a machine with no Piper model
downloaded and no internet.
"""

from __future__ import annotations

import os
import tempfile
import threading
from typing import List, Optional

import numpy as np

from .._optional import have
from .base import Audio, SynthRequest, TtsEngine, TtsError, Voice

_LANGUAGE_HINTS = {
    "russian": ("russian", "русск", "irina", "pavel", "ru-ru"),
    "german": ("german", "deutsch", "hedda", "katja", "stefan", "de-de"),
}
_LOCALES = {"russian": "ru-RU", "german": "de-DE"}


class SapiEngine(TtsEngine):
    name = "sapi"

    def __init__(self, voice_key: str = "") -> None:
        self.voice_key = voice_key
        self._lock = threading.Lock()

    @staticmethod
    def is_installed() -> bool:
        return os.name == "nt" and have("win32com.client")

    def is_available(self) -> bool:
        return self.is_installed() and bool(self.list_voices())

    def _voice_tokens(self):
        import win32com.client

        speaker = win32com.client.Dispatch("SAPI.SpVoice")
        return speaker, speaker.GetVoices()

    def list_voices(self, language: Optional[str] = None) -> List[Voice]:
        if not self.is_installed():
            return []
        try:
            _speaker, tokens = self._voice_tokens()
        except Exception:
            return []
        wanted = language or "russian"
        locale = _LOCALES.get(wanted, "ru-RU")
        out: List[Voice] = []
        for i in range(tokens.Count):
            token = tokens.Item(i)
            try:
                name = token.GetDescription()
            except Exception:
                continue
            low = name.lower()
            matches = any(hint in low
                          for hint in _LANGUAGE_HINTS.get(wanted, ()))
            out.append(Voice(
                key=f"sapi:{name}",
                name=name,
                engine="sapi",
                language=locale if matches else "unknown",
                accent=wanted,
                description=(f"System voice — {wanted.title()}" if matches else
                             f"System voice — not {wanted.title()}, "
                             "the accent will be weak"),
                offline=True,
                installed=True,
            ))
        # Matching-language voices first: they are the only ones that sound
        # right, because the accent is carried by the voice's native phonetics.
        out.sort(key=lambda v: v.language != locale)
        return out

    def synthesize(self, request: SynthRequest) -> Audio:
        if not self.is_installed():
            raise TtsError("SAPI5 is only available on Windows with pywin32")
        text = (request.text or request.plain_text or "").strip()
        if not text:
            return Audio(np.zeros(0, dtype=np.float32), 22050)

        import win32com.client

        wanted = _strip_prefix(request.voice_key or self.voice_key)
        path = os.path.join(tempfile.gettempdir(),
                            f"ravc_sapi_{threading.get_ident()}.wav")
        with self._lock:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            if wanted:
                tokens = speaker.GetVoices()
                for i in range(tokens.Count):
                    token = tokens.Item(i)
                    try:
                        if token.GetDescription() == wanted:
                            speaker.Voice = token
                            break
                    except Exception:
                        continue
            speaker.Rate = int(max(-10, min(10, round((request.rate - 1.0) * 10))))
            stream = win32com.client.Dispatch("SAPI.SpFileStream")
            stream.Open(path, 3)   # SSFMCreateForWrite
            speaker.AudioOutputStream = stream
            try:
                speaker.Speak(text)
            finally:
                stream.Close()
                speaker.AudioOutputStream = None

        try:
            samples, sample_rate = _read_wav(path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        if request.volume != 1.0:
            samples = samples * float(request.volume)
        return Audio(samples, sample_rate)


def _read_wav(path: str):
    import wave

    with wave.open(path, "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    dtype = {1: np.uint8, 2: np.int16, 4: np.int32}.get(width, np.int16)
    data = np.frombuffer(raw, dtype=dtype).astype(np.float32)
    if dtype is np.uint8:
        data = (data - 128.0) / 128.0
    else:
        data = data / float(np.iinfo(dtype).max)
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data.astype(np.float32), int(rate)


def _strip_prefix(key: Optional[str]) -> str:
    if not key:
        return ""
    return key.split(":", 1)[1] if key.startswith("sapi:") else key
