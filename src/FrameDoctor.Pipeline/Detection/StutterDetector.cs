using FrameDoctor.Abstractions.Time;
using FrameDoctor.Pipeline.Statistics;

namespace FrameDoctor.Pipeline.Detection;

/// <summary>
/// Adaptive, baseline-relative stutter detection.
/// </summary>
/// <remarks>
/// <para>
/// A stutter is not <c>fps &lt; X</c>. A fixed threshold fires constantly on a 30 fps console
/// port and never on a 240 fps game that hitches to 100. What matters is whether a frame is
/// anomalous <i>against the recent behaviour of this game on this machine right now</i>.
/// </para>
/// <para>
/// The threshold is built from a rolling median (level) and a median absolute successive
/// difference (scale), clamped between a floor and a ceiling:
/// </para>
/// <code>
/// excess    = frameTime − median
/// floor     = max(absoluteFloor, ½ × refreshInterval, ½ × median)
/// threshold = clamp(k × scale, floor, 3 × median)
/// </code>
/// <para>
/// The floor is what makes vsync-locked series behave, and the difference-based scale is what
/// makes genuinely unstable series behave. Both are required; either alone fails one of them.
/// </para>
/// <para>
/// <b>The baseline is frozen while an event is open.</b> This is easy to omit and catastrophic
/// when omitted: feeding a 142 ms hitch into the scale estimator inflates it and blinds the
/// detector for the next ten seconds — precisely when a cascade is most likely.
/// </para>
/// </remarks>
public sealed class StutterDetector
{
    private readonly StutterDetectorOptions _options;
    private readonly FrameTimeStatistics _stats;
    private readonly double _refreshIntervalMs;

    // Cached baseline, refreshed on an interval rather than per frame.
    private double _median = double.NaN;
    private double _scale = double.NaN;
    private double _threshold = double.NaN;
    private MonotonicTimestamp _lastRefresh;

    // Open-event state.
    private bool _eventOpen;
    private MonotonicTimestamp _eventStart;
    private MonotonicTimestamp _eventLastExceeded;
    private double _eventPeak;
    private double _eventThreshold;
    private double _eventBaselineMedian;
    private double _eventBaselineScale;
    private int _eventFrames;
    private int _eventMerged;
    private int _consecutiveRecovered;
    private MonotonicTimestamp _recoveryStart;
    private bool _eventDuringWarmUp;

    // A closed event is held for the merge window before being emitted. Its extent is not
    // knowable until then: a second excursion 300 ms later is part of the same stutter
    // episode from the user's point of view, and emitting two markers would be wrong.
    private StutterEvent? _pendingEvent;
    private MonotonicTimestamp _pendingSince;

    // Frames observed while an event is held. Used to tell a stutter apart from a regime
    // change: if the level after recovery is persistently higher, nothing went wrong - the
    // workload changed, and the lagging median is what made it look like a fault.
    private readonly List<double> _postEventFrames = [];

    // Frames observed inside the currently open event. A force-closed event never recovered,
    // so these frames *are* the new regime and are what the baseline is reseeded from.
    private readonly List<double> _openEventFrames = [];

    /// <summary>Cap on retained in-event frames, so a pathological event cannot grow memory.</summary>
    private const int MaxRetainedEventFrames = 4096;

    private MonotonicTimestamp _firstSample;
    private bool _hasFirstSample;
    private long _framesSeen;

    public StutterDetector(
        double refreshRateHz,
        StutterDetectorOptions? options = null,
        int? windowCapacity = null)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(refreshRateHz, 0);
        _options = options ?? StutterDetectorOptions.Default;
        _refreshIntervalMs = 1000.0 / refreshRateHz;

