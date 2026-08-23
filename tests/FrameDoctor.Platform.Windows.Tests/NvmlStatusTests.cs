using Xunit;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Platform.Windows.Gpu;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

public sealed class NvmlStatusTests
{
    [Fact]
    public void A_sensor_the_card_does_not_have_is_absence_not_a_fault()
    {
        // The routine answer to nvmlDeviceGetPowerUsage on several consumer parts. Publishing it
        // as a fault would report a perfectly healthy GPU as broken; publishing it as zero would
        // report a card drawing no power.
        var (state, reason) = NvmlStatus.Classify(NvmlReturn.NotSupported);

        state.ShouldBe(Availability.Unavailable);
        reason.ShouldBe(UnavailableReason.NotExposedByVendor);
    }

    [Fact]
    public void A_card_that_fell_off_the_bus_is_a_fault()
    {
        // Distinct from a sensor that does not exist: this is a real failure the user is
        // probably already seeing on screen.
        NvmlStatus.Classify(NvmlReturn.GpuIsLost).State.ShouldBe(Availability.Failed);
    }

    [Fact]
    public void A_missing_library_is_reported_as_no_sensor_because_that_is_the_normal_case()
    {
        // The ordinary state of an AMD or Intel machine. It is an answer, not an error.
        NvmlStatus.Classify(NvmlReturn.LibraryNotFound).Reason.ShouldBe(UnavailableReason.NoSensor);
        NvmlStatus.Classify(NvmlReturn.DriverNotLoaded).Reason.ShouldBe(UnavailableReason.NoSensor);
    }

    [Fact]
    public void A_refused_reading_is_kept_distinct_because_the_user_can_act_on_it()
    {
        NvmlStatus.Classify(NvmlReturn.NoPermission).State.ShouldBe(Availability.Denied);
    }

    [Fact]
    public void An_unrecognised_code_is_a_fault_rather_than_an_invented_explanation()
    {
        NvmlStatus.Classify(NvmlReturn.Unknown).Reason.ShouldBe(UnavailableReason.SourceFaulted);
    }

    [Fact]
    public void Only_a_permanently_absent_sensor_retires_its_call()
    {
        // A card that does not expose board power will not start exposing it, and retrying costs
        // a failing P/Invoke four times a second in the collector path for the whole session.
        NvmlStatus.IsPermanent(NvmlReturn.NotSupported).ShouldBeTrue();
        NvmlStatus.IsPermanent(NvmlReturn.FunctionNotFound).ShouldBeTrue();

        // These can recover, so the call keeps being made.
        NvmlStatus.IsPermanent(NvmlReturn.GpuIsLost).ShouldBeFalse();
        NvmlStatus.IsPermanent(NvmlReturn.NoPermission).ShouldBeFalse();
        NvmlStatus.IsPermanent(NvmlReturn.Unknown).ShouldBeFalse();
    }

    [Fact]
    public void Every_explanation_names_the_card_or_the_situation_rather_than_the_error_code()
    {
        var description = NvmlStatus.Describe(NvmlReturn.NotSupported, "GeForce RTX 4070");

        description.ShouldContain("GeForce RTX 4070");
        description.ShouldNotContain("NVML_ERROR");
    }

    [Fact]
    public void The_missing_library_explanation_says_that_this_is_normal()
    {
        // Without this the System view reads as a broken installation on every AMD machine.
        NvmlStatus.Describe(NvmlReturn.LibraryNotFound, "GPU").ShouldContain("normal");
    }
}
