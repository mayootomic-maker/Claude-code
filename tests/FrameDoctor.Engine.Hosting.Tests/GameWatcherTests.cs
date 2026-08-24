using FrameDoctor.Abstractions.Time;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Pipeline.Attribution;
using Shouldly;
using Xunit;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// Assembling a candidate out of three sources that do not know about each other.
/// </summary>
/// <remarks>
/// The detector's own suite proves the gates. What only shows up here is the wiring: whether the
/// confirmed process keeps being polled once something else takes the foreground, and whether an
/// absent foreground reaches the detector as an absence rather than as a missed observation.
/// </remarks>
public sealed class GameWatcherTests
{
    private const string SystemRoot = @"C:\Windows";
    private const int OwnPid = 4242;
    private const int GamePid = 9001;
    private const string GamePath = @"D:\Games\Cyberpunk2077.exe";

    private static MonotonicTimestamp At(double seconds) =>
        MonotonicTimestamp.FromMilliseconds(seconds * 1000.0);

    /// <summary>A machine whose three sources can each be moved independently.</summary>
    private sealed class Machine
    {
        public ForegroundFacts? Foreground { get; set; } =
            new(GamePid, GamePath, "CD PROJEKT S.A.");

        public Dictionary<int, double?> ThreeD { get; } = new() { [GamePid] = 92.0 };

        public Dictionary<int, double?> Present { get; } = new() { [GamePid] = 144.0 };

        public GameWatcher Watcher(GameDetector? detector = null) => new(
            detector ?? new GameDetector(SystemRoot, OwnPid),
            () => Foreground,
            pid => ThreeD.TryGetValue(pid, out var v) ? v : null,
            pid => Present.TryGetValue(pid, out var v) ? v : null);
    }

    private static DetectionResult Confirm(GameWatcher watcher)
    {
        watcher.Poll(At(0));
        watcher.Poll(At(1));
        var result = watcher.Poll(At(2.5));
        result.State.ShouldBe(GameDetectionState.Playing);
        return result;
    }

    [Fact]
    public void Three_sources_together_confirm_a_game()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();

        var result = Confirm(watcher);

        result.ProcessId.ShouldBe(GamePid);
        watcher.Current.ShouldBe(result);
    }

    [Fact]
    public void A_change_of_belief_is_announced_once()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();

        var announced = new List<DetectionResult>();
        watcher.Changed += announced.Add;

        Confirm(watcher);
        watcher.Poll(At(3));
        watcher.Poll(At(3.5));

        // Confirmation is one change. Three further polls in the same state are not.
        announced.Count(r => r.State is GameDetectionState.Playing).ShouldBe(1);
    }

    [Fact]
    public void The_confirmed_process_keeps_being_polled_when_something_else_is_in_front()
    {
        // The wiring that makes stickiness real. Asking only about whatever holds the foreground
        // would lose the session at the first alt-tab.
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        machine.Foreground = new ForegroundFacts(77, @"D:\Apps\browser.exe", null);

        var result = watcher.Poll(At(4));

        result.State.ShouldBe(GameDetectionState.Background);
        result.ProcessId.ShouldBe(GamePid);
        result.GameForeground.ShouldBeFalse();
    }

    [Fact]
    public void A_backgrounded_game_returns_to_the_foreground_without_reconfirming()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        machine.Foreground = new ForegroundFacts(77, @"D:\Apps\browser.exe", null);
        watcher.Poll(At(4));

        machine.Foreground = new ForegroundFacts(GamePid, GamePath, "CD PROJEKT S.A.");
        var back = watcher.Poll(At(5));

        back.State.ShouldBe(GameDetectionState.Playing);
        back.GameForeground.ShouldBeTrue();
    }

    [Fact]
    public void No_foreground_at_all_does_not_end_a_confirmed_session()
    {
        // The lock screen. Ending here would split one evening into two sessions.
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        machine.Foreground = null;

        watcher.Poll(At(4)).IsConfirmed.ShouldBeTrue();
    }

    [Fact]
    public void No_foreground_resets_an_unconfirmed_candidate_s_dwell()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();

        watcher.Poll(At(0));
        machine.Foreground = null;
        watcher.Poll(At(1));

        machine.Foreground = new ForegroundFacts(GamePid, GamePath, "CD PROJEKT S.A.");
        watcher.Poll(At(2.5)).IsConfirmed.ShouldBeFalse();
    }

    [Fact]
    public void A_game_still_rendering_behind_a_lock_screen_stays_the_session()
    {
        // The GPU counters and our frame collector both still see it. Losing the foreground is
        // not losing the process.
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        machine.Foreground = null;

        for (var t = 3.0; t < 30; t += 1.0) watcher.Poll(At(t));

        watcher.Current.IsConfirmed.ShouldBeTrue();
    }

    [Fact]
    public void A_game_that_is_gone_from_every_source_ends_the_session()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        machine.Foreground = null;
        machine.ThreeD.Remove(GamePid);
        machine.Present.Remove(GamePid);

        watcher.Poll(At(4)).IsConfirmed.ShouldBeTrue();
        watcher.Poll(At(20)).State.ShouldBe(GameDetectionState.Idle);
    }

    [Fact]
    public void A_known_exit_ends_the_session_without_waiting_out_the_grace()
    {
        var machine = new Machine();
        var watcher = machine.Watcher();
        Confirm(watcher);

        watcher.End().State.ShouldBe(GameDetectionState.Idle);
    }

    [Fact]
    public void An_excluded_foreground_process_never_becomes_the_session()
    {
        var machine = new Machine { Foreground = new ForegroundFacts(500, @"C:\Windows\explorer.exe", null) };
        machine.ThreeD[500] = 99.0;
        machine.Present[500] = 144.0;

        var watcher = machine.Watcher();

        for (var t = 0.0; t < 20; t += 0.5) watcher.Poll(At(t));

        watcher.Current.IsConfirmed.ShouldBeFalse();
        watcher.Current.Exclusion.ShouldBe(ExclusionReason.SystemImage);
    }

    [Fact]
    public void A_missing_gpu_counter_prevents_confirmation_rather_than_being_read_as_idle()
    {
        var machine = new Machine();
        machine.ThreeD.Remove(GamePid);

        var watcher = machine.Watcher();
        for (var t = 0.0; t < 20; t += 0.5) watcher.Poll(At(t));

        watcher.Current.IsConfirmed.ShouldBeFalse();
        watcher.Current.Progress.ThreeDWork.ShouldBeFalse();
    }

    [Fact]
    public void Nothing_running_at_all_is_a_quiet_idle_rather_than_a_throw()
    {
        var machine = new Machine { Foreground = null };
        var watcher = machine.Watcher();

        var result = watcher.Poll(At(0));

        result.IsConfirmed.ShouldBeFalse();
        result.Explain().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public void The_watcher_refuses_to_be_built_without_its_sources()
    {
        var detector = new GameDetector(SystemRoot, OwnPid);

        Should.Throw<ArgumentNullException>(() => new GameWatcher(null!, () => null, _ => null, _ => null));
        Should.Throw<ArgumentNullException>(() => new GameWatcher(detector, null!, _ => null, _ => null));
        Should.Throw<ArgumentNullException>(() => new GameWatcher(detector, () => null, null!, _ => null));
        Should.Throw<ArgumentNullException>(() => new GameWatcher(detector, () => null, _ => null, null!));
    }
}
