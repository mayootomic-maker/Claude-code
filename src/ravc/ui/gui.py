"""The desktop window.

Tkinter rather than Qt on purpose: it is in the standard library, so the
packaged executable stays around a third of the size and needs no extra
runtime installed.

**Threading rule for this file.** Tkinter is not thread-safe, and that
includes ``after()`` -- it mutates the Tcl interpreter's event queue.
Audio callbacks run on PortAudio's realtime thread. So nothing outside the
Tk thread may touch a widget: background work calls :meth:`AccentApp._ui`,
which only appends to a queue, and :meth:`AccentApp._pump` drains it from
a timer the Tk thread owns. Getting this wrong crashes on Windows.
"""

from __future__ import annotations

import queue
import sys
import threading
import traceback
import webbrowser
from pathlib import Path
from typing import Callable, Dict, List, Optional

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import APP_TITLE, __version__, diagnostics
from ..accent.languages import available as available_languages
from ..accent.languages import get_pack
from ..asr.whisper_asr import MODEL_SIZES, WhisperAsr
from ..audio import devices as audio_devices
from ..config import AppConfig, config_path
from ..dsp.chain import get_preset, preset_names
from ..dsp.comms import profile_names as comms_names
from ..hotkeys import (DEFAULTS as HOTKEY_DEFAULTS, Binding, HotkeyManager,
                       LABELS as HOTKEY_LABELS, available as hotkeys_available,
                       describe as describe_hotkey,
                       unavailable_reason as hotkey_reason)
from ..pipeline import Events, State, VoiceChanger
from ..realtime import LiveMode
from ..tts import voices as voice_catalogue
from . import theme
from .widgets import (Card, LevelMeter, NavButton, SegmentedControl, Slider,
                      StatusDot, Toggle, scrollable)

SYSTEM_DEFAULT = "System default"

MODE_OFF = "Off"
MODE_LIVE = "Live"
MODE_ACCENT = "Accent"

PAGES = [
    ("home", "Home", "◉"),
    ("voice", "Voice", "◔"),
    ("accent", "Accent", "▤"),
    ("comms", "Comms", "▦"),
    ("audio", "Audio", "▶"),
    ("models", "Models", "▼"),
    ("help", "Help", "?"),
]


