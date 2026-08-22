# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Accent Voice Changer.

Builds a one-folder distribution containing two executables that share the
same runtime:

  AccentVoiceChanger.exe  windowed, opens the desktop window
  ravc.exe                console, the command line

One-folder rather than one-file on purpose: onnxruntime and CTranslate2
ship large native libraries, and a one-file build has to unpack all of them
to a temporary directory on every launch, which turns a fast start into a
five-second one.  The installer hides the folder anyway.
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files

SPEC_DIR = Path(SPECPATH).resolve()
ROOT = SPEC_DIR.parent
SRC = ROOT / "src"
ICON = ROOT / "assets" / "ravc.ico"

block_cipher = None

datas = [
    (str(SRC / "ravc" / "data"), "ravc/data"),
    (str(ROOT / "README.md"), "."),
    (str(ROOT / "LICENSE"), "."),
]
binaries = []
hiddenimports = [
    "ravc", "ravc.ui.gui", "ravc.ui.cli",
    "tkinter", "tkinter.ttk", "tkinter.filedialog", "tkinter.messagebox",
]

# Optional runtime dependencies: collect whatever is actually installed in
# the build environment, and simply leave out what is not.  The app already
# degrades gracefully when a backend is missing.
for package in ("onnxruntime", "ctranslate2", "faster_whisper", "av",
                "sounddevice", "soundfile", "edge_tts", "tokenizers",
                "huggingface_hub", "certifi",
                # sounddevice and soundfile are single modules, so their
                # bundled PortAudio/libsndfile binaries live in these separate
                # data packages and are missed by collecting the module name.
                "_sounddevice_data", "_soundfile_data"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    except Exception as exc:  # pragma: no cover - build-time only
        print(f"[ravc.spec] skipping optional package {package}: {exc}")
        continue
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

excludes = [
    "matplotlib", "PyQt5", "PyQt6", "PySide2", "PySide6", "IPython",
    "pandas", "notebook", "jupyter", "pytest", "setuptools._distutils",
    "tests",
    # scipy is only an optional fast path for streaming biquads; the shipped
    # app filters whole utterances through the FFT path in dsp.filters, so
    # bundling ~90 MB of it would buy nothing.
    "scipy",
    # hf_xet only speeds up Hugging Face downloads; huggingface_hub falls
    # back to plain HTTPS without it, for 12 MB less.
    "hf_xet",
    "torch", "torchaudio", "transformers", "onnx",
]

analysis = Analysis(
    [str(SPEC_DIR / "launcher.py")],
    pathex=[str(SRC)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(analysis.pure, analysis.zipped_data, cipher=block_cipher)

version_file = SPEC_DIR / "version_info.txt"
version_arg = str(version_file) if version_file.exists() else None
icon_arg = str(ICON) if ICON.exists() else None

gui_exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="AccentVoiceChanger",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # windowed: no console flashes on launch
    disable_windowed_traceback=False,
    icon=icon_arg,
    version=version_arg,
)

cli_exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="ravc",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,           # the CLI needs a console to print to
    disable_windowed_traceback=False,
    icon=icon_arg,
    version=version_arg,
)

coll = COLLECT(
    gui_exe,
    cli_exe,
    analysis.binaries,
    analysis.zipfiles,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="AccentVoiceChanger",
)
