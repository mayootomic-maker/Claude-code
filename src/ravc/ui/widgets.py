"""Custom widgets.

Tk has no rounded panel, no segmented control and no toggle switch, and
its stock equivalents are what make a Tk app look like a Tk app. These are
drawn on a Canvas instead.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable, List, Optional, Sequence

from . import theme


def rounded_rect(canvas: tk.Canvas, x0: float, y0: float, x1: float, y1: float,
                 radius: float, **kwargs) -> int:
    """A rounded rectangle as a smoothed polygon."""
    radius = max(0.0, min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
    points = [
        x0 + radius, y0, x1 - radius, y0, x1, y0, x1, y0 + radius,
        x1, y1 - radius, x1, y1, x1 - radius, y1, x0 + radius, y1,
        x0, y1, x0, y1 - radius, x0, y0 + radius, x0, y0,
    ]
    return canvas.create_polygon(points, smooth=True, splinesteps=16, **kwargs)


class Card(tk.Frame):
    """A padded panel with rounded corners.

    The rounding is painted onto a background Canvas that sits behind the
    content, because Tk frames cannot have a radius.
    """

    def __init__(self, master: tk.Misc, title: str = "", subtitle: str = "",
                 padding: int = 18, radius: int = 14,
                 background: str = theme.BG_CARD,
                 parent_background: str = theme.BG) -> None:
        super().__init__(master, bg=parent_background, highlightthickness=0, bd=0)
        self._background = background
        self._radius = radius

        self._canvas = tk.Canvas(self, bg=parent_background,
                                 highlightthickness=0, bd=0)
        self._canvas.place(x=0, y=0, relwidth=1, relheight=1)
        self._shape = rounded_rect(self._canvas, 0, 0, 10, 10, radius,
                                   fill=background, outline="")
        self._canvas.bind("<Configure>", self._redraw)

        self.inner = tk.Frame(self, bg=background, highlightthickness=0, bd=0)
        self.inner.pack(fill="both", expand=True, padx=padding, pady=padding)

        if title:
            tk.Label(self.inner, text=title, bg=background, fg=theme.FG,
                     font=theme.Fonts.heading, anchor="w").pack(fill="x")
        if subtitle:
            tk.Label(self.inner, text=subtitle, bg=background,
                     fg=theme.FG_MUTED, font=theme.Fonts.small, anchor="w",
                     justify="left", wraplength=560).pack(fill="x",
                                                          pady=(3, 10))
        elif title:
            tk.Frame(self.inner, bg=background, height=10).pack(fill="x")

    def _redraw(self, event) -> None:
        self._canvas.coords(
            self._shape,
            *self._rounded_points(0, 0, event.width, event.height))

    def _rounded_points(self, x0, y0, x1, y1) -> List[float]:
        r = max(0.0, min(self._radius, (x1 - x0) / 2, (y1 - y0) / 2))
        return [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r,
                x1, y1 - r, x1, y1, x1 - r, y1, x0 + r, y1,
                x0, y1 - r, x0, y0 + r, x0, y0]

    def body(self) -> tk.Frame:
        frame = tk.Frame(self.inner, bg=self._background, highlightthickness=0,
                         bd=0)
        frame.pack(fill="both", expand=True)
        return frame


class SegmentedControl(tk.Canvas):
    """A pill-shaped multiple choice, like a mode switch."""

    def __init__(self, master: tk.Misc, options: Sequence[str],
                 command: Optional[Callable[[str], None]] = None,
                 background: str = theme.BG_CARD, height: int = 40,
                 width: int = 360) -> None:
        super().__init__(master, height=height, width=width, bg=background,
                         highlightthickness=0, bd=0)
        # NB: not "_options" -- that name belongs to tkinter.Misc and is
        # called internally by pack_configure.
        self._choices = list(options)
        self._command = command
        self._value = self._choices[0] if self._choices else ""
        self._background = background
        self.bind("<Configure>", lambda _e: self._draw())
        self.bind("<Button-1>", self._clicked)
        self._draw()

    @property
    def value(self) -> str:
        return self._value

    def set(self, value: str, notify: bool = False) -> None:
        if value not in self._choices:
            return
        self._value = value
        self._draw()
        if notify and self._command:
            self._command(value)

    def _clicked(self, event) -> None:
        if not self._choices:
            return
        index = int(event.x / max(1, self.winfo_width() / len(self._choices)))
        index = max(0, min(index, len(self._choices) - 1))
        if self._choices[index] != self._value:
            self.set(self._choices[index], notify=True)

    def _draw(self) -> None:
        self.delete("all")
        width = self.winfo_width() or int(self["width"])
        height = self.winfo_height() or int(self["height"])
        if not self._choices or width < 10:
            return
        rounded_rect(self, 0, 0, width, height, height / 2,
                     fill=theme.BG_INPUT, outline="")
        segment = width / len(self._choices)
        for index, option in enumerate(self._choices):
            x0 = index * segment
            selected = option == self._value
            if selected:
                rounded_rect(self, x0 + 3, 3, x0 + segment - 3, height - 3,
                             (height - 6) / 2, fill=theme.ACCENT, outline="")
            self.create_text(x0 + segment / 2, height / 2, text=option,
                             fill="#ffffff" if selected else theme.FG_MUTED,
                             font=theme.Fonts.strong if selected
                             else theme.Fonts.body)


class Toggle(tk.Canvas):
    """An on/off switch."""

    def __init__(self, master: tk.Misc, command: Optional[Callable[[bool], None]] = None,
                 value: bool = False, background: str = theme.BG_CARD) -> None:
        super().__init__(master, width=44, height=24, bg=background,
                         highlightthickness=0, bd=0)
        self._value = value
        self._command = command
        self.bind("<Button-1>", self._clicked)
        self._draw()

    @property
    def value(self) -> bool:
        return self._value

    def set(self, value: bool, notify: bool = False) -> None:
        self._value = bool(value)
        self._draw()
        if notify and self._command:
            self._command(self._value)

    def _clicked(self, _event) -> None:
        self.set(not self._value, notify=True)

    def _draw(self) -> None:
        self.delete("all")
        rounded_rect(self, 1, 3, 43, 21, 9,
                     fill=theme.ACCENT if self._value else theme.BG_INPUT,
                     outline="")
        x = 32 if self._value else 12
        self.create_oval(x - 8, 4, x + 8, 20, fill="#ffffff", outline="")


class NavButton(tk.Canvas):
    """One entry in the sidebar."""

    def __init__(self, master: tk.Misc, label: str, glyph: str,
                 command: Callable[[], None]) -> None:
        super().__init__(master, height=40, bg=theme.BG_NAV,
                         highlightthickness=0, bd=0)
        self._label = label
        self._glyph = glyph
        self._command = command
        self._selected = False
        self._hover = False
        self.bind("<Configure>", lambda _e: self._draw())
        self.bind("<Button-1>", lambda _e: command())
        self.bind("<Enter>", self._entered)
        self.bind("<Leave>", self._left)
        self._draw()

    def _entered(self, _event) -> None:
        self._hover = True
        self.configure(cursor="hand2")
        self._draw()

    def _left(self, _event) -> None:
        self._hover = False
        self._draw()

    def set_selected(self, selected: bool) -> None:
        self._selected = selected
        self._draw()

    def _draw(self) -> None:
        self.delete("all")
        width = self.winfo_width() or 180
        height = self.winfo_height() or 40
        if self._selected:
            rounded_rect(self, 8, 3, width - 8, height - 3, 8,
                         fill=theme.BG_HOVER, outline="")
            self.create_rectangle(8, height / 2 - 9, 11, height / 2 + 9,
                                  fill=theme.ACCENT, outline="")
        elif self._hover:
            rounded_rect(self, 8, 3, width - 8, height - 3, 8,
                         fill=theme.BORDER_SOFT, outline="")
        colour = theme.FG if self._selected else theme.FG_MUTED
        self.create_text(28, height / 2, text=self._glyph, anchor="w",
                         font=(theme.Fonts.family, 12), fill=colour)
        self.create_text(52, height / 2, text=self._label, anchor="w",
                         font=theme.Fonts.strong if self._selected
                         else theme.Fonts.body, fill=colour)


class LevelMeter(tk.Canvas):
    """A segmented level meter with a decaying peak marker."""

    def __init__(self, master: tk.Misc, width: int = 220, height: int = 10,
                 segments: int = 32, background: str = theme.BG_CARD) -> None:
        super().__init__(master, width=width, height=height, bg=background,
                         highlightthickness=0, bd=0)
        self._segments = segments
        self._level = 0.0
        self._peak = 0.0
        self._rects: List[int] = []
        gap = 2
        segment_width = (width - gap * (segments - 1)) / segments
        for index in range(segments):
            x0 = index * (segment_width + gap)
            self._rects.append(self.create_rectangle(
                x0, 0, x0 + segment_width, height, outline="",
                fill=theme.BORDER_SOFT))

    def set_level(self, value: float) -> None:
        self._level = max(0.0, min(1.0, float(value)))
        self._peak = max(self._peak * 0.9, self._level)
        lit = int(self._level * self._segments)
        peak_index = int(self._peak * self._segments)
        for index, rect in enumerate(self._rects):
            ratio = index / max(1, self._segments - 1)
            if index < lit:
                colour = (theme.OK if ratio < 0.7
                          else theme.WARN if ratio < 0.9 else theme.ACCENT)
            elif index == peak_index and peak_index > 0:
                colour = theme.FG_FAINT
            else:
                colour = theme.BORDER_SOFT
            self.itemconfigure(rect, fill=colour)

    def reset(self) -> None:
        self._level = self._peak = 0.0
        self.set_level(0.0)


class StatusDot(tk.Canvas):
    """A coloured dot and a word, for the current state."""

    def __init__(self, master: tk.Misc, width: int = 130,
                 background: str = theme.BG) -> None:
        super().__init__(master, width=width, height=26, bg=background,
                         highlightthickness=0, bd=0)
        self._dot = self.create_oval(3, 9, 13, 19, outline="",
                                     fill=theme.FG_FAINT)
        self._text = self.create_text(21, 14, anchor="w", text="Stopped",
                                      fill=theme.FG, font=theme.Fonts.body)

    def set_state(self, state: str) -> None:
        self.itemconfigure(self._dot,
                           fill=theme.STATE_COLOURS.get(state, theme.FG_FAINT))
        self.itemconfigure(self._text, text=state.capitalize())


class Slider(tk.Frame):
    """A labelled slider with a live readout."""

    def __init__(self, master: tk.Misc, label: str, minimum: float,
                 maximum: float, value: float,
                 on_change: Optional[Callable[[float], None]] = None,
                 fmt: str = "{:+.1f}", suffix: str = "",
                 background: str = theme.BG_CARD) -> None:
        super().__init__(master, bg=background, highlightthickness=0, bd=0)
        self._on_change = on_change
        self._fmt = fmt
        self._suffix = suffix
        self.var = tk.DoubleVar(value=value)

        header = tk.Frame(self, bg=background, highlightthickness=0, bd=0)
        header.pack(fill="x")
        tk.Label(header, text=label, bg=background, fg=theme.FG,
                 font=theme.Fonts.body, anchor="w").pack(side="left")
        self._readout = tk.Label(header, text=self._format(value),
                                 bg=background, fg=theme.FG_MUTED,
                                 font=theme.Fonts.code)
        self._readout.pack(side="right")

        ttk.Scale(self, from_=minimum, to=maximum, variable=self.var,
                  command=self._changed).pack(fill="x", pady=(3, 0))

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


def scrollable(master: tk.Misc, background: str = theme.BG) -> ttk.Frame:
    """A vertically scrollable frame that follows the mouse wheel."""
    outer = ttk.Frame(master)
    canvas = tk.Canvas(outer, bg=background, highlightthickness=0, bd=0)
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
