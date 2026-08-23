using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// The deny-list, which is the feature.
/// </summary>
/// <remarks>
/// Anyone can call an API that slows a process down. What makes this safe rather than reckless
/// is the list of things it will not do it to, and these tests are that list made executable.
/// </remarks>
public sealed class ThrottleEligibilityTests
{
    /// <summary>A Windows directory to evaluate against, since this suite runs on Linux.</summary>
    private const string WindowsRoot = @"C:\Windows";

    private static ThrottleRefusal Evaluate(in ThrottleCandidate candidate) =>
        ThrottleEligibility.Evaluate(candidate, WindowsRoot);

    private static ThrottleCandidate Ordinary(string image = "updater.exe") => new(
        ProcessId: 4812,
        ImageName: image,
        ImagePath: @"C:\Program Files\Vendor\" + image,
        IsSameUser: true,
        IsForeground: false,
        IsGameOrLauncher: false,
        IsOwnProcessTree: false,
        IsVideoEncoding: false,
        IsElevated: false);

    [Fact]
    public void An_ordinary_background_process_of_ours_may_be_restrained()
    {
        Evaluate(Ordinary()).ShouldBe(ThrottleRefusal.None);
    }

    [Fact]
    public void A_process_encoding_video_is_never_restrained()
    {
        // The single most likely way this feature hurts someone. A video encoder is exactly what
        // a naive tool sees as a background CPU offender, and restraining it drops the user's
        // recording — a harm FrameDoctor would be causing.
        var recording = Ordinary() with { IsVideoEncoding = true };

        Evaluate(recording).ShouldBe(ThrottleRefusal.Recording);
        ThrottleEligibility.Describe(ThrottleRefusal.Recording, "obs64.exe")
            .ShouldContain("recording");
    }

    [Theory]
    [InlineData("audiodg.exe")]
    [InlineData("svchost.exe")]
    [InlineData("dwm.exe")]
    [InlineData("lsass.exe")]
    [InlineData("explorer.exe")]
    public void Windows_components_are_never_restrained_by_name(string image)
    {
        Evaluate(Ordinary(image)).ShouldBe(ThrottleRefusal.ProtectedByName);
    }

    [Theory]
    [InlineData("EasyAntiCheat.exe")]
    [InlineData("BEService.exe")]
    [InlineData("vgc.exe")]
    public void Anti_cheat_services_are_never_touched(string image)
    {
        // Interfering with these can get someone banned from a game, which no frame-time
        // improvement could justify.
        Evaluate(Ordinary(image)).ShouldBe(ThrottleRefusal.ProtectedByName);
    }

    [Theory]
    [InlineData("obs64.exe")]
    [InlineData("XSplit.Core.exe")]
    public void Capture_tools_are_on_the_list_as_well_as_behind_the_encode_signal(string image)
    {
        // The encode signal depends on a GPU counter that may be unavailable. The name list is
        // the fallback for exactly that case.
        Evaluate(Ordinary(image)).ShouldBe(ThrottleRefusal.ProtectedByName);
    }

    [Fact]
    public void Names_are_matched_without_regard_to_case()
    {
        Evaluate(Ordinary("AUDIODG.EXE")).ShouldBe(ThrottleRefusal.ProtectedByName);
    }

    [Fact]
    public void Anything_under_the_Windows_directory_is_refused()
    {
        var component = Ordinary("something.exe") with { ImagePath = @"C:\Windows\System32\something.exe" };

        Evaluate(component).ShouldBe(ThrottleRefusal.SystemComponent);
    }

    [Fact]
    public void A_directory_that_merely_starts_with_the_same_letters_is_not_the_Windows_directory()
    {
        // C:\WindowsApps is where Store applications live and has nothing to do with C:\Windows.
        // The trailing separator is what makes the prefix test a directory test.
        ThrottleEligibility.IsUnderSystemRoot(@"C:\WindowsApps\game.exe", @"C:\Windows")
            .ShouldBeFalse();

        ThrottleEligibility.IsUnderSystemRoot(@"C:\Windows\System32\svchost.exe", @"C:\Windows")
            .ShouldBeTrue();
    }

