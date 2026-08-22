"""Crash logging and a safety net.

A packaged Windows app has no console: when something raises on a
background thread, the traceback goes nowhere and the user sees a window
that stops responding. Everything here exists so that never happens
silently again -- every unhandled exception, on any thread, ends up in a
log file the user can send, and the app says so rather than dying quietly.
"""

from __future__ import annotations

import os
import platform
import sys
import threading
import traceback
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional

MAX_LOG_BYTES = 512 * 1024

_lock = threading.Lock()
_listeners: List[Callable[[str], None]] = []


def log_dir() -> Path:
    override = os.environ.get("RAVC_LOG_DIR")
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA",
                                   Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":  # pragma: no cover - mac
        base = Path.home() / "Library" / "Logs"
    else:
        base = Path(os.environ.get("XDG_STATE_HOME",
                                   Path.home() / ".local" / "state"))
    return base / "AccentVoiceChanger"


def log_path() -> Path:
    return log_dir() / "accent-voice-changer.log"


def add_listener(callback: Callable[[str], None]) -> None:
    """Also deliver log lines somewhere else (the in-app activity pane)."""
    with _lock:
        if callback not in _listeners:
            _listeners.append(callback)


def remove_listener(callback: Callable[[str], None]) -> None:
    with _lock:
        if callback in _listeners:
            _listeners.remove(callback)


def write(message: str, level: str = "INFO") -> None:
    """Append one line to the log. Never raises."""
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{stamp} {level:<7} {message}"
    try:
        path = log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Keep the file from growing without bound over a long stream.
        try:
            if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
                tail = path.read_text(encoding="utf-8", errors="replace")
                path.write_text(tail[-MAX_LOG_BYTES // 2:], encoding="utf-8")
        except OSError:
            pass
        with open(path, "a", encoding="utf-8", errors="replace") as fh:
            fh.write(line + "\n")
    except Exception:
        pass  # logging must never be the thing that breaks

    with _lock:
        listeners = list(_listeners)
    for listener in listeners:
        try:
            listener(line)
        except Exception:
            pass


def log_exception(context: str, exc: BaseException) -> str:
    """Record an exception with its traceback; returns a one-line summary."""
    summary = f"{type(exc).__name__}: {exc}"
    detail = "".join(traceback.format_exception(type(exc), exc,
                                                exc.__traceback__))
    write(f"{context}: {summary}\n{detail}", level="ERROR")
    return summary


def log_environment() -> None:
    """One block at startup, so a log alone is enough to diagnose from."""
    from . import __version__

    lines = [
        f"Accent Voice Changer {__version__}",
        f"Python {sys.version.split()[0]} ({platform.machine()})",
        f"{platform.system()} {platform.release()} {platform.version()}",
        f"frozen={getattr(sys, 'frozen', False)}",
        f"executable={sys.executable}",
    ]
    for module in ("numpy", "sounddevice", "soundfile", "onnxruntime",
                   "faster_whisper", "edge_tts"):
        try:
            imported = __import__(module)
            version = getattr(imported, "__version__", "?")
            lines.append(f"  {module} {version}")
        except Exception as exc:
            lines.append(f"  {module} MISSING ({type(exc).__name__})")
    write("startup\n" + "\n".join(lines))


def install(on_error: Optional[Callable[[str], None]] = None) -> None:
    """Route every unhandled exception, on any thread, into the log.

    Python installs no default handler for exceptions raised in threads
    other than the main one beyond printing to stderr -- and a windowed
    build has no stderr. Without this, a failure in the audio or synthesis
    thread is completely invisible.
    """

    def report(context: str, exc: BaseException) -> None:
        summary = log_exception(context, exc)
        if on_error is not None:
            try:
                on_error(summary)
            except Exception:
                pass

    previous_hook = sys.excepthook

    def excepthook(kind, value, tb) -> None:
        report("unhandled exception", value)
        try:
            previous_hook(kind, value, tb)
        except Exception:
            pass

    sys.excepthook = excepthook

    if hasattr(threading, "excepthook"):
        previous_thread_hook = threading.excepthook

        def thread_excepthook(args) -> None:
            if args.exc_value is not None:
                report(f"unhandled exception in thread "
                       f"{getattr(args.thread, 'name', '?')}", args.exc_value)
            try:
                previous_thread_hook(args)
            except Exception:
                pass

        threading.excepthook = thread_excepthook


def crash_report_hint() -> str:
    return (f"A full log is at:\n{log_path()}\n\n"
            "Attaching that file to a bug report is usually enough to "
            "identify the cause.")
