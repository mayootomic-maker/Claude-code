using System.Diagnostics;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Platform.Windows.Processes;

/// <summary>
/// Names the process that was competing for the CPU when a stutter happened.
/// </summary>
/// <remarks>
/// <para>
/// The difference between a useful diagnosis and a useless one. "Another process was using the
/// CPU" tells a user nothing they can act on; "Discord was using 84 % of one core" tells them
/// exactly what to close. It is also the evidence that separates background contention from a
/// frequency collapse, which look identical in total CPU load.
/// </para>
/// <para>
/// Runs only when an event is detected, per ADR 0002. Enumerating every process and thread on
/// the machine is the most expensive thing FrameDoctor asks Windows for, and doing it four times
/// a second for a whole session would make the tool a plausible cause of the stutters it
/// reports.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: cannot execute on the Linux container this repository is
/// developed in.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class NtProcessAttributionSource : IProcessAttributionSource
{
    private readonly IMonotonicClock _clock;
    private readonly TimeSpan _samplingGap;
    private readonly int _maxProcesses;
    private bool _unavailable;

    /// <param name="clock">Session clock, for stamping the samples.</param>
    /// <param name="samplingGap">
    /// Interval between the two enumerations. Long enough that a busy process accumulates
    /// measurable CPU time, short enough that the reading still describes the moment around the
    /// stutter rather than the half-second after it.
    /// </param>
    /// <param name="maxProcesses">
    /// How many of the busiest processes to publish. A handful is what a diagnosis can use; a
    /// few hundred near-idle series would cost the correlation window far more than they inform
    /// it.
    /// </param>
    public NtProcessAttributionSource(
        IMonotonicClock clock,
        TimeSpan? samplingGap = null,
        int maxProcesses = 8)
    {
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxProcesses);

        _clock = clock;
        _samplingGap = samplingGap ?? TimeSpan.FromMilliseconds(250);
        _maxProcesses = maxProcesses;
    }

    public SourceId Id => SourceId.NtSystemInformation;

    public string DisplayName => "Windows process table";

    public int MaxSamplesPerWidening => _maxProcesses;

    public ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var snapshot = ProcessEnumerationNative.Enumerate();

        if (snapshot is null or { Count: 0 })
        {
            _unavailable = true;
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, UnavailableReason.InsufficientPrivilege,
                "Windows did not return its process table, so a stutter caused by another " +
                "program cannot be attributed to it by name."));
        }

        return ValueTask.FromResult(SourceProbe.Working(
            Id, DisplayName, [MetricAvailability.Available(MetricId.ProcessCpu)]));
    }

    public async ValueTask<int> WidenAsync(
        Memory<TelemetrySample> destination,
        CancellationToken cancellationToken)
    {
        if (destination.Length < MaxSamplesPerWidening)
        {
            throw new ArgumentException(
                $"Needs room for {MaxSamplesPerWidening} samples, got {destination.Length}.",
                nameof(destination));
        }

        if (_unavailable) return 0;

        var startedAt = Stopwatch.GetTimestamp();
        var before = ProcessEnumerationNative.Enumerate();
        if (before is null) { _unavailable = true; return 0; }

        await Task.Delay(_samplingGap, cancellationToken).ConfigureAwait(false);

        var after = ProcessEnumerationNative.Enumerate();
        if (after is null) { _unavailable = true; return 0; }

        // Measured, not assumed to be the requested gap. Task.Delay overshoots under exactly the
        // conditions this runs in — the machine is busy, which is why there was a stutter — and
        // dividing by the requested interval instead of the real one would overstate every
        // process's CPU share at the worst possible moment.
        var elapsed = Stopwatch.GetElapsedTime(startedAt);
        var now = _clock.Now;

        var busiest = ProcessCpuDelta.Compute(
            before, after, elapsed, Environment.ProcessorCount);

        var span = destination.Span;
        var written = 0;

        foreach (var (processId, _, cpuPercent) in busiest)
        {
            if (written == _maxProcesses) break;

            span[written++] = TelemetrySample.Measured(
                now,
                MetricId.ProcessCpu,
                Id,
                cpuPercent,
                Unit.Percent,
                // Degraded, and for a reason worth stating: these readings are taken just after
                // the stutter, not during it. They establish that a process was busy around the
                // event. They cannot establish that it was busy before it, and a diagnosis that
                // claimed the sequence from them would be claiming more than the measurement
                // supports.
                Quality.Degraded,
                instance: processId);
        }

        return written;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
