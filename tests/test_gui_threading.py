"""The GUI must never touch Tk from a background thread.

Tkinter is not thread-safe, and that includes ``after()`` -- it mutates the
Tcl interpreter's event queue. The microphone level callback runs on
PortAudio's realtime thread roughly fifty times a second, so getting this
wrong is not a rare race: it is a constant stream of foreign-thread calls
into Tcl, and on Windows it crashes.
"""

from __future__ import annotations

import threading

import pytest

tk = pytest.importorskip("tkinter")


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("RAVC_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("RAVC_LOG_DIR", str(tmp_path / "logs"))
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("no display available")
    from ravc.ui.gui import AccentApp
    instance = AccentApp(root)
    yield instance
    instance._closing = True
    try:
        root.destroy()
    except tk.TclError:
        pass


def test_ui_calls_from_other_threads_never_reach_tk(app):
    """_ui must only enqueue; the Tk thread does the work."""
    main_thread = threading.current_thread()
    offenders = []

    original_after = app.root.after

    def watched_after(*args, **kwargs):
        if threading.current_thread() is not main_thread:
            offenders.append(threading.current_thread().name)
        return original_after(*args, **kwargs)

    app.root.after = watched_after

    ran = []
    barrier = threading.Barrier(9)

    def hammer(index: int) -> None:
        barrier.wait()
        for _ in range(200):
            app._ui(ran.append, index)
            app._set_level(0.5)

    threads = [threading.Thread(target=hammer, args=(i,), name=f"hammer-{i}")
               for i in range(8)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=10)

    assert not offenders, f"Tk was called from background threads: {offenders}"

    # Now let the Tk thread drain, and confirm the work actually happened.
    for _ in range(60):
        app._pump()
        app.root.update()
        if len(ran) >= 1600:
            break
    assert len(ran) == 1600, len(ran)


def test_level_updates_do_not_queue_up(app):
    """Levels arrive faster than the UI redraws; only the newest matters."""
    for value in range(500):
        app._set_level(value / 500.0)
    assert app._events.qsize() == 0
    assert app._pending_level == pytest.approx(499 / 500.0)


def test_pump_survives_a_failing_callback(app):
    """One bad callback must not stop the pump or take the window down."""
    def explode():
        raise RuntimeError("callback blew up")

    marker = []
    app._ui(explode)
    app._ui(marker.append, "still running")
    app._pump()
    assert marker == ["still running"]

    from ravc import diagnostics
    assert "callback blew up" in diagnostics.log_path().read_text(
        encoding="utf-8", errors="replace")


def test_pump_reschedules_itself_until_closed(app):
    assert app._pump_job is not None
    app._closing = True
    app._pump()
    job = app._pump_job
    app._pump()
    assert app._pump_job == job, "pump kept rescheduling after close"
