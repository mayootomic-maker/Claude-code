using Xunit;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Platform.Windows.PresentMon;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// Turning a child process's death into something a user can act on.
/// </summary>
/// <remarks>
/// Exit code 6 covers every trace-session start failure, and the three common causes need three
/// different answers: join a Windows group, close an overlay, or nothing at all. Getting this
/// wrong sends a user to reinstall a driver over a group-membership problem.
/// </remarks>
public sealed class PresentMonInvocationTests
{
    private const string AccessDeniedWithGroupHint =
        "error: failed to start trace session: access denied.\n" +
        "       PresentMon requires either administrative privileges or to be run by a user in the\n" +
        "       \"Performance Log Users\" user group.  View the readme for more details.";

    private const string AccessDeniedWithoutGroupHint =
        "error: failed to start trace session: access denied.";

    private const string ProviderSlotsExhausted =
        "error: failed to start trace session: error code 1450.";

    [Fact]
    public void The_pinned_arguments_scope_the_capture_and_bound_the_child_lifetime()
    {
        var args = PresentMonInvocation.BuildArguments(4812);

        args.ShouldContain("--process_id");
        args.ShouldContain("4812");
        args.ShouldContain("--qpc_time");
        args.ShouldContain("--terminate_on_proc_exit");
        args.ShouldContain("--stop_existing_session");
        args.ShouldContain("--no_track_input");
        args.ShouldContain(PresentMonInvocation.SessionName);

        // Either metric-vocabulary flag drops columns the diagnostics read.
        args.ShouldNotContain("--v1_metrics");
        args.ShouldNotContain("--v2_metrics");
    }

    [Fact]
    public void An_invalid_process_id_is_refused_rather_than_passed_through()
    {
        Should.Throw<ArgumentOutOfRangeException>(() => PresentMonInvocation.BuildArguments(0));
    }

    [Fact]
    public void A_clean_exit_after_the_game_ended_is_not_a_fault()
    {
        var outcome = PresentMonInvocation.Classify(0, "", targetStillRunning: false);

        outcome.IsFault.ShouldBeFalse();
        outcome.Reason.ShouldBe(UnavailableReason.None);
    }

    [Fact]
    public void A_clean_exit_while_the_game_is_still_running_is_a_fault()
    {
        // Something stopped the child that was not the game ending. Restarting in a loop would
        // hide it and produce a session with unexplained holes in it.
        var outcome = PresentMonInvocation.Classify(0, "", targetStillRunning: true);

        outcome.IsFault.ShouldBeTrue();
        outcome.Reason.ShouldBe(UnavailableReason.SourceFaulted);
    }

    [Fact]
    public void Access_denied_naming_the_group_tells_the_user_which_group_to_join()
    {
        var outcome = PresentMonInvocation.Classify(6, AccessDeniedWithGroupHint, targetStillRunning: true);

        outcome.Reason.ShouldBe(UnavailableReason.InsufficientPrivilege);
        outcome.Detail.ShouldContain("Performance Log Users");
    }

    [Fact]
    public void Access_denied_without_the_group_hint_is_a_different_diagnosis()
    {
        // Upstream omits the group paragraph when the account IS already a member. Repeating
        // "join this group" there would send the user to do something they have already done.
        var outcome = PresentMonInvocation.Classify(6, AccessDeniedWithoutGroupHint, targetStillRunning: true);

        outcome.Reason.ShouldBe(UnavailableReason.InsufficientPrivilege);
        outcome.Detail.ShouldNotContain("Performance Log Users");
        outcome.Detail.ShouldContain("policy");
    }

    [Fact]
    public void A_bare_error_code_1450_is_recognised_as_exhausted_tracing_slots()
    {
        // Upstream prints no distinguishing words for this one, so the number is the only
        // evidence there is. It is also the most common real-world failure: overlays hold the
        // slots.
        var outcome = PresentMonInvocation.Classify(6, ProviderSlotsExhausted, targetStillRunning: true);

        outcome.Reason.ShouldBe(UnavailableReason.EtwProviderSlotsExhausted);
        outcome.Detail.ShouldContain("overlay");
    }

    [Fact]
    public void An_unhandled_exception_code_is_read_as_a_crash_even_when_the_game_ended()
    {
        // Windows returns the exception code as the exit code. 0xC0000005 is an access
        // violation; treating it as a clean shutdown would silently truncate the session.
        var outcome = PresentMonInvocation.Classify(unchecked((int)0xC0000005), "", targetStillRunning: false);

        outcome.IsFault.ShouldBeTrue();
        outcome.Reason.ShouldBe(UnavailableReason.SourceFaulted);
        outcome.Detail.ShouldContain("C0000005");
    }

    [Fact]
    public void An_unrecognised_exit_code_is_reported_rather_than_assumed_benign()
    {
        var outcome = PresentMonInvocation.Classify(4, "", targetStillRunning: true);

        outcome.IsFault.ShouldBeTrue();
        outcome.Detail.ShouldContain("4");
    }

    [Fact]
    public void The_warning_every_unelevated_run_prints_is_not_treated_as_a_problem()
    {
        // FrameDoctor runs unelevated by design, so this line appears on every healthy session.
        PresentMonInvocation.IsExpectedWarning(
            "warning: PresentMon requires elevated privilege in order to query processes that are")
            .ShouldBeTrue();
    }

    [Fact]
    public void A_genuine_error_line_is_not_swallowed_as_an_expected_warning()
    {
        PresentMonInvocation.IsExpectedWarning(ProviderSlotsExhausted).ShouldBeFalse();
    }

    [Fact]
    public void Lost_ETW_data_is_recognised_because_missing_frames_look_like_smooth_play()
    {
        PresentMonInvocation.ReportsLostData("warning: 412 ETW events were lost.").ShouldBeTrue();
        PresentMonInvocation.ReportsLostData("warning: 3 ETW buffers were lost.").ShouldBeTrue();
        PresentMonInvocation.ReportsLostData(
            "warning: 9 overflowed present events detected.").ShouldBeTrue();

        PresentMonInvocation.ReportsLostData(
            "warning: PresentMon requires elevated privilege").ShouldBeFalse();
    }
}
