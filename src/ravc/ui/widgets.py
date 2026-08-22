"""Small custom widgets used by the desktop window."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable, Optional

from . import theme


class LevelMeter(tk.Canvas):
    """A segmented microphone-level meter with a slow-decay peak marker."""

    def __init__(self, master: tk.Misc, width: int = 260, height: int = 14,
                 segments: int = 28) -> None:
        super().__init__(master, width=width, height=height, bg=theme.BG_INPUT,
                         highlightthickness=0, bd=0)
        self._segments = segments
        self._width = width
        self._height = height
        self._level = 0.0
        self._peak = 0.0
        self._rects = []
        gap = 2
        seg_w = (width - gap * (segments - 1)) / segments
        for i in range(segments):
            x0 = i * (seg_w + gap)
            self._rects.append(self.create_rectangle(
                x0, 0, x0 + seg_w, height, outline="", fill=theme.BORDER))

    def set_level(self, value: float) -> None:
        self._level = max(0.0, min(1.0, float(value)))
        self._peak = max(self._peak * 0.93, self._level)
        lit = int(self._level * self._segments)
        peak_index = int(self._peak * self._segments)
        for i, rect in enumerate(self._rects):
            if i < lit:
                ratio = i / max(1, self._segments - 1)
                colour = (theme.OK if ratio < 0.65
                          else theme.WARN if ratio < 0.87 else theme.ACCENT)
            elif i == peak_index and peak_index > 0:
                colour = theme.FG_DIM
            else:
                colour = theme.BORDER
            self.itemconfigure(rect, fill=colour)

    def reset(self) -> None:
        self._level = self._peak = 0.0
        self.set_level(0.0)


class StatusPill(tk.Canvas):
    """A coloured dot plus a word, for the pipeline state."""

    COLOURS = {
        "stopped": theme.FG_DIM,
        "starting": theme.WARN,
        "listening": theme.OK,
        "thinking": theme.WARN,
        "speaking": theme.ACCENT,
        "error": theme.ACCENT,
    }

    def __init__(self, master: tk.Misc, width: int = 150) -> None:
        super().__init__(master, width=width, height=24, bg=theme.BG,
                         highlightthickness=0, bd=0)
        self._dot = self.create_oval(4, 8, 14, 18, outline="",
                                     fill=theme.FG_DIM)
        self._text = self.create_text(22, 13, anchor="w", text="Stopped",
                                      fill=theme.FG, font=theme.FONT)

    def set_state(self, state: str) -> None:
        colour = self.COLOURS.get(state, theme.FG_DIM)
        self.itemconfigure(self._dot, fill=colour)
        self.itemconfigure(self._text, text=state.capitalize())


class LabelledSlider(ttk.Frame):
    """A slider with a caption and a live value readout."""

    def __init__(self, master: tk.Misc, label: str, minimum: float,
                 maximum: float, value: float,
                 on_change: Optional[Callable[[float], None]] = None,
                 fmt: str = "{:+.1f}", suffix: str = "",
                 style_prefix: str = "Panel") -> None:
        super().__init__(master, style=f"{style_prefix}.TFrame")
        self._on_change = on_change
        self._fmt = fmt
        self._suffix = suffix
        self.var = tk.DoubleVar(value=value)

        header = ttk.Frame(self, style=f"{style_prefix}.TFrame")
        header.pack(fill="x")
        ttk.Label(header, text=label,
                  style=f"{style_prefix}.TLabel").pack(side="left")
        self._readout = ttk.Label(header, text=self._format(value),
                                  style=f"{style_prefix}Dim.TLabel")
        self._readout.pack(side="right")

        self._scale = ttk.Scale(self, from_=minimum, to=maximum,
                                variable=self.var, command=self._changed)
        self._scale.pack(fill="x", pady=(2, 0))

    def _format(self, value: float) -> str:
        return self._fmt.format(value) + self._suffix

    def _changed(self, _value) -> None:
        current = self.var.get()
        self._readout.configure(text=self._format(current))
        if self._on_change:
            self._on_change(current)

    def set(self, value: float) -> None:
        self.var.set(value)
        self._readout.configure(text=self._format(value))

    def get(self) -> float:
        return self.var.get()


class Card(ttk.Frame):
    """A titled panel."""

    def __init__(self, master: tk.Misc, title: str = "",
                 subtitle: str = "") -> None:
        super().__init__(master, style="Panel.TFrame", padding=14)
        if title:
            ttk.Label(self, text=title, style="PanelHead.TLabel").pack(
                anchor="w")
        if subtitle:
            ttk.Label(self, text=subtitle, style="PanelDim.TLabel",
                      wraplength=520, justify="left").pack(anchor="w",
                                                           pady=(1, 8))
        elif title:
            ttk.Frame(self, style="Panel.TFrame", height=8).pack()

    def body(self) -> ttk.Frame:
        frame = ttk.Frame(self, style="Panel.TFrame")
        frame.pack(fill="both", expand=True)
        return frame


def scrollable(master: tk.Misc) -> ttk.Frame:
    """A vertically scrollable frame that also responds to the mouse wheel."""
    outer = ttk.Frame(master)
    canvas = tk.Canvas(outer, bg=theme.BG, highlightthickness=0, bd=0)
    scrollbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
    inner = ttk.Frame(canvas)

    window = canvas.create_window((0, 0), window=inner, anchor="nw")
    canvas.configure(yscrollcommand=scrollbar.set)
    canvas.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")

    def on_configure(_event=None) -> None:
        canvas.configure(scrollregion=canvas.bbox("all"))
        canvas.itemconfigure(window, width=canvas.winfo_width())

    inner.bind("<Configure>", on_configure)
    canvas.bind("<Configure>", on_configure)

    def on_wheel(event) -> None:
        delta = event.delta
        if delta == 0:
            delta = 120 if getattr(event, "num", 5) == 4 else -120
        canvas.yview_scroll(int(-delta / 120), "units")

    for widget in (canvas, inner):
        widget.bind("<MouseWheel>", on_wheel)
        widget.bind("<Button-4>", on_wheel)
        widget.bind("<Button-5>", on_wheel)

    outer.inner = inner  # type: ignore[attr-defined]
    return outer
