"""Catalogue and downloader for offline Piper voice models."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .._optional import have

_HF_BASE = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
            "{lang}/{locale}/{speaker}/{quality}/"
            "{locale}-{speaker}-{quality}")


@dataclass(frozen=True)
class VoiceModel:
    key: str
    speaker: str
    quality: str
    display: str
    gender: str
    description: str
    approx_mb: int
    language: str = "russian"
    locale: str = "ru_RU"

    @property
    def lang_dir(self) -> str:
        return self.locale.split("_", 1)[0]

    @property
    def base_url(self) -> str:
        return _HF_BASE.format(lang=self.lang_dir, locale=self.locale,
                               speaker=self.speaker, quality=self.quality)

    @property
    def onnx_url(self) -> str:
        return self.base_url + ".onnx"

    @property
    def config_url(self) -> str:
        return self.base_url + ".onnx.json"

    @property
    def filename(self) -> str:
        return f"{self.locale}-{self.speaker}-{self.quality}.onnx"


CATALOGUE: Dict[str, VoiceModel] = {
    m.key: m for m in [
        # -- Russian ----------------------------------------------------
        VoiceModel("ru_RU-dmitri-medium", "dmitri", "medium", "Dmitri", "male",
                   "Deep, calm male voice. The default villain.", 61,
                   "russian", "ru_RU"),
        VoiceModel("ru_RU-ruslan-medium", "ruslan", "medium", "Ruslan", "male",
                   "Brighter, faster male voice.", 61, "russian", "ru_RU"),
        VoiceModel("ru_RU-denis-medium", "denis", "medium", "Denis", "male",
                   "Younger male voice.", 61, "russian", "ru_RU"),
        VoiceModel("ru_RU-irina-medium", "irina", "medium", "Irina", "female",
                   "Clear female voice.", 61, "russian", "ru_RU"),
        # -- German -----------------------------------------------------
        VoiceModel("de_DE-thorsten-medium", "thorsten", "medium", "Thorsten",
                   "male", "Deep, precise male voice. The default.", 61,
                   "german", "de_DE"),
        VoiceModel("de_DE-karlsson-low", "karlsson", "low", "Karlsson", "male",
                   "Gruff male voice, smaller and faster model.", 28,
                   "german", "de_DE"),
        VoiceModel("de_DE-pavoque-low", "pavoque", "low", "Pavoque", "male",
                   "Lighter male voice.", 28, "german", "de_DE"),
        VoiceModel("de_DE-eva_k-x_low", "eva_k", "x_low", "Eva", "female",
                   "Female voice, smallest and fastest model.", 21,
                   "german", "de_DE"),
        VoiceModel("de_DE-kerstin-low", "kerstin", "low", "Kerstin", "female",
                   "Clear female voice.", 28, "german", "de_DE"),
        VoiceModel("de_DE-ramona-low", "ramona", "low", "Ramona", "female",
                   "Warmer female voice.", 28, "german", "de_DE"),
    ]
}

DEFAULT_VOICES: Dict[str, str] = {
    "russian": "ru_RU-dmitri-medium",
    "german": "de_DE-thorsten-medium",
}

DEFAULT_VOICE = DEFAULT_VOICES["russian"]


def default_voice(language: str) -> str:
    return DEFAULT_VOICES.get(language, DEFAULT_VOICE)


def for_language(language: str) -> Dict[str, VoiceModel]:
    return {k: m for k, m in CATALOGUE.items() if m.language == language}


def models_dir() -> Path:
    """Where voice models live.  Overridable for portable installs."""
    override = os.environ.get("RAVC_MODELS_DIR")
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA",
                                   Path.home() / "AppData" / "Local"))
    elif os.uname().sysname == "Darwin":  # pragma: no cover - mac
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "RussianAccentVoiceChanger" / "voices"


def model_paths(key: str) -> tuple:
    model = CATALOGUE[key]
    root = models_dir()
    onnx = root / model.filename
    return onnx, onnx.with_suffix(".onnx.json")


def is_installed(key: str) -> bool:
    if key not in CATALOGUE:
        return False
    onnx, cfg = model_paths(key)
    try:
        return onnx.is_file() and cfg.is_file() and onnx.stat().st_size > 1_000_000
    except OSError:
        return False


def installed_voices(language: Optional[str] = None) -> List[str]:
    return [k for k, m in CATALOGUE.items()
            if (language is None or m.language == language) and is_installed(k)]


ProgressFn = Callable[[str, float], None]


def download_voice(key: str, progress: Optional[ProgressFn] = None,
                   timeout: int = 120) -> Path:
    """Fetch a voice model into :func:`models_dir`.

    Downloads to a temporary file and moves it into place, so an interrupted
    download can never leave a half-written model that fails at synthesis
    time with a confusing ONNX error.
    """
    if key not in CATALOGUE:
        raise KeyError(f"unknown voice model: {key}")
    model = CATALOGUE[key]
    root = models_dir()
    root.mkdir(parents=True, exist_ok=True)
    onnx_path, cfg_path = model_paths(key)

    def report(stage: str, frac: float) -> None:
        if progress:
            progress(stage, max(0.0, min(1.0, frac)))

    if not cfg_path.is_file():
        report(f"Fetching {model.display} config", 0.0)
        _download(model.config_url, cfg_path, timeout, None)
    if not onnx_path.is_file() or onnx_path.stat().st_size < 1_000_000:
        report(f"Downloading {model.display} ({model.approx_mb} MB)", 0.02)
        _download(model.onnx_url, onnx_path, timeout,
                  lambda f: report(f"Downloading {model.display}", 0.02 + 0.98 * f))
    report(f"{model.display} ready", 1.0)
    return onnx_path


def _download(url: str, dest: Path, timeout: int,
              progress: Optional[Callable[[float], None]]) -> None:
    if not have("requests"):
        _download_urllib(url, dest, timeout, progress)
        return

    import requests

    with requests.get(url, stream=True, timeout=timeout) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        fd, tmp = tempfile.mkstemp(dir=str(dest.parent), suffix=".part")
        try:
            with os.fdopen(fd, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=1 << 18):
                    if not chunk:
                        continue
                    fh.write(chunk)
                    done += len(chunk)
                    if progress and total:
                        progress(done / total)
            shutil.move(tmp, dest)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def _download_urllib(url: str, dest: Path, timeout: int,
                     progress: Optional[Callable[[float], None]]) -> None:
    from urllib.request import Request, urlopen

    req = Request(url, headers={"User-Agent": "ravc/1.0"})
    fd, tmp = tempfile.mkstemp(dir=str(dest.parent), suffix=".part")
    try:
        with urlopen(req, timeout=timeout) as resp, os.fdopen(fd, "wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(1 << 18)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if progress and total:
                    progress(done / total)
        shutil.move(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def voice_config(key: str) -> dict:
    _, cfg_path = model_paths(key)
    with open(cfg_path, "r", encoding="utf-8") as fh:
        return json.load(fh)