class AccentApp:
    """The whole application window."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = AppConfig.load()
        self.style = theme.apply(root)

        root.title(f"{APP_TITLE} {__version__}")
        root.geometry("1020x700")
        root.minsize(940, 620)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # -- cross-thread plumbing (see the module docstring) --------------
        self._events: "queue.Queue" = queue.Queue(maxsize=2048)
        self._pending_level: Optional[float] = None
        self._pump_job: Optional[str] = None
        self._timers: List[str] = []
        self._closing = False
        self._calibrating = False

        self._save_job: Optional[str] = None
        self._downloading = False
        self._voice_keys: List[str] = []
        self._variant_labels: List[str] = []
        self._device_maps: Dict[str, Dict[str, Optional[int]]] = {}
        self._feature_vars: Dict[str, tk.BooleanVar] = {}
        self._pages: Dict[str, ttk.Frame] = {}
        self._nav_buttons: Dict[str, NavButton] = {}
        self._current_page = "home"

        self.changer = VoiceChanger(self.config, Events(
            on_state=lambda s: self._ui(self._on_state, s),
            on_level=self._set_level,
            on_utterance=lambda src, acc: self._ui(self._on_utterance, src, acc),
            on_error=lambda m: self._ui(self._on_error, m),
            on_log=lambda m: self._ui(self._log, m),
            on_stats=lambda s: self._ui(self._on_stats, s),
        ))
        self.live = LiveMode(
            self.config,
            on_state=lambda s: self._ui(self._on_state, s),
            on_level=self._set_level,
            on_error=lambda m: self._ui(self._on_error, m),
            on_log=lambda m: self._ui(self._log, m))

        self.hotkeys = HotkeyManager()
        self._muted_mode: Optional[str] = None

        self._build()
        self._load_into_widgets()
        self._start_hotkeys()
        diagnostics.add_listener(self._on_log_line)
        self._pump()
        self._after(200, self._refresh_devices)

    # ------------------------------------------------------------------
    # Cross-thread plumbing
    # ------------------------------------------------------------------

    @staticmethod
    def _clear_selection(event) -> None:
        try:
            event.widget.selection_clear()
        except tk.TclError:
            pass

    def _ui(self, fn: Callable, *args) -> None:
        """Queue work for the Tk thread. Must not touch Tk itself."""
        try:
            self._events.put_nowait((fn, args))
        except queue.Full:
            pass

    def _set_level(self, value: float) -> None:
        """Newest microphone level. Safe from any thread.

        Deliberately a single slot rather than a queued event: levels
        arrive far faster than the UI redraws, and queueing them would only
        build a backlog of stale values.
        """
        self._pending_level = value

    def _pump(self) -> None:
        try:
            for _ in range(64):
                try:
                    fn, args = self._events.get_nowait()
                except queue.Empty:
                    break
                try:
                    fn(*args)
                except Exception as exc:  # noqa: BLE001
                    diagnostics.log_exception("UI callback", exc)

            level = self._pending_level
            if level is not None:
                self._pending_level = None
                scaled = min(1.0, level * 2.2)
                for meter in self._active_meters():
                    try:
                        meter.set_level(scaled)
                    except tk.TclError:
                        pass
        finally:
            # Cancel any timer already pending before arming the next one.
            # Without this, calling _pump directly (as the tests and the
            # smoke check do) leaves an orphaned job behind each time, and
            # those fire after the window is destroyed.
            if self._pump_job is not None:
                try:
                    self.root.after_cancel(self._pump_job)
                except tk.TclError:
                    pass
                self._pump_job = None
            if not self._closing:
                try:
                    self._pump_job = self.root.after(40, self._pump)
                except tk.TclError:
                    pass

    def _after(self, delay_ms: int, fn: Callable) -> Optional[str]:
        """Schedule on the Tk thread and remember the job.

        Anything still pending when the window is destroyed fires against a
        dead interpreter and prints a Tcl traceback, so every timer is
        tracked and cancelled on close.
        """
        if self._closing:
            return None
        try:
            job = self.root.after(delay_ms, fn)
        except tk.TclError:
            return None
        self._timers.append(job)
        if len(self._timers) > 64:
            self._timers = self._timers[-64:]
        return job

    def _active_meters(self) -> List[LevelMeter]:
        if self._calibrating:
            return [self.calibrate_meter]
        return [self.meter, self.status_meter]

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def _build(self) -> None:
        header = tk.Frame(self.root, bg=theme.BG, height=64)
        header.pack(fill="x", side="top")
        header.pack_propagate(False)
        tk.Label(header, text=APP_TITLE, bg=theme.BG, fg=theme.FG,
                 font=theme.Fonts.display).pack(side="left", padx=(22, 10))
        self.header_note = tk.Label(header, text="", bg=theme.BG,
                                    fg=theme.FG_MUTED, font=theme.Fonts.small)
        self.header_note.pack(side="left", pady=(10, 0))
        self.status = StatusDot(header)
        self.status.pack(side="right", padx=20)

        footer = tk.Frame(self.root, bg=theme.BG, height=34)
        footer.pack(fill="x", side="bottom")
        footer.pack_propagate(False)
        self.footer_label = tk.Label(footer, text="", bg=theme.BG,
                                     fg=theme.FG_MUTED, font=theme.Fonts.small)
        self.footer_label.pack(side="left", padx=22)
        self.status_meter = LevelMeter(footer, width=130, height=8,
                                       segments=22, background=theme.BG)
        self.status_meter.pack(side="right", padx=(0, 22))
        tk.Label(footer, text="mic", bg=theme.BG, fg=theme.FG_FAINT,
                 font=theme.Fonts.tiny).pack(side="right", padx=(0, 8))

        body = tk.Frame(self.root, bg=theme.BG)
        body.pack(fill="both", expand=True)

        nav = tk.Frame(body, bg=theme.BG_NAV, width=176)
        nav.pack(side="left", fill="y")
        nav.pack_propagate(False)
        tk.Frame(nav, bg=theme.BG_NAV, height=6).pack(fill="x")
        for key, label, glyph in PAGES:
            button = NavButton(nav, label, glyph,
                               lambda k=key: self._show_page(k))
            button.pack(fill="x", pady=1)
            self._nav_buttons[key] = button

        self.content = tk.Frame(body, bg=theme.BG)
        self.content.pack(side="left", fill="both", expand=True)

        self._build_home()
        self._build_voice()
        self._build_accent()
        self._build_comms()
        self._build_audio()
        self._build_models()
        self._build_help()
        self._show_page("home")

    def _page(self, key: str, scroll: bool = True) -> tk.Frame:
        if scroll:
            holder = scrollable(self.content)
            frame = tk.Frame(holder.inner, bg=theme.BG)
            frame.pack(fill="both", expand=True, padx=22, pady=18)
            self._pages[key] = holder
        else:
            holder = tk.Frame(self.content, bg=theme.BG)
            frame = tk.Frame(holder, bg=theme.BG)
            frame.pack(fill="both", expand=True, padx=22, pady=18)
            self._pages[key] = holder
        return frame

    def _show_page(self, key: str) -> None:
        for name, widget in self._pages.items():
            if name == key:
                widget.pack(fill="both", expand=True)
            else:
                widget.pack_forget()
        for name, button in self._nav_buttons.items():
            button.set_selected(name == key)
        self._current_page = key

    # -- Home --------------------------------------------------------------

    def _build_home(self) -> None:
        page = self._page("home")

        mode_card = Card(page, "Mode",
                         "Live changes your voice as you speak. Accent "
                         "transcribes each sentence and re-speaks it, which "
                         "sounds far more Russian but adds about a second.")
        mode_card.pack(fill="x")
        body = mode_card.body()
        self.mode_control = SegmentedControl(
            body, [MODE_OFF, MODE_LIVE, MODE_ACCENT], command=self.on_mode_change,
            height=42, width=380)
        self.mode_control.pack(anchor="w", pady=(2, 12))

        row = tk.Frame(body, bg=theme.BG_CARD)
        row.pack(fill="x")
        tk.Label(row, text="Microphone", bg=theme.BG_CARD, fg=theme.FG_MUTED,
                 font=theme.Fonts.small).pack(side="left", padx=(0, 10))
        self.meter = LevelMeter(row, width=240)
        self.meter.pack(side="left")
        self.latency_label = tk.Label(row, text="", bg=theme.BG_CARD,
                                      fg=theme.FG_FAINT, font=theme.Fonts.code)
        self.latency_label.pack(side="right")

        subs = Card(page, "What they hear")
        subs.pack(fill="both", expand=True, pady=(14, 0))
        sbody = subs.body()
        self.heard_label = tk.Label(sbody, text="—", bg=theme.BG_CARD,
                                    fg=theme.FG_MUTED, font=theme.Fonts.small,
                                    anchor="w", justify="left", wraplength=700)
        self.heard_label.pack(fill="x", anchor="w")
        self.accented_label = tk.Label(sbody, text="", bg=theme.BG_CARD,
                                       fg=theme.FG, font=theme.Fonts.subtitle,
                                       anchor="w", justify="left",
                                       wraplength=700)
        self.accented_label.pack(fill="x", anchor="w", pady=(8, 6))
        self.native_label = tk.Label(sbody, text="", bg=theme.BG_CARD,
                                     fg=theme.FG_MUTED, font=theme.Fonts.small,
                                     anchor="w", justify="left", wraplength=700)
        self.native_label.pack(fill="x", anchor="w")

        speak = Card(page, "Type to speak",
                     "Straight to the virtual microphone. No speech "
                     "recognition needed, so it is instant.")
        speak.pack(fill="x", pady=(14, 0))
        sp_body = speak.body()
        self.speak_text = tk.Text(sp_body, height=3, bg=theme.BG_INPUT,
                                  fg=theme.FG, insertbackground=theme.FG,
                                  relief="flat", font=theme.Fonts.body,
                                  wrap="word", padx=10, pady=8,
                                  highlightthickness=0, bd=0)
        self.speak_text.pack(fill="x")
        self.speak_text.bind("<Control-Return>", lambda _e: self.speak_typed())
        buttons = tk.Frame(sp_body, bg=theme.BG_CARD)
        buttons.pack(fill="x", pady=(10, 0))
        ttk.Button(buttons, text="Speak   Ctrl+Enter", style="Accent.TButton",
                   command=self.speak_typed).pack(side="left")
        ttk.Button(buttons, text="Sample line", style="Ghost.TButton",
                   command=self.insert_sample).pack(side="left", padx=8)
        ttk.Button(buttons, text="Save WAV", style="Ghost.TButton",
                   command=self.save_typed).pack(side="left")
        ttk.Button(buttons, text="Convert a file", style="Ghost.TButton",
                   command=self.convert_file).pack(side="left", padx=8)
        self.file_status = tk.Label(buttons, text="", bg=theme.BG_CARD,
                                    fg=theme.FG_MUTED, font=theme.Fonts.small)
        self.file_status.pack(side="left", padx=6)

        log_card = Card(page, "Activity")
        log_card.pack(fill="both", expand=True, pady=(14, 0))
        self.log_text = tk.Text(log_card.body(), height=5, bg=theme.BG_INPUT,
                                fg=theme.FG_MUTED, insertbackground=theme.FG,
                                relief="flat", font=theme.Fonts.code,
                                wrap="word", padx=10, pady=8,
                                highlightthickness=0, bd=0)
        self.log_text.pack(fill="both", expand=True)
        self.log_text.configure(state="disabled")

    # -- Voice -------------------------------------------------------------

    def _build_voice(self) -> None:
        page = self._page("voice")

        card = Card(page, "Voice",
                    "The accent comes from the voice's own phonetics, so the "
                    "voice has to match the accent language.")
        card.pack(fill="x")
        body = card.body()
        self.voice_combo = ttk.Combobox(body, state="readonly", width=48)
        self.voice_combo.pack(anchor="w")
        self.voice_combo.bind("<<ComboboxSelected>>", self.on_voice_change)
        self.voice_note = tk.Label(body, text="", bg=theme.BG_CARD,
                                   fg=theme.FG_MUTED, font=theme.Fonts.small,
                                   anchor="w", justify="left", wraplength=560)
        self.voice_note.pack(anchor="w", pady=(6, 0))

        self.variant_frame = tk.Frame(body, bg=theme.BG_CARD)
        self.variant_label = tk.Label(self.variant_frame, text="Variant",
                                      bg=theme.BG_CARD, fg=theme.FG,
                                      font=theme.Fonts.body)
        self.variant_label.pack(anchor="w", pady=(12, 3))
        self.variant_combo = ttk.Combobox(self.variant_frame, state="readonly",
                                          width=28)
        self.variant_combo.pack(anchor="w")
        self.variant_combo.bind("<<ComboboxSelected>>", self.on_variant_change)

        preset_card = Card(page, "Character")
        preset_card.pack(fill="x", pady=(14, 0))
        pbody = preset_card.body()
        self.preset_combo = ttk.Combobox(pbody, state="readonly", width=26,
                                         values=preset_names())
        self.preset_combo.pack(anchor="w")
        self.preset_combo.bind("<<ComboboxSelected>>", self.on_preset_change)

        cal = Card(page, "Match my voice",
                   "Measures your pitch and vocal tract length, and moves "
                   "the character voice onto them. Run it again after "
                   "changing voice.")
        cal.pack(fill="x", pady=(14, 0))
        cbody = cal.body()
        crow = tk.Frame(cbody, bg=theme.BG_CARD)
        crow.pack(fill="x")
        self.calibrate_button = ttk.Button(crow, text="Record 6 seconds",
                                           style="Ghost.TButton",
                                           command=self.start_calibration)
        self.calibrate_button.pack(side="left")
        ttk.Button(crow, text="Use a recording", style="Ghost.TButton",
                   command=self.calibrate_from_file).pack(side="left", padx=8)
        ttk.Button(crow, text="Clear", style="Ghost.TButton",
                   command=self.clear_calibration).pack(side="left")
        self.calibrate_meter = LevelMeter(crow, width=140)
        self.calibrate_meter.pack(side="right")
        self.calibrate_note = tk.Label(cbody, text="", bg=theme.BG_CARD,
                                       fg=theme.FG_MUTED,
                                       font=theme.Fonts.small, anchor="w",
                                       justify="left", wraplength=620)
        self.calibrate_note.pack(anchor="w", pady=(10, 0))

        tune = Card(page, "Fine tuning")
        tune.pack(fill="x", pady=(14, 0))
        tbody = tune.body()
        self.fx_sliders: Dict[str, Slider] = {}
        for field, label, lo, hi, fmt, suffix in [
            ("pitch_semitones", "Pitch", -12.0, 12.0, "{:+.1f}", " st"),
            ("formant_semitones", "Voice size (formants)", -8.0, 8.0,
             "{:+.1f}", " st"),
            ("bass_db", "Bass", -10.0, 12.0, "{:+.1f}", " dB"),
            ("presence_db", "Presence", -8.0, 10.0, "{:+.1f}", " dB"),
            ("drive", "Grit", 0.0, 1.0, "{:.0%}", ""),
            ("compression", "Compression", 0.0, 1.0, "{:.0%}", ""),
        ]:
            slider = Slider(tbody, label, lo, hi,
                            getattr(self.config.voice.fx, field),
                            on_change=lambda v, f=field: self.on_fx_change(f, v),
                            fmt=fmt, suffix=suffix)
            slider.pack(fill="x", pady=(0, 10))
            self.fx_sliders[field] = slider
        self.rate_slider = Slider(tbody, "Speaking rate", 0.6, 1.6,
                                  self.config.voice.speaking_rate,
                                  on_change=self.on_rate_change,
                                  fmt="{:.2f}", suffix="x")
        self.rate_slider.pack(fill="x")
        actions = tk.Frame(tbody, bg=theme.BG_CARD)
        actions.pack(fill="x", pady=(12, 0))
        ttk.Button(actions, text="Preview", style="Accent.TButton",
                   command=self.preview_sample).pack(side="left")
        ttk.Button(actions, text="Reset to character", style="Ghost.TButton",
                   command=self.reset_fx).pack(side="left", padx=8)

    # -- Accent ------------------------------------------------------------

    def _build_accent(self) -> None:
        page = self._page("accent")

        lang = Card(page, "Accent language")
        lang.pack(fill="x")
        lbody = lang.body()
        self.language_var = tk.StringVar(value=self.config.accent.language)
        row = tk.Frame(lbody, bg=theme.BG_CARD)
        row.pack(fill="x")
        for key, name in available_languages():
            ttk.Radiobutton(row, text=name, value=key,
                            variable=self.language_var,
                            command=self.on_language_change).pack(
                side="left", padx=(0, 20))

        strength = Card(page, "Strength",
                        "Lower values drop the most stereotyped "
                        "substitutions first and keep the subtle ones.")
        strength.pack(fill="x", pady=(14, 0))
        sbody = strength.body()
        self.strength_slider = Slider(
            sbody, "Accent strength", 0.0, 1.0, self.config.accent.strength,
            on_change=self.on_strength_change, fmt="{:.0%}")
        self.strength_slider.pack(fill="x", pady=(0, 10))
        self.grammar_slider = Slider(
            sbody, "Broken English (changes your words)", 0.0, 1.0,
            self.config.accent.grammar_strength,
            on_change=self.on_grammar_change, fmt="{:.0%}")
        self.grammar_slider.pack(fill="x")

        self.features_card = Card(
            page, "Features",
            "Turn one off if it makes a word you use a lot hard to follow.")
        self.features_card.pack(fill="x", pady=(14, 0))
        self.features_body = self.features_card.body()

        sample = Card(page, "Preview")
        sample.pack(fill="x", pady=(14, 0))
        sam_body = sample.body()
        ttk.Button(sam_body, text="Speak the sample", style="Ghost.TButton",
                   command=self.preview_sample).pack(anchor="w")
        self.sample_label = tk.Label(sam_body, text="", bg=theme.BG_CARD,
                                     fg=theme.FG, font=theme.Fonts.subtitle,
                                     anchor="w", justify="left", wraplength=640)
        self.sample_label.pack(anchor="w", fill="x", pady=(10, 0))

    def _rebuild_features(self) -> None:
        for child in self.features_body.winfo_children():
            child.destroy()
        self._feature_vars.clear()

        pack = get_pack(self.config.accent.language)
        overrides = self.config.accent.overrides()
        grid = tk.Frame(self.features_body, bg=theme.BG_CARD)
        grid.pack(fill="x")
        for index, (name, label) in enumerate(pack.feature_labels):
            default = pack.default_features.get(name, True)
            var = tk.BooleanVar(value=overrides.get(name, default))
            self._feature_vars[name] = var
            ttk.Checkbutton(grid, text=label, variable=var,
                            command=lambda n=name: self.on_feature_toggle(n)
                            ).grid(row=index // 2, column=index % 2, sticky="w",
                                   padx=(0, 22), pady=4)
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

    # -- Comms -------------------------------------------------------------

    def _build_comms(self) -> None:
        page = self._page("comms")

        card = Card(page, "Voice chat link",
                    "Push the finished voice through a game voice channel: "
                    "narrowband codec, a cheap headset mic clipping, an "
                    "automatic gain control pumping, dropped packets, and a "
                    "room behind it.")
        card.pack(fill="x")
        body = card.body()
        self.comms_combo = ttk.Combobox(body, state="readonly", width=32,
                                        values=comms_names())
        self.comms_combo.pack(anchor="w")
        self.comms_combo.bind("<<ComboboxSelected>>", self.on_comms_change)
        self.comms_note = tk.Label(body, text="", bg=theme.BG_CARD,
                                   fg=theme.FG_MUTED, font=theme.Fonts.small,
                                   anchor="w", justify="left", wraplength=620)
        self.comms_note.pack(anchor="w", pady=(8, 0))
        ttk.Button(body, text="Preview", style="Ghost.TButton",
                   command=self.preview_sample).pack(anchor="w", pady=(12, 0))

        noise = Card(page, "Background",
                     "What is in the room behind the microphone. These are "
                     "part of the chosen link; move them to taste.")
        noise.pack(fill="x", pady=(14, 0))
        nbody = noise.body()
        self.noise_sliders: Dict[str, Slider] = {}
        for source, label in (("fan", "Desk fan"), ("keyboard", "Keyboard"),
                              ("television", "Television next door"),
                              ("room", "Room tone")):
            slider = Slider(nbody, label, -60.0, -10.0,
                            self.config.voice.comms_profile.noise.get(source, -60.0),
                            on_change=lambda v, s=source: self.on_noise_change(s, v),
                            fmt="{:.0f}", suffix=" dB")
            slider.pack(fill="x", pady=(0, 10))
            self.noise_sliders[source] = slider

        live = Card(page, "Live mode",
                    "Live mode applies the same link in real time, without "
                    "the accent.")
        live.pack(fill="x", pady=(14, 0))
        lbody = live.body()
        self.gate_slider = Slider(
            lbody, "Open the channel above", -70.0, -25.0,
            self.config.voice.live_gate_db, on_change=self.on_gate_change,
            fmt="{:.0f}", suffix=" dB")
        self.gate_slider.pack(fill="x")

    # -- Audio -------------------------------------------------------------

    def _build_audio(self) -> None:
        page = self._page("audio")

        card = Card(page, "Devices",
                    "Send the changed voice to a virtual cable, then pick "
                    "that cable as your microphone in the game.")
        card.pack(fill="x")
        body = card.body()
        self.device_combos: Dict[str, ttk.Combobox] = {}
        for key, label in (("input_device", "Microphone"),
                           ("output_device", "Virtual cable (the game hears this)"),
                           ("monitor_device", "Monitor (you hear this)")):
            tk.Label(body, text=label, bg=theme.BG_CARD, fg=theme.FG,
                     font=theme.Fonts.body).pack(anchor="w", pady=(10, 3))
            combo = ttk.Combobox(body, state="readonly", width=52)
            combo.pack(anchor="w")
            combo.bind("<<ComboboxSelected>>",
                       lambda e, k=key: (self._clear_selection(e),
                                         self.on_device_change(k)))
            self.device_combos[key] = combo

        toggle_row = tk.Frame(body, bg=theme.BG_CARD)
        toggle_row.pack(fill="x", pady=(14, 0))
        self.monitor_toggle = Toggle(toggle_row, command=self.on_monitor_toggle,
                                     value=self.config.audio.monitor_enabled)
        self.monitor_toggle.pack(side="left")
        tk.Label(toggle_row, text="Also play on the monitor device",
                 bg=theme.BG_CARD, fg=theme.FG,
                 font=theme.Fonts.body).pack(side="left", padx=10)

        self.gain_slider = Slider(body, "Microphone gain", -12.0, 18.0,
                                  self.config.audio.input_gain_db,
                                  on_change=self.on_gain_change,
                                  fmt="{:+.1f}", suffix=" dB")
        self.gain_slider.pack(fill="x", pady=(14, 0))

        actions = tk.Frame(body, bg=theme.BG_CARD)
        actions.pack(fill="x", pady=(14, 0))
        ttk.Button(actions, text="Refresh devices", style="Ghost.TButton",
                   command=self._refresh_devices).pack(side="left")
        ttk.Button(actions, text="Get VB-CABLE (free)", style="Ghost.TButton",
                   command=lambda: webbrowser.open(
                       audio_devices.VB_CABLE_DOWNLOAD)).pack(side="left",
                                                              padx=8)
        self.routing_label = tk.Label(body, text="", bg=theme.BG_CARD,
                                      fg=theme.FG_MUTED,
                                      font=theme.Fonts.small, anchor="w",
                                      justify="left", wraplength=640)
        self.routing_label.pack(anchor="w", pady=(12, 0))

        keys = Card(page, "Shortcuts",
                    "System-wide, so they work while a game has focus.")
        keys.pack(fill="x", pady=(14, 0))
        kbody = keys.body()
        self.hotkey_entries: Dict[str, ttk.Entry] = {}
        for name, label in HOTKEY_LABELS.items():
            row = tk.Frame(kbody, bg=theme.BG_CARD)
            row.pack(fill="x", pady=3)
            tk.Label(row, text=label, bg=theme.BG_CARD, fg=theme.FG,
                     font=theme.Fonts.body, width=34,
                     anchor="w").pack(side="left")
            entry = ttk.Entry(row, width=20, font=theme.Fonts.code)
            entry.insert(0, self.config.behaviour.hotkeys.get(
                name, HOTKEY_DEFAULTS.get(name, "")))
            entry.pack(side="left")
            entry.bind("<FocusOut>", lambda _e, n=name: self.on_hotkey_change(n))
            entry.bind("<Return>", lambda _e, n=name: self.on_hotkey_change(n))
            self.hotkey_entries[name] = entry
        self.hotkey_note = tk.Label(kbody, text="", bg=theme.BG_CARD,
                                    fg=theme.FG_MUTED, font=theme.Fonts.small,
                                    anchor="w", justify="left", wraplength=620)
        self.hotkey_note.pack(anchor="w", pady=(10, 0))

        listen = Card(page, "Listening",
                      "How long a pause ends a sentence in Accent mode.")
        listen.pack(fill="x", pady=(14, 0))
        lbody = listen.body()
        self.hangover_slider = Slider(
            lbody, "Pause before speaking back", 250, 1500,
            self.config.recognition.silence_hangover_ms,
            on_change=self.on_hangover_change, fmt="{:.0f}", suffix=" ms")
        self.hangover_slider.pack(fill="x", pady=(0, 10))
        self.threshold_slider = Slider(
            lbody, "Speech threshold over room noise", 3.0, 20.0,
            self.config.recognition.vad_threshold_db,
            on_change=self.on_threshold_change, fmt="{:.1f}", suffix=" dB")
        self.threshold_slider.pack(fill="x")

    # -- Models ------------------------------------------------------------

    def _build_models(self) -> None:
        page = self._page("models")

        asr = Card(page, "Speech recognition",
                   "Only used by Accent mode. Bigger understands more and "
                   "adds delay. Downloaded on first use.")
        asr.pack(fill="x")
        abody = asr.body()
        self.asr_combo = ttk.Combobox(
            abody, state="readonly", width=50,
            values=[f"{name} — {note}" for _key, name, note in MODEL_SIZES])
        self.asr_combo.pack(anchor="w")
        self.asr_combo.bind("<<ComboboxSelected>>", self.on_asr_change)
        note = ("Installed." if WhisperAsr.is_installed()
                else "faster-whisper is missing; Accent mode will not run, "
                     "but Live and Type to speak still will.")
        tk.Label(abody, text=note, bg=theme.BG_CARD, fg=theme.FG_MUTED,
                 font=theme.Fonts.small).pack(anchor="w", pady=(6, 0))

        self.voices_card = Card(page, "Voice models",
                                "One per accent is enough to start.")
        self.voices_card.pack(fill="x", pady=(14, 0))
        self.voices_body = self.voices_card.body()
        self.download_bar = ttk.Progressbar(self.voices_body,
                                            mode="determinate",
                                            style="Horizontal.TProgressbar")
        self.download_label = tk.Label(self.voices_body, text="",
                                       bg=theme.BG_CARD, fg=theme.FG_MUTED,
                                       font=theme.Fonts.small)

    def _rebuild_voice_models(self) -> None:
        for child in list(self.voices_body.winfo_children()):
            if child not in (self.download_bar, self.download_label):
                child.destroy()

        for lang_key, lang_name in available_languages():
            tk.Label(self.voices_body, text=lang_name, bg=theme.BG_CARD,
                     fg=theme.FG, font=theme.Fonts.heading).pack(
                anchor="w", pady=(12, 5))
            for key, model in voice_catalogue.for_language(lang_key).items():
                row = tk.Frame(self.voices_body, bg=theme.BG_CARD)
                row.pack(fill="x", pady=2)
                tk.Label(row, text=f"{model.display}", bg=theme.BG_CARD,
                         fg=theme.FG, font=theme.Fonts.body, width=22,
                         anchor="w").pack(side="left")
                tk.Label(row, text=f"{model.gender}, {model.approx_mb} MB",
                         bg=theme.BG_CARD, fg=theme.FG_FAINT,
                         font=theme.Fonts.small, width=16,
                         anchor="w").pack(side="left")
                tk.Label(row, text=model.description, bg=theme.BG_CARD,
                         fg=theme.FG_MUTED, font=theme.Fonts.small,
                         anchor="w").pack(side="left", fill="x", expand=True)
                if voice_catalogue.is_installed(key):
                    tk.Label(row, text="installed", bg=theme.BG_CARD,
                             fg=theme.OK, font=theme.Fonts.small).pack(
                        side="right")
                else:
                    ttk.Button(row, text="Download", style="Ghost.TButton",
                               command=lambda k=key: self.download_voice(k)
                               ).pack(side="right")
        self.download_bar.pack_forget()
        self.download_label.pack_forget()

    # -- Help --------------------------------------------------------------

    def _build_help(self) -> None:
        page = self._page("help", scroll=False)
        text = tk.Text(page, bg=theme.BG_INPUT, fg=theme.FG, relief="flat",
                       font=theme.Fonts.body, wrap="word", padx=16, pady=14,
                       highlightthickness=0, bd=0)
        text.pack(fill="both", expand=True)
        text.insert("1.0", HELP_TEXT.format(
            models_dir=voice_catalogue.models_dir(),
            settings=config_path(),
            log=diagnostics.log_path(),
            cable=audio_devices.VB_CABLE_DOWNLOAD))
        text.configure(state="disabled")

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def _load_into_widgets(self) -> None:
        self.language_var.set(self.config.accent.language)
        self.strength_slider.set(self.config.accent.strength)
        self.grammar_slider.set(self.config.accent.grammar_strength)
        self.preset_combo.set(self.config.voice.preset)
        self.comms_combo.set(self.config.voice.comms)
        self.rate_slider.set(self.config.voice.speaking_rate)
        self.gate_slider.set(self.config.voice.live_gate_db)
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        for index, (key, _n, _d) in enumerate(MODEL_SIZES):
            if key == self.config.recognition.model_size:
                self.asr_combo.current(index)
                break
        self._rebuild_features()
        self._rebuild_voices()
        self._rebuild_voice_models()
        self._sync_noise_sliders()
        self._update_comms_note()
        self._update_sample()
        self._update_footer()

    def _rebuild_voices(self) -> None:
        language = self.config.accent.language
        voices = self.changer.registry.all_voices(language)
        labels, keys = [], []
        for voice in voices:
            tag = "" if voice.installed else "   (not downloaded)"
            where = "offline" if voice.offline else "online"
            labels.append(f"{voice.name} — {voice.gender}, {where}{tag}")
            keys.append(voice.key)
        self._voice_keys = keys
        self.voice_combo.configure(values=labels)

        current = self.config.voice.voice_for(language)
        if current in keys:
            self.voice_combo.current(keys.index(current))
        elif keys:
            self.voice_combo.current(0)
            self.config.voice.set_voice(language, keys[0])

        self._rebuild_variants()
        installed = [v for v in voices if v.installed]
        pack_name = get_pack(language).name
        self.voice_note.configure(
            text=(f"{len(installed)} voice(s) ready for {pack_name}."
                  if installed else
                  f"No {pack_name} voice downloaded yet — open Models."))

    def _rebuild_variants(self) -> None:
        key = self.config.active_voice_key
        engine_name, model_key = self.changer.registry.split_key(key)
        model = voice_catalogue.CATALOGUE.get(model_key)
        piper = self.changer.registry.engine("piper")

        speakers = []
        if (engine_name == "piper" and model is not None
                and model.multi_speaker and piper is not None):
            try:
                speakers = piper.speakers(model_key)
            except Exception:
                speakers = []
        if not speakers:
            self.variant_frame.pack_forget()
            self._variant_labels = []
            return

        self._variant_labels = [label for label, _sid in speakers]
        self.variant_label.configure(
            text="Emotion" if model.speaker_kind == "emotion" else "Voice")
        self.variant_combo.configure(values=self._variant_labels)
        current = (self.config.voice.speaker_for(key)
                   or model.default_speaker or self._variant_labels[0])
        self.variant_combo.current(self._variant_labels.index(current)
                                   if current in self._variant_labels else 0)
        self.variant_frame.pack(fill="x")

    def _sync_noise_sliders(self) -> None:
        noise = self.config.voice.comms_profile.noise
        for source, slider in self.noise_sliders.items():
            slider.set(noise.get(source, -60.0))

    def _update_comms_note(self) -> None:
        profile = self.config.voice.comms_profile
        if not profile.enabled:
            self.comms_note.configure(text="No link processing — the voice "
                                           "goes out clean.")
            return
        bits = f"{profile.bits:.0f}-bit" if profile.bits else "full resolution"
        self.comms_note.configure(
            text=(f"{profile.codec_rate or 'full'} Hz codec, "
                  f"{profile.band_low_hz:.0f}–{profile.band_high_hz:.0f} Hz, "
                  f"{bits}, {profile.packet_loss * 100:.1f}% packet loss."))

    def _refresh_devices(self) -> None:
        if self._closing:
            return
        if not audio_devices.sounddevice_available():
            for combo in self.device_combos.values():
                combo.configure(values=["(audio backend not installed)"])
                combo.set("(audio backend not installed)")
            self.routing_label.configure(
                text="PortAudio is not available. Install 'sounddevice'.")
            return
        try:
            inputs = audio_devices.input_devices()
            outputs = audio_devices.output_devices()
        except Exception as exc:  # noqa: BLE001
            diagnostics.log_exception("device enumeration", exc)
            self.routing_label.configure(text=f"Could not list devices: {exc}")
            return

        saved = {
            "input_device": self.config.audio.input_device,
            "output_device": self.config.audio.output_device,
            "monitor_device": self.config.audio.monitor_device,
        }
        for key, pool in (("input_device", inputs), ("output_device", outputs),
                          ("monitor_device", outputs)):
            names = [SYSTEM_DEFAULT] + [d.name for d in pool]
            self._device_maps[key] = {SYSTEM_DEFAULT: None}
            self._device_maps[key].update({d.name: d.index for d in pool})
            combo = self.device_combos[key]
            combo.configure(values=names)
            combo.set(saved[key] if saved[key] in names else SYSTEM_DEFAULT)

        cable = audio_devices.find_virtual_cable()
        if cable and not self.config.audio.output_device:
            self.config.audio.output_device = cable.name
            self.device_combos["output_device"].set(cable.name)
        self.routing_label.configure(text=audio_devices.describe_routing())
        self._update_footer()

    def _update_footer(self) -> None:
        pack = get_pack(self.config.accent.language)
        voice = self.config.active_voice_key.split(":", 1)[-1]
        comms = self.config.voice.comms
        parts = [pack.adjective, voice, self.config.voice.preset]
        if comms and comms != "Off":
            parts.append(comms)
        self.footer_label.configure(text="   ·   ".join(parts))
        self.header_note.configure(
            text=f"English in, thick {pack.adjective} accent out.")

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def on_mode_change(self, mode: str) -> None:
        self.changer.stop()
        self.live.stop()
        if mode == MODE_ACCENT:
            self.changer.update_config(self.config)
            self.changer.start()
        elif mode == MODE_LIVE:
            self.live.update_config(self.config)
            self.live.start()
            self.latency_label.configure(
                text=f"~{self.live.latency_estimate_ms:.0f} ms")
        else:
            self.latency_label.configure(text="")
            self._on_state(State.STOPPED)

    def on_language_change(self) -> None:
        self.config.accent.language = self.language_var.get()
        self._rebuild_features()
        self._rebuild_voices()
        self._apply_config()
        self._update_sample()
        self._update_footer()

    def on_strength_change(self, value: float) -> None:
        self.config.accent.strength = float(value)
        self._apply_config()
        self._update_sample()

    def on_grammar_change(self, value: float) -> None:
        self.config.accent.grammar_strength = float(value)
        self._apply_config()
        self._update_sample()

    def on_feature_toggle(self, name: str) -> None:
        self.config.accent.set_feature(name, self._feature_vars[name].get())
        self._apply_config()
        self._update_sample()

    def on_voice_change(self, event=None) -> None:
        if event is not None:
            self._clear_selection(event)
        index = self.voice_combo.current()
        if 0 <= index < len(self._voice_keys):
            self.config.voice.set_voice(self.config.accent.language,
                                        self._voice_keys[index])
            self._rebuild_variants()
            self._apply_config()
            self._update_footer()

    def on_variant_change(self, event=None) -> None:
        if event is not None:
            self._clear_selection(event)
        index = self.variant_combo.current()
        if 0 <= index < len(self._variant_labels):
            self.config.voice.set_speaker(self.config.active_voice_key,
                                          self._variant_labels[index])
            self._apply_config()

    def on_preset_change(self, event=None) -> None:
        if event is not None:
            self._clear_selection(event)
        self.config.apply_preset(self.preset_combo.get())
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        self._apply_config()
        self._update_footer()

    def on_comms_change(self, event=None) -> None:
        if event is not None:
            self._clear_selection(event)
        self.config.apply_comms(self.comms_combo.get())
        self._sync_noise_sliders()
        self._update_comms_note()
        self._apply_config()
        self._update_footer()

    def on_noise_change(self, source: str, value: float) -> None:
        profile = self.config.voice.comms_profile
        if value <= -59.5:
            profile.noise.pop(source, None)
        else:
            profile.noise[source] = float(value)
            profile.enabled = True
        self._apply_config()

    def on_gate_change(self, value: float) -> None:
        self.config.voice.live_gate_db = float(value)
        self._apply_config()

    def reset_fx(self) -> None:
        self.config.voice.fx = get_preset(self.config.voice.preset)
        self._sync_fx_sliders()

    def on_fx_change(self, field: str, value: float) -> None:
        setattr(self.config.voice.fx, field, float(value))
        self._apply_config()

    def on_rate_change(self, value: float) -> None:
        self.config.voice.speaking_rate = float(value)
        self._apply_config()

    def on_device_change(self, key: str) -> None:
        name = self.device_combos[key].get()
        setattr(self.config.audio, key, "" if name == SYSTEM_DEFAULT else name)
        self._apply_config()

    def on_monitor_toggle(self, value: bool) -> None:
        self.config.audio.monitor_enabled = value
        self._apply_config()

    def on_gain_change(self, value: float) -> None:
        self.config.audio.input_gain_db = float(value)
        self._apply_config()

    def on_hangover_change(self, value: float) -> None:
        self.config.recognition.silence_hangover_ms = int(value)
        self._apply_config()

    def on_threshold_change(self, value: float) -> None:
        self.config.recognition.vad_threshold_db = float(value)
        self._apply_config()

    def on_asr_change(self, event=None) -> None:
        if event is not None:
            self._clear_selection(event)
        index = self.asr_combo.current()
        if 0 <= index < len(MODEL_SIZES):
            self.config.recognition.model_size = MODEL_SIZES[index][0]
            self._apply_config()

    # -- hotkeys -----------------------------------------------------------

    def _start_hotkeys(self) -> None:
        if not self.config.behaviour.hotkeys_enabled:
            self.hotkey_note.configure(text="Shortcuts are turned off.")
            return
        if not hotkeys_available():
            self.hotkey_note.configure(text=hotkey_reason())
            return
        configured = self.config.behaviour.hotkeys
        bindings = {}
        for name, action in (("cycle_mode", self.hotkey_cycle_mode),
                             ("mute", self.hotkey_mute),
                             ("comms", self.hotkey_toggle_comms)):
            spec = configured.get(name, "")
            if spec:
                bindings[name] = Binding(spec, action, HOTKEY_LABELS[name])
        self.hotkeys.set_bindings(bindings)
        self.hotkeys.start()
        self._report_hotkeys()

    def _report_hotkeys(self) -> None:
        active = ", ".join(
            describe_hotkey(self.config.behaviour.hotkeys[name])
            for name in self.hotkeys.active
            if name in self.config.behaviour.hotkeys)
        failed = "; ".join(self.hotkeys.failed.values())
        parts = []
        if active:
            parts.append(f"Active: {active}.")
        if failed:
            parts.append(failed + ".")
        self.hotkey_note.configure(text=" ".join(parts) or "No shortcuts set.")

    def on_hotkey_change(self, name: str) -> None:
        self.config.behaviour.hotkeys[name] = self.hotkey_entries[name].get().strip()
        self._apply_config()
        self.hotkeys.stop()
        self._start_hotkeys()

    def hotkey_cycle_mode(self) -> None:
        order = [MODE_OFF, MODE_LIVE, MODE_ACCENT]
        current = self.mode_control.value
        nxt = order[(order.index(current) + 1) % len(order)] \
            if current in order else MODE_OFF
        self._ui(self.mode_control.set, nxt, True)

    def hotkey_mute(self) -> None:
        if self._muted_mode is None:
            self._muted_mode = self.mode_control.value
            self._ui(self.mode_control.set, MODE_OFF, True)
            self._ui(self._log, "Muted.")
        else:
            restore, self._muted_mode = self._muted_mode, None
            self._ui(self.mode_control.set, restore, True)
            self._ui(self._log, "Unmuted.")

    def hotkey_toggle_comms(self) -> None:
        profile = self.config.voice.comms_profile
        profile.enabled = not profile.enabled
        self._ui(self._log,
                 f"Voice-chat link {'on' if profile.enabled else 'off'}.")
        self._ui(self._apply_config)

    # -- pipeline feedback -------------------------------------------------

    def _on_state(self, state: str) -> None:
        self.status.set_state(state)
        if state in (State.STOPPED, State.ERROR):
            if self.mode_control.value != MODE_OFF and not self.live.running:
                self.mode_control.set(MODE_OFF)

    def _on_utterance(self, source: str, accented) -> None:
        self.heard_label.configure(text=f"heard:  {source}")
        self.accented_label.configure(text=accented.eye_dialect)
        self.native_label.configure(text=accented.native_text)

    def _on_stats(self, stats: dict) -> None:
        self.latency_label.configure(text=f"{stats['total_ms']:.0f} ms")
        self._log(f"{stats['total_ms']} ms total (heard {stats['asr_ms']}, "
                  f"voice {stats['tts_ms']}, effects {stats['fx_ms']})")

    def _on_error(self, message: str) -> None:
        self._log(f"Error: {message}")
        self.status.set_state(State.ERROR)

    def _on_log_line(self, line: str) -> None:
        if " ERROR " in line:
            self._ui(self._log, line.split(" ERROR ", 1)[-1].splitlines()[0])

    def _log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message.rstrip() + "\n")
        self.log_text.see("end")
        if int(self.log_text.index("end-1c").split(".")[0]) > 400:
            self.log_text.delete("1.0", "120.0")
        self.log_text.configure(state="disabled")

    # -- speaking ----------------------------------------------------------

    def speak_typed(self) -> str:
        text = self.speak_text.get("1.0", "end").strip()
        if text:
            self._speak_async(text)
        return "break"

    def insert_sample(self) -> None:
        pack = get_pack(self.config.accent.language)
        self.speak_text.delete("1.0", "end")
        self.speak_text.insert("1.0", pack.sample_line)

    def preview_sample(self) -> None:
        self._update_sample()
        self._speak_async(get_pack(self.config.accent.language).sample_line)

    def _update_sample(self) -> None:
        pack = get_pack(self.config.accent.language)
        try:
            result = self.changer.accent.accentify(pack.sample_line)
        except Exception as exc:  # noqa: BLE001
            self.sample_label.configure(text=f"({exc})")
            return
        self.sample_label.configure(
            text=f"{result.eye_dialect}\n{result.native_text}")

    def _speak_async(self, text: str) -> None:
        def work() -> None:
            try:
                if self.changer.running:
                    self.changer.speak(text, blocking=False)
                else:
                    self._play_once(text)
            except Exception as exc:  # noqa: BLE001
                diagnostics.log_exception("speak", exc)
                self._ui(self._on_error, str(exc))

        threading.Thread(target=work, daemon=True).start()

    def _play_once(self, text: str) -> None:
        from ..audio.playback import AudioPlayer, PlaybackConfig

        accented, audio = self.changer.render(text)
        self._ui(self._on_utterance, text, accented)
        if audio.samples.size == 0:
            return
        if not audio_devices.sounddevice_available():
            self._ui(self._on_error, "No audio output. Use Save WAV instead.")
            return

        name = (self.config.audio.output_device
                or self.config.audio.monitor_device)
        index = None
        if name:
            device = audio_devices.find_device_by_name(name, want_input=False)
            if device is not None:
                index = device.index
        player = AudioPlayer(PlaybackConfig(
            device_index=index,
            sample_rate=self.config.audio.output_sample_rate))
        player.start()
        player.play(audio.samples, audio.sample_rate)
        threading.Timer(audio.duration + 0.6, player.stop).start()

    def save_typed(self) -> None:
        text = self.speak_text.get("1.0", "end").strip()
        if not text:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".wav", filetypes=[("WAV audio", "*.wav")],
            initialfile="accented.wav")
        if not path:
            return
        try:
            self.changer.render_to_file(text, Path(path))
            self._log(f"Saved {path}")
        except Exception as exc:  # noqa: BLE001
            diagnostics.log_exception("save wav", exc)
            messagebox.showerror(APP_TITLE, f"Could not save:\n{exc}")

    def convert_file(self) -> None:
        source = filedialog.askopenfilename(
            filetypes=[("Audio", "*.wav *.flac *.ogg *.mp3 *.m4a"),
                       ("All files", "*.*")])
        if not source:
            return
        destination = filedialog.asksaveasfilename(
            defaultextension=".wav", filetypes=[("WAV audio", "*.wav")],
            initialfile=Path(source).stem + "_accented.wav")
        if not destination:
            return
        self.file_status.configure(text="Working…")

        def work() -> None:
            try:
                self.changer.convert_file(
                    Path(source), Path(destination),
                    progress=lambda m: self._ui(self.file_status.configure,
                                                {"text": m}))
                self._ui(self.file_status.configure,
                         {"text": f"Saved {Path(destination).name}"})
            except Exception as exc:  # noqa: BLE001
                diagnostics.log_exception("convert file", exc)
                self._ui(self.file_status.configure, {"text": f"Failed: {exc}"})

        threading.Thread(target=work, daemon=True).start()

    # -- calibration -------------------------------------------------------

    def start_calibration(self) -> None:
        if self._calibrating:
            return
        if not audio_devices.sounddevice_available():
            self.calibrate_note.configure(
                text="No microphone available. Use 'Use a recording' instead.")
            return
        self._calibrating = True
        self.calibrate_button.configure(state="disabled")
        self._countdown(3)

    def _countdown(self, remaining: int) -> None:
        if remaining > 0:
            self.calibrate_note.configure(
                text=f"Recording in {remaining}… then talk normally.")
            self._after(1000, lambda: self._countdown(remaining - 1))
            return
        self.calibrate_note.configure(text="Recording — talk now.")
        threading.Thread(target=self._record_and_calibrate,
                         daemon=True).start()

    def _record_and_calibrate(self) -> None:
        try:
            samples, rate = self.changer.record(6.0, on_level=self._set_level)
            self._ui(self.calibrate_note.configure, {"text": "Measuring…"})
            self._apply_calibration(samples, rate)
        except Exception as exc:  # noqa: BLE001
            diagnostics.log_exception("calibration", exc)
            self._ui(self._finish_calibration, f"Calibration failed: {exc}")

    def _apply_calibration(self, samples, rate) -> None:
        pitch, formant, message = self.changer.calibrate(samples, rate)
        if pitch or formant:
            self._ui(self._sync_fx_sliders)
        self._ui(self._finish_calibration, message)

    def _sync_fx_sliders(self) -> None:
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        self._apply_config()

    def _finish_calibration(self, message: str) -> None:
        self._calibrating = False
        self.calibrate_button.configure(state="normal")
        self.calibrate_meter.reset()
        self.calibrate_note.configure(text=message)
        self._log(message)

    def calibrate_from_file(self) -> None:
        path = filedialog.askopenfilename(
            filetypes=[("Audio", "*.wav *.flac *.ogg *.mp3 *.m4a"),
                       ("All files", "*.*")])
        if not path:
            return
        self.calibrate_note.configure(text="Measuring…")

        def work() -> None:
            try:
                import soundfile as sf
                data, rate = sf.read(path, dtype="float32", always_2d=True)
                self._apply_calibration(data.mean(axis=1), rate)
            except Exception as exc:  # noqa: BLE001
                diagnostics.log_exception("calibration from file", exc)
                self._ui(self._finish_calibration, f"Could not read: {exc}")

        threading.Thread(target=work, daemon=True).start()

    def clear_calibration(self) -> None:
        self.config.voice.fx.pitch_semitones = 0.0
        self.config.voice.fx.formant_semitones = 0.0
        self._sync_fx_sliders()
        self.calibrate_note.configure(text="Cleared.")

    # -- downloads ---------------------------------------------------------

    def download_voice(self, key: str) -> None:
        if self._downloading:
            return
        self._downloading = True
        self.download_bar.pack(fill="x", pady=(14, 4))
        self.download_label.pack(anchor="w")
        self.download_bar["value"] = 0

        def work() -> None:
            try:
                voice_catalogue.download_voice(
                    key, progress=lambda stage, fraction: self._ui(
                        self._download_progress, stage, fraction))
                self._ui(self._download_done, key, None)
            except Exception as exc:  # noqa: BLE001
                diagnostics.log_exception(f"download {key}", exc)
                self._ui(self._download_done, key, str(exc))

        threading.Thread(target=work, daemon=True).start()

    def _download_progress(self, stage: str, fraction: float) -> None:
        self.download_bar["value"] = fraction * 100
        self.download_label.configure(text=stage)

    def _download_done(self, key: str, error: Optional[str]) -> None:
        self._downloading = False
        if error:
            self.download_label.configure(text=f"Download failed: {error}")
            messagebox.showerror(APP_TITLE, f"Could not download {key}:\n{error}")
        else:
            self.download_label.configure(text=f"{key} installed.")
            self._log(f"Voice model installed: {key}")
        self._rebuild_voice_models()
        self._rebuild_voices()
        self._update_footer()

    # -- persistence -------------------------------------------------------

    def _apply_config(self) -> None:
        self.changer.update_config(self.config)
        self.live.update_config(self.config)
        if self._save_job is not None:
            try:
                self.root.after_cancel(self._save_job)
            except tk.TclError:
                pass
        self._save_job = self._after(700, self._save_now)

    def _save_now(self) -> None:
        self._save_job = None
        try:
            self.config.save()
        except Exception as exc:  # noqa: BLE001
            diagnostics.log_exception("save settings", exc)
            self._log(f"Could not save settings: {exc}")

    def on_close(self) -> None:
        self._closing = True
        diagnostics.remove_listener(self._on_log_line)
        for job in [self._pump_job, self._save_job] + self._timers:
            if job is None:
                continue
            try:
                self.root.after_cancel(job)
            except tk.TclError:
                pass
        self._timers = []
        for closer in (self.config.save, self.hotkeys.stop, self.live.stop,
                       self.changer.close):
            try:
                closer()
            except Exception:
                pass
        self.root.destroy()


HELP_TEXT = """\
Being heard in a game
─────────────────────
1. Install a virtual audio cable (free): {cable}
2. Audio → "Virtual cable" → choose "CABLE Input".
3. In the game, set the microphone to "CABLE Output".
4. Home → pick a mode.