        // Sized for the window duration at the frame rate the display implies, with headroom
        // for uncapped rendering, and clamped to what the histogram's counters allow.
        var capacity = windowCapacity
            ?? (int)Math.Clamp(_options.WindowDuration.TotalSeconds * refreshRateHz * 4,
                               512, RollingWindow.MaxCapacity);
        _stats = new FrameTimeStatistics(capacity);
    }

    /// <summary>Frame-time statistics over the rolling window.</summary>
    public FrameTimeStatistics Statistics => _stats;

    /// <summary>Current detection threshold in milliseconds, or NaN before warm-up completes.</summary>
    public double ThresholdMs => _threshold;

    /// <summary>Current baseline median in milliseconds, or NaN before warm-up completes.</summary>
    public double BaselineMedianMs => _median;

    /// <summary>Current robust scale in milliseconds, or NaN before warm-up completes.</summary>
    public double BaselineScaleMs => _scale;

    /// <summary>Whether enough data has accumulated for detection to be trusted.</summary>
    public bool IsWarmedUp { get; private set; }

    /// <summary>Whether an event is currently open.</summary>
    public bool HasOpenEvent => _eventOpen;

    /// <summary>
    /// Smallest excess this detector can currently resolve, in milliseconds.
    /// </summary>
    /// <remarks>
    /// Surfaced deliberately. On a genuinely unstable game this can exceed 25 ms, and
    /// "no stutters detected" without stating the floor would be a misleading claim. The honest
    /// statement is "nothing smaller than N ms is detectable in your current regime".
    /// </remarks>
    public double SensitivityFloorMs => _threshold;

    /// <summary>
    /// Feeds one frame time and returns any event that closed as a result.
    /// </summary>
    /// <returns>
    /// A settled event, or <see langword="null"/>.
    /// </returns>
    /// <remarks>
    /// An event is emitted once its merge window has elapsed, not the instant it closes. Its
    /// extent is not knowable before then: a second excursion 300 ms later belongs to the same
    /// stutter episode as far as the user is concerned, and emitting two markers would be a
    /// misreading of one event. The cost is up to one merge window of reporting latency, which
    /// sits inside the diagnosis latency budget.
    /// </remarks>
    public StutterEvent? Add(MonotonicTimestamp timestamp, double frameTimeMs)
    {
        if (!_hasFirstSample)
        {
            _firstSample = timestamp;
            _lastRefresh = timestamp;
            _hasFirstSample = true;
        }

        // Accumulate frames behind a held event so its release can distinguish a stutter
        // from a shift in the baseline itself.
        if (_pendingEvent is not null && !_eventOpen && double.IsFinite(frameTimeMs))
        {
            _postEventFrames.Add(frameTimeMs);
        }

        // Release a held event once nothing can merge into it any more.
        var released = ReleasePendingIfSettled(timestamp);

        // A non-finite frame time is a source defect. It must not enter the statistics, and it
        // must not be treated as a stutter either.
        if (double.IsNaN(frameTimeMs) || double.IsInfinity(frameTimeMs) || frameTimeMs < 0)
        {
            _stats.Add(frameTimeMs);
            return released;
        }

        _framesSeen++;

        // While an event is open the baseline is frozen, so the hitch cannot poison the
        // estimate it is being judged against.
        if (!_eventOpen) _stats.Add(frameTimeMs);

        RefreshBaselineIfDue(timestamp);

        if (!IsWarmedUp)
        {
            UpdateWarmUp(timestamp);
            // Frames before warm-up are still tracked so a retrospective pass can re-run
            // detection once the baseline is known.
            return released;
        }

        if (double.IsNaN(_threshold)) return released;

        var excess = frameTimeMs - _median;

        if (_eventOpen)
        {
            AdvanceOpenEvent(timestamp, frameTimeMs, excess);
            return released;
        }

        if (excess > _threshold) OpenEvent(timestamp, frameTimeMs, excess);
        return released;
    }

    /// <summary>Emits a held event once the merge window has passed without a new excursion.</summary>
    /// <remarks>
    /// Release is also where a regime change is recognised. A rolling median lags an abrupt
    /// shift in frame time by its whole window, so a scene transition or a settings change
    /// looks like a stutter - and then like another, and another, until the median catches up.
    /// Comparing the recovered level against the baseline the event was judged by separates the
    /// two, and reseeding the estimator stops the rest of the train from ever being generated.
    /// </remarks>
    private StutterEvent? ReleasePendingIfSettled(MonotonicTimestamp now)
    {
        if (_pendingEvent is null) return null;
        if ((now - _pendingSince) <= _options.MergeWindow) return null;

        var e = _pendingEvent;
        _pendingEvent = null;

        if (e.Class != StutterClass.RegimeChange &&
            HasSettledAbove(_postEventFrames, e.BaselineMedianMs, e.ThresholdMs))
        {
            e = e with { Class = StutterClass.RegimeChange };
            ReseedBaselineFrom(_postEventFrames);
        }

        _postEventFrames.Clear();
        return e;
    }

    /// <summary>Discards the stale baseline and rebuilds it from the new regime's frames.</summary>
    /// <remarks>
    /// Warm-up is deliberately not restarted: this is the same session on the same hardware,
    /// and the frames being reseeded are real observations. Only the level is stale.
    /// </remarks>
    private void ReseedBaselineFrom(List<double> frames)
    {
        _stats.Reset();
        foreach (var f in frames) _stats.Add(f);

        _median = _stats.Median();
        _scale = _stats.RobustScale();
        _threshold = double.NaN;   // recomputed on the next refresh, from the new level
    }

    /// <summary>
    /// Closes any open event and returns it.
    /// </summary>
    /// <remarks>
    /// Called at session end and at a discontinuity, so an in-flight event is not silently lost.
    /// </remarks>
    public IReadOnlyList<StutterEvent> Flush(MonotonicTimestamp timestamp)
    {
        var result = new List<StutterEvent>(2);

        if (_eventOpen) CloseEvent(timestamp, forceClosed: true);

        if (_pendingEvent is not null)
        {
            result.Add(_pendingEvent);
            _pendingEvent = null;
        }

        return result;
    }

    /// <summary>
    /// Discards all state at a discontinuity.
    /// </summary>
    /// <remarks>
    /// Statistics must never span a suspend, a session lock or a source restart. Warm-up
    /// restarts, because a baseline learned before a three-hour sleep says nothing about after.
    /// </remarks>
    public void Reset()
    {
        _stats.Reset();
        _median = _scale = _threshold = double.NaN;
        _eventOpen = false;
        _consecutiveRecovered = 0;
        _pendingEvent = null;
        _postEventFrames.Clear();
        _openEventFrames.Clear();
        IsWarmedUp = false;
        _hasFirstSample = false;
        _framesSeen = 0;
    }

    private void UpdateWarmUp(MonotonicTimestamp now)
    {
        IsWarmedUp =
            _framesSeen >= _options.WarmUpFrames &&
            (now - _firstSample) >= _options.WarmUpDuration &&
            _stats.DifferenceCount >= _options.WarmUpDifferences;
    }

    private void RefreshBaselineIfDue(MonotonicTimestamp now)
    {
        if (_eventOpen) return;
        if ((now - _lastRefresh) < _options.RefreshInterval && !double.IsNaN(_threshold)) return;

        _lastRefresh = now;
        _median = _stats.Median();
        _scale = _stats.RobustScale();

        if (double.IsNaN(_median) || double.IsNaN(_scale))
        {
            _threshold = double.NaN;
            return;
        }

        var floor = Math.Max(
            _options.AbsoluteFloorMs,
            Math.Max(
                _options.RefreshIntervalFloorFraction * _refreshIntervalMs,
                _options.MedianFloorFraction * _median));

        var ceiling = _options.MedianCeilingMultiple * _median;

        // The ceiling can fall below the floor on a very fast series (a 3.3 ms median gives a
        // 9.9 ms ceiling against a 8.3 ms floor at 60 Hz). The floor wins: it encodes what is
        // perceptible, and the ceiling only exists to stop a pathological window blinding us.
        _threshold = Math.Max(floor, Math.Min(_options.ScaleMultiplier * _scale, Math.Max(floor, ceiling)));
    }

    private void OpenEvent(MonotonicTimestamp now, double frameTimeMs, double excess)
    {
        // A force-closed event is never a merge target. It was closed precisely because frame
        // times never recovered, so merging the next excursion into it would push the event's
        // start backwards past the timeout that exists to unblock the frozen baseline - and the
        // event would then grow without bound. The merge window joins two recovered
        // excursions; this was not one.
        var mergeTarget =
            _pendingEvent is { ForceClosed: false } && (now - _pendingSince) <= _options.MergeWindow
                ? _pendingEvent
                : null;

        _eventOpen = true;
        _eventLastExceeded = now;
        _eventPeak = frameTimeMs;
        _eventThreshold = _threshold;
        _eventBaselineMedian = _median;
        _eventBaselineScale = _scale;
        _eventFrames = 1;
        _consecutiveRecovered = 0;
        _eventDuringWarmUp = false;
        _openEventFrames.Clear();
        _openEventFrames.Add(frameTimeMs);

        if (mergeTarget is not null)
        {
            // Absorb the held event rather than letting a second one reach the caller.
            _eventStart = mergeTarget.Start;
            _eventPeak = Math.Max(_eventPeak, mergeTarget.PeakFrameTimeMs);
            _eventFrames += mergeTarget.FrameCount;
            _eventMerged = mergeTarget.MergedCount + 1;
            _eventBaselineMedian = mergeTarget.BaselineMedianMs;
            _eventBaselineScale = mergeTarget.BaselineScaleMs;
            _eventThreshold = mergeTarget.ThresholdMs;
            _pendingEvent = null;
        }
        else
        {
            _eventStart = now;
            _eventMerged = 0;
        }

        _ = excess;
    }

    private void AdvanceOpenEvent(MonotonicTimestamp now, double frameTimeMs, double excess)
    {
        _eventFrames++;
        if (frameTimeMs > _eventPeak) _eventPeak = frameTimeMs;
        if (_openEventFrames.Count < MaxRetainedEventFrames) _openEventFrames.Add(frameTimeMs);

        if ((now - _eventStart) >= _options.MaximumEventDuration)
        {
            CloseEvent(now, forceClosed: true);
            return;
        }

        if (excess > _eventThreshold)
        {
            _eventLastExceeded = now;
            _consecutiveRecovered = 0;
            return;
        }

        if (excess < _options.CloseHysteresisFraction * _eventThreshold)
        {
            if (_consecutiveRecovered == 0) _recoveryStart = now;
            _consecutiveRecovered++;

            var enoughFrames = _consecutiveRecovered >= _options.MinimumCloseFrames;
            var enoughTime = (now - _recoveryStart) >= _options.CloseDuration;
            if (enoughFrames && enoughTime) CloseEvent(_eventLastExceeded, forceClosed: false);
        }
        else
        {
            _consecutiveRecovered = 0;
        }
    }

    private void CloseEvent(MonotonicTimestamp end, bool forceClosed)
    {
        var excess = _eventPeak - _eventBaselineMedian;

        // A force-closed event never recovered: frame times sat above the threshold for the
        // whole timeout. That is not a stutter, it is the baseline having moved - a scene
        // change, a settings change, or a sustained slowdown. Reporting it as a stutter would
        // produce one every timeout for the rest of the session, each with a baseline that is
        // now meaningless, which is exactly the train of false events a lagging median causes.
        var settledShift = forceClosed && HasSettledAbove(_openEventFrames, _eventBaselineMedian,
            _eventThreshold);

        var completed = new StutterEvent(
            Class: settledShift ? StutterClass.RegimeChange : Classify(excess),
            Start: _eventStart,
            End: end,
            PeakFrameTimeMs: _eventPeak,
            ExcessMs: excess,
            ThresholdMs: _eventThreshold,
            BaselineMedianMs: _eventBaselineMedian,
            BaselineScaleMs: _eventBaselineScale,
            FrameCount: _eventFrames,
            MergedCount: _eventMerged,
            DuringWarmUp: _eventDuringWarmUp,
            ForceClosed: forceClosed);

        _eventOpen = false;
        _consecutiveRecovered = 0;
        _pendingEvent = completed;
        _pendingSince = end;

        if (settledShift)
        {
            ReseedBaselineFrom(_openEventFrames);
            _postEventFrames.Clear();
        }
    }

    /// <summary>Whether a run of frames sits persistently above a baseline by more than a threshold.</summary>
    private static bool HasSettledAbove(List<double> frames, double baselineMs, double thresholdMs)
    {
        if (frames.Count < 8) return false;

        var sorted = frames.ToArray();
        Array.Sort(sorted);
        return sorted[sorted.Length / 2] - baselineMs > thresholdMs;
    }

    private StutterClass Classify(double excessMs)
    {
        var microCeiling = Math.Max(
            _options.MicroStutterRefreshMultiple * _refreshIntervalMs,
            _options.MicroStutterFloorMs);

        var stutterCeiling = Math.Max(
            _options.StutterRefreshMultiple * _refreshIntervalMs,
            _options.StutterFloorMs);

        if (excessMs <= microCeiling) return StutterClass.MicroStutter;
        if (excessMs <= stutterCeiling) return StutterClass.Stutter;
        return StutterClass.SevereHitch;
    }
}
