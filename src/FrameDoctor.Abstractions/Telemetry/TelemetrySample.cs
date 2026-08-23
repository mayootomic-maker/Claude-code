using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// One normalized telemetry reading. The single currency of the pipeline.
/// </summary>
/// <remarks>
/// <para>
/// Every collector, whatever its source, emits this shape. Everything downstream — statistics,
/// detection, correlation, diagnosis, storage, UI — consumes only this. A collector that needs
/// a downstream component to know where its data came from has leaked.
/// </para>
/// <para>
/// Fixed sequential layout, no references, blittable: batches are written straight to the IPC
/// pipe with <see cref="MemoryMarshal"/> and no per-sample allocation. The hot path must not
/// allocate, because a GC pause in the process watching for stutters is a stutter we caused.
/// </para>
/// <para>
/// <b>The value is private.</b> It is reachable only through <see cref="TryGetValue"/>, which
/// refuses to hand it out unless the sample actually carries a reading. This is the type-level
/// expression of "a missing metric is never zero" — the single most damaging false diagnosis
/// available to this product is reading an absent sensor as a real zero, and a plain public
/// field would make that a one-character mistake.
/// </para>
/// </remarks>
[StructLayout(LayoutKind.Sequential)]
public readonly struct TelemetrySample
{
    /// <summary>No instance: the metric is machine-wide rather than per-core or per-process.</summary>
    public const int NoInstance = -1;

    private readonly long _timestampTicks;
    private readonly double _value;
    private readonly int _instance;
    private readonly ushort _metric;
    private readonly ushort _source;
    private readonly byte _availability;
    private readonly byte _quality;
    private readonly byte _reason;
    private readonly byte _unit;

    private TelemetrySample(
        MonotonicTimestamp timestamp,
        MetricId metric,
        SourceId source,
        double value,
        Unit unit,
        Availability availability,
        Quality quality,
        UnavailableReason reason,
        int instance)
    {
        _timestampTicks = timestamp.Ticks;
        _value = value;
        _instance = instance;
        _metric = (ushort)metric;
        _source = (ushort)source;
        _availability = (byte)availability;
        _quality = (byte)quality;
        _reason = (byte)reason;
        _unit = (byte)unit;
    }

    public MonotonicTimestamp Timestamp => new(_timestampTicks);
    public MetricId Metric => (MetricId)_metric;
    public SourceId Source => (SourceId)_source;
    public Unit Unit => (Unit)_unit;
    public Availability Availability => (Availability)_availability;
    public Quality Quality => (Quality)_quality;
    public UnavailableReason Reason => (UnavailableReason)_reason;

    /// <summary>Core index, process id, disk index — or <see cref="NoInstance"/>.</summary>
    public int Instance => _instance;

    public bool HasInstance => _instance != NoInstance;

    /// <summary>
    /// Retrieves the reading, if this sample carries one.
    /// </summary>
    /// <returns>
    /// <see langword="false"/> when the metric is unavailable, denied or failed — in which
    /// case <paramref name="value"/> is untouched and the caller must not substitute a default.
    /// </returns>
    /// <remarks>
    /// <see cref="Availability.Stale"/> returns <see langword="true"/>: the reading is real,
    /// just old. Callers that care about freshness check <see cref="Availability"/> directly.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetValue(out double value)
    {
        if (_availability is (byte)Availability.Available or (byte)Availability.Stale)
        {
            value = _value;
            return true;
        }

        value = default;
        return false;
    }

    /// <summary>
    /// Retrieves the reading, or <paramref name="fallback"/> when there is none.
    /// </summary>
    /// <remarks>
    /// Only for presentation code that has already decided what an absent reading should look
    /// like. Never call this with <c>0</c> from anything that feeds detection or diagnosis:
    /// that is precisely the "absent sensor reads as a real zero" bug, written deliberately.
    /// </remarks>
    public double GetValueOr(double fallback) => TryGetValue(out var v) ? v : fallback;

    // ---- Factories -----------------------------------------------------------
    // Construction goes through these so that every sample states its availability
    // explicitly. There is no way to accidentally create an "available" zero.

    public static TelemetrySample Measured(
        MonotonicTimestamp timestamp,
        MetricId metric,
        SourceId source,
        double value,
        Unit unit,
        Quality quality = Quality.Exact,
        int instance = NoInstance) =>
        new(timestamp, metric, source, value, unit, Availability.Available, quality,
            UnavailableReason.None, instance);

    public static TelemetrySample Unavailable(
        MonotonicTimestamp timestamp,
        MetricId metric,
        SourceId source,
        UnavailableReason reason,
        Unit unit = Unit.None,
        int instance = NoInstance) =>
        new(timestamp, metric, source, double.NaN, unit, Availability.Unavailable,
            Quality.Exact, reason, instance);

    public static TelemetrySample Denied(
        MonotonicTimestamp timestamp,
        MetricId metric,
        SourceId source,
        UnavailableReason reason = UnavailableReason.InsufficientPrivilege,
        Unit unit = Unit.None,
        int instance = NoInstance) =>
        new(timestamp, metric, source, double.NaN, unit, Availability.Denied,
            Quality.Exact, reason, instance);

    public static TelemetrySample Failed(
        MonotonicTimestamp timestamp,
        MetricId metric,
        SourceId source,
        UnavailableReason reason = UnavailableReason.SourceFaulted,
        Unit unit = Unit.None,
        int instance = NoInstance) =>
        new(timestamp, metric, source, double.NaN, unit, Availability.Failed,
            Quality.Exact, reason, instance);

    /// <summary>Re-stamps an earlier reading as stale at a later time.</summary>
    public TelemetrySample AsStaleAt(MonotonicTimestamp now) =>
        new(now, Metric, Source, _value, Unit, Availability.Stale, Quality.Degraded,
            Reason, _instance);

    /// <summary>Downgrades quality, e.g. after the source reported dropped events.</summary>
    /// <remarks>
    /// Quality only ever moves toward less trustworthy. A degraded reading that later looks
    /// exact again would launder a known measurement problem.
    /// </remarks>
    public TelemetrySample WithQuality(Quality quality) =>
        quality <= Quality ? this
            : new(Timestamp, Metric, Source, _value, Unit, Availability, quality, Reason, _instance);

    public override string ToString()
    {
        var inst = HasInstance ? $"[{_instance}]" : string.Empty;
        return TryGetValue(out var v)
            ? $"{Metric}{inst}={v:G6} {Unit} ({Quality}, {Source}) @{Timestamp}"
            : $"{Metric}{inst}={Availability}({Reason}) ({Source}) @{Timestamp}";
    }
}
