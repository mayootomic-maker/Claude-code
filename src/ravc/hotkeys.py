"""System-wide hotkeys.

Alt-tabbing out of a game to change your voice defeats the point, so the
mode switch and a panic mute need to work while the game has focus. That
means a *global* hotkey, which a normal Tk key binding is not: Tk only
sees keys when its own window is focused.

On Windows this uses RegisterHotKey through ctypes, so it needs no extra
dependency. Elsewhere it degrades to doing nothing and says so, rather
than pretending to work.

RegisterHotKey has one firm requirement: the hotkey must be registered on
the same thread that runs the message loop which receives WM_HOTKEY. So
registration is deferred and performed inside the worker thread.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from . import diagnostics

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000

WM_HOTKEY = 0x0312

_MODIFIER_NAMES = {
    "ctrl": MOD_CONTROL, "control": MOD_CONTROL,
    "alt": MOD_ALT, "shift": MOD_SHIFT,
    "win": MOD_WIN, "super": MOD_WIN, "cmd": MOD_WIN,
}

# Virtual-key codes for the keys worth binding.
_VIRTUAL_KEYS: Dict[str, int] = {
    **{chr(c): c for c in range(0x30, 0x3A)},          # 0-9
    **{chr(c).lower(): c for c in range(0x41, 0x5B)},  # a-z
    **{f"f{n}": 0x6F + n for n in range(1, 13)},       # F1-F12
    "space": 0x20, "escape": 0x1B, "esc": 0x1B, "tab": 0x09,
    "insert": 0x2D, "delete": 0x2E, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "numlock": 0x90, "scrolllock": 0x91, "pause": 0x13,
}


def parse(spec: str) -> Optional[Tuple[int, int]]:
    """``"ctrl+alt+v"`` -> ``(modifiers, virtual key)``, or None if invalid."""
    if not spec:
        return None
    modifiers = 0
    key: Optional[int] = None
    for part in spec.lower().replace(" ", "").split("+"):
        if not part:
            continue
        if part in _MODIFIER_NAMES:
            modifiers |= _MODIFIER_NAMES[part]
        elif part in _VIRTUAL_KEYS:
            key = _VIRTUAL_KEYS[part]
        else:
            return None
    if key is None:
        return None
    return modifiers | MOD_NOREPEAT, key


def describe(spec: str) -> str:
    parts = [p for p in spec.replace(" ", "").split("+") if p]
    pretty = {"ctrl": "Ctrl", "control": "Ctrl", "alt": "Alt",
              "shift": "Shift", "win": "Win", "super": "Win"}
    return " + ".join(pretty.get(p.lower(), p.upper() if len(p) == 1
                                 else p.capitalize()) for p in parts)


def available() -> bool:
    """Can global hotkeys actually work here?"""
    if os.name != "nt":
        return False
    try:
        import ctypes
    except Exception:
        return False
    return hasattr(ctypes, "windll")


def unavailable_reason() -> str:
    if os.name != "nt":
        return ("Global hotkeys are only implemented on Windows. The window's "
                "own shortcuts still work when it is focused.")
    return "Global hotkeys could not be set up on this system."


@dataclass
class Binding:
    spec: str
    callback: Callable[[], None]
    description: str = ""


class HotkeyManager:
    """Registers global hotkeys and dispatches them onto a callback.

    Callbacks run on the hotkey thread, so anything touching the UI must
    marshal onto the Tk thread itself.
    """

    def __init__(self) -> None:
        self._bindings: Dict[str, Binding] = {}
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._thread_id: Optional[int] = None
        self.active: List[str] = []
        self.failed: Dict[str, str] = {}

    def set_bindings(self, bindings: Dict[str, Binding]) -> None:
        """Replace the whole set; restarts if already running."""
        was_running = self.running
        if was_running:
            self.stop()
        self._bindings = dict(bindings)
        if was_running:
            self.start()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        if self.running or not self._bindings:
            return False
        if not available():
            return False
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="ravc-hotkeys",
                                        daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        thread_id, self._thread_id = self._thread_id, None
        if thread_id is not None:
            try:
                import ctypes
                # Nudge the message loop so GetMessage returns.
                ctypes.windll.user32.PostThreadMessageW(thread_id, 0x0400, 0, 0)
            except Exception:
                pass
        if thread is not None:
            thread.join(timeout=1.5)
        self.active = []

    # -- the worker ------------------------------------------------------

    def _loop(self) -> None:  # pragma: no cover - Windows only
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        self._thread_id = ctypes.windll.kernel32.GetCurrentThreadId()

        registered: Dict[int, Binding] = {}
        self.active = []
        self.failed = {}
        for index, (name, binding) in enumerate(sorted(self._bindings.items()), 1):
            parsed = parse(binding.spec)
            if parsed is None:
                self.failed[name] = f"'{binding.spec}' is not a valid shortcut"
                continue
            modifiers, key = parsed
            if user32.RegisterHotKey(None, index, modifiers, key):
                registered[index] = binding
                self.active.append(name)
            else:
                # Almost always means another application owns it.
                self.failed[name] = (f"{describe(binding.spec)} is already "
                                     "taken by another application")
        if self.failed:
            diagnostics.write("hotkeys not registered: "
                              + "; ".join(f"{k}: {v}"
                                          for k, v in self.failed.items()),
                              level="WARN")
        if registered:
            diagnostics.write("hotkeys registered: " + ", ".join(self.active))

        try:
            message = wintypes.MSG()
            while not self._stop.is_set():
                result = user32.GetMessageW(ctypes.byref(message), None, 0, 0)
                if result in (0, -1):
                    break
                if message.message == WM_HOTKEY:
                    binding = registered.get(message.wParam)
                    if binding is not None:
                        try:
                            binding.callback()
                        except Exception as exc:
                            diagnostics.log_exception("hotkey callback", exc)
        except Exception as exc:
            diagnostics.log_exception("hotkey loop", exc)
        finally:
            for index in registered:
                try:
                    user32.UnregisterHotKey(None, index)
                except Exception:
                    pass


DEFAULTS: Dict[str, str] = {
    "cycle_mode": "ctrl+alt+v",
    "mute": "ctrl+alt+m",
    "comms": "ctrl+alt+c",
    "push_to_talk": "",
}

LABELS: Dict[str, str] = {
    "cycle_mode": "Switch mode (Off → Live → Accent)",
    "mute": "Panic mute",
    "comms": "Voice-chat link on/off",
    "push_to_talk": "Push to talk (leave empty for off)",
}
