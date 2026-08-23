namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// The counter paths FrameDoctor reads, and how the per-processor instance names are formed.
/// </summary>
/// <remarks>
/// <para>
/// Microsoft publishes no normative list of counter <i>names</i>; they live in a per-machine
/// registry table. Every path here is therefore a candidate, not a guarantee, and each one is
/// probed at start-up and demoted to unavailable if it does not read. That probe is not
/// defensive style — it is the only thing that makes hard-coded path strings safe.
/// </para>
/// <para>
/// The <c>Processor Information</c> object is used rather than the legacy <c>Processor</c>
/// object. It is the one that exposes <c>% Processor Utility</c> and <c>% Processor
/// Performance</c>, and it is aware of processor groups, which the legacy object is not — on a
/// machine with more than 64 logical processors the legacy object silently reports only the
/// first group.
/// </para>
/// </remarks>
public static class CounterPaths
{
    public const string CpuUtilityTotal = @"\Processor Information(_Total)\% Processor Utility";
    public const string CpuPerformanceTotal = @"\Processor Information(_Total)\% Processor Performance";
    public const string CpuPrivilegedTotal = @"\Processor Information(_Total)\% Privileged Time";
    public const string CpuDpcTotal = @"\Processor Information(_Total)\% DPC Time";
    public const string CpuInterruptTotal = @"\Processor Information(_Total)\% Interrupt Time";

    /// <summary>
    /// The fallback when <c>% Processor Utility</c> is absent.
    /// </summary>
    /// <remarks>
    /// Not equivalent. <c>% Processor Time</c> is capped at 100 and does not account for the
    /// processor running below its base clock, so a throttled machine reads as fully busy. When
    /// this substitution happens the emitted samples are marked degraded, so a stored session
    /// records which of the two was measured rather than blending them.
    /// </remarks>
    public const string CpuTimeTotalFallback = @"\Processor Information(_Total)\% Processor Time";

    /// <summary>
    /// Hard page faults per second: the one memory counter with diagnostic weight.
    /// </summary>
    /// <remarks>
    /// Never <c>Page Faults/sec</c>, which counts soft faults — those are satisfied from memory
    /// and are a normal part of every running program. Reporting them as memory pressure is the
    /// classic way to blame RAM for a stutter the disk caused.
    /// </remarks>
    public const string MemoryHardFaults = @"\Memory\Pages Input/sec";

    public const string DiskIdleTotal = @"\PhysicalDisk(_Total)\% Idle Time";
    public const string DiskLatencyTotal = @"\PhysicalDisk(_Total)\Avg. Disk sec/Transfer";
    public const string DiskReadTotal = @"\PhysicalDisk(_Total)\Disk Read Bytes/sec";
    public const string DiskWriteTotal = @"\PhysicalDisk(_Total)\Disk Write Bytes/sec";

    /// <summary>
    /// The <c>Processor Information</c> instance name for one logical processor.
    /// </summary>
    /// <remarks>
    /// Instances are named <c>group,cpu</c> — <c>0,0</c>, <c>0,1</c>, … — unlike the legacy
    /// <c>Processor</c> object, whose instances are bare indices. Getting this wrong yields a
    /// path that adds successfully and never reads, which is exactly the failure the start-up
    /// probe exists to catch.
    /// </remarks>
    public static string ProcessorInstance(int group, int processor) => $"{group},{processor}";

    public static string CpuUtilityFor(int group, int processor) =>
        $@"\Processor Information({ProcessorInstance(group, processor)})\% Processor Utility";

    public static string CpuPerformanceFor(int group, int processor) =>
        $@"\Processor Information({ProcessorInstance(group, processor)})\% Processor Performance";

    /// <summary>Logical processors per group on Windows. Fixed by the kernel's affinity mask.</summary>
    public const int ProcessorsPerGroup = 64;

    /// <summary>
    /// Enumerates candidate <c>group,cpu</c> pairs for a machine of a given size.
    /// </summary>
    /// <remarks>
    /// Candidates, not facts: a machine can present groups that are not full, so a pair that
    /// does not exist simply fails its probe and is dropped. Generating them arithmetically
    /// rather than enumerating through PDH's wildcard expansion avoids the localization dance
    /// that wildcard paths require, at the cost of a handful of failed probes at start-up.
    /// </remarks>
    public static IEnumerable<(int Group, int Processor)> EnumerateProcessors(int logicalProcessorCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(logicalProcessorCount);

        for (var index = 0; index < logicalProcessorCount; index++)
            yield return (index / ProcessorsPerGroup, index % ProcessorsPerGroup);
    }
}
