"""Microphone capture with a lock-free hand-off to the processing thread."""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

from .devices import AudioUnavailable, Device, _sd

CAPTURE_RATE = 16000  # what Whisper wants; also plenty for the VAD


@dataclass
class CaptureConfig:
    device_index: Optional[int] = None
    sample_rate: int = CAPTURE_RATE
    block_ms: int = 20
    channels: int = 1
    gain_db: float = 0.0

    @property
    def block_size(self) -> int:
        return int(self.sample_rate * self.block_ms / 1000)


class MicrophoneCapture:
    """Runs a PortAudio input stream and publishes mono float32 blocks.

    The PortAudio callback must never block, so it only does a non-blocking
    put onto a bounded queue; if the consumer falls behind, the oldest block
    is dropped rather than glitching the driver.
    """

    def __init__(self, config: Optional[CaptureConfig] = None,
                 on_level: Optional[Callable[[float], None]] = None) -> None:
        self.config = config or CaptureConfig()
        self.on_level = on_level
        self._queue: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=200)
        self._stream = None
        self._running = threading.Event()
        self.dropped_blocks = 0
        self.overflows = 0

    # -- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if self._running.is_set():
            return
        sd = _sd()
        cfg = self.config
        gain = 10.0 ** (cfg.gain_db / 20.0)

        def callback(indata, frames, time_info, status):  # noqa: ANN001
            if status and getattr(status, "input_overflow", False):
                self.overflows += 1
            block = np.asarray(indata, dtype=np.float32)
            if block.ndim > 1:
                block = block.mean(axis=1)
            if gain != 1.0:
                block = block * gain
            if self.on_level is not None:
                peak = float(np.max(np.abs(block))) if block.size else 0.0
                try:
                    self.on_level(peak)
                except Exception:
                    pass
            try:
                self._queue.put_nowait(block.copy())
            except queue.Full:
                self.dropped_blocks += 1
                try:
                    self._queue.get_nowait()
                    self._queue.put_nowait(block.copy())
                except (queue.Empty, queue.Full):
                    pass

        try:
            self._stream = sd.InputStream(
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
            raise AudioUnavailable(f"Could not open microphone: {exc}") from exc
        self._running.set()

    def stop(self) -> None:
        self._running.clear()
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break

    @property
    def running(self) -> bool:
        return self._running.is_set()

    # -- consumption -----------------------------------------------------

    def read(self, timeout: float = 0.25) -> Optional[np.ndarray]:
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def __enter__(self) -> "MicrophoneCapture":
        self.start()
        return self

    def __exit__(self, *exc_info) -> None:
        self.stop()


class Reframer:
    """Re-chunks a stream of arbitrary blocks into fixed-size frames."""

    def __init__(self, frame_length: int) -> None:
        self.frame_length = int(frame_length)
        self._tail = np.zeros(0, dtype=np.float32)

    def push(self, block: np.ndarray):
        data = np.concatenate([self._tail, np.asarray(block, dtype=np.float32)])
        n = data.size // self.frame_length
        frames = [data[i * self.frame_length:(i + 1) * self.frame_length]
                  for i in range(n)]
        self._tail = data[n * self.frame_length:]
        return frames

    def reset(self) -> None:
        self._tail = np.zeros(0, dtype=np.float32)
