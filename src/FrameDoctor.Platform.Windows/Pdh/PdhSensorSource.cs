using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// CPU, memory and disk telemetry from Windows performance counters.
/// </summary>
/// <remarks>
/// <para>
/// Tier 0: no elevation, no driver, no third-party service. Everything here is readable by an
/// ordinary user account, which is what lets FrameDoctor run unelevated as a whole
/// (invariant 6). The metrics that genuinely need more than this — CPU temperature and package
/// power — are reported as unavailable with the reason, not approximated.
/// </para>
/// <para>
/// Counter handles are opened once and reused for the life of the process. Creating a counter
/// per metric per tick is the standard way to make a monitoring tool cost more than the thing it
/// is monitoring.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: the counter names are per-machine registry data and
/// cannot be confirmed from Linux. The start-up probe is what makes that safe — a path that does
/// not read is reported as absent rather than assumed.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class PdhSensorSource : ISensorSource
{
    /// <summary>One bound counter and what it feeds.</summary>
    private sealed class Counter
    {
        public required nint Handle { get; init; }
        public required string Path { get; init; }
        public required MetricId Metric { get; init; }
        public required Unit Unit { get; init; }
        public required uint Format { get; init; }

        /// <summary>Instance index for per-core metrics, or <see cref="TelemetrySample.NoInstance"/>.</summary>
        public int Instance { get; init; } = TelemetrySample.NoInstance;

        /// <summary>Multiplier applied to the raw reading, e.g. seconds to milliseconds.</summary>
        public double Scale { get; init; } = 1.0;

        /// <summary>Whether this counter is read for a derivation instead of published directly.</summary>
        public bool IsInternal { get; init; }

        /// <summary>
        /// Provenance for samples from this counter, when it is standing in for another.
        /// </summary>
        /// <remarks>
        /// A substituted counter measures something different from the one it replaces, so the
        /// substitution is stamped onto every sample rather than mentioned in a log line. A
        /// stored session then records which of the two was actually read, and a comparison
        /// across sessions cannot silently span both.
        /// </remarks>
        public SourceId? SourceOverride { get; init; }

        /// <summary>Quality floor for this counter's samples.</summary>
        public Quality Quality { get; init; } = Quality.Exact;

        public uint LastStatus { get; set; } = PdhStatus.InvalidData;
        public double LastValue { get; set; } = double.NaN;
        public bool Retired { get; set; }
    }

    private readonly List<Counter> _counters = [];
    private readonly TimeSpan _interval;
    private nint _query;
    private int _collects;
    private uint[] _baseClocksMhz = [];
    private double[] _perCoreUtility = [];

    public PdhSensorSource(TimeSpan? interval = null)
    {
        // 4 Hz. Fast enough that a 250 ms clock collapse is two samples rather than one, and
        // slow enough that the counters themselves have new data on every read — several of them
        // update no faster than this, and polling harder returns the same value twice, which
        // reads as a perfectly stable metric rather than as no new information.
        _interval = interval ?? TimeSpan.FromMilliseconds(250);
    }

    public SourceId Id => SourceId.PerformanceCounters;

    public string DisplayName => "Windows performance counters";

    public IReadOnlyList<MetricId> DeclaredMetrics { get; } =
    [
        MetricId.CpuLoadTotal,
        MetricId.CpuLoadCore,
        MetricId.CpuClockEffective,
        MetricId.CpuActiveCoreCount,
        MetricId.CpuDpcTime,
        MetricId.CpuIsrTime,
        MetricId.MemoryHardFaults,
        MetricId.DiskActive,
        MetricId.DiskLatency,
        MetricId.DiskRead,
        MetricId.DiskWrite,
    ];

    public TimeSpan Interval => _interval;

    public int MaxSamplesPerPoll { get; private set; }

    public async ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken)
    {
        if (_query == 0 && !TryOpen(out var openStatus))
        {
            return SourceProbe.NotWorking(
                Id,
                DisplayName,
                PdhStatus.Classify(openStatus).Reason,
                "Windows performance counters could not be opened. The Performance Counter " +
                "registry may need rebuilding (lodctr /R).");
        }

        // Rate counters have no value until the second collect, so a probe that reads once would
        // conclude every counter on the machine is broken.
        await SettleAsync(cancellationToken).ConfigureAwait(false);

        foreach (var counter in _counters) ReadInto(counter);

        if (TryAddCpuTimeFallback())
        {
            await SettleAsync(cancellationToken).ConfigureAwait(false);
            foreach (var counter in _counters) ReadInto(counter);
        }

        // A counter that does not exist on this machine will never exist on this machine.
        // Dropping it here means it is neither read nor published for the rest of the session,
        // instead of emitting an unavailable sample every 250 ms for a counter no build of
        // Windows has.
        _counters.RemoveAll(c => c.Retired);
        RenumberCoreInstances();

        var metrics = new List<MetricAvailability>();
        var seen = new HashSet<MetricId>();

        foreach (var counter in _counters)
        {
            var status = counter.LastStatus;
            if (counter.IsInternal) continue;
            if (!seen.Add(counter.Metric)) continue;

            metrics.Add(PdhStatus.IsSuccess(status)
                ? MetricAvailability.Available(counter.Metric)
                : MetricAvailability.Missing(
                    counter.Metric,
                    PdhStatus.Classify(status).Reason,
                    $"This machine does not publish the counter \"{counter.Path}\"."));
        }

        metrics.Add(DescribeDerivedClock());
        metrics.Add(ActiveCoreAvailability());

        // Named so the System view can state the reason rather than showing a bare dash. Both
        // need a kernel-mode sensor driver, which FrameDoctor will not install (invariant 5).
        metrics.Add(MetricAvailability.Missing(
            MetricId.CpuTemperature,
            UnavailableReason.RequiresSensorDriver,
            "Windows exposes no CPU temperature to an ordinary program. Reading it needs a " +
            "kernel-mode sensor driver, which FrameDoctor does not install."));
        metrics.Add(MetricAvailability.Missing(
            MetricId.CpuPower,
            UnavailableReason.RequiresSensorDriver,
            "CPU package power needs the same kernel-mode sensor driver as temperature."));

        MaxSamplesPerPoll = metrics.Count + _perCoreUtility.Length + 4;

        return SourceProbe.Working(Id, DisplayName, metrics);
    }

    /// <summary>Collects twice with a gap, which is what a rate counter needs to have a value.</summary>
    private async ValueTask SettleAsync(CancellationToken cancellationToken)
    {
        Collect();
        await Task.Delay(_interval, cancellationToken).ConfigureAwait(false);
        Collect();
    }

    /// <summary>
    /// Substitutes <c>% Processor Time</c> when <c>% Processor Utility</c> is not published.
    /// </summary>
    /// <remarks>
    /// Not an equivalent counter. <c>% Processor Time</c> is capped at 100 and does not account
    /// for a processor running below its base clock, so a throttled machine reads as fully busy
    /// on it. The substitution is worth making — a CPU-load reading that is right in shape is
    /// far better than none — but it is stamped onto the samples rather than hidden.
    /// </remarks>
    private bool TryAddCpuTimeFallback()
    {
        var utility = _counters.Find(c => c.Path == CounterPaths.CpuUtilityTotal);
        if (utility is null || PdhStatus.IsSuccess(utility.LastStatus)) return false;

        if (!PdhStatus.IsSuccess(
                PdhNative.PdhAddEnglishCounter(_query, CounterPaths.CpuTimeTotalFallback, 0, out var handle)))
            return false;

        utility.Retired = true;

        _counters.Add(new Counter
        {
            Handle = handle,
            Path = CounterPaths.CpuTimeTotalFallback,
            Metric = MetricId.CpuLoadTotal,
            Unit = Unit.Percent,
            Format = PdhNative.PdhFmtDouble,
            SourceOverride = SourceId.Derived,
            Quality = Quality.Degraded,
        });

        return true;
    }

    /// <summary>
    /// Re-indexes per-core instances after absent counters were dropped.
    /// </summary>
    /// <remarks>
    /// Instance numbers must stay dense and match the derivation buffer. A machine that
    /// publishes cores 0-7 but not 8-15 would otherwise leave holes, and the active-core
    /// derivation reads a buffer sized to the surviving counters.
    /// </remarks>
    private void RenumberCoreInstances()
    {
        var cores = _counters.Count(c => c.Metric == MetricId.CpuLoadCore);
        _perCoreUtility = new double[cores];

        var index = 0;
        for (var i = 0; i < _counters.Count; i++)
        {
            if (_counters[i].Metric != MetricId.CpuLoadCore) continue;

            var counter = _counters[i];
            _counters[i] = new Counter
            {
                Handle = counter.Handle,
                Path = counter.Path,
                Metric = counter.Metric,
                Unit = counter.Unit,
                Format = counter.Format,
                Scale = counter.Scale,
                Instance = index++,
                IsInternal = counter.IsInternal,
                SourceOverride = counter.SourceOverride,
                Quality = counter.Quality,
                LastStatus = counter.LastStatus,
                LastValue = counter.LastValue,
            };
        }
    }

    private MetricAvailability DescribeDerivedClock()
    {
        if (_baseClocksMhz.Length == 0)
        {
            return MetricAvailability.Missing(
                MetricId.CpuClockEffective,
                UnavailableReason.NoSensor,
                "Windows did not report this processor's base clock, so an effective clock " +
                "cannot be derived from it.");
        }

        var hasPerformance = _counters.Any(c =>
            c.Path == CounterPaths.CpuPerformanceTotal && PdhStatus.IsSuccess(c.LastStatus));

        return hasPerformance
            ? MetricAvailability.Available(MetricId.CpuClockEffective)
            : MetricAvailability.Missing(
                MetricId.CpuClockEffective,
                UnavailableReason.NoSensor,
                "This machine does not publish \"% Processor Performance\", which is what the " +
                "effective clock is derived from.");
    }

    private MetricAvailability ActiveCoreAvailability() =>
        _perCoreUtility.Length > 0
            ? MetricAvailability.Available(MetricId.CpuActiveCoreCount)
            : MetricAvailability.Missing(
                MetricId.CpuActiveCoreCount,
                UnavailableReason.NoSensor,
                "Per-processor counters are not available, so busy cores cannot be counted.");

    public ValueTask StartAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_query == 0 && !TryOpen(out _))
            throw new InvalidOperationException("Performance counters could not be opened.");

        return ValueTask.CompletedTask;
    }

    private bool TryOpen(out uint status)
    {
        status = PdhNative.PdhOpenQuery(null, 0, out _query);
        if (!PdhStatus.IsSuccess(status)) return false;

        _baseClocksMhz = PowerNative.ReadBaseClocksMhz();

        const uint Uncapped = PdhNative.PdhFmtDouble | PdhNative.PdhFmtNoCap100;
        const uint Plain = PdhNative.PdhFmtDouble;

        Add(CounterPaths.CpuUtilityTotal, MetricId.CpuLoadTotal, Unit.Percent, Uncapped);
        Add(CounterPaths.CpuPerformanceTotal, MetricId.CpuClockEffective, Unit.Percent, Uncapped,
            isInternal: true);
        Add(CounterPaths.CpuDpcTotal, MetricId.CpuDpcTime, Unit.Percent, Plain);
        Add(CounterPaths.CpuInterruptTotal, MetricId.CpuIsrTime, Unit.Percent, Plain);

        Add(CounterPaths.MemoryHardFaults, MetricId.MemoryHardFaults, Unit.PerSecond, Plain);

        Add(CounterPaths.DiskIdleTotal, MetricId.DiskActive, Unit.Percent, Plain, isInternal: true);
        Add(CounterPaths.DiskLatencyTotal, MetricId.DiskLatency, Unit.Milliseconds, Plain,
            scale: 1000.0);
        Add(CounterPaths.DiskReadTotal, MetricId.DiskRead, Unit.BytesPerSecond, Plain);
        Add(CounterPaths.DiskWriteTotal, MetricId.DiskWrite, Unit.BytesPerSecond, Plain);

        var cores = 0;
        foreach (var (group, processor) in CounterPaths.EnumerateProcessors(Environment.ProcessorCount))
        {
            Add(CounterPaths.CpuUtilityFor(group, processor), MetricId.CpuLoadCore, Unit.Percent,
                Uncapped, instance: cores);
            cores++;
        }

        _perCoreUtility = new double[cores];
        return true;


        void Add(
            string path,
            MetricId metric,
            Unit unit,
            uint format,
            double scale = 1.0,
            int instance = TelemetrySample.NoInstance,
            bool isInternal = false)
        {
            // A successful add proves nothing: PDH returns success for an instance that does not
            // exist. The counter earns its place by reading, in the probe.
            if (!PdhStatus.IsSuccess(PdhNative.PdhAddEnglishCounter(_query, path, 0, out var handle)))
                return;

            _counters.Add(new Counter
            {
                Handle = handle,
                Path = path,
                Metric = metric,
                Unit = unit,
                Format = format,
                Scale = scale,
                Instance = instance,
                IsInternal = isInternal,
            });
        }
    }

    private void Collect()
    {
        if (_query == 0) return;

        // The status is deliberately not acted on. A failed collect leaves every counter's
        // previous status in place, and the per-counter read below is what reports the problem
        // — with the detail of which counter, which a query-wide code does not carry.
        _ = PdhNative.PdhCollectQueryData(_query);
        _collects++;
    }

    private static uint ReadInto(Counter counter)
    {
        if (counter.Retired) return counter.LastStatus;

        var status = PdhNative.PdhGetFormattedCounterValue(
            counter.Handle, counter.Format, 0, out var value);

        // Two statuses: one for the call, one inside the value. A nonzero CStatus with a
        // successful call still means the number is meaningless.
        if (PdhStatus.IsSuccess(status) && value.CStatus != 0) status = value.CStatus;

        counter.LastStatus = status;
        counter.LastValue = PdhStatus.IsSuccess(status) ? value.DoubleValue * counter.Scale : double.NaN;

        // A counter that does not exist here will never exist here. Retiring it stops a failed
        // read every 250 ms for the rest of the session — but only for permanent failures: a
        // rate counter that is merely not ready yet must keep being tried, or every one of them
        // would be disabled on the first tick.
        if (PdhStatus.IsPermanent(status)) counter.Retired = true;

        return status;
    }

    public int Poll(MonotonicTimestamp now, Span<TelemetrySample> destination)
    {
        if (destination.Length < MaxSamplesPerPoll)
            throw new ArgumentException(
                $"Needs room for {MaxSamplesPerPoll} samples, got {destination.Length}.",
                nameof(destination));

        Collect();

        var written = 0;
        var coreIndex = 0;
        var performancePercent = double.NaN;
        var utilityPercent = double.NaN;
        var idlePercent = double.NaN;

        foreach (var counter in _counters)
        {
            var status = ReadInto(counter);

            if (counter.Path == CounterPaths.CpuPerformanceTotal) performancePercent = counter.LastValue;
            if (counter.Path == CounterPaths.CpuUtilityTotal) utilityPercent = counter.LastValue;
            if (counter.Path == CounterPaths.DiskIdleTotal) idlePercent = counter.LastValue;

            if (counter.Metric == MetricId.CpuLoadCore && coreIndex < _perCoreUtility.Length)
                _perCoreUtility[coreIndex++] = counter.LastValue;

            if (counter.IsInternal) continue;

            destination[written++] = Publish(now, counter, status);
        }

        // Rate counters have no value before the second collect. Everything above already
        // reports that honestly through PDH's own status, so there is nothing to special-case
        // here — but the derivations below read those values directly and must not.
        var ready = _collects >= 2;

        destination[written++] = ready
            ? PublishDerived(
                now,
                MetricId.CpuClockEffective,
                Unit.Megahertz,
                CounterDerivations.EffectiveClockMhz(
                    _baseClocksMhz.Length > 0 ? _baseClocksMhz[0] : 0,
                    performancePercent,
                    utilityPercent))
            : TelemetrySample.Unavailable(
                now, MetricId.CpuClockEffective, Id, UnavailableReason.NotYetSampled, Unit.Megahertz);

        destination[written++] = ready
            ? PublishDerived(
                now, MetricId.DiskActive, Unit.Percent,
                CounterDerivations.DiskActivePercent(idlePercent))
            : TelemetrySample.Unavailable(
                now, MetricId.DiskActive, Id, UnavailableReason.NotYetSampled, Unit.Percent);

        destination[written++] = ready
            ? PublishDerived(
                now, MetricId.CpuActiveCoreCount, Unit.Count,
                CounterDerivations.ActiveCoreCount(_perCoreUtility))
            : TelemetrySample.Unavailable(
                now, MetricId.CpuActiveCoreCount, Id, UnavailableReason.NotYetSampled, Unit.Count);

        // Stated every poll rather than only at probe time, so a stored session records that the
        // sensor was absent throughout rather than leaving a gap that could be read as a dropout.
        destination[written++] = TelemetrySample.Unavailable(
            now, MetricId.CpuTemperature, Id, UnavailableReason.RequiresSensorDriver, Unit.Celsius);

        return written;
    }

    private TelemetrySample Publish(MonotonicTimestamp now, Counter counter, uint status)
    {
        if (PdhStatus.IsSuccess(status))
        {
            return TelemetrySample.Measured(
                now, counter.Metric, counter.SourceOverride ?? Id, counter.LastValue,
                counter.Unit, counter.Quality, counter.Instance);
        }

        var (state, reason) = PdhStatus.Classify(status);

        return state switch
        {
            Availability.Denied => TelemetrySample.Denied(
                now, counter.Metric, Id, reason, counter.Unit, counter.Instance),
            Availability.Failed => TelemetrySample.Failed(
                now, counter.Metric, Id, reason, counter.Unit, counter.Instance),
            _ => TelemetrySample.Unavailable(
                now, counter.Metric, Id, reason, counter.Unit, counter.Instance),
        };
    }

    private TelemetrySample PublishDerived(
        MonotonicTimestamp now, MetricId metric, Unit unit, Derived derived) =>
        derived.HasValue
            ? TelemetrySample.Measured(now, metric, Id, derived.Value, unit, Quality.Derived)
            : TelemetrySample.Unavailable(now, metric, Id, derived.Reason, unit);

    public ValueTask DisposeAsync()
    {
        if (_query != 0)
        {
            _ = PdhNative.PdhCloseQuery(_query);
            _query = 0;
        }

        _counters.Clear();
        return ValueTask.CompletedTask;
    }
}
