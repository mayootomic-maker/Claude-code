"""Colours, type scale and ttk styling.

Tk's stock widgets look like 1998. Most of what follows is undoing that:
a flat dark palette, one accent colour used sparingly, a real type scale,
and generous spacing. The genuinely awkward parts -- rounded panels, the
mode switch, toggles -- are drawn on a Canvas in widgets.py instead.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

# -- palette ---------------------------------------------------------------
BG = "#0f1216"           # window
BG_NAV = "#141920"       # sidebar
BG_CARD = "#181e26"      # panels
BG_INPUT = "#0b0e12"     # fields
BG_HOVER = "#212a35"
BORDER = "#252e3a"
BORDER_SOFT = "#1c242e"

FG = "#e8edf4"
FG_MUTED = "#8895a6"
FG_FAINT = "#5c6875"

ACCENT = "#e0483c"
ACCENT_HOVER = "#f05a4d"
ACCENT_DIM = "#7d2a23"
OK = "#3ecf7e"
WARN = "#e0a23c"
INFO = "#4d9fe8"

STATE_COLOURS = {
    "stopped": FG_FAINT,
    "starting": WARN,
    "listening": OK,
    "thinking": WARN,
    "speaking": ACCENT,
    "live": INFO,
    "error": ACCENT,
}


def _pick_family(root: tk.Misc) -> str:
    """The nicest UI face actually present, rather than a hopeful guess."""
    try:
        available = set(tkfont.families(root))
    except Exception:
        return "TkDefaultFont"
    for candidate in ("Segoe UI Variable Text", "Segoe UI", "Inter",
                      "SF Pro Text", "Helvetica Neue", "DejaVu Sans",
                      "Noto Sans", "Arial"):
        if candidate in available:
            return candidate
    return "TkDefaultFont"


def _pick_mono(root: tk.Misc) -> str:
    try:
        available = set(tkfont.families(root))
    except Exception:
        return "TkFixedFont"
    for candidate in ("Cascadia Mono", "Consolas", "SF Mono", "DejaVu Sans Mono",
                      "Menlo", "Courier New"):
        if candidate in available:
            return candidate
    return "TkFixedFont"


class Fonts:
    """Filled in by :func:`apply`, once a root window exists."""

    family = "TkDefaultFont"
    mono = "TkFixedFont"
    display = ("TkDefaultFont", 19, "bold")
    title = ("TkDefaultFont", 14, "bold")
    heading = ("TkDefaultFont", 11, "bold")
    body = ("TkDefaultFont", 10)
    small = ("TkDefaultFont", 9)
    tiny = ("TkDefaultFont", 8)
    strong = ("TkDefaultFont", 10, "bold")
    subtitle = ("TkDefaultFont", 13)
    code = ("TkFixedFont", 9)


def apply(root: tk.Misc) -> ttk.Style:
    family = _pick_family(root)
    mono = _pick_mono(root)
    Fonts.family = family
    Fonts.mono = mono
    Fonts.display = (family, 19, "bold")
    Fonts.title = (family, 14, "bold")
    Fonts.heading = (family, 11, "bold")
    Fonts.body = (family, 10)
    Fonts.small = (family, 9)
    Fonts.tiny = (family, 8)
    Fonts.strong = (family, 10, "bold")
    Fonts.subtitle = (family, 13)
    Fonts.code = (mono, 9)

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:  # pragma: no cover - depends on the Tk build
        pass

    root.configure(bg=BG)
    style.configure(".", background=BG, foreground=FG, font=Fonts.body,
                    fieldbackground=BG_INPUT, bordercolor=BORDER,
                    lightcolor=BG_CARD, darkcolor=BG_CARD, focuscolor=ACCENT)

    for name, background in (("TFrame", BG), ("Nav.TFrame", BG_NAV),
                             ("Card.TFrame", BG_CARD),
                             ("Input.TFrame", BG_INPUT)):
        style.configure(name, background=background)

    for suffix, background in (("", BG), ("Nav.", BG_NAV), ("Card.", BG_CARD)):
        style.configure(f"{suffix}TLabel", background=background, foreground=FG,
                        font=Fonts.body)
        style.configure(f"{suffix}Muted.TLabel", background=background,
                        foreground=FG_MUTED, font=Fonts.small)
        style.configure(f"{suffix}Heading.TLabel", background=background,
                        foreground=FG, font=Fonts.heading)
        style.configure(f"{suffix}Title.TLabel", background=background,
                        foreground=FG, font=Fonts.title)
        style.configure(f"{suffix}Subtitle.TLabel", background=background,
                        foreground=FG, font=Fonts.subtitle)
        style.configure(f"{suffix}Code.TLabel", background=background,
                        foreground=FG_MUTED, font=Fonts.code)

    style.configure("Display.TLabel", background=BG, foreground=FG,
                    font=Fonts.display)
    style.configure("Ok.TLabel", background=BG_CARD, foreground=OK,
                    font=Fonts.small)
    style.configure("Warn.TLabel", background=BG_CARD, foreground=WARN,
                    font=Fonts.small)

    # -- buttons -----------------------------------------------------------
    style.configure("TButton", background=BG_HOVER, foreground=FG,
                    borderwidth=0, focusthickness=0, padding=(14, 8),
                    font=Fonts.body, relief="flat")
    style.map("TButton",
              background=[("pressed", BORDER), ("active", "#2b3644"),
                          ("disabled", BG_CARD)],
              foreground=[("disabled", FG_FAINT)])

    style.configure("Accent.TButton", background=ACCENT, foreground="#ffffff",
                    font=Fonts.strong, padding=(20, 11), borderwidth=0,
                    relief="flat")
    style.map("Accent.TButton",
              background=[("pressed", ACCENT_DIM), ("active", ACCENT_HOVER),
                          ("disabled", BORDER)],
              foreground=[("disabled", FG_FAINT)])

    style.configure("Ghost.TButton", background=BG_HOVER, foreground=FG,
                    font=Fonts.small, padding=(13, 7), borderwidth=0,
                    relief="flat")
    style.map("Ghost.TButton",
              background=[("pressed", BORDER), ("active", "#2b3644"),
                          ("disabled", BG_CARD)],
              foreground=[("disabled", FG_FAINT)])

    # -- inputs ------------------------------------------------------------
    style.configure("TCombobox", fieldbackground=BG_INPUT, background=BG_CARD,
                    foreground=FG, arrowcolor=FG_MUTED, padding=7,
                    borderwidth=0, relief="flat")
    style.map("TCombobox",
              fieldbackground=[("readonly", BG_INPUT), ("disabled", BG_CARD)],
              selectbackground=[("readonly", BG_INPUT)],
              selectforeground=[("readonly", FG)],
              background=[("readonly", BG_CARD), ("active", BG_CARD)],
              foreground=[("readonly", FG), ("disabled", FG_FAINT)],
              arrowcolor=[("active", FG)])
    root.option_add("*TCombobox*Listbox.background", BG_INPUT)
    root.option_add("*TCombobox*Listbox.foreground", FG)
    root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")
    root.option_add("*TCombobox*Listbox.borderWidth", 0)
    root.option_add("*TCombobox*Listbox.font", Fonts.body)

    style.configure("TCheckbutton", background=BG_CARD, foreground=FG,
                    font=Fonts.body, focuscolor=BG_CARD)
    style.map("TCheckbutton", background=[("active", BG_CARD)],
              foreground=[("disabled", FG_FAINT)])
    style.configure("TRadiobutton", background=BG_CARD, foreground=FG,
                    font=Fonts.body, focuscolor=BG_CARD)
    style.map("TRadiobutton", background=[("active", BG_CARD)])

    style.configure("Horizontal.TScale", background=BG_CARD,
                    troughcolor=BG_INPUT, borderwidth=0, lightcolor=ACCENT,
                    darkcolor=ACCENT)
    style.configure("Horizontal.TProgressbar", background=ACCENT,
                    troughcolor=BG_INPUT, borderwidth=0, thickness=6)
    style.configure("TSeparator", background=BORDER_SOFT)
    style.configure("Vertical.TScrollbar", background=BORDER, troughcolor=BG,
                    borderwidth=0, arrowcolor=FG_FAINT, relief="flat")
    style.map("Vertical.TScrollbar", background=[("active", BG_HOVER)])
    return style
