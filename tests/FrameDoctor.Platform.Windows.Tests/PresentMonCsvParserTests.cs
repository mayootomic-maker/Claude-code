using Xunit;
using FrameDoctor.Platform.Windows.PresentMon;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// The CSV contract, held to the letter.
/// </summary>
/// <remarks>
/// Every row here is shaped like real PresentMon 2.5.1 output on the pinned invocation, with the
/// column count and missing-value sentinels documented in
/// <c>docs/research/collector-implementation.md</c> §1.2. The traps this file exists for are the
/// three columns that print <c>0.0000</c> for a missing value: a parser that reads those as
/// measurements produces a chart of frames that took no time.
/// </remarks>
public sealed class PresentMonCsvParserTests
{
    /// <summary>A healthy 144 Hz frame: everything measured, nothing missing.</summary>
    private const string HealthyRow =
        "game.exe,4812,0x1F2A3B4C,DXGI,0,0,1,Hardware: Independent Flip," +
        "12345678901,16.6667,6.9440000000000,6.9450000000000,0.3210000000000," +
        "1.2340000000000,2.1000,12345670000,6.9440,3.1200,3.8240," +
        "4.0000,5.5000,4.2000,1.3000,0.0100,7.0000,0.2000";

    private static PresentMonRow Parse(string line)
    {
        PresentMonCsvParser.TryParse(line, out var row).ShouldBeTrue();
        return row;
    }

    [Fact]
    public void The_pinned_header_is_recognised_exactly()
    {
        PresentMonCsvParser.IsPinnedHeader(PresentMonCsvParser.PinnedHeader).ShouldBeTrue();
    }

    [Fact]
    public void A_header_with_an_extra_column_is_not_close_enough()
    {
        // A future PresentMon inserting a column would shift every index. Reading column 16 as
        // the frame time anyway would produce a plausible chart of the wrong metric, which is
        // worse than refusing to run.
        PresentMonCsvParser
            .IsPinnedHeader(PresentMonCsvParser.PinnedHeader + ",FrameId")
            .ShouldBeFalse();
    }

    [Fact]
    public void The_header_declares_the_same_column_count_the_parser_requires()
    {
        PresentMonCsvParser.LooksLikeDataRow(HealthyRow).ShouldBeTrue();
        PresentMonCsvParser.PinnedHeader.Count(c => c == ',')
            .ShouldBe(HealthyRow.Count(c => c == ','));
    }

    [Fact]
    public void A_healthy_row_yields_every_metric_FrameDoctor_uses()
    {
        var row = Parse(HealthyRow);

        row.ProcessId.ShouldBe(4812);
        row.Runtime.ShouldBe(PresentRuntime.Dxgi);
        row.CpuStartQpc.ShouldBe(12345670000UL);

        row.MsBetweenAppStart.TryGetValue(out var frameTime).ShouldBeTrue();
        frameTime.ShouldBe(6.9440, 1e-9);

        row.MsBetweenDisplayChange.TryGetValue(out var displayed).ShouldBeTrue();
        displayed.ShouldBe(6.9450, 1e-9);

        row.WasDropped.ShouldBeFalse();
        row.HasTrustworthyCpuPacing.ShouldBeTrue();
    }

    [Fact]
    public void A_frame_that_never_reached_the_screen_is_dropped_not_zero_length()
    {
        // MsUntilDisplayed prints NA exactly when the present never scanned out. There is no
        // Dropped column on this metric vocabulary, so this is the only signal there is.
        var row = Parse(HealthyRow.Replace(",2.1000,", ",NA,", StringComparison.Ordinal));

        row.WasDropped.ShouldBeTrue();
        row.MsUntilDisplayed.IsPresent.ShouldBeFalse();
    }

    [Fact]
    public void An_NA_display_interval_is_absent_rather_than_zero()
    {
        var row = Parse(HealthyRow.Replace(",6.9450000000000,", ",NA,", StringComparison.Ordinal));

        row.MsBetweenDisplayChange.State.ShouldBe(FieldState.NotApplicable);
        row.MsBetweenDisplayChange.TryGetValue(out _).ShouldBeFalse();
    }

