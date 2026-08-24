using FrameDoctor.Platform.Windows.Pdh;
using Shouldly;
using Xunit;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// Taking a <c>GPU Engine</c> instance name apart.
/// </summary>
/// <remarks>
/// The counter object encodes the process, the adapter and the engine type in a string, and
/// there is no API that returns them as fields. This is therefore the whole of per-process GPU
/// attribution, and a parser that accepts a name it does not understand would credit one
/// process's rendering to another — which the game detector would then confirm as a game.
/// </remarks>
public sealed class GpuEngineCounterTests
{
    private const string Real = "pid_9001_luid_0x00000000_0x0000C4B3_phys_0_eng_1_engtype_3D";

    [Fact]
    public void A_real_instance_name_yields_its_process_engine_and_adapter()
    {
        var parsed = GpuEngineCounters.Parse(Real).ShouldNotBeNull();

        parsed.ProcessId.ShouldBe(9001);
        parsed.EngineType.ShouldBe("3D");
        parsed.Adapter.ShouldBe("0x00000000_0x0000C4B3");
    }

    [Theory]
    [InlineData("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_VideoDecode", "VideoDecode")]
    [InlineData("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_Copy", "Copy")]
    [InlineData("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_Video_Encode", "Video_Encode")]
    public void The_engine_type_is_everything_after_the_marker(string instance, string expected)
    {
        // Taken as the remainder rather than as the last field, because an engine type
        // containing an underscore would otherwise come back truncated.
        GpuEngineCounters.Parse(instance).ShouldNotBeNull().EngineType.ShouldBe(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("_Total")]
    [InlineData("pid_notanumber_engtype_3D")]
    [InlineData("process_9001_engtype_3D")]
    [InlineData("pid_9001_luid_0x0_0x1_phys_0_eng_0")]
    [InlineData("pid_9001_engtype_")]
    public void A_name_we_do_not_understand_is_refused_rather_than_half_read(string? instance)
    {
        // Null rather than a partly-filled result. Guessing a pid out of a name that failed to
        // parse is how one process's rendering gets credited to another.
        GpuEngineCounters.Parse(instance).ShouldBeNull();
    }

    [Fact]
    public void Only_the_3D_engine_counts_for_a_given_process()
    {
        GpuEngineCounters.IsThreeDFor(Real, 9001).ShouldBeTrue();
        GpuEngineCounters.IsThreeDFor(Real, 9002).ShouldBeFalse();

        // A video player keeps the decode engine busy while fullscreen and presenting steadily.
        GpuEngineCounters
            .IsThreeDFor("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_VideoDecode", 9001)
            .ShouldBeFalse();
    }

    [Fact]
    public void Utilization_sums_every_engine_the_process_renders_on()
    {
        (string, double)[] readings =
        [
            ("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 62.0),
            ("pid_9001_luid_0x0_0x1_phys_0_eng_1_engtype_3D", 48.0),
            ("pid_9001_luid_0x0_0x1_phys_0_eng_2_engtype_VideoDecode", 90.0),
            ("pid_7_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 30.0),
        ];

        // 110, not clamped to 100. A game saturating two engines is a different fact from one
        // saturating a single engine, and Gate B only asks whether the figure clears a floor.
        GpuEngineCounters.ThreeDUtilizationFor(readings, 9001)!.Value.ShouldBe(110.0, 1e-9);
    }

    [Fact]
    public void A_process_with_no_readable_instance_is_unavailable_not_zero()
    {
        // Zero says the process rendered nothing. A process whose counters are missing has not
        // said that, and the game detector treats the two differently on purpose.
        (string, double)[] readings =
        [
            ("pid_7_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 30.0),
        ];

        GpuEngineCounters.ThreeDUtilizationFor(readings, 9001).ShouldBeNull();
    }

    [Fact]
    public void A_process_that_rendered_nothing_reads_as_zero_not_as_unavailable()
    {
        (string, double)[] readings =
        [
            ("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 0.0),
        ];

        GpuEngineCounters.ThreeDUtilizationFor(readings, 9001).ShouldBe(0.0);
    }

    [Fact]
    public void A_non_finite_reading_is_skipped_rather_than_poisoning_the_sum()
    {
        (string, double)[] readings =
        [
            ("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 62.0),
            ("pid_9001_luid_0x0_0x1_phys_0_eng_1_engtype_3D", double.NaN),
        ];

        GpuEngineCounters.ThreeDUtilizationFor(readings, 9001)!.Value.ShouldBe(62.0, 1e-9);
    }

    [Fact]
    public void An_empty_reading_set_is_unavailable()
    {
        GpuEngineCounters.ThreeDUtilizationFor([], 9001).ShouldBeNull();
    }

    [Fact]
    public void The_counter_path_is_built_around_the_instance_verbatim()
    {
        GpuEngineCounters.UtilizationFor(Real)
            .ShouldBe($@"\GPU Engine({Real})\Utilization Percentage");
    }
}

/// <summary>
/// The two pure pieces of the PDH reader: pulling an instance out of an expanded path, and
/// splitting the double-null-terminated list PDH returns.
/// </summary>
/// <remarks>
/// Both run on a machine with no GPU, and both are where a silent mistake would attribute one
/// process's rendering to another — or drop the game's instance entirely and leave Gate B with a
/// signal it thinks is missing.
/// </remarks>
public sealed class GpuEngineReaderParsingTests
{
    [Fact]
    public void An_instance_is_taken_from_between_the_parentheses()
    {
        GpuEngineCounters
            .InstanceOf(@"\GPU Engine(pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_3D)\Utilization Percentage")
            .ShouldBe("pid_9001_luid_0x0_0x1_phys_0_eng_0_engtype_3D");
    }

    [Theory]
    [InlineData(@"\GPU Engine\Utilization Percentage")]
    [InlineData(@"\GPU Engine()\Utilization Percentage")]
    [InlineData("")]
    public void A_path_with_no_usable_instance_is_refused(string path)
    {
        GpuEngineCounters.InstanceOf(path).ShouldBeNull();
    }

    [Fact]
    public void A_multi_string_splits_on_single_nulls_and_ends_at_the_double()
    {
        var buffer = "one\0two\0three\0\0".ToCharArray();

        GpuEngineCounters
            .SplitMultiString(buffer, buffer.Length)
            .ShouldBe(["one", "two", "three"]);
    }

    [Fact]
    public void Uninitialised_buffer_past_the_terminator_is_not_read_as_data()
    {
        // PDH reports the used length; the rest of the array is whatever was there. Reading past
        // the double null would invent instance names out of it.
        var buffer = new char[32];
        "one\0two\0\0".CopyTo(0, buffer, 0, 9);
        for (var i = 9; i < buffer.Length; i++) buffer[i] = 'x';

        GpuEngineCounters
            .SplitMultiString(buffer, buffer.Length)
            .ShouldBe(["one", "two"]);
    }

    [Fact]
    public void The_reported_length_bounds_the_read()
    {
        var buffer = "one\0two\0\0".ToCharArray();

        GpuEngineCounters
            .SplitMultiString(buffer, 4)
            .ShouldBe(["one"]);
    }

    [Fact]
    public void An_empty_list_is_empty_rather_than_one_empty_string()
    {
        GpuEngineCounters
            .SplitMultiString(['\0', '\0'], 2)
            .ShouldBeEmpty();
    }
}
