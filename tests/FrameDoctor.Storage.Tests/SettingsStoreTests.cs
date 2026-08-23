using Xunit;
using FrameDoctor.Storage.Settings;
using Shouldly;

namespace FrameDoctor.Storage.Tests;

/// <summary>
/// Settings that survive being wrong.
/// </summary>
/// <remarks>
/// The theme here is that nothing about a settings file may prevent the product from measuring.
/// A corrupt file, a hand-edited impossible value, a crash mid-write: each has a defined outcome
/// and none of them is "does not start".
/// </remarks>
public sealed class SettingsStoreTests : IDisposable
{
    private readonly string _path =
        Path.Combine(Path.GetTempPath(), $"framedoctor-settings-{Guid.NewGuid():N}.json");

    [Fact]
    public void A_missing_file_yields_defaults_rather_than_an_error()
    {
        var store = new SettingsStore(_path);

        store.Exists.ShouldBeFalse();
        store.Load().ShouldBe(new FrameDoctorSettings());
    }

    [Fact]
    public void Settings_round_trip()
    {
        var store = new SettingsStore(_path);
        var settings = new FrameDoctorSettings
        {
            HighResolutionRetentionDays = 30,
            AutoStartOnGameDetected = true,
            KeepMeasuringWithWindowClosed = false,
            LiveWindowSeconds = 120,
            SimulationMode = true,
        };

        store.Save(settings);

        store.Exists.ShouldBeTrue();
        store.Load().ShouldBe(settings);
    }

    [Fact]
    public void A_corrupt_file_yields_defaults_rather_than_stopping_the_application()
    {
        // Settings describe how the product behaves, not what it is for. Refusing to launch
        // because a text file is malformed fails at the more important thing.
        File.WriteAllText(_path, "{ this is not json");

        new SettingsStore(_path).Load().ShouldBe(new FrameDoctorSettings());
    }

    [Fact]
    public void An_empty_file_yields_defaults()
    {
        File.WriteAllText(_path, "");
        new SettingsStore(_path).Load().ShouldBe(new FrameDoctorSettings());
    }

    [Fact]
    public void A_json_null_yields_defaults()
    {
        File.WriteAllText(_path, "null");
        new SettingsStore(_path).Load().ShouldBe(new FrameDoctorSettings());
    }

    [Fact]
    public void An_impossible_retention_is_clamped_rather_than_rejected()
    {
        // Zero days would purge a session's frames the moment it is recorded, which is
        // indistinguishable from not recording it.
        new FrameDoctorSettings { HighResolutionRetentionDays = 0 }
            .Validated().HighResolutionRetentionDays.ShouldBe(1);

        new FrameDoctorSettings { HighResolutionRetentionDays = -50 }
            .Validated().HighResolutionRetentionDays.ShouldBe(1);

        new FrameDoctorSettings { HighResolutionRetentionDays = 100_000 }
            .Validated().HighResolutionRetentionDays.ShouldBe(365);
    }

    [Fact]
    public void An_impossible_live_window_is_clamped_to_something_the_chart_can_draw()
    {
        // Below fifteen seconds a stutter and its recovery do not fit on screen together; above
        // five minutes one pixel column spans more than a second and the envelope stops
        // distinguishing a spike from a busy period.
        new FrameDoctorSettings { LiveWindowSeconds = 1 }.Validated().LiveWindowSeconds.ShouldBe(15);
        new FrameDoctorSettings { LiveWindowSeconds = 9999 }.Validated().LiveWindowSeconds.ShouldBe(300);
    }

    [Fact]
    public void Loading_clamps_a_hand_edited_file()
    {
        File.WriteAllText(_path, """{"highResolutionRetentionDays": 9999, "liveWindowSeconds": 2}""");

        var loaded = new SettingsStore(_path).Load();

        loaded.HighResolutionRetentionDays.ShouldBe(365);
        loaded.LiveWindowSeconds.ShouldBe(15);
    }

    [Fact]
    public void A_partial_file_keeps_the_defaults_for_what_it_omits()
    {
        // Forward compatibility in the direction that matters: an older file must not silently
        // turn off a setting added since it was written.
        File.WriteAllText(_path, """{"simulationMode": true}""");

        var loaded = new SettingsStore(_path).Load();

        loaded.SimulationMode.ShouldBeTrue();
        loaded.HighResolutionRetentionDays.ShouldBe(14);
        loaded.KeepMeasuringWithWindowClosed.ShouldBeTrue();
    }

    [Fact]
    public void A_save_leaves_no_temporary_file_behind()
    {
        // The write is a temp-file-and-move so a crash cannot leave a truncated settings file,
        // which would read as "every setting is default" and silently discard a retention policy
        // someone chose.
        new SettingsStore(_path).Save(new FrameDoctorSettings { LiveWindowSeconds = 45 });

        File.Exists(_path + ".tmp").ShouldBeFalse();
        new SettingsStore(_path).Load().LiveWindowSeconds.ShouldBe(45);
    }

    [Fact]
    public void Saving_twice_replaces_rather_than_appends()
    {
        var store = new SettingsStore(_path);

        store.Save(new FrameDoctorSettings { LiveWindowSeconds = 30 });
        store.Save(new FrameDoctorSettings { LiveWindowSeconds = 90 });

        store.Load().LiveWindowSeconds.ShouldBe(90);
    }

    [Fact]
    public void There_is_no_detection_sensitivity_setting()
    {
        // Asserted rather than assumed. The threshold is derived from the measured noise of the
        // machine it runs on; a slider over it would let someone tune away the stutters instead
        // of finding them, which is this product's distinction inverted. If a future change adds
        // one, it should have to delete this test and explain why.
        var names = typeof(FrameDoctorSettings).GetProperties().Select(p => p.Name).ToArray();

        names.ShouldNotContain(n => n.Contains("Sensitivity", StringComparison.OrdinalIgnoreCase));
        names.ShouldNotContain(n => n.Contains("Threshold", StringComparison.OrdinalIgnoreCase));
    }

    public void Dispose()
    {
        foreach (var path in new[] { _path, _path + ".tmp" })
            if (File.Exists(path)) File.Delete(path);
    }
}
