using FrameDoctor.Abstractions.Time;
using FrameDoctor.Pipeline.Attribution;
using Shouldly;
using Xunit;

namespace FrameDoctor.Pipeline.Tests;

/// <summary>
/// Which process, if any, is the game.
/// </summary>
/// <remarks>
/// Two opposite failures are both fatal and both are asserted against: attaching to something
/// that is not a game, which makes every number on screen describe the wrong process, and
/// dropping a real session at the first alt-tab, which splits one session into several and gives
/// a baseline a machine that restarts the game every few minutes.
/// </remarks>
public sealed class GameDetectorTests
{
    private const string SystemRoot = @"C:\Windows";
    private const int OwnPid = 4242;
    private const int GamePid = 9001;

    private static MonotonicTimestamp At(double seconds) =>
        MonotonicTimestamp.FromMilliseconds(seconds * 1000.0);

    private static GameDetector Detector(
        string? systemRoot = SystemRoot,
        GameDetectorOptions? options = null) =>
        new(systemRoot, OwnPid, options);

    private static GameCandidate Playing(
        double atSeconds,
        int pid = GamePid,
        string path = @"D:\Games\Cyberpunk2077\bin\x64\Cyberpunk2077.exe",
        string? signer = "CD PROJEKT S.A.",
        bool foreground = true,
        double? gpu = 92.0,
        double? presentHz = 144.0) =>
        new(pid, path, signer, foreground, gpu, presentHz, At(atSeconds));

    /// <summary>Drives the detector to a confirmed session and returns it.</summary>
    private static GameDetector Confirmed(out DetectionResult result, GameDetector? detector = null)
    {
        var d = detector ?? Detector();
        d.Observe(Playing(0));
        d.Observe(Playing(1));
        result = d.Observe(Playing(2.5));
        result.State.ShouldBe(GameDetectionState.Playing);
        return d;
    }

    // ---- Gate A: unoverridable exclusions -----------------------------------------------

    [Fact]
    public void A_windows_process_is_excluded_however_convincing_it_looks()
    {
        var detector = Detector();

        for (var t = 0.0; t < 10; t += 0.5)
        {
            var result = detector.Observe(Playing(t, pid: 500, path: @"C:\Windows\explorer.exe"));
            result.Exclusion.ShouldBe(ExclusionReason.SystemImage);
            result.IsConfirmed.ShouldBeFalse();
        }
    }

    [Fact]
    public void A_path_that_merely_starts_with_the_windows_directory_is_not_under_it()
    {
        // A prefix test alone would have excluded this. The boundary is a separator.
        var detector = Detector();

        detector.Observe(Playing(0, path: @"C:\Windows-Games\game.exe"))
            .Exclusion.ShouldBe(ExclusionReason.None);
    }

    [Fact]
    public void We_are_never_the_game()
    {
        Detector().Observe(Playing(0, pid: OwnPid))
            .Exclusion.ShouldBe(ExclusionReason.OwnProcess);
    }

    [Fact]
    public void An_unknown_system_directory_excludes_everything_rather_than_nothing()
    {
        // Fails closed. Treating an unreadable system path as "nothing is under it" would attach
        // the profiler to a Windows process and report its frame pacing as the user's game.
        foreach (var root in new string?[] { null, "", "   " })
        {
            var result = Detector(systemRoot: root).Observe(Playing(0));

            result.Exclusion.ShouldBe(ExclusionReason.UnknownSystemRoot);
            result.IsConfirmed.ShouldBeFalse();
            result.Explain().ShouldContain("could not be determined");
        }
    }

    [Fact]
    public void A_launcher_is_excluded_when_the_filename_and_the_signer_both_match()
    {
        // Big Picture Mode is fullscreen, sustained 3D and foreground: it passes every positive
        // signal there is.
        var result = Detector().Observe(Playing(
            0, pid: 700, path: @"C:\Program Files (x86)\Steam\steam.exe",
            signer: "Valve Corp."));

        result.Exclusion.ShouldBe(ExclusionReason.KnownLauncher);
        result.Explain().ShouldContain("separate process");
    }

    [Fact]
    public void A_binary_renamed_to_a_launcher_does_not_ride_the_deny_list()
    {
        Detector().Observe(Playing(
            0, path: @"D:\Games\steam.exe", signer: "Some Other Publisher"))
            .Exclusion.ShouldBe(ExclusionReason.None);
    }

    [Fact]
    public void A_game_shipping_a_launcher_shaped_filename_is_not_silently_excluded()
    {
        Detector().Observe(Playing(
            0, path: @"D:\Games\Anno\Origin.exe", signer: "Ubisoft Entertainment"))
            .Exclusion.ShouldBe(ExclusionReason.None);
    }

    [Fact]
    public void An_unverifiable_signature_does_not_exclude()
    {
        // The deliberate direction to fail, and the branch someone will later "fix" into a
        // filename match. Measuring a launcher wastes a session and is visible on screen;
        // excluding a real game because its signature could not be read measures nothing at all.
        foreach (var signer in new string?[] { null, "" })
        {
            Detector().Observe(Playing(
                0, pid: 700, path: @"C:\Program Files (x86)\Steam\steam.exe", signer: signer))
                .Exclusion.ShouldBe(ExclusionReason.None);
        }
    }

