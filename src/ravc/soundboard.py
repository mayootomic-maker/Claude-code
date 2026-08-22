"""A soundboard: clips fired by hotkey into the voice channel.

This is the feature every voice changer has and this one did not. The point
is not playback -- anything can play a wav -- it is that the clip has to
arrive *on the microphone*, mixed into the same stream the accent is going
out on, so the other players hear it and you do not have to alt-tab.

Three things make it behave rather than merely work:

*Decoding happens once, off the audio thread.* A clip is read, resampled to
the stream rate and cached the first time it is used. Reading a file inside
the audio callback is how a voice changer produces a click in the middle of
a round.

*The microphone ducks while a clip plays.* Otherwise you are talking over
your own soundboard, and both come out unintelligible. This is the same
sidechain every broadcast desk does, with a short attack and a slower
release so it does not pump.

*Firing a clip that is already playing restarts it.* Holding a key would
otherwise stack the same sample on top of itself and clip the output.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from . import diagnostics

MAX_CLIP_SECONDS = 30.0     # a soundboard clip, not a backing track
DUCK_ATTACK_MS = 12.0
DUCK_RELEASE_MS = 180.0


@dataclass
class SoundClip:
    """One entry on the board."""

    name: str = ""
    path: str = ""
    hotkey: str = ""            # e.g. "ctrl+alt+1"; empty means click-only
    gain_db: float = 0.0

    @property
    def exists(self) -> bool:
        return bool(self.path) and Path(self.path).is_file()


@dataclass
class SoundboardSettings:
    enabled: bool = True
    output_db: float = -3.0
    # How far the microphone drops while a clip plays. 0 disables ducking.
    duck_db: float = -14.0
    clips: List[SoundClip] = field(default_factory=list)


class _Voice:
    """One clip currently sounding."""

    __slots__ = ("samples", "position", "gain")

    def __init__(self, samples: np.ndarray, gain: float) -> None:
        self.samples = samples
        self.position = 0
        self.gain = gain


class Soundboard:
    """Mixes triggered clips into the outgoing stream.

    `trigger` is called from the hotkey thread and the UI thread; `read`
    from the audio loop. Everything shared is behind one lock, and `read`
    never touches the filesystem.
    """

    def __init__(self, sample_rate: int,
                 settings: Optional[SoundboardSettings] = None) -> None:
        self.sample_rate = sample_rate
        self.settings = settings or SoundboardSettings()
        self._cache: Dict[str, np.ndarray] = {}
        self._voices: List[_Voice] = []
        self._lock = threading.Lock()
        self._duck = 1.0

    # -- loading ----------------------------------------------------------

    def load(self, path: str) -> Optional[np.ndarray]:
        """Decode and resample a clip, caching the result.

        Returns None if the file cannot be read, having logged why: a
        missing clip should grey out a button, not stop the voice changer.
        """
        if path in self._cache:
            return self._cache[path]
        try:
            import soundfile as sf
            data, rate = sf.read(path, dtype="float32", always_2d=True)
            mono = data.mean(axis=1)
            if rate != self.sample_rate:
                from .dsp.pitch import resample_to
                mono = resample_to(mono, rate, self.sample_rate)
            limit = int(MAX_CLIP_SECONDS * self.sample_rate)
            mono = np.asarray(mono[:limit], dtype=np.float32)
        except Exception as exc:  # noqa: BLE001
            # An unreadable clip is a thing users do, not a fault: it greys
            # the button out. Logging it as a crash would put an ERROR in
            # the file the packaged build checks for real ones.
            diagnostics.write(f"Soundboard clip {path!r} could not be read: "
                              f"{exc}", level="WARN")
            self._cache[path] = np.zeros(0, dtype=np.float32)
            return None
        self._cache[path] = mono
        return mono

    def preload(self) -> None:
        """Decode every clip up front, so the first press is not the slow one."""
        for clip in self.settings.clips:
            if clip.exists:
                self.load(clip.path)

    def forget(self, path: str) -> None:
        self._cache.pop(path, None)

    # -- playing ----------------------------------------------------------

    def trigger(self, index: int) -> bool:
        """Start clip ``index``. Returns whether anything will be heard."""
        clips = self.settings.clips
        if not self.settings.enabled or not 0 <= index < len(clips):
            return False
        clip = clips[index]
        samples = self.load(clip.path) if clip.exists else None
        if samples is None or samples.size == 0:
            return False
        gain = 10.0 ** (clip.gain_db / 20.0)
        with self._lock:
            # Retrigger rather than stack: a held key would otherwise pile
            # the same clip onto itself and clip the output.
            self._voices = [v for v in self._voices if v.samples is not samples]
            self._voices.append(_Voice(samples, gain))
        return True

    def stop_all(self) -> None:
        with self._lock:
            self._voices.clear()

    @property
    def playing(self) -> bool:
        with self._lock:
            return bool(self._voices)

    def read(self, count: int) -> np.ndarray:
        """The next ``count`` samples of the mix. Never blocks, never reads
        from disk."""
        out = np.zeros(count, dtype=np.float32)
        if count <= 0:
            return out
        with self._lock:
            if not self._voices:
                return out
            still: List[_Voice] = []
            for voice in self._voices:
                chunk = voice.samples[voice.position:voice.position + count]
                if chunk.size:
                    out[:chunk.size] += chunk * voice.gain
                voice.position += count
                if voice.position < voice.samples.size:
                    still.append(voice)
            self._voices = still
        return out * (10.0 ** (self.settings.output_db / 20.0))

    def mix(self, block: np.ndarray) -> np.ndarray:
        """Duck ``block`` under any playing clip and add the clip to it."""
        arr = np.asarray(block, dtype=np.float32).reshape(-1)
        if not self.settings.enabled:
            return arr
        clip = self.read(arr.size)
        target = (10.0 ** (self.settings.duck_db / 20.0)
                  if self._duck_wanted() else 1.0)
        envelope = self._duck_envelope(arr.size, target)
        return (arr * envelope + clip).astype(np.float32)

    def _duck_wanted(self) -> bool:
        if self.settings.duck_db >= 0.0:
            return False
        with self._lock:
            return bool(self._voices)

    def _duck_envelope(self, count: int, target: float) -> np.ndarray:
        """Ramp towards ``target``, fast down and slow back up.

        A hard switch would click, and a symmetric one would pump: coming
        out of the duck slowly is what makes it sound like a broadcast desk
        rather than a gate.
        """
        milliseconds = (DUCK_ATTACK_MS if target < self._duck
                        else DUCK_RELEASE_MS)
        step = 1.0 / max(1.0, milliseconds * self.sample_rate / 1000.0)
        if target < self._duck:
            values = np.clip(self._duck - step * np.arange(1, count + 1),
                             target, 1.0)
        else:
            values = np.clip(self._duck + step * np.arange(1, count + 1),
                             0.0, target)
        self._duck = float(values[-1])
        return values.astype(np.float32)
