"""Entry point for the frozen application.

PyInstaller runs the entry script as ``__main__`` with no package context,
so ``src/ravc/__main__.py`` cannot be used directly -- its relative imports
(``from .ui.cli import main``) have no parent package to resolve against.
This launcher uses absolute imports instead.

Both bundled executables share this one script:

* ``AccentVoiceChanger.exe`` is launched with no arguments and opens the
  desktop window;
* ``ravc.exe`` is launched with arguments and runs the command line.
"""

import multiprocessing
import os
import sys


def main() -> int:
    # Required before anything spawns a worker in a frozen build on Windows,
    # or the child process re-runs the whole application.
    multiprocessing.freeze_support()

    # A windowed build has no stdout/stderr; anything that prints would raise.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")

    from ravc.ui.cli import main as cli_main
    return cli_main()


if __name__ == "__main__":
    sys.exit(main())
