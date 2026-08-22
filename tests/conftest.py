import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture(autouse=True)
def isolated_paths(tmp_path, monkeypatch):
    """Never touch the developer's real settings or voice models."""
    monkeypatch.setenv("RAVC_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("RAVC_MODELS_DIR", str(tmp_path / "voices"))
    yield
