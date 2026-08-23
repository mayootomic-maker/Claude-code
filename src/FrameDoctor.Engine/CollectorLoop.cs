using System.Buffers;
using System.Diagnostics;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Engine.Hosting;

namespace FrameDoctor.Engine;

/// <summary>
/// Drives every sensor source on its own cadence and feeds the live session.
/// </summary>
/// <remarks>
/// <para>
/// One thread for every source rather than a thread each. Sources declare intervals between
/// 250 ms and a second; giving each one a timer would put three or four wakeups a second on a
/// machine trying to render a game, for work that fits in one.
/// </para>
/// <para>
/// The buffers are rented once and reused. This loop runs for the length of a gaming session, so
/// a per-poll array would be a steady drip of garbage in the process whose GC pause is, by
/// invariant 8, the user's stutter.
/// </para>
/// </remarks>
public sealed class CollectorLoop
{
    private readonly IReadOnlyList<ISensorSource> _sources;
    private readonly IMonotonicClock _clock;
    private readonly LiveSession _session;

    /// <summary>Next due time per source, parallel to <see cref="_sources"/>.</summary>
    private readonly MonotonicTimestamp[] _nextDue;

    private readonly TelemetrySample[] _buffer;

    /// <summary>
    /// How long the slowest single poll took.
    /// </summary>
    /// <remarks>
    /// FrameDoctor's tripwire on itself. A poll that takes tens of milliseconds is a poll that
    /// can be the cause of a stutter, and the product's whole claim is that it is not.
    /// </remarks>
    public TimeSpan WorstPollDuration { get; private set; }

    /// <summary>Total time spent inside source polls.</summary>
    public TimeSpan TotalPollDuration { get; private set; }

    public long PollCount { get; private set; }

    public CollectorLoop(
        IReadOnlyList<ISensorSource> sources,
        IMonotonicClock clock,
        LiveSession session)
    {
        ArgumentNullException.ThrowIfNull(sources);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(session);

        _sources = sources;
        _clock = clock;
        _session = session;
        _nextDue = new MonotonicTimestamp[sources.Count];

        var widest = 1;
        foreach (var source in sources) widest = Math.Max(widest, source.MaxSamplesPerPoll);
        _buffer = new TelemetrySample[widest];
    }

    /// <summary>The shortest interval any source asked for, which sets the loop's tick.</summary>
    public TimeSpan TickInterval
    {
        get
        {
            var shortest = TimeSpan.FromSeconds(1);
            foreach (var source in _sources)
            {
                if (source.Interval > TimeSpan.Zero && source.Interval < shortest)
                    shortest = source.Interval;
            }

            return shortest;
        }
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        foreach (var source in _sources)
            await source.StartAsync(cancellationToken).ConfigureAwait(false);

        var tick = TickInterval;
        using var timer = new PeriodicTimer(tick);

        // Seed every source as due immediately, so the first tick produces a full reading
        // instead of a chart that fills in over the first few seconds.
        var now = _clock.Now;
        for (var i = 0; i < _nextDue.Length; i++) _nextDue[i] = now;

        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            PollDueSources(_clock.Now);
        }
    }

    /// <summary>
    /// Polls every source whose interval has elapsed. Public so the loop can be driven by a test.
    /// </summary>
    public void PollDueSources(MonotonicTimestamp now)
    {
        for (var i = 0; i < _sources.Count; i++)
        {
            if (now < _nextDue[i]) continue;

            var source = _sources[i];

            // Scheduled from now rather than from the previous due time. Catching up on missed
            // polls would burst several reads of the same rate counter back to back, which
            // returns the same value repeatedly — a perfectly stable metric where in truth there
            // was no new information.
            _nextDue[i] = now + source.Interval;

            var started = Stopwatch.GetTimestamp();
            var written = source.Poll(now, _buffer);
            var elapsed = Stopwatch.GetElapsedTime(started);

            PollCount++;
            TotalPollDuration += elapsed;
            if (elapsed > WorstPollDuration) WorstPollDuration = elapsed;

            _session.AddSensorSamples(_buffer.AsSpan(0, written));
        }
    }
}

/// <summary>
/// Pumps frames from a frame source into the live session.
/// </summary>
/// <remarks>
/// Separate from the sensor loop because frames are pushed and sensors are pulled, and because a
/// frame source that stalls must not stop the sensors: a session whose frame source died still
/// has telemetry worth recording, and the reason the frames stopped is itself a finding.
/// </remarks>
public sealed class FramePump(IFrameSource source, LiveSession session)
{
    private readonly IFrameSource _source = source ?? throw new ArgumentNullException(nameof(source));
    private readonly LiveSession _session = session ?? throw new ArgumentNullException(nameof(session));

    public long FramesConsumed { get; private set; }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        await _source.StartAsync(cancellationToken).ConfigureAwait(false);

        await foreach (var frame in _source.ReadFramesAsync(cancellationToken).ConfigureAwait(false))
        {
            _session.AddFrame(frame);
            FramesConsumed++;
        }
    }
}

/// <summary>Rented scratch space for a widening, so the event path allocates nothing.</summary>
internal static class AttributionBuffer
{
    internal static async ValueTask<int> WidenIntoAsync(
        IProcessAttributionSource attribution,
        LiveSession session,
        CancellationToken cancellationToken)
    {
        var buffer = ArrayPool<TelemetrySample>.Shared.Rent(attribution.MaxSamplesPerWidening);

        try
        {
            var written = await attribution
                .WidenAsync(buffer.AsMemory(0, attribution.MaxSamplesPerWidening), cancellationToken)
                .ConfigureAwait(false);

            session.AddSensorSamples(buffer.AsSpan(0, written));
            return written;
        }
        finally
        {
            ArrayPool<TelemetrySample>.Shared.Return(buffer);
        }
    }
}
