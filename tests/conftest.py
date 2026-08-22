import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture(autouse=True)
def isolated_paths(tmp_path, monkeypatch):
    """Never touch the developer's real settings, voice models or log.

    The log matters as much as the rest: the packaged build's smoke test
    audits that file for unexpected ERROR lines, and a test suite that
    deliberately provokes handled failures was writing into it and failing
    the next build.
    """
    monkeypatch.setenv("RAVC_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("RAVC_MODELS_DIR", str(tmp_path / "voices"))
    monkeypatch.setenv("RAVC_LOG_DIR", str(tmp_path / "logs"))
    yield
