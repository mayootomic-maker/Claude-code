using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Engine.Hosting;

/// <summary>
/// A bounded, time-ordered buffer of recent sensor samples, kept only long enough to diagnose.
/// </summary>
/// <remarks>
/// <para>
/// The batch analyzer holds the whole session in memory, which is fine for a hundred-second
/// scenario and impossible for a six-hour one. A live session keeps only what a correlation
/// window can reach: the diagnosis of an event needs a couple of seconds either side of it, so a
/// buffer a little longer than that is the entire working set.
/// </para>
/// <para>
/// Trimming is by time rather than by count, deliberately. A count-bounded buffer holds a
/// different duration depending on how many metrics the machine happens to publish, so a
/// well-instrumented PC would keep a shorter history than a poorly instrumented one — and the
/// well-instrumented PC is the one whose diagnoses depend on it.
/// </para>
/// </remarks>
public sealed class SensorHistory
{
    private readonly Queue<TelemetrySample> _samples = new();
    private readonly TimeSpan _retention;

    /// <param name="retention">
    /// How far back to keep. Must exceed the correlation padding, with room for an event that
    /// lasts a while and for a sensor whose interval is longer than the padding — a 1 Hz metric
    /// needs a sample outside the window to bracket it, or its "before" value does not exist.
    /// </param>
    public SensorHistory(TimeSpan? retention = null)
    {
        _retention = retention ?? TimeSpan.FromSeconds(30);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(_retention, TimeSpan.Zero);
    }

    public int Count => _samples.Count;

    public TimeSpan Retention => _retention;

    /// <summary>Samples dropped because they arrived older than the retention window.</summary>
    /// <remarks>
    /// A source running behind, or a clock that stepped. Counted rather than ignored: silently
    /// discarding late samples produces diagnoses missing evidence that was in fact collected.
    /// </remarks>
    public long DroppedAsTooOld { get; private set; }

    public void Add(in TelemetrySample sample)
    {
        _samples.Enqueue(sample);
    }

    /// <summary>The newest timestamp any retained sample carries.</summary>
    public MonotonicTimestamp Newest { get; private set; }

    /// <summary>Adds a batch, as written by <see cref="Abstractions.Collection.ISensorSource.Poll"/>.</summary>
    public void AddRange(ReadOnlySpan<TelemetrySample> samples)
    {
        foreach (ref readonly var sample in samples)
        {
            _samples.Enqueue(sample);
            if (sample.Timestamp > Newest) Newest = sample.Timestamp;
        }
    }

    /// <summary>
    /// Drops everything older than the retention window relative to <paramref name="now"/>.
    /// </summary>
    /// <remarks>
    /// Called after diagnosis, never before it. Trimming on arrival would race an event that is
    /// still open — the samples explaining a stutter that began four seconds ago are exactly the
    /// ones a naive trim removes first.
    /// </remarks>
    public void Trim(MonotonicTimestamp now)
    {
        var cutoff = now - _retention;

        // Every sample, not just the ones at the front.
        //
        // The queue is ordered by arrival, not by timestamp, and a single sample stamped ahead
        // of the session — a clock step at resume, a source on a different clock base, a sensor
        // returning a stuck value with a stale stamp — sits at the head and is never older than
        // any future cutoff. A trim that stops at the first sample it cannot drop therefore
        // stops dropping anything at all, and the history grows without bound for the rest of
        // the session. In the process whose own overhead is the product's headline claim.
        var kept = 0;
        var count = _samples.Count;

        for (var i = 0; i < count; i++)
        {
            var sample = _samples.Dequeue();

            if (sample.Timestamp < cutoff)
            {
                DroppedAsTooOld++;
                continue;
            }

            _samples.Enqueue(sample);
            kept++;
        }

        if (kept == 0) Newest = MonotonicTimestamp.Zero;
    }

    /// <summary>Everything retained, oldest first.</summary>
    public IReadOnlyCollection<TelemetrySample> Samples => _samples;

    public void Clear()
    {
        _samples.Clear();
        DroppedAsTooOld = 0;
        Newest = MonotonicTimestamp.Zero;
    }
}