Everything runs on this machine. Nothing is uploaded unless you choose one
of the voices marked "online", which sends only the transcribed text.

The two modes
─────────────
Live     Changes your own voice as you speak, about 40 ms behind. It can
         change who you sound like and put you on a game voice channel,
         but it cannot add an accent: an accent is a property of words,
         and words are only known once you have said them.

Accent   Waits for you to finish a sentence, works out what you said, and
         re-speaks it with a real Russian or German accent. Roughly a
         second of delay. This is the one that actually sounds foreign.

Type to speak works in either mode and is instant.

Sounding like a teammate
────────────────────────
Comms → "CS:GO teammate" puts the voice through a game voice channel:
narrowband codec, a cheap headset mic clipping, an automatic gain control
pumping the noise floor between words, dropped packets, and a room behind
it. The Background sliders control the fan, keyboard and television.

If something goes wrong
───────────────────────
Everything is logged, including failures on background threads:
{log}

No sound anywhere        Audio → Refresh devices.
The game cannot hear you Check the cable is installed and the game's
                         microphone is CABLE Output, not your real one.
It repeats itself        Lower the microphone gain or turn the monitor off.
Nothing is recognised    Raise the gain, or lower the speech threshold.

Files
─────
Voice models  {models_dir}
Settings      {settings}
Log           {log}
"""


def run_gui() -> int:
    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print(f"Could not open a window: {exc}\n"
              "Use the command line instead, for example:\n"
              '  ravc say "hello there" --out hello.wav', file=sys.stderr)
        return 1

    diagnostics.install()
    diagnostics.log_environment()

    def report_callback_exception(kind, value, tb) -> None:
        diagnostics.log_exception("Tk callback", value)

    root.report_callback_exception = report_callback_exception

    try:
        AccentApp(root)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        diagnostics.log_exception("building the window", exc)
        try:
            messagebox.showerror(
                APP_TITLE,
                f"Could not start.\n\n{exc}\n\n{diagnostics.crash_report_hint()}")
        except Exception:
            pass
        return 1
    root.mainloop()
    return 0
