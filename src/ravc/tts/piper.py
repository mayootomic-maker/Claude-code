"""Offline neural TTS using Piper (VITS) voices, driven by phonemes directly.

Piper normally phonemises text with espeak-ng.  We do not want that: we
have already worked out the exact Russian phonemes we want, down to which
consonants are palatalised, and running our Cyrillic through espeak would
throw that detail away and re-derive a worse version of it.

So this backend skips espeak entirely and feeds the model's phoneme table
straight from :func:`ravc.accent.render.to_ipa`.  Two useful consequences:

* the install has no native espeak dependency -- just onnxruntime;
* stress, palatalisation and vowel quality are exactly what the accent
  engine decided, not what a text front-end guessed.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

from . import voices as voice_catalogue
from .base import Audio, SynthRequest, TtsEngine, TtsError, Voice

_BOS = "^"
_EOS = "$"
_PAD = "_"


class PiperEngine(TtsEngine):
    """Runs a Piper ``.onnx`` voice through onnxruntime."""

    name = "piper"

    def __init__(self, voice_key: str = voice_catalogue.DEFAULT_VOICE,
                 num_threads: int = 0) -> None:
        self.voice_key = voice_key
        self._num_threads = num_threads
        self._lock = threading.Lock()
        self._session = None
        self._config: Optional[dict] = None
        self._id_map: Dict[str, List[int]] = {}
        self._loaded_key: Optional[str] = None
        self._input_names: List[str] = []

    # -- availability ----------------------------------------------------

    @staticmethod
    def onnxruntime_available() -> bool:
        try:
            import onnxruntime  # noqa: F401
        except Exception:
            return False
        return True

    def is_available(self) -> bool:
        return (self.onnxruntime_available()
                and bool(voice_catalogue.installed_voices()))

    def list_voices(self) -> List[Voice]:
        out: List[Voice] = []
        for key, model in voice_catalogue.CATALOGUE.items():
            out.append(Voice(
                key=f"piper:{key}",
                name=model.display,
                engine="piper",
                gender=model.gender,
                description=model.description,
                offline=True,
                installed=voice_catalogue.is_installed(key),
            ))
        return out

    # -- model loading ---------------------------------------------------

    def _ensure_loaded(self, key: str) -> None:
        if self._loaded_key == key and self._session is not None:
            return
        import onnxruntime as ort

        onnx_path, cfg_path = voice_catalogue.model_paths(key)
        if not onnx_path.is_file() or not cfg_path.is_file():
            raise TtsError(
                f"Voice '{key}' is not downloaded yet. "
                f"Use the Voices tab (or `ravc voices --install {key}`).")

        with open(cfg_path, "r", encoding="utf-8") as fh:
            config = json.load(fh)

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if self._num_threads > 0:
            opts.intra_op_num_threads = self._num_threads
        opts.log_severity_level = 3

        session = ort.InferenceSession(
            str(onnx_path), sess_options=opts,
            providers=["CPUExecutionProvider"])

        self._session = session
        self._config = config
        self._id_map = {k: list(v) for k, v in config["phoneme_id_map"].items()}
        self._input_names = [i.name for i in session.get_inputs()]
        self._loaded_key = key

    def warm_up(self) -> None:
        key = _strip_prefix(self.voice_key)
        if not voice_catalogue.is_installed(key):
            return
        with self._lock:
            self._ensure_loaded(key)
            try:
                self._infer([self._id_map[_BOS][0], self._id_map[_EOS][0]], 1.0)
            except Exception:  # pragma: no cover - warm-up must never fail loudly
                pass

    def close(self) -> None:
        with self._lock:
            self._session = None
            self._loaded_key = None

    # -- phoneme resolution ----------------------------------------------

    def resolve_symbol(self, candidates: Sequence[str]) -> Optional[str]:
        """Pick the first candidate whose characters the voice actually has.

        Piper's tables are per-character, so a candidate like ``"tɕ"`` is
        usable exactly when both ``t`` and ``ɕ`` are in the table.  This is
        what lets one renderer target voices that spell /ʃ/ as ``ʂ`` and
        voices that spell it ``ʃ``.
        """
        for cand in candidates:
            if cand and all(ch in self._id_map for ch in cand):
                return cand
        return None

    def phoneme_ids(self, ipa: Sequence[Sequence[str]]) -> List[int]:
        if _BOS not in self._id_map or _EOS not in self._id_map:
            raise TtsError("voice model has no BOS/EOS symbols")
        ids: List[int] = list(self._id_map[_BOS])
        pad = self._id_map.get(_PAD, [])
        for candidates in ipa:
            resolved = self.resolve_symbol(candidates)
            if resolved is None:
                continue
            for ch in resolved:
                ids.extend(self._id_map[ch])
                ids.extend(pad)
        ids.extend(self._id_map[_EOS])
        return ids

    # -- synthesis -------------------------------------------------------

    def synthesize(self, request: SynthRequest) -> Audio:
        key = _strip_prefix(request.voice_key or self.voice_key)
        if key not in voice_catalogue.CATALOGUE:
            key = voice_catalogue.DEFAULT_VOICE

        with self._lock:
            self._ensure_loaded(key)
            sample_rate = int(self._config["audio"]["sample_rate"])
            ids = self.phoneme_ids(request.ipa)
            if len(ids) <= 2:
                return Audio(np.zeros(0, dtype=np.float32), sample_rate)
            rate = max(0.35, min(3.0, request.rate or 1.0))
            samples = self._infer(ids, rate)

        if request.volume != 1.0:
            samples = samples * float(request.volume)
        return Audio(samples, sample_rate)

    def _infer(self, ids: List[int], rate: float) -> np.ndarray:
        assert self._session is not None and self._config is not None
        inference = self._config.get("inference", {})
        noise_scale = float(inference.get("noise_scale", 0.667))
        length_scale = float(inference.get("length_scale", 1.0)) / rate
        noise_w = float(inference.get("noise_w", 0.8))

        text = np.asarray([ids], dtype=np.int64)
        feeds = {
            "input": text,
            "input_lengths": np.asarray([text.shape[1]], dtype=np.int64),
            "scales": np.asarray([noise_scale, length_scale, noise_w],
                                 dtype=np.float32),
        }
        if "sid" in self._input_names:
            speaker = 0
            speaker_map = self._config.get("speaker_id_map") or {}
            if speaker_map:
                speaker = int(next(iter(speaker_map.values())))
            feeds["sid"] = np.asarray([speaker], dtype=np.int64)

        feeds = {k: v for k, v in feeds.items() if k in self._input_names}
        out = self._session.run(None, feeds)[0]
        audio = np.asarray(out, dtype=np.float32).reshape(-1)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 1.0:
            audio = audio / peak
        return audio


def _strip_prefix(key: Optional[str]) -> str:
    if not key:
        return voice_catalogue.DEFAULT_VOICE
    return key.split(":", 1)[1] if key.startswith("piper:") else key
