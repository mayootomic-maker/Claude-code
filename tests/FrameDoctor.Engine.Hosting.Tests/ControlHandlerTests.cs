using FrameDoctor.Engine.Hosting;
using FrameDoctor.Ipc.Control;
using FrameDoctor.Storage.Settings;
using Shouldly;
using Xunit;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// The whole of what the window may make the engine do.
/// </summary>
/// <remarks>
/// Every field of every request here is untrusted. The pipe is scoped to one user, which bounds
/// who can connect and says nothing about what they send — so most of these tests are refusals,
/// and the ones that are not check that a refusal still leaves the caller with the truth.
/// </remarks>
public sealed class ControlHandlerTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-control-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private SettingsStore Store() => new(Path.Combine(_dir, "settings.json"));

    private ControlHandler Handler(SettingsStore? store = null) => new(store ?? Store(), "test-build");

    [Fact]
    public void A_ping_answers_with_the_build()
    {
        var response = Handler().Handle(ControlRequest.For(1, ControlCommand.Ping));

        response.Ok.ShouldBeTrue();
        response.Id.ShouldBe(1);
        response.Build.ShouldBe("test-build");
    }

    [Fact]
    public void Every_answer_carries_the_id_it_answers()
    {
        // Without it, a caller with two requests in flight can attribute an answer to the wrong
        // question — which on this channel means showing a value that was never set.
        foreach (var id in new[] { 1, 2, int.MaxValue })
        {
            Handler().Handle(ControlRequest.For(id, ControlCommand.GetSettings)).Id.ShouldBe(id);
        }
    }

    [Fact]
    public void Settings_can_be_read()
    {
        var response = Handler().Handle(ControlRequest.For(1, ControlCommand.GetSettings));

        var settings = response.Settings.ShouldNotBeNull();
        settings.HighResolutionRetentionDays.ShouldBe(14);
        settings.KeepMeasuringWithWindowClosed.ShouldBeTrue();
    }

    [Fact]
    public void A_setting_can_be_changed_and_is_persisted()
    {
        var store = Store();
        var handler = Handler(store);

        var response = handler.Handle(
            ControlRequest.For(1, ControlCommand.SetSetting, "retention-days", "30"));

        response.Ok.ShouldBeTrue();
        response.Settings.ShouldNotBeNull().HighResolutionRetentionDays.ShouldBe(30);

        // Persisted, not merely echoed. A control that reports success and changes nothing is
        // worse than one that does nothing visibly.
        new SettingsStore(store.Path).Load().HighResolutionRetentionDays.ShouldBe(30);
    }

    [Fact]
    public void A_change_is_announced_so_the_engine_can_act_on_it()
    {
        // The engine does not poll the file. A setting the user changed and the engine did not
        // notice is a control that appears to work and does not.
        var handler = Handler();
        FrameDoctorSettings? announced = null;
        handler.SettingsChanged += s => announced = s;

        handler.Handle(ControlRequest.For(1, ControlCommand.SetSetting, "live-window-seconds", "120"));

        announced.ShouldNotBeNull().LiveWindowSeconds.ShouldBe(120);
    }

    [Fact]
    public void A_refused_change_is_not_announced()
    {
        var handler = Handler();
        var announced = 0;
        handler.SettingsChanged += _ => announced++;

        handler.Handle(ControlRequest.For(1, ControlCommand.SetSetting, "retention-days", "soon"));

        announced.ShouldBe(0);
    }

    [Fact]
    public void A_clamped_value_is_reported_rather_than_silently_stored()
    {
        // The caller asked for 9,999 days and got 365. Saying so is the difference between a
        // setting the user misunderstands and one the interface lies about.
        var response = Handler().Handle(
            ControlRequest.For(1, ControlCommand.SetSetting, "retention-days", "9999"));

        response.Ok.ShouldBeTrue();
        response.Settings.ShouldNotBeNull().HighResolutionRetentionDays.ShouldBe(365);
        response.Note.ShouldNotBeNull().ShouldContain("9999");
        response.Note.ShouldContain("Stored 365");
    }

    [Fact]
    public void A_value_inside_the_range_carries_no_note()
    {
        Handler().Handle(ControlRequest.For(1, ControlCommand.SetSetting, "retention-days", "30"))
            .Note.ShouldBeNull();
    }

    [Theory]
    [InlineData("retention-days", "soon")]
    [InlineData("retention-days", "")]
    [InlineData("retention-days", "30.5")]
    [InlineData("retention-days", "1e3")]
    [InlineData("live-window-seconds", "a minute")]
    [InlineData("auto-start", "yes")]
    [InlineData("auto-start", "1")]
    [InlineData("auto-start", "on")]
    [InlineData("simulation", "")]
    public void A_value_that_does_not_parse_is_refused_with_what_it_accepts(string key, string value)
    {
        // "yes", "1" and "on" are refused deliberately. Accepting them would mean every typo
        // parses as false, and a setting turns itself off because the value was misspelled.
        var response = Handler().Handle(ControlRequest.For(1, ControlCommand.SetSetting, key, value));

        response.Ok.ShouldBeFalse();
        response.Error.ShouldNotBeNull().ShouldContain(key);
        response.Error.ShouldContain("takes");
    }

    [Theory]
    [InlineData("retention_days")]
    [InlineData("RETENTION-DAYS")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("../../etc/passwd")]
    [InlineData("HighResolutionRetentionDays")]
    public void An_unknown_key_is_refused_and_the_real_ones_are_named(string? key)
    {
        // The property name is refused too. A key looked up in a fixed list cannot reach a
        // property that was never meant to be settable, which reflecting onto the type would.
        var response = Handler().Handle(ControlRequest.For(1, ControlCommand.SetSetting, key, "30"));

        response.Ok.ShouldBeFalse();
        response.Error.ShouldNotBeNull().ShouldContain("retention-days");
    }

    [Fact]
    public void A_refusal_still_carries_the_settings_as_they_are()
    {
        // The window has just shown a rejected value and needs to put the real one back. Making
        // it ask again would leave a wrong number on screen for another round trip.
        var response = Handler().Handle(
            ControlRequest.For(1, ControlCommand.SetSetting, "retention-days", "soon"));

        response.Settings.ShouldNotBeNull().HighResolutionRetentionDays.ShouldBe(14);
    }

    [Fact]
    public void A_missing_value_is_refused_rather_than_read_as_empty()
    {
        var response = Handler().Handle(
            new ControlRequest(1, nameof(ControlCommand.SetSetting), "retention-days", null));

        response.Ok.ShouldBeFalse();
        response.Error.ShouldNotBeNull().ShouldContain("needs a value");
    }

    [Theory]
    [InlineData("DeleteEverything")]
    [InlineData("getsettings")]
    [InlineData("")]
    [InlineData(null)]
    public void An_unrecognised_command_is_refused_and_the_real_ones_are_named(string? command)
    {
        var response = Handler().Handle(new ControlRequest(1, command));

        response.Ok.ShouldBeFalse();
        response.Error.ShouldNotBeNull().ShouldContain("GetSettings");
    }

    [Fact]
    public void A_request_that_could_not_be_read_still_gets_an_answer()
    {
        // Otherwise the caller waits forever on a request it believes is in flight.
        var response = Handler().Handle(null);

        response.Ok.ShouldBeFalse();
        response.Error.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public void Nothing_on_this_channel_can_change_the_system()
    {
        // The command surface is three, and none of them touches power policy, process priority
        // or a startup entry. Those go through the change journal and its apply protocol, and
        // deliberately have no door here.
        var reachable = Enum.GetValues<ControlCommand>()
            .Where(c => c is not ControlCommand.Unknown)
            .ToArray();

        reachable.ShouldBe(
            [ControlCommand.Ping, ControlCommand.GetSettings, ControlCommand.SetSetting],
            ignoreOrder: true);
    }

    [Fact]
    public void The_handler_refuses_to_be_built_without_a_store_or_a_build()
    {
        Should.Throw<ArgumentNullException>(() => new ControlHandler(null!, "b"));
        Should.Throw<ArgumentNullException>(() => new ControlHandler(Store(), null!));
    }
}
