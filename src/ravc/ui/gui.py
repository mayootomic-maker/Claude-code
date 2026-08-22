"""The desktop window.

Tkinter rather than Qt on purpose: it is in the standard library, so the
packaged executable stays around a third of the size and there is no extra
runtime to install or license.

Threading rule for this file: the pipeline runs on background threads and
Tk is not thread-safe, so every callback coming from the pipeline is
marshalled onto the Tk thread with :meth:`AccentApp._ui` before it touches
a widget.
"""

from __future__ import annotations

import queue
import sys
import threading
import traceback
import webbrowser
from pathlib import Path
from typing import Dict, List, Optional

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import APP_TITLE, __version__
from ..accent.languages import available as available_languages
from ..accent.languages import get_pack
from ..asr.whisper_asr import MODEL_SIZES, WhisperAsr
from ..audio import devices as audio_devices
from ..config import AppConfig, config_path
from ..dsp.chain import get_preset, preset_names
from ..pipeline import Events, State, VoiceChanger
from ..tts import voices as voice_catalogue
from . import theme
from .widgets import Card, LabelledSlider, LevelMeter, StatusPill, scrollable

SYSTEM_DEFAULT = "System default"


class AccentApp:
    """The whole application window."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = AppConfig.load()
        self.style = theme.apply(root)

        root.title(f"{APP_TITLE} {__version__}")
        root.geometry("980x720")
        root.minsize(880, 620)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._save_job: Optional[str] = None
        self._downloading = False
        self._preview_player = None
        self._voice_keys: List[str] = []
        self._device_maps: Dict[str, Dict[str, Optional[int]]] = {}
        self._feature_vars: Dict[str, tk.BooleanVar] = {}
        self._log_queue: "queue.Queue[str]" = queue.Queue()

        self.changer = VoiceChanger(self.config, Events(
            on_state=lambda s: self._ui(self._on_state, s),
            on_level=lambda v: self._ui(self.meter.set_level, min(1.0, v * 2.2)),
            on_utterance=lambda src, acc: self._ui(self._on_utterance, src, acc),
            on_error=lambda m: self._ui(self._on_error, m),
            on_log=lambda m: self._ui(self._log, m),
            on_stats=lambda s: self._ui(self._on_stats, s),
        ))

        self._build()
        self._load_into_widgets()
        self.root.after(200, self._refresh_devices)
        if self.config.behaviour.autostart_pipeline:
            self.root.after(900, self.toggle_pipeline)

    # -- thread marshalling ---------------------------------------------

    @staticmethod
    def _clear_selection(event) -> None:
        """Drop the leftover text highlight after a combobox pick."""
        try:
            event.widget.selection_clear()
        except tk.TclError:
            pass

    def _ui(self, fn, *args) -> None:
        try:
            self.root.after(0, lambda: fn(*args))
        except (RuntimeError, tk.TclError):
            pass  # window already gone

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def _build(self) -> None:
        header = ttk.Frame(self.root, padding=(18, 14, 18, 6))
        header.pack(fill="x")
        ttk.Label(header, text=APP_TITLE, style="Title.TLabel").pack(side="left")
        self.status = StatusPill(header)
        self.status.pack(side="right")
        self.subtitle_label = ttk.Label(
            header, text="English in, thick accent out.", style="Dim.TLabel")
        self.subtitle_label.pack(side="left", padx=(12, 0), pady=(8, 0))

        self.tabs = ttk.Notebook(self.root)
        self.tabs.pack(fill="both", expand=True, padx=14, pady=(4, 6))

        self._build_live_tab()
        self._build_speak_tab()
        self._build_accent_tab()
        self._build_voice_tab()
        self._build_audio_tab()
        self._build_models_tab()
        self._build_help_tab()

        footer = ttk.Frame(self.root, padding=(18, 0, 18, 10))
        footer.pack(fill="x")
        self.footer_label = ttk.Label(footer, text="", style="Dim.TLabel")
        self.footer_label.pack(side="left")
        ttk.Label(footer, text="Settings save automatically",
                  style="Dim.TLabel").pack(side="right")

    # -- Live ------------------------------------------------------------

    def _build_live_tab(self) -> None:
        tab = ttk.Frame(self.tabs, padding=16)
        self.tabs.add(tab, text="  Live  ")

        top = Card(tab, "Live microphone",
                   "Speak normally. Each time you pause, what you said is "
                   "re-spoken with the accent and sent to your virtual "
                   "microphone.")
        top.pack(fill="x")
        body = top.body()

        row = ttk.Frame(body, style="Panel.TFrame")
        row.pack(fill="x", pady=(4, 0))
        self.start_button = ttk.Button(row, text="Start listening",
                                       style="Accent.TButton",
                                       command=self.toggle_pipeline)
        self.start_button.pack(side="left")
        ttk.Label(row, text="Microphone", style="PanelDim.TLabel").pack(
            side="left", padx=(20, 8))
        self.meter = LevelMeter(row)
        self.meter.pack(side="left")

        subs = Card(tab, "What you said → what they hear")
        subs.pack(fill="both", expand=True, pady=(12, 0))
        sbody = subs.body()
        self.heard_label = ttk.Label(sbody, text="—", style="PanelDim.TLabel",
                                     wraplength=880, justify="left")
        self.heard_label.pack(anchor="w", fill="x")
        self.accented_label = ttk.Label(sbody, text="", style="Sub.TLabel",
                                        wraplength=880, justify="left")
        self.accented_label.pack(anchor="w", fill="x", pady=(6, 10))
        self.native_label = ttk.Label(sbody, text="", style="PanelDim.TLabel",
                                      wraplength=880, justify="left")
        self.native_label.pack(anchor="w", fill="x")

        log_card = Card(tab, "Activity")
        log_card.pack(fill="both", expand=True, pady=(12, 0))
        self.log_text = tk.Text(log_card.body(), height=7, bg=theme.BG_INPUT,
                                fg=theme.FG_DIM, insertbackground=theme.FG,
                                relief="flat", font=theme.FONT_SMALL, wrap="word",
                                padx=8, pady=6)
        self.log_text.pack(fill="both", expand=True)
        self.log_text.configure(state="disabled")

    # -- Type & Speak ------------------------------------------------------

    def _build_speak_tab(self) -> None:
        tab = ttk.Frame(self.tabs, padding=16)
        self.tabs.add(tab, text="  Type & Speak  ")

        card = Card(tab, "Type to speak",
                    "No microphone and no speech recognition needed — type a "
                    "line and it comes out of the virtual microphone.")
        card.pack(fill="both", expand=True)
        body = card.body()

        self.speak_text = tk.Text(body, height=7, bg=theme.BG_INPUT, fg=theme.FG,
                                  insertbackground=theme.FG, relief="flat",
                                  font=theme.FONT, wrap="word", padx=10, pady=8)
        self.speak_text.pack(fill="both", expand=True)
        self.speak_text.bind("<Control-Return>", lambda _e: self.speak_typed())

        row = ttk.Frame(body, style="Panel.TFrame")
        row.pack(fill="x", pady=(10, 0))
        ttk.Button(row, text="Speak  (Ctrl+Enter)", style="Accent.TButton",
                   command=self.speak_typed).pack(side="left")
        ttk.Button(row, text="Save as WAV…", style="Small.TButton",
                   command=self.save_typed).pack(side="left", padx=8)
        ttk.Button(row, text="Insert sample line", style="Small.TButton",
                   command=self.insert_sample).pack(side="left")

        preview = Card(tab, "Preview")
        preview.pack(fill="x", pady=(12, 0))
        self.speak_preview = ttk.Label(preview.body(), text="", style="Sub.TLabel")
        self.speak_preview.pack(anchor="w", fill="x")
        self.speak_native = ttk.Label(preview.body(), text="",
                                      style="PanelDim.TLabel", wraplength=860,
                                      justify="left")
        self.speak_native.pack(anchor="w", fill="x", pady=(4, 0))
        self.speak_text.bind("<KeyRelease>", lambda _e: self._update_preview())

        files = Card(tab, "Convert an audio file",
                     "Transcribe a recording and re-speak it with the accent.")
        files.pack(fill="x", pady=(12, 0))
        frow = ttk.Frame(files.body(), style="Panel.TFrame")
        frow.pack(fill="x")
        ttk.Button(frow, text="Choose file…", style="Small.TButton",
                   command=self.convert_file).pack(side="left")
        self.file_status = ttk.Label(frow, text="", style="PanelDim.TLabel")
        self.file_status.pack(side="left", padx=12)

    # -- Accent ------------------------------------------------------------

    def _build_accent_tab(self) -> None:
        tab = scrollable(self.tabs)
        self.tabs.add(tab, text="  Accent  ")
        inner = tab.inner
        pad = ttk.Frame(inner, padding=16)
        pad.pack(fill="both", expand=True)

        lang_card = Card(pad, "Accent language")
        lang_card.pack(fill="x")
        self.language_var = tk.StringVar(value=self.config.accent.language)
        lrow = ttk.Frame(lang_card.body(), style="Panel.TFrame")
        lrow.pack(fill="x")
        for key, name in available_languages():
            ttk.Radiobutton(lrow, text=name, value=key,
                            variable=self.language_var,
                            command=self.on_language_change,
                            style="TCheckbutton").pack(side="left", padx=(0, 18))

        strength_card = Card(
            pad, "Strength",
            "How thick the accent is. Lower values drop the most "
            "stereotyped substitutions first and keep the subtle ones.")
        strength_card.pack(fill="x", pady=(12, 0))
        sbody = strength_card.body()
        self.strength_slider = LabelledSlider(
            sbody, "Accent strength", 0.0, 1.0, self.config.accent.strength,
            on_change=self.on_strength_change, fmt="{:.0%}")
        self.strength_slider.pack(fill="x", pady=(0, 10))
        self.grammar_slider = LabelledSlider(
            sbody, "Broken English (changes your words — off by default)",
            0.0, 1.0, self.config.accent.grammar_strength,
            on_change=self.on_grammar_change, fmt="{:.0%}")
        self.grammar_slider.pack(fill="x")

        self.features_card = Card(
            pad, "Features",
            "Individual substitutions. Turn one off if it makes a word you "
            "use a lot hard to understand.")
        self.features_card.pack(fill="x", pady=(12, 0))
        self.features_body = self.features_card.body()

        sample = Card(pad, "Try it")
        sample.pack(fill="x", pady=(12, 0))
        srow = ttk.Frame(sample.body(), style="Panel.TFrame")
        srow.pack(fill="x")
        ttk.Button(srow, text="Preview accent", style="Small.TButton",
                   command=self.preview_sample).pack(side="left")
        self.sample_label = ttk.Label(sample.body(), text="", style="Sub.TLabel")
        self.sample_label.pack(anchor="w", fill="x", pady=(10, 0))

    def _rebuild_features(self) -> None:
        for child in self.features_body.winfo_children():
            child.destroy()
        self._feature_vars.clear()

        pack = get_pack(self.config.accent.language)
        overrides = self.config.accent.overrides()
        grid = ttk.Frame(self.features_body, style="Panel.TFrame")
        grid.pack(fill="x")
        for index, (name, label) in enumerate(pack.feature_labels):
            default = pack.default_features.get(name, True)
            var = tk.BooleanVar(value=overrides.get(name, default))
            self._feature_vars[name] = var
            ttk.Checkbutton(
                grid, text=label, variable=var,
                command=lambda n=name: self.on_feature_toggle(n),
            ).grid(row=index // 2, column=index % 2, sticky="w",
                   padx=(0, 24), pady=3)
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

    # -- Voice -------------------------------------------------------------

    def _build_voice_tab(self) -> None:
        tab = scrollable(self.tabs)
        self.tabs.add(tab, text="  Voice  ")
        pad = ttk.Frame(tab.inner, padding=16)
        pad.pack(fill="both", expand=True)

        vcard = Card(pad, "Voice",
                     "The accent comes from the voice's native phonetics, so "
                     "the voice must match the accent language.")
        vcard.pack(fill="x")
        vbody = vcard.body()
        self.voice_combo = ttk.Combobox(vbody, state="readonly", width=52)
        self.voice_combo.pack(anchor="w")
        self.voice_combo.bind("<<ComboboxSelected>>", self.on_voice_change)
        self.voice_note = ttk.Label(vbody, text="", style="PanelDim.TLabel",
                                    wraplength=560, justify="left")
        self.voice_note.pack(anchor="w", pady=(6, 0))

        # Only shown for models that carry several voices or deliveries.
        self.variant_frame = ttk.Frame(vbody, style="Panel.TFrame")
        self.variant_label = ttk.Label(self.variant_frame, text="Variant",
                                       style="Panel.TLabel")
        self.variant_label.pack(anchor="w", pady=(10, 2))
        self.variant_combo = ttk.Combobox(self.variant_frame, state="readonly",
                                          width=30)
        self.variant_combo.pack(anchor="w")
        self.variant_combo.bind("<<ComboboxSelected>>", self.on_variant_change)

        cal = Card(pad, "Match my voice",
                   "Records a few seconds of you speaking, measures your "
                   "pitch and vocal tract length, and shifts the character "
                   "voice to sit where yours does. Re-run it after changing "
                   "voice.")
        cal.pack(fill="x", pady=(12, 0))
        cbody = cal.body()
        crow = ttk.Frame(cbody, style="Panel.TFrame")
        crow.pack(fill="x")
        self.calibrate_button = ttk.Button(crow, text="Record 6 seconds",
                                           style="Small.TButton",
                                           command=self.start_calibration)
        self.calibrate_button.pack(side="left")
        ttk.Button(crow, text="Use a recording…", style="Small.TButton",
                   command=self.calibrate_from_file).pack(side="left", padx=8)
        ttk.Button(crow, text="Clear", style="Small.TButton",
                   command=self.clear_calibration).pack(side="left")
        self.calibrate_meter = LevelMeter(crow, width=150)
        self.calibrate_meter.pack(side="right")
        self.calibrate_note = ttk.Label(cbody, text="", style="PanelDim.TLabel",
                                        wraplength=620, justify="left")
        self.calibrate_note.pack(anchor="w", pady=(8, 0))

        pcard = Card(pad, "Character preset")
        pcard.pack(fill="x", pady=(12, 0))
        pbody = pcard.body()
        self.preset_combo = ttk.Combobox(pbody, state="readonly", width=28,
                                         values=preset_names())
        self.preset_combo.pack(anchor="w")
        self.preset_combo.bind("<<ComboboxSelected>>", self.on_preset_change)

        fcard = Card(pad, "Fine tuning")
        fcard.pack(fill="x", pady=(12, 0))
        fbody = fcard.body()
        fx = self.config.voice.fx
        self.fx_sliders: Dict[str, LabelledSlider] = {}
        specs = [
            ("pitch_semitones", "Pitch", -12.0, 12.0, "{:+.1f}", " st"),
            ("formant_semitones", "Formant (body size)", -8.0, 8.0,
             "{:+.1f}", " st"),
            ("bass_db", "Bass", -10.0, 12.0, "{:+.1f}", " dB"),
            ("presence_db", "Presence", -8.0, 10.0, "{:+.1f}", " dB"),
            ("drive", "Grit", 0.0, 1.0, "{:.0%}", ""),
            ("compression", "Compression", 0.0, 1.0, "{:.0%}", ""),
        ]
        for field, label, lo, hi, fmt, suffix in specs:
            slider = LabelledSlider(
                fbody, label, lo, hi, getattr(fx, field),
                on_change=lambda v, f=field: self.on_fx_change(f, v),
                fmt=fmt, suffix=suffix)
            slider.pack(fill="x", pady=(0, 9))
            self.fx_sliders[field] = slider

        self.rate_slider = LabelledSlider(
            fbody, "Speaking rate", 0.6, 1.6, self.config.voice.speaking_rate,
            on_change=self.on_rate_change, fmt="{:.2f}", suffix="×")
        self.rate_slider.pack(fill="x")

        row = ttk.Frame(fbody, style="Panel.TFrame")
        row.pack(fill="x", pady=(12, 0))
        ttk.Button(row, text="Preview voice", style="Accent.TButton",
                   command=self.preview_sample).pack(side="left")
        ttk.Button(row, text="Reset to preset", style="Small.TButton",
                   command=self.reset_fx).pack(side="left", padx=8)

    # -- Audio -------------------------------------------------------------

    def _build_audio_tab(self) -> None:
        tab = scrollable(self.tabs)
        self.tabs.add(tab, text="  Audio  ")
        pad = ttk.Frame(tab.inner, padding=16)
        pad.pack(fill="both", expand=True)

        card = Card(pad, "Devices",
                    "Send the changed voice to a virtual cable, then pick that "
                    "cable as your microphone in Discord, Zoom, OBS or a game.")
        card.pack(fill="x")
        body = card.body()

        self.device_combos: Dict[str, ttk.Combobox] = {}
        for key, label in (("input_device", "Microphone (your real one)"),
                           ("output_device", "Virtual cable (apps hear this)"),
                           ("monitor_device", "Monitor (you hear this)")):
            ttk.Label(body, text=label, style="Panel.TLabel").pack(
                anchor="w", pady=(8, 2))
            combo = ttk.Combobox(body, state="readonly", width=58)
            combo.pack(anchor="w")
            combo.bind("<<ComboboxSelected>>",
                       lambda e, k=key: (self._clear_selection(e),
                                         self.on_device_change(k)))
            self.device_combos[key] = combo

        self.monitor_var = tk.BooleanVar(
            value=self.config.audio.monitor_enabled)
        ttk.Checkbutton(body, text="Also play through the monitor device",
                        variable=self.monitor_var,
                        command=self.on_monitor_toggle).pack(anchor="w",
                                                             pady=(10, 0))

        self.gain_slider = LabelledSlider(
            body, "Microphone gain", -12.0, 18.0,
            self.config.audio.input_gain_db,
            on_change=self.on_gain_change, fmt="{:+.1f}", suffix=" dB")
        self.gain_slider.pack(fill="x", pady=(12, 0))

        row = ttk.Frame(body, style="Panel.TFrame")
        row.pack(fill="x", pady=(12, 0))
        ttk.Button(row, text="Refresh devices", style="Small.TButton",
                   command=self._refresh_devices).pack(side="left")
        ttk.Button(row, text="Get VB-CABLE (free)", style="Small.TButton",
                   command=lambda: webbrowser.open(
                       audio_devices.VB_CABLE_DOWNLOAD)).pack(side="left",
                                                              padx=8)
        self.routing_label = ttk.Label(body, text="", style="PanelDim.TLabel",
                                       wraplength=620, justify="left")
        self.routing_label.pack(anchor="w", pady=(12, 0))

        rec = Card(pad, "Listening sensitivity",
                   "How long a pause ends a sentence, and how loud speech has "
                   "to be over the room noise.")
        rec.pack(fill="x", pady=(12, 0))
        rbody = rec.body()
        self.hangover_slider = LabelledSlider(
            rbody, "Pause before speaking back", 250, 1500,
            self.config.recognition.silence_hangover_ms,
            on_change=self.on_hangover_change, fmt="{:.0f}", suffix=" ms")
        self.hangover_slider.pack(fill="x", pady=(0, 9))
        self.threshold_slider = LabelledSlider(
            rbody, "Speech threshold above room noise", 3.0, 20.0,
            self.config.recognition.vad_threshold_db,
            on_change=self.on_threshold_change, fmt="{:.1f}", suffix=" dB")
        self.threshold_slider.pack(fill="x")

    # -- Models ------------------------------------------------------------

    def _build_models_tab(self) -> None:
        tab = scrollable(self.tabs)
        self.tabs.add(tab, text="  Models  ")
        pad = ttk.Frame(tab.inner, padding=16)
        pad.pack(fill="both", expand=True)

        asr_card = Card(pad, "Speech recognition",
                        "Bigger models understand more, but add delay. "
                        "Downloaded automatically the first time you use one.")
        asr_card.pack(fill="x")
        abody = asr_card.body()
        self.asr_combo = ttk.Combobox(
            abody, state="readonly", width=52,
            values=[f"{name} — {note}" for _key, name, note in MODEL_SIZES])
        self.asr_combo.pack(anchor="w")
        self.asr_combo.bind("<<ComboboxSelected>>", self.on_asr_change)
        note = ("Installed." if WhisperAsr.is_installed()
                else "faster-whisper is not installed; the live microphone "
                     "mode will not work, but Type & Speak still will.")
        ttk.Label(abody, text=note, style="PanelDim.TLabel").pack(
            anchor="w", pady=(6, 0))

        self.voices_card = Card(
            pad, "Voice models",
            "Offline neural voices. One per accent is enough to get started.")
        self.voices_card.pack(fill="x", pady=(12, 0))
        self.voices_body = self.voices_card.body()

        self.download_bar = ttk.Progressbar(self.voices_body, mode="determinate",
                                            style="Horizontal.TProgressbar")
        self.download_label = ttk.Label(self.voices_body, text="",
                                        style="PanelDim.TLabel")

    def _rebuild_voice_models(self) -> None:
        for child in list(self.voices_body.winfo_children()):
            if child not in (self.download_bar, self.download_label):
                child.destroy()

        for lang_key, lang_name in available_languages():
            header = ttk.Label(self.voices_body, text=lang_name,
                               style="PanelHead.TLabel")
            header.pack(anchor="w", pady=(10, 4))
            for key, model in voice_catalogue.for_language(lang_key).items():
                row = ttk.Frame(self.voices_body, style="Panel.TFrame")
                row.pack(fill="x", pady=2)
                installed = voice_catalogue.is_installed(key)
                ttk.Label(row,
                          text=f"{model.display} ({model.gender}, "
                               f"{model.approx_mb} MB)",
                          style="Panel.TLabel", width=32).pack(side="left")
                ttk.Label(row, text=model.description,
                          style="PanelDim.TLabel").pack(side="left", padx=(0, 8))
                if installed:
                    ttk.Label(row, text="installed",
                              style="PanelDim.TLabel").pack(side="right")
                else:
                    ttk.Button(row, text="Download", style="Small.TButton",
                               command=lambda k=key: self.download_voice(k)
                               ).pack(side="right")

        self.download_bar.pack_forget()
        self.download_label.pack_forget()

    # -- Help --------------------------------------------------------------

    def _build_help_tab(self) -> None:
        tab = ttk.Frame(self.tabs, padding=16)
        self.tabs.add(tab, text="  Help  ")
        text = tk.Text(tab, bg=theme.BG_INPUT, fg=theme.FG, relief="flat",
                       font=theme.FONT, wrap="word", padx=14, pady=12)
        text.pack(fill="both", expand=True)
        text.insert("1.0", HELP_TEXT.format(
            models_dir=voice_catalogue.models_dir(),
            settings=config_path(),
            cable=audio_devices.VB_CABLE_DOWNLOAD))
        text.configure(state="disabled")

    # ------------------------------------------------------------------
    # State loading
    # ------------------------------------------------------------------

    def _load_into_widgets(self) -> None:
        self.language_var.set(self.config.accent.language)
        self.strength_slider.set(self.config.accent.strength)
        self.grammar_slider.set(self.config.accent.grammar_strength)
        self.preset_combo.set(self.config.voice.preset)
        self.rate_slider.set(self.config.voice.speaking_rate)
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        for index, (key, _n, _d) in enumerate(MODEL_SIZES):
            if key == self.config.recognition.model_size:
                self.asr_combo.current(index)
                break
        self._rebuild_features()
        self._rebuild_voices()
        self._rebuild_voice_models()
        self._update_sample()
        self._update_footer()

    def _rebuild_voices(self) -> None:
        language = self.config.accent.language
        voices = self.changer.registry.all_voices(language)
        labels, keys = [], []
        for voice in voices:
            labels.append(voice.label)
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
        if installed:
            self.voice_note.configure(
                text=f"{len(installed)} voice(s) ready for "
                     f"{get_pack(language).name}.")
        else:
            self.voice_note.configure(
                text=f"No {get_pack(language).name} voice downloaded yet — "
                     f"open the Models tab and download one.")

    def _rebuild_variants(self) -> None:
        """Show the sub-voice picker only for multi-speaker models."""
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
        if current in self._variant_labels:
            self.variant_combo.current(self._variant_labels.index(current))
        else:
            self.variant_combo.current(0)
        self.variant_frame.pack(fill="x")

    def on_variant_change(self, _event=None) -> None:
        if _event is not None:
            self._clear_selection(_event)
        index = self.variant_combo.current()
        if 0 <= index < len(getattr(self, "_variant_labels", [])):
            self.config.voice.set_speaker(self.config.active_voice_key,
                                          self._variant_labels[index])
            self._apply_config()

    # -- calibration ------------------------------------------------------

    def start_calibration(self) -> None:
        if getattr(self, "_calibrating", False):
            return
        if not audio_devices.sounddevice_available():
            self.calibrate_note.configure(
                text="No microphone available. Use 'Use a recording…' instead.")
            return
        self._calibrating = True
        self.calibrate_button.configure(state="disabled")
        self._countdown(3)

    def _countdown(self, remaining: int) -> None:
        if remaining > 0:
            self.calibrate_note.configure(
                text=f"Recording in {remaining}… then speak normally.")
            self.root.after(1000, lambda: self._countdown(remaining - 1))
            return
        self.calibrate_note.configure(text="Recording — speak now.")
        threading.Thread(target=self._record_and_calibrate,
                         daemon=True).start()

    def _record_and_calibrate(self) -> None:
        try:
            samples, sample_rate = self.changer.record(
                6.0, on_level=lambda v: self._ui(
                    self.calibrate_meter.set_level, min(1.0, v * 2.2)))
            self._ui(self.calibrate_note.configure,
                     {"text": "Measuring…"})
            self._apply_calibration(samples, sample_rate)
        except Exception as exc:  # noqa: BLE001
            self._ui(self._finish_calibration, f"Calibration failed: {exc}")

    def _apply_calibration(self, samples, sample_rate) -> None:
        pitch, formant, message = self.changer.calibrate(samples, sample_rate)
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
                data, sample_rate = sf.read(path, dtype="float32",
                                            always_2d=True)
                self._apply_calibration(data.mean(axis=1), sample_rate)
            except Exception as exc:  # noqa: BLE001
                self._ui(self._finish_calibration, f"Could not read: {exc}")

        threading.Thread(target=work, daemon=True).start()

    def clear_calibration(self) -> None:
        self.config.voice.fx.pitch_semitones = 0.0
        self.config.voice.fx.formant_semitones = 0.0
        self._sync_fx_sliders()
        self.calibrate_note.configure(text="Cleared.")

    def _refresh_devices(self) -> None:
        if not audio_devices.sounddevice_available():
            for combo in self.device_combos.values():
                combo.configure(values=["(audio backend not installed)"])
                combo.set("(audio backend not installed)")
            self.routing_label.configure(
                text="PortAudio is not available. Install it with "
                     "'pip install sounddevice' (on Linux also "
                     "'libportaudio2').")
            return
        try:
            inputs = audio_devices.input_devices()
            outputs = audio_devices.output_devices()
        except Exception as exc:  # noqa: BLE001
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
            mapping = {SYSTEM_DEFAULT: None}
            mapping.update({d.name: d.index for d in pool})
            self._device_maps[key] = mapping
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
        voice_key = self.config.active_voice_key
        name = voice_key.split(":", 1)[-1]
        self.footer_label.configure(
            text=f"{pack.adjective} · {name} · {self.config.voice.preset}")
        self.subtitle_label.configure(
            text=f"English in, thick {pack.adjective} accent out.")

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

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

    def on_voice_change(self, _event=None) -> None:
        if _event is not None:
            self._clear_selection(_event)
        index = self.voice_combo.current()
        if 0 <= index < len(self._voice_keys):
            key = self._voice_keys[index]
            self.config.voice.set_voice(self.config.accent.language, key)
            self._apply_config()
            self._update_footer()

    def on_preset_change(self, _event=None) -> None:
        if _event is not None:
            self._clear_selection(_event)
        self.config.apply_preset(self.preset_combo.get())
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        self._apply_config()
        self._update_footer()

    def reset_fx(self) -> None:
        self.config.voice.fx = get_preset(self.config.voice.preset)
        for field, slider in self.fx_sliders.items():
            slider.set(getattr(self.config.voice.fx, field))
        self._apply_config()

    def on_fx_change(self, field: str, value: float) -> None:
        setattr(self.config.voice.fx, field, float(value))
        self._apply_config()

    def on_rate_change(self, value: float) -> None:
        self.config.voice.speaking_rate = float(value)
        self._apply_config()

    def on_device_change(self, key: str) -> None:
        name = self.device_combos[key].get()
        setattr(self.config.audio, key, "" if name == SYSTEM_DEFAULT else name)
        self._apply_config(restart_audio=True)

    def on_monitor_toggle(self) -> None:
        self.config.audio.monitor_enabled = self.monitor_var.get()
        self._apply_config(restart_audio=True)

    def on_gain_change(self, value: float) -> None:
        self.config.audio.input_gain_db = float(value)
        self._apply_config(restart_audio=False)

    def on_hangover_change(self, value: float) -> None:
        self.config.recognition.silence_hangover_ms = int(value)
        self._apply_config()

    def on_threshold_change(self, value: float) -> None:
        self.config.recognition.vad_threshold_db = float(value)
        self._apply_config()

    def on_asr_change(self, _event=None) -> None:
        if _event is not None:
            self._clear_selection(_event)
        index = self.asr_combo.current()
        if 0 <= index < len(MODEL_SIZES):
            self.config.recognition.model_size = MODEL_SIZES[index][0]
            self._apply_config()

    # -- pipeline ---------------------------------------------------------

    def toggle_pipeline(self) -> None:
        if self.changer.running:
            self.changer.stop()
            self.start_button.configure(text="Start listening")
            self.meter.reset()
        else:
            self.changer.update_config(self.config)
            self.changer.start()
            self.start_button.configure(text="Stop")

    def _on_state(self, state: str) -> None:
        self.status.set_state(state)
        self.start_button.configure(
            text="Stop" if state not in (State.STOPPED, State.ERROR)
            else "Start listening")

    def _on_utterance(self, source: str, accented) -> None:
        self.heard_label.configure(text=f"heard:  {source}")
        self.accented_label.configure(text=accented.eye_dialect)
        self.native_label.configure(text=accented.native_text)

    def _on_stats(self, stats: dict) -> None:
        self._log(f"{stats['total_ms']} ms total "
                  f"(listen→text {stats['asr_ms']} ms, voice "
                  f"{stats['tts_ms']} ms, effects {stats['fx_ms']} ms)")

    def _on_error(self, message: str) -> None:
        self._log(f"Error: {message}")
        self.status.set_state(State.ERROR)

    def _log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message.rstrip() + "\n")
        self.log_text.see("end")
        # Keep the log bounded; it runs for hours in a streaming session.
        if int(self.log_text.index("end-1c").split(".")[0]) > 400:
            self.log_text.delete("1.0", "120.0")
        self.log_text.configure(state="disabled")

    # -- speaking ---------------------------------------------------------

    def speak_typed(self) -> str:
        text = self.speak_text.get("1.0", "end").strip()
        if not text:
            return "break"
        self._speak_async(text)
        return "break"

    def insert_sample(self) -> None:
        pack = get_pack(self.config.accent.language)
        self.speak_text.delete("1.0", "end")
        self.speak_text.insert("1.0", pack.sample_line)
        self._update_preview()

    def _update_preview(self) -> None:
        text = self.speak_text.get("1.0", "end").strip()
        if not text:
            self.speak_preview.configure(text="")
            self.speak_native.configure(text="")
            return
        try:
            result = self.changer.accent.accentify(text[:400])
        except Exception:
            return
        self.speak_preview.configure(text=result.eye_dialect)
        self.speak_native.configure(text=result.native_text)

    def preview_sample(self) -> None:
        pack = get_pack(self.config.accent.language)
        self._update_sample()
        self._speak_async(pack.sample_line)

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
                self._ui(self._on_error, str(exc))

        threading.Thread(target=work, daemon=True).start()

    def _play_once(self, text: str) -> None:
        """Speak without the live pipeline running (Type & Speak, previews)."""
        from ..audio.playback import AudioPlayer, PlaybackConfig

        accented, audio = self.changer.render(text)
        self._ui(self._on_utterance, text, accented)
        if audio.samples.size == 0:
            return
        if not audio_devices.sounddevice_available():
            self._ui(self._on_error,
                     "No audio output available. Use 'Save as WAV…' instead.")
            return

        index = None
        name = (self.config.audio.output_device
                or self.config.audio.monitor_device)
        if name:
            device = audio_devices.find_device_by_name(name, want_input=False)
            if device is not None:
                index = device.index
        player = AudioPlayer(PlaybackConfig(
            device_index=index,
            sample_rate=self.config.audio.output_sample_rate))
        player.start()
        player.play(audio.samples, audio.sample_rate)
        self._preview_player = player
        # Stop the stream once the audio has drained, without blocking the
        # Tk thread.
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
                self._ui(self.file_status.configure, {"text": f"Failed: {exc}"})

        threading.Thread(target=work, daemon=True).start()

    # -- downloads --------------------------------------------------------

    def download_voice(self, key: str) -> None:
        if self._downloading:
            return
        self._downloading = True
        self.download_bar.pack(fill="x", pady=(12, 2))
        self.download_label.pack(anchor="w")
        self.download_bar["value"] = 0

        def progress(stage: str, fraction: float) -> None:
            self._ui(self._download_progress, stage, fraction)

        def work() -> None:
            try:
                voice_catalogue.download_voice(key, progress=progress)
                self._ui(self._download_done, key, None)
            except Exception as exc:  # noqa: BLE001
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

    # -- persistence ------------------------------------------------------

    def _apply_config(self, restart_audio: bool = False) -> None:
        self.changer.update_config(self.config)
        if self._save_job is not None:
            try:
                self.root.after_cancel(self._save_job)
            except tk.TclError:
                pass
        self._save_job = self.root.after(700, self._save_now)

    def _save_now(self) -> None:
        self._save_job = None
        try:
            self.config.save()
        except Exception as exc:  # noqa: BLE001
            self._log(f"Could not save settings: {exc}")

    def on_close(self) -> None:
        try:
            self.config.save()
        except Exception:
            pass
        try:
            self.changer.close()
        except Exception:
            pass
        self.root.destroy()


HELP_TEXT = """\
Getting heard in Discord, Zoom, OBS or a game
─────────────────────────────────────────────
1. Install a virtual audio cable (free): {cable}
2. In this app, Audio tab → "Virtual cable" → choose "CABLE Input".
3. In Discord/Zoom/OBS/the game, set the microphone to "CABLE Output".
4. Press "Start listening" on the Live tab and talk.