    [Fact]
    public void Exclusion_is_decided_before_any_positive_evidence()
    {
        // "Unoverridable" made concrete: perfect Gate B evidence does not promote an excluded
        // process at any point.
        var detector = Detector();

        for (var t = 0.0; t < 30; t += 0.5)
        {
            detector.Observe(Playing(t, pid: 500, path: @"C:\Windows\System32\dwm.exe"));
        }

        detector.State.ShouldNotBe(GameDetectionState.Playing);
        detector.ConfirmedProcessId.ShouldBeNull();
    }

    // ---- Gate B: a conjunction, not a score ---------------------------------------------

    [Fact]
    public void All_three_signals_confirm()
    {
        Confirmed(out var result);

        result.ProcessId.ShouldBe(GamePid);
        result.Progress.AllMet.ShouldBeTrue();
        result.GameForeground.ShouldBeTrue();
        result.Changed.ShouldBeTrue();
    }

    [Fact]
    public void Two_strong_signals_never_carry_a_missing_third()
    {
        // The reason this is a conjunction. A weighted score would confirm each of these.
        var withoutGpu = Detector();
        var withoutFrames = Detector();
        var withoutForeground = Detector();

        for (var t = 0.0; t < 20; t += 0.5)
        {
            withoutGpu.Observe(Playing(t, gpu: 2.0));
            withoutFrames.Observe(Playing(t, presentHz: 3.0));
            withoutForeground.Observe(Playing(t, foreground: false));
        }

        withoutGpu.ConfirmedProcessId.ShouldBeNull();
        withoutFrames.ConfirmedProcessId.ShouldBeNull();
        withoutForeground.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void A_signal_that_could_not_be_read_is_not_a_signal_that_was_met()
    {
        // Null is not zero and is not "below threshold". Confirming on evidence that was never
        // gathered is the failure the whole telemetry model exists to prevent.
        var noGpuCounters = Detector();
        var noFrameSource = Detector();

        for (var t = 0.0; t < 20; t += 0.5)
        {
            noGpuCounters.Observe(Playing(t, gpu: null));
            noFrameSource.Observe(Playing(t, presentHz: null));
        }

        noGpuCounters.ConfirmedProcessId.ShouldBeNull();
        noFrameSource.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void A_candidate_says_what_it_is_still_missing()
    {
        var detector = Detector();
        detector.Observe(Playing(0, gpu: 1.0, presentHz: null));
        var result = detector.Observe(Playing(1, gpu: 1.0, presentHz: null));

        result.Progress.Missing.ShouldContain("is not doing sustained 3D work");
        result.Progress.Missing.ShouldContain("is not presenting frames we can see");
        result.Explain().ShouldContain("Watching a candidate");
    }

    [Fact]
    public void A_burst_of_gpu_work_is_not_a_game()
    {
        // A loading screen. One observation of high utilization is not "sustained".
        var detector = Detector();

        detector.Observe(Playing(0, gpu: 1.0, presentHz: 1.0));
        detector.Observe(Playing(0.2));

        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void Dwell_is_time_held_continuously_not_time_accumulated()
    {
        // Alt-tabbing between two windows must not bank seconds toward either of them.
        var detector = Detector();

        detector.Observe(Playing(0));
        detector.Observe(Playing(1.5, foreground: false));
        detector.Observe(Playing(2.5));

        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void A_different_candidate_starts_its_own_evidence()
    {
        var detector = Detector();

        detector.Observe(Playing(0));
        detector.Observe(Playing(1.5, pid: 1234, path: @"D:\Other\other.exe"));
        detector.Observe(Playing(2.5));

        // The second candidate's clock started at 1.5 s, so by 2.5 s neither has held long
        // enough. Sharing the clock would have confirmed one of them on the other's evidence.
        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void The_thresholds_are_the_ones_the_options_say_they_are()
    {
        var permissive = new GameDetectorOptions
        {
            ForegroundDwell = TimeSpan.Zero,
            SustainedFor = TimeSpan.Zero,
            MinimumThreeDPercent = 1.0,
            MinimumPresentRateHz = 1.0,
        };

        Detector(options: permissive).Observe(Playing(0, gpu: 1.5, presentHz: 1.5))
            .State.ShouldBe(GameDetectionState.Playing);
    }

    // ---- Stickiness ----------------------------------------------------------------------

    [Fact]
    public void Alt_tabbing_does_not_end_the_session()
    {
        var detector = Confirmed(out _);

        var result = detector.Observe(Playing(5, foreground: false));

        result.State.ShouldBe(GameDetectionState.Background);
        result.IsConfirmed.ShouldBeTrue();
        result.ProcessId.ShouldBe(GamePid);
        result.Changed.ShouldBeTrue();
    }

    [Fact]
    public void Background_frames_are_tagged_so_they_are_not_compared_against_foreground_ones()
    {
        // A minimised game legitimately drops to low QoS and its frame rate legitimately
        // collapses. Mixing those frames into the session median would describe neither state.
        var detector = Confirmed(out _);

        detector.Observe(Playing(5, foreground: false)).GameForeground.ShouldBeFalse();
        detector.Observe(Playing(6)).GameForeground.ShouldBeTrue();
    }

    [Fact]
    public void A_backgrounded_game_whose_frame_rate_collapses_stays_the_session()
    {
        var detector = Confirmed(out _);

        var result = detector.Observe(Playing(5, foreground: false, gpu: 0.0, presentHz: 0.0));

        result.IsConfirmed.ShouldBeTrue();
        result.State.ShouldBe(GameDetectionState.Background);
    }

    [Fact]
    public void Another_process_taking_the_foreground_does_not_steal_the_session()
    {
        var detector = Confirmed(out _);

        for (var t = 5.0; t < 20; t += 0.5)
        {
            detector.Observe(Playing(t, pid: 77, path: @"D:\Apps\browser.exe"));
        }

        detector.ConfirmedProcessId.ShouldBe(GamePid);
    }

    [Fact]
    public void The_session_ends_when_the_process_is_gone_for_long_enough()
    {
        var detector = Confirmed(out _);

        detector.NoteMissing(At(4)).Changed.ShouldBeFalse();

        var ended = detector.NoteMissing(At(20));

        ended.Changed.ShouldBeTrue();
        ended.State.ShouldBe(GameDetectionState.Idle);
        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void One_missed_poll_does_not_split_a_session_in_two()
    {
        // Ending on the first miss would give a baseline a machine that restarts the game every
        // few minutes.
        var detector = Confirmed(out _);

        detector.NoteMissing(At(3)).State.ShouldBe(GameDetectionState.Playing);
        detector.Observe(Playing(4)).State.ShouldBe(GameDetectionState.Playing);
        detector.NoteMissing(At(6)).State.ShouldBe(GameDetectionState.Playing);

        detector.ConfirmedProcessId.ShouldBe(GamePid);
    }

    [Fact]
    public void A_known_process_exit_ends_the_session_at_once()
    {
        var detector = Confirmed(out _);

        var ended = detector.End();

        ended.State.ShouldBe(GameDetectionState.Idle);
        ended.Changed.ShouldBeTrue();
        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void Ending_an_idle_detector_changes_nothing()
    {
        Detector().End().Changed.ShouldBeFalse();
    }

    [Fact]
    public void A_new_game_can_be_confirmed_after_the_last_one_ended()
    {
        var detector = Confirmed(out _);
        detector.End();

        detector.Observe(Playing(10, pid: 555, path: @"D:\Games\other.exe"));
        detector.Observe(Playing(11, pid: 555, path: @"D:\Games\other.exe"));
        var again = detector.Observe(Playing(12.5, pid: 555, path: @"D:\Games\other.exe"));

        again.State.ShouldBe(GameDetectionState.Playing);
        again.ProcessId.ShouldBe(555);
    }

    [Fact]
    public void Every_state_explains_itself_without_inventing_a_reason()
    {
        var detector = Detector();

        detector.Observe(Playing(0, pid: OwnPid)).Explain().ShouldContain("FrameDoctor itself");
        Detector().Observe(Playing(0, pid: 5, path: @"C:\Windows\explorer.exe"))
            .Explain().ShouldContain("part of Windows");

        var confirmed = Confirmed(out var playing);
        playing.Explain().ShouldContain("Measuring process");
        confirmed.Observe(Playing(5, foreground: false)).Explain().ShouldContain("kept separately");
        confirmed.End().Explain().ShouldBe("Nothing is being measured.");
    }

    [Fact]
    public void A_stretch_with_no_foreground_resets_a_candidate_s_dwell()
    {
        // The lock screen. Without this the candidate banks the seconds it held before the
        // screen locked and confirms on time it was not actually in front.
        var detector = Detector();

        detector.Observe(Playing(0));
        detector.NoteNoForeground(At(1));
        detector.Observe(Playing(2.5));

        detector.ConfirmedProcessId.ShouldBeNull();
    }

    [Fact]
    public void A_stretch_with_no_foreground_does_not_end_a_confirmed_session()
    {
        // A lock screen is not a game exiting.
        var detector = Confirmed(out _);

        detector.NoteNoForeground(At(4)).IsConfirmed.ShouldBeTrue();
        detector.ConfirmedProcessId.ShouldBe(GamePid);
    }

    [Fact]
    public void A_long_stretch_with_no_foreground_does_end_one()
    {
        var detector = Confirmed(out _);

        detector.NoteNoForeground(At(30)).State.ShouldBe(GameDetectionState.Idle);
    }

    [Fact]
    public void Observing_a_candidate_with_no_image_path_is_rejected_rather_than_guessed_at()
    {
        Should.Throw<ArgumentNullException>(() =>
            Detector().Observe(new GameCandidate(1, null!, null, true, 90, 144, At(0))));
    }
}