    [Fact]
    public void A_trailing_separator_on_the_configured_root_does_not_change_the_answer()
    {
        ThrottleEligibility.IsUnderSystemRoot(@"C:\Windows\notepad.exe", @"C:\Windows\")
            .ShouldBeTrue();
    }

    [Fact]
    public void The_system_root_is_matched_without_regard_to_case()
    {
        ThrottleEligibility.IsUnderSystemRoot(@"c:\windows\system32\a.exe", @"C:\Windows")
            .ShouldBeTrue();
    }

    [Fact]
    public void Another_users_process_is_not_ours_to_change()
    {
        Evaluate(Ordinary() with { IsSameUser = false })
            .ShouldBe(ThrottleRefusal.NotSameUser);
    }

    [Fact]
    public void The_game_and_the_foreground_window_are_both_refused()
    {
        Evaluate(Ordinary() with { IsGameOrLauncher = true })
            .ShouldBe(ThrottleRefusal.TheGame);

        Evaluate(Ordinary() with { IsForeground = true })
            .ShouldBe(ThrottleRefusal.Foreground);
    }

    [Fact]
    public void FrameDoctors_own_processes_are_refused_before_anything_else_is_considered()
    {
        var ourselves = Ordinary() with { IsOwnProcessTree = true, IsSameUser = false };

        Evaluate(ourselves).ShouldBe(ThrottleRefusal.Ourselves);
    }

    [Fact]
    public void An_elevated_process_is_refused_rather_than_attempted_and_failed()
    {
        Evaluate(Ordinary() with { IsElevated = true })
            .ShouldBe(ThrottleRefusal.Elevated);
    }

    [Fact]
    public void A_process_with_no_readable_path_is_refused()
    {
        // Without a path the system-directory test cannot run, and that test is what stands
        // between this feature and a Windows component. Not knowing is not a licence to act.
        Evaluate(Ordinary() with { ImagePath = null })
            .ShouldBe(ThrottleRefusal.Unknown);
    }

    [Fact]
    public void A_process_with_no_name_is_refused()
    {
        Evaluate(Ordinary() with { ImageName = "" })
            .ShouldBe(ThrottleRefusal.Unknown);
    }

    [Fact]
    public void The_ordering_puts_the_most_consequential_refusals_first()
    {
        // A candidate that trips several gates at once must report the one that matters most,
        // because the reason is shown to the user and "it is the foreground window" is a worse
        // explanation than "it is encoding video right now".
        var everything = Ordinary("obs64.exe") with
        {
            IsForeground = true,
            IsVideoEncoding = true,
            IsGameOrLauncher = true,
            IsElevated = true,
            IsSameUser = false,
            IsOwnProcessTree = true,
        };

        Evaluate(everything).ShouldBe(ThrottleRefusal.Ourselves);

        var notUs = everything with { IsOwnProcessTree = false };
        Evaluate(notUs).ShouldBe(ThrottleRefusal.NotSameUser);
    }

    [Fact]
    public void A_machine_that_cannot_say_where_Windows_lives_refuses_rather_than_permits()
    {
        // The one branch where a wrong answer restrains a Windows component. A gate that
        // disappears when its input is missing is a gate that fails open.
        ThrottleEligibility.Evaluate(Ordinary(), systemRoot: "").ShouldBe(ThrottleRefusal.Unknown);
        ThrottleEligibility.Evaluate(Ordinary(), systemRoot: "   ").ShouldBe(ThrottleRefusal.Unknown);
    }

    [Fact]
    public void Every_refusal_has_wording_a_user_can_understand()
    {
        foreach (var refusal in Enum.GetValues<ThrottleRefusal>())
        {
            var description = ThrottleEligibility.Describe(refusal, "updater.exe");

            if (refusal == ThrottleRefusal.None)
            {
                description.ShouldBeEmpty();
                continue;
            }

            description.ShouldNotBeNullOrWhiteSpace();
            // No API names, no error codes, no jargon the user did not bring with them.
            description.ShouldNotContain("QoS");
            description.ShouldNotContain("SetProcessInformation");
        }
    }
}