Everything runs on your own machine. Nothing is uploaded, unless you pick
one of the "online" voices, which sends only the transcribed text to
Microsoft's speech service.

The three modes
───────────────
Live          Speak; each time you pause, the sentence is re-spoken with
              the accent. There is about a second of delay, because the
              accent has to know which words you said before it can
              change how they sound.
Type & Speak  Type a line and it is spoken instantly. No microphone or
              speech recognition needed. Good for streaming and for
              slow machines.
File          Convert an existing recording.

Making it faster
────────────────
• Models tab → a smaller speech-recognition model (Tiny or Base).
• Audio tab → shorten "Pause before speaking back".
• A machine with an NVIDIA GPU is detected automatically.

Making it sound better
──────────────────────
• Voice tab → try the presets first; "Bond Villain" is the classic.
• Pitch moves the voice up and down; Formant changes how *large* the
  speaker sounds. Lowering formants without lowering pitch is what makes
  a voice sound big rather than slowed down.
• Accent tab → Strength backs the whole thing off if colleagues cannot
  understand you.
• "Broken English" also drops articles and rearranges words. It changes
  what you actually said, so it is off by default.

If something is wrong
─────────────────────
• No sound anywhere: Audio tab → Refresh devices.
• Apps cannot hear you: check the virtual cable is installed and that the
  app's microphone is set to CABLE Output, not your real microphone.
• It repeats itself: lower the microphone gain, or turn the monitor off.
• Nothing is recognised: raise the microphone gain, or lower "Speech
  threshold above room noise".

Files
─────
Voice models: {models_dir}
Settings:     {settings}
"""


def run_gui() -> int:
    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print(f"Could not open a window: {exc}\n"
              "Use the command line instead, for example:\n"
              '  ravc say "hello there" --out hello.wav', file=sys.stderr)
        return 1

    try:
        AccentApp(root)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        try:
            messagebox.showerror(APP_TITLE, traceback.format_exc())
        except Exception:
            pass
        return 1
    root.mainloop()
    return 0
