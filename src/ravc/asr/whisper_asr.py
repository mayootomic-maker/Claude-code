"""Offline speech recognition with faster-whisper (CTranslate2).

Recognition runs in English and is deliberately conservative: the accent
engine will happily give an accent to a hallucinated sentence, so it
is much better to return nothing than to return something invented.  The
guards below (no cross-utterance conditioning, a compression-ratio and
log-probability floor, and a hallucination blocklist) exist for that.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from .._optional import have

ASR_RATE = 16000

MODEL_SIZES: Tuple[Tuple[str, str, str], ...] = (
    ("tiny.en", "Tiny", "~75 MB, fastest, least accurate"),
    ("base.en", "Base", "~145 MB, good balance (recommended)"),
    ("small.en", "Small", "~480 MB, noticeably more accurate"),
    ("medium.en", "Medium", "~1.5 GB, best accuracy, needs a strong CPU"),
    ("large-v3", "Large v3", "~3 GB, multilingual, GPU strongly advised"),
)

DEFAULT_MODEL = "base.en"

# Whisper's well-known filler outputs on silence or noise.
_HALLUCINATIONS = {
    "thank you.", "thanks for watching.", "thank you for watching.",
    "thanks for watching!", "you", "bye.", "bye bye.", ".", "...",
    "please subscribe.", "subtitles by the amara.org community",
    "thank you very much.", "thank you very much for watching.",
    "subs by www.zeoranger.co.uk", "www.mooji.org", "[music]", "[applause]",
    "(upbeat music)", "♪", "so.",
}


@dataclass
class AsrConfig:
    model_size: str = DEFAULT_MODEL
    device: str = "auto"          # "auto" | "cpu" | "cuda"
    compute_type: str = "auto"    # "auto" | "int8" | "float16" | "float32"
    beam_size: int = 1            # 1 = greedy: much faster, barely worse here
    language: str = "en"
    initial_prompt: Optional[str] = None
    min_logprob: float = -1.0
    max_compression_ratio: float = 2.4
    cpu_threads: int = 0


@dataclass
class Transcript:
    text: str = ""
    confidence: float = 0.0
    duration: float = 0.0
    rejected_reason: str = ""
    segments: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return bool(self.text.strip())


class WhisperAsr:
    """Thin, thread-safe wrapper around faster-whisper."""

    def __init__(self, config: Optional[AsrConfig] = None) -> None:
        self.config = config or AsrConfig()
        self._model = None
        self._lock = threading.Lock()
        self._loaded_size: Optional[str] = None

    # -- availability ----------------------------------------------------

    @staticmethod
    def is_installed() -> bool:
        return have("faster_whisper")

    @staticmethod
    def cuda_available() -> bool:
        try:
            import ctranslate2
            return ctranslate2.get_cuda_device_count() > 0
        except Exception:
            return False

    def _resolve_device(self) -> Tuple[str, str]:
        device = self.config.device
        if device == "auto":
            device = "cuda" if self.cuda_available() else "cpu"
        compute = self.config.compute_type
        if compute == "auto":
            compute = "float16" if device == "cuda" else "int8"
        return device, compute

    # -- lifecycle -------------------------------------------------------

    def load(self, progress=None) -> None:
        """Load (downloading on first use) the model."""
        if not self.is_installed():
            raise RuntimeError(
                "faster-whisper is not installed. Install it with "
                "`pip install faster-whisper`, or use Type-to-Speak mode, "
                "which does not need speech recognition.")
        with self._lock:
            if self._model is not None and self._loaded_size == self.config.model_size:
                return
            from faster_whisper import WhisperModel

            device, compute = self._resolve_device()
            if progress:
                progress(f"Loading speech model '{self.config.model_size}' "
                         f"on {device} ({compute})…")
            kwargs = dict(device=device, compute_type=compute)
            if self.config.cpu_threads > 0:
                kwargs["cpu_threads"] = self.config.cpu_threads
            self._model = WhisperModel(self.config.model_size, **kwargs)
            self._loaded_size = self.config.model_size
            if progress:
                progress("Speech model ready.")

    def close(self) -> None:
        with self._lock:
            self._model = None
            self._loaded_size = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def warm_up(self) -> None:
        """Run one tiny inference so the first real utterance is not slow."""
        self.load()
        silence = np.zeros(ASR_RATE // 2, dtype=np.float32)
        try:
            self.transcribe(silence)
        except Exception:
            pass

    # -- recognition -----------------------------------------------------

    def transcribe(self, samples: np.ndarray,
                   sample_rate: int = ASR_RATE) -> Transcript:
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            return Transcript(rejected_reason="empty")
        if sample_rate != ASR_RATE:
            ratio = ASR_RATE / float(sample_rate)
            out_len = max(1, int(round(audio.size * ratio)))
            audio = np.interp(np.linspace(0.0, audio.size - 1.0, out_len),
                              np.arange(audio.size), audio).astype(np.float32)

        duration = audio.size / float(ASR_RATE)
        self.load()
        cfg = self.config
        with self._lock:
            model = self._model
            if model is None:
                return Transcript(rejected_reason="model not loaded")
            segments, _info = model.transcribe(
                audio,
                language=cfg.language,
                beam_size=max(1, cfg.beam_size),
                # Never condition on the previous utterance: it is the main
                # source of Whisper repeating itself forever.
                condition_on_previous_text=False,
                temperature=0.0,
                no_speech_threshold=0.6,
                compression_ratio_threshold=cfg.max_compression_ratio,
                log_prob_threshold=cfg.min_logprob,
                initial_prompt=cfg.initial_prompt,
                word_timestamps=False,
            )
            collected: List[str] = []
            logprobs: List[float] = []
            for segment in segments:
                text = (segment.text or "").strip()
                if not text:
                    continue
                collected.append(text)
                logprobs.append(float(getattr(segment, "avg_logprob", 0.0)))

        text = " ".join(collected).strip()
        confidence = float(np.exp(np.mean(logprobs))) if logprobs else 0.0

        rejected = _rejection_reason(text, duration)
        if rejected:
            return Transcript(text="", confidence=confidence, duration=duration,
                              rejected_reason=rejected, segments=collected)
        return Transcript(text=text, confidence=confidence, duration=duration,
                          segments=collected)


def _rejection_reason(text: str, duration: float) -> str:
    stripped = text.strip()
    if not stripped:
        return "no speech"
    low = stripped.lower()
    if low in _HALLUCINATIONS:
        return "filler"
    letters = sum(1 for ch in stripped if ch.isalpha())
    if letters == 0:
        return "no letters"
    # A very long transcript from a very short clip is a repetition loop.
    if duration > 0 and len(stripped) / duration > 45:
        return "implausible rate"
    words = low.split()
    if len(words) >= 6 and len(set(words)) <= 2:
        return "repetition loop"
    return ""


def available_models() -> List[Tuple[str, str, str]]:
    return list(MODEL_SIZES)
