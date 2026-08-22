"""Entry points for `python -m ravc`, the `ravc` console script and the GUI."""

from __future__ import annotations

import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from .ui.cli import main as cli_main
    return cli_main(argv)


def main_gui() -> int:
    """Windowed entry point (no console)."""
    from .ui.gui import run_gui
    return run_gui()


if __name__ == "__main__":
    sys.exit(main())
