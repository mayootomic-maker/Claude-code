"""Tests for global hotkey parsing and the manager's lifecycle."""

from __future__ import annotations

import os

import pytest

from ravc import hotkeys
from ravc.hotkeys import (DEFAULTS, LABELS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
                          MOD_SHIFT, MOD_WIN, Binding, HotkeyManager, describe,
                          parse)


@pytest.mark.parametrize("spec, modifiers, key", [
    ("ctrl+alt+v", MOD_CONTROL | MOD_ALT, 0x56),
    ("shift+f9", MOD_SHIFT, 0x78),
    ("win+space", MOD_WIN, 0x20),
    ("CTRL + ALT + V", MOD_CONTROL | MOD_ALT, 0x56),
    ("f12", 0, 0x7B),
    ("ctrl+7", MOD_CONTROL, 0x37),
])
def test_parse_accepts_reasonable_shortcuts(spec, modifiers, key):
    parsed = parse(spec)
    assert parsed is not None, spec
    got_modifiers, got_key = parsed
    assert got_key == key
    # NOREPEAT is always added: holding the key must fire once, not stream.
    assert got_modifiers == modifiers | MOD_NOREPEAT


@pytest.mark.parametrize("spec", ["", "ctrl", "alt+shift", "nonsense",
                                  "ctrl+notakey", "+", None])
def test_parse_rejects_nonsense(spec):
    assert parse(spec) is None


def test_describe_is_human_readable():
    assert describe("ctrl+alt+v") == "Ctrl + Alt + V"
    assert describe("shift+f9") == "Shift + F9"
    assert describe("") == ""


def test_every_default_is_valid_and_labelled():
    for name, spec in DEFAULTS.items():
        assert name in LABELS, name
        if spec:
            assert parse(spec) is not None, (name, spec)


def test_defaults_do_not_collide():
    used = [spec for spec in DEFAULTS.values() if spec]
    assert len(used) == len(set(used))


def test_manager_is_inert_where_hotkeys_are_unsupported():
    """Everywhere but Windows this must no-op rather than pretend."""
    manager = HotkeyManager()
    fired = []
    manager.set_bindings({"test": Binding("ctrl+alt+v", lambda: fired.append(1))})
    started = manager.start()
    if os.name != "nt":
        assert started is False
        assert manager.running is False
        assert hotkeys.available() is False
        assert "Windows" in hotkeys.unavailable_reason()
    manager.stop()
    assert manager.running is False


def test_manager_without_bindings_does_not_start():
    manager = HotkeyManager()
    assert manager.start() is False
    manager.stop()


def test_stop_is_idempotent():
    manager = HotkeyManager()
    manager.set_bindings({"a": Binding("ctrl+alt+j", lambda: None)})
    manager.stop()
    manager.stop()
    assert manager.running is False


def test_set_bindings_replaces_rather_than_accumulates():
    manager = HotkeyManager()
    manager.set_bindings({"a": Binding("ctrl+alt+a", lambda: None)})
    manager.set_bindings({"b": Binding("ctrl+alt+b", lambda: None)})
    assert set(manager._bindings) == {"b"}


def test_config_round_trips_hotkeys(tmp_path, monkeypatch):
    monkeypatch.setenv("RAVC_CONFIG_DIR", str(tmp_path))
    from ravc.config import AppConfig

    config = AppConfig()
    assert config.behaviour.hotkeys["cycle_mode"] == DEFAULTS["cycle_mode"]
    config.behaviour.hotkeys["mute"] = "ctrl+shift+m"
    config.behaviour.hotkeys_enabled = False
    config.save()

    reloaded = AppConfig.load()
    assert reloaded.behaviour.hotkeys["mute"] == "ctrl+shift+m"
    assert reloaded.behaviour.hotkeys_enabled is False
