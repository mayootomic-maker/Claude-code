"""Audio output: the virtual cable other apps hear, plus optional monitoring."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from ..dsp.pitch import resample_to
from .devices import AudioUnavailable, _sd


@dataclass
class PlaybackConfig:
    device_index: Optional[int] = None
    sample_rate: int = 48000
    channels: int = 2
    block_size: int = 512
    volume: float = 1.0


class _RingBuffer:
    """Single-producer/single-consumer float ring buffer."""

    def __init__(self, capacity: int) -> None:
        self._data = np.zeros(capacity, dtype=np.float32)
        self._capacity = capacity
        self._read = 0
        self._write = 0
        self._available = 0
        self._lock = threading.Lock()

    @property
    def available(self) -> int:
        with self._lock:
            return self._available

    def clear(self) -> None:
        with self._lock:
            self._read = self._write = self._available = 0

    def write(self, samples: np.ndarray) -> int:
        arr = np.asarray(samples, dtype=np.float32).reshape(-1)
        with self._lock:
            # A single write larger than the whole buffer: keep its tail and
            # start clean, otherwise the modular arithmetic below would leave
            # the oldest samples in place and desynchronise `available`.
            if arr.size >= self._capacity:
                arr = arr[-self._capacity:]
                self._read = self._write = self._available = 0
            free = self._capacity - self._available
            if arr.size > free:
                # Drop the oldest audio rather than the newest: a listener
                # would rather lose the start of a stale utterance than have
                # the current one truncated.
                overflow = arr.size - free
                self._read = (self._read + overflow) % self._capacity
                self._available -= overflow
            n = arr.size
            first = min(n, self._capacity - self._write)
            self._data[self._write:self._write + first] = arr[:first]
            rest = n - first
            if rest:
                self._data[:rest] = arr[first:first + rest]
            self._write = (self._write + n) % self._capacity
            self._available += n
            return n

    def read(self, count: int) -> np.ndarray:
        out = np.zeros(count, dtype=np.float32)
        with self._lock:
            n = min(count, self._available)
            if n:
                first = min(n, self._capacity - self._read)
                out[:first] = self._data[self._read:self._read + first]
                rest = n - first
                if rest:
                    out[first:first + rest] = self._data[:rest]
                self._read = (self._read + n) % self._capacity
                self._available -= n
        return out


class AudioPlayer:
    """Streams queued audio to one output device."""

    def __init__(self, config: Optional[PlaybackConfig] = None,
                 buffer_seconds: float = 20.0) -> None:
        self.config = config or PlaybackConfig()
        self._ring = _RingBuffer(int(self.config.sample_rate * buffer_seconds))
        self._stream = None
        self._running = False
        self.underruns = 0

    def start(self) -> None:
        if self._running:
            return
        sd = _sd()
        cfg = self.config

        def callback(outdata, frames, time_info, status):  # noqa: ANN001
            mono = self._ring.read(frames)
            if self._ring.available == 0 and not np.any(mono):
                self.underruns += 1
            if cfg.volume != 1.0:
                mono = mono * cfg.volume
            if cfg.channels == 1:
                outdata[:, 0] = mono
            else:
                for ch in range(cfg.channels):
                    outdata[:, ch] = mono

        try:
            self._stream = sd.OutputStream(
                samplerate=cfg.sample_rate,
                blocksize=cfg.block_size,
                device=cfg.device_index,
                channels=cfg.channels,
                dtype="float32",
                callback=callback,
            )
            self._stream.start()
        except Exception as exc:
            self._stream = None
            raise AudioUnavailable(f"Could not open output device: {exc}") from exc
        self._running = True

    def stop(self) -> None:
        self._running = False
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass
        self._ring.clear()

    @property
    def running(self) -> bool:
        return self._running

    @property
    def queued_seconds(self) -> float:
        return self._ring.available / float(self.config.sample_rate)

    def play(self, samples: np.ndarray, sample_rate: int) -> None:
        """Queue mono audio, resampling to the device rate if needed."""
        arr = np.asarray(samples, dtype=np.float32).reshape(-1)
        if arr.size == 0:
            return
        if sample_rate != self.config.sample_rate:
            arr = resample_to(arr, sample_rate, self.config.sample_rate)
        self._ring.write(arr)

    def flush(self) -> None:
        self._ring.clear()

    def __enter__(self) -> "AudioPlayer":
        self.start()
        return self

    def __exit__(self, *exc_info) -> None:
        self.stop()


class OutputRouter:
    """Fans one audio stream out to several devices.

    Typical setup: the virtual cable (so Discord hears it) plus your own
    headphones (so you hear it too).  A failure to open one device must not
    stop the other, hence the per-player error handling.
    """

    def __init__(self) -> None:
        self.players: List[AudioPlayer] = []
        self.errors: List[str] = []

    def add(self, config: PlaybackConfig) -> Optional[AudioPlayer]:
        player = AudioPlayer(config)
        try:
            player.start()
        except AudioUnavailable as exc:
            self.errors.append(str(exc))
            return None
        self.players.append(player)
        return player

    def play(self, samples: np.ndarray, sample_rate: int) -> None:
        for player in self.players:
            player.play(samples, sample_rate)

    def flush(self) -> None:
        for player in self.players:
            player.flush()

    def stop(self) -> None:
        for player in self.players:
            player.stop()
        self.players.clear()

    @property
    def active(self) -> bool:
        return any(p.running for p in self.players)

    @property
    def queued_seconds(self) -> float:
        return max((p.queued_seconds for p in self.players), default=0.0)
