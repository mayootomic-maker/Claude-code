"""Build the window, drive every page and control, and shut down.

Run in CI on a real Windows session. The Windows crash that shipped in
1.1.0 existed because the GUI had only ever run under Xvfb on Linux and CI
exercised the command line alone -- so the window was never opened on the
platform every user runs it on.

Exits non-zero if anything raises, or if the diagnostics log records an
error while running.
"""

from __future__ import annotations

import os
import sys
import threading
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import tkinter as tk  # noqa: E402

from ravc import diagnostics  # noqa: E402
from ravc.ui.gui import PAGES, AccentApp  # noqa: E402

failures = []


def check(label, fn):
    try:
        fn()
        root.update_idletasks()
        root.update()
        print(f"  ok   {label}", flush=True)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        failures.append((label, exc))
        print(f"  FAIL {label}: {exc!r}", flush=True)


try:
    root = tk.Tk()
except tk.TclError as exc:
    print(f"no display: {exc}")
    sys.exit(0 if os.environ.get("RAVC_GUI_SMOKE_OPTIONAL") else 1)

app = AccentApp(root)
root.update_idletasks()
root.update()

for key, label, _glyph in PAGES:
    check(f"page {label}", lambda k=key: app._show_page(k))

for mode in ("Live", "Accent", "Off"):
    check(f"mode {mode}", lambda m=mode: app.mode_control.set(m, notify=True))

check("language german", lambda: (app.language_var.set("german"),
                                  app.on_language_change()))
check("language russian", lambda: (app.language_var.set("russian"),
                                   app.on_language_change()))
check("strength", lambda: app.on_strength_change(0.55))
check("preset", lambda: (app.preset_combo.set("Bond Villain"),
                         app.on_preset_change()))
check("comms", lambda: (app.comms_combo.set("CS:GO teammate"),
                        app.on_comms_change()))
check("noise", lambda: app.on_noise_change("fan", -28.0))
check("devices", app._refresh_devices)
check("hotkey cycle", app.hotkey_cycle_mode)
check("hotkey mute", app.hotkey_mute)
check("hotkey unmute", app.hotkey_mute)
check("meters", lambda: [app.meter.set_level(v / 10) for v in range(11)])
check("sample", app.insert_sample)


def hammer():
    """The crash that shipped: UI updates from a foreign thread."""
    for _ in range(300):
        app._ui(lambda: None)
        app._set_level(0.4)


check("cross-thread updates", lambda: [
    t.join(timeout=10) for t in [
        threading.Thread(target=hammer, name=f"hammer-{i}")
        for i in range(6)
    ] if (t.start() or True)
])
for _ in range(40):
    app._pump()
    root.update()

check("save", app._save_now)
check("close", app.on_close)

# A build machine has no sound card, so opening an output device fails.
# That is the app correctly reporting a missing device, not a defect -- and
# exercising the audio modes anyway is worth more than the noise it makes.
# Everything else in the log is a real problem.
EXPECTED = ("AudioUnavailable",)

log = diagnostics.log_path()
if log.exists():
    text = log.read_text(encoding="utf-8", errors="replace")
    errors = [line for line in text.splitlines() if " ERROR " in line]
    expected = [l for l in errors if any(e in l for e in EXPECTED)]
    unexpected = [l for l in errors if l not in expected]
    if expected:
        print(f"\n{len(expected)} expected error(s) (no audio hardware here):")
        for line in expected[:5]:
            print("  " + line)
    if unexpected:
        print("\nUNEXPECTED ERRORS IN THE LOG:")
        for line in unexpected[:20]:
            print("  " + line)
        failures.append(("log", unexpected[0]))

print(f"\n{len(failures)} failures")
sys.exit(1 if failures else 0)
