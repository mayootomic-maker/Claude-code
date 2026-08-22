"""Checking for optional dependencies without importing them.

Several backends are optional (faster-whisper, onnxruntime, edge-tts,
sounddevice, pywin32).  Probing them with a bare ``import`` inside a
``try`` works but leaves an unused name behind and, worse, pays the
import cost just to answer a yes/no question that the UI asks on every
refresh.  ``find_spec`` answers it without executing the module.
"""

from __future__ import annotations

import importlib.util


def have(module: str) -> bool:
    """True when ``module`` is importable, without importing it."""
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError, AttributeError):
        # A parent package that is itself missing or broken raises here.
        return False