    [Fact]
    public void The_three_WriteMetricOrZero_columns_report_a_zero_as_ambiguous()
    {
        // These print 0.0000 for a missing value, so at the character level a real zero and an
        // absent metric are the same string. The parser refuses to decide.
        var row = Parse(HealthyRow.Replace(
            ",12345670000,6.9440,3.1200,3.8240,",
            ",12345670000,0.0000,0.0000,0.0000,",
            StringComparison.Ordinal));

        row.MsBetweenAppStart.State.ShouldBe(FieldState.AmbiguousZero);
        row.MsCpuBusy.State.ShouldBe(FieldState.AmbiguousZero);
        row.MsCpuWait.State.ShouldBe(FieldState.AmbiguousZero);
        row.HasTrustworthyCpuPacing.ShouldBeFalse();
    }

    [Fact]
    public void A_zero_in_a_column_that_does_not_use_the_sentinel_stays_a_measurement()
    {
        // MsBetweenDisplayChange writes NA for missing, so a literal 0 there is a reading and
        // treating it as absent would discard real data.
        var row = Parse(HealthyRow.Replace(
            ",6.9450000000000,", ",0.0000000000000,", StringComparison.Ordinal));

        row.MsBetweenDisplayChange.State.ShouldBe(FieldState.Present);
        row.MsBetweenDisplayChange.TryGetValue(out var displayed).ShouldBeTrue();
        displayed.ShouldBe(0);
    }

    [Fact]
    public void One_zero_among_the_three_is_still_a_measurement()
    {
        // A frame with no CPU wait is entirely ordinary. Only all three at once is the
        // signature of an absent measurement.
        var row = Parse(HealthyRow.Replace(
            ",6.9440,3.1200,3.8240,", ",6.9440,3.1200,0.0000,", StringComparison.Ordinal));

        row.HasTrustworthyCpuPacing.ShouldBeTrue();
        row.MsBetweenAppStart.TryGetValue(out var frameTime).ShouldBeTrue();
        frameTime.ShouldBe(6.9440, 1e-9);
    }

    [Fact]
    public void CPU_pacing_is_never_trusted_on_the_Other_runtime()
    {
        // OpenGL and Vulkan. Upstream documents these columns as not meaningful there, so
        // publishing them would be republishing a number the source does not stand behind.
        var row = Parse(HealthyRow.Replace(",DXGI,", ",Other,", StringComparison.Ordinal));

        row.Runtime.ShouldBe(PresentRuntime.Other);
        row.HasTrustworthyCpuPacing.ShouldBeFalse();
    }

    [Fact]
    public void A_warning_line_on_stdout_is_not_mistaken_for_a_row()
    {
        // PresentMon writes warnings and the ETW status line to the same stdout the CSV goes to.
        PresentMonCsvParser.LooksLikeDataRow(
            "warning: PresentMon requires elevated privilege in order to query processes")
            .ShouldBeFalse();

        PresentMonCsvParser.LooksLikeDataRow(
            "[ETW Status] BufferFillPct=3.5% BuffersInUse=9 TotalBuffers=256 EventsLost=0 " +
            "BuffersLost=0, OverflowedPresents=0")
            .ShouldBeFalse();

        PresentMonCsvParser.LooksLikeDataRow(PresentMonCsvParser.PinnedHeader).ShouldBeFalse();
        PresentMonCsvParser.LooksLikeDataRow("").ShouldBeFalse();
    }

    [Fact]
    public void A_truncated_row_is_rejected_rather_than_partially_read()
    {
        // Happens in practice: the child is killed mid-write and the last line is half a row.
        var truncated = HealthyRow[..(HealthyRow.Length / 2)];
        PresentMonCsvParser.TryParse(truncated, out _).ShouldBeFalse();
    }

    [Fact]
    public void A_row_with_a_non_numeric_process_id_is_rejected()
    {
        PresentMonCsvParser
            .TryParse(HealthyRow.Replace(",4812,", ",????,", StringComparison.Ordinal), out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void An_unknown_present_mode_string_does_not_break_the_row()
    {
        // PresentMode is a free-form enum string we do not consume; a new value upstream must
        // not cost us the frame.
        var row = Parse(HealthyRow.Replace(
            ",Hardware: Independent Flip,", ",Some Future Mode,", StringComparison.Ordinal));

        row.MsBetweenAppStart.TryGetValue(out var frameTime).ShouldBeTrue();
        frameTime.ShouldBe(6.9440, 1e-9);
    }
}
