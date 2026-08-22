"""Colours and ttk styling for the desktop window."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

BG = "#161a20"
BG_PANEL = "#1e242c"
BG_INPUT = "#131820"
FG = "#e6ebf2"
FG_DIM = "#8f9bab"
ACCENT = "#e0483c"          # the flag red both accents happen to share
ACCENT_DARK = "#b3392f"
OK = "#37b26a"
WARN = "#d9a441"
BORDER = "#2b333d"

FONT = ("Segoe UI", 10)
FONT_SMALL = ("Segoe UI", 9)
FONT_BOLD = ("Segoe UI", 10, "bold")
FONT_TITLE = ("Segoe UI", 16, "bold")
FONT_MONO = ("Consolas", 10)
FONT_SUB = ("Segoe UI", 13)


def apply(root: tk.Misc) -> ttk.Style:
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:  # pragma: no cover - depends on the Tk build
        pass

    root.configure(bg=BG)
    style.configure(".", background=BG, foreground=FG, font=FONT,
                    fieldbackground=BG_INPUT, bordercolor=BORDER,
                    lightcolor=BG_PANEL, darkcolor=BG_PANEL)
    style.configure("TFrame", background=BG)
    style.configure("Panel.TFrame", background=BG_PANEL)
    style.configure("TLabel", background=BG, foreground=FG)
    style.configure("Panel.TLabel", background=BG_PANEL, foreground=FG)
    style.configure("Dim.TLabel", background=BG, foreground=FG_DIM,
                    font=FONT_SMALL)
    style.configure("PanelDim.TLabel", background=BG_PANEL, foreground=FG_DIM,
                    font=FONT_SMALL)
    style.configure("Title.TLabel", background=BG, foreground=FG,
                    font=FONT_TITLE)
    style.configure("Head.TLabel", background=BG, foreground=FG, font=FONT_BOLD)
    style.configure("PanelHead.TLabel", background=BG_PANEL, foreground=FG,
                    font=FONT_BOLD)
    style.configure("Sub.TLabel", background=BG_PANEL, foreground=FG,
                    font=FONT_SUB, wraplength=760, justify="left")
    style.configure("Ok.TLabel", background=BG, foreground=OK, font=FONT_SMALL)
    style.configure("Warn.TLabel", background=BG, foreground=WARN,
                    font=FONT_SMALL)

    style.configure("TButton", background=BG_PANEL, foreground=FG,
                    borderwidth=0, focusthickness=0, padding=(12, 7))
    style.map("TButton",
              background=[("active", BORDER), ("disabled", BG_PANEL)],
              foreground=[("disabled", FG_DIM)])

    # Secondary buttons need a visible surface, or they read as plain text
    # against the panel background.
    style.configure("Small.TButton", background=BORDER, foreground=FG,
                    borderwidth=0, focusthickness=0, padding=(11, 5),
                    font=FONT_SMALL)
    style.map("Small.TButton",
              background=[("active", "#3a444f"), ("disabled", BG_PANEL)],
              foreground=[("disabled", FG_DIM)])

    style.configure("Accent.TButton", background=ACCENT, foreground="#ffffff",
                    font=FONT_BOLD, padding=(18, 10), borderwidth=0)
    style.map("Accent.TButton",
              background=[("active", ACCENT_DARK), ("disabled", BORDER)],
              foreground=[("disabled", FG_DIM)])

    style.configure("TNotebook", background=BG, borderwidth=0, tabmargins=0)
    style.configure("TNotebook.Tab", background=BG, foreground=FG_DIM,
                    padding=(16, 9), borderwidth=0, font=FONT)
    style.map("TNotebook.Tab",
              background=[("selected", BG_PANEL)],
              foreground=[("selected", FG)])

    style.configure("TCheckbutton", background=BG_PANEL, foreground=FG)
    style.map("TCheckbutton", background=[("active", BG_PANEL)])
    style.configure("TRadiobutton", background=BG, foreground=FG)
    style.map("TRadiobutton", background=[("active", BG)])

    style.configure("TCombobox", fieldbackground=BG_INPUT, background=BG_PANEL,
                    foreground=FG, arrowcolor=FG, selectbackground=BG_INPUT,
                    selectforeground=FG, padding=5)
    # A readonly combobox draws its field in the *state-mapped* colours, so
    # without this map it keeps the platform's light "selected" look and the
    # value appears permanently highlighted.
    style.map("TCombobox",
              fieldbackground=[("readonly", BG_INPUT), ("disabled", BG_PANEL)],
              selectbackground=[("readonly", BG_INPUT)],
              selectforeground=[("readonly", FG)],
              background=[("readonly", BG_PANEL), ("active", BG_PANEL)],
              foreground=[("readonly", FG), ("disabled", FG_DIM)],
              arrowcolor=[("readonly", FG_DIM), ("active", FG)])
    root.option_add("*TCombobox*Listbox.background", BG_INPUT)
    root.option_add("*TCombobox*Listbox.foreground", FG)
    root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")

    style.configure("TScale", background=BG_PANEL, troughcolor=BG_INPUT,
                    borderwidth=0)
    style.configure("Horizontal.TProgressbar", background=ACCENT,
                    troughcolor=BG_INPUT, borderwidth=0, thickness=8)
    style.configure("TSeparator", background=BORDER)
    style.configure("TLabelframe", background=BG_PANEL, foreground=FG,
                    borderwidth=1, relief="solid")
    style.configure("TLabelframe.Label", background=BG_PANEL, foreground=FG_DIM,
                    font=FONT_SMALL)
    return style
