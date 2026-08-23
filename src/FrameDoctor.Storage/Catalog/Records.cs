using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace FrameDoctor.Storage.Catalog;

/// <summary>Lifecycle state of a stored session.</summary>
public enum SessionState
{
    /// <summary>Capture is in progress, or the process died before finalizing.</summary>
    Open = 0,

    /// <summary>Closed normally with complete aggregates.</summary>
    Finalized = 1,

    /// <summary>Reconstructed from a segment file after an unclean shutdown.</summary>
    Recovered = 2,

    /// <summary>Abandoned; too little data to be useful.</summary>
    Aborted = 3,
}

/// <summary>How far a baseline can be trusted.</summary>
public enum BaselineTrust
{
    /// <summary>Too few sessions. Report "no baseline yet" rather than a number.</summary>
    Insufficient = 0,

    /// <summary>Shown to the user, but never used to declare a regression.</summary>
    Provisional = 1,

    /// <summary>Enough sessions for a regression claim to be defensible.</summary>
    Trusted = 2,
}

/// <summary>The machine a session ran on.</summary>
public sealed record MachineRecord(
    string Fingerprint,
    string? CpuModel,
    string? GpuModel,
    int? RamMegabytes,
    string? OsBuild);

/// <summary>A detected game.</summary>
public sealed record GameRecord(
    string ExecutableName,
    string? ExecutableHash,
    string? DisplayName);

/// <summary>
/// Everything that must match for two sessions to be comparable.
/// </summary>
/// <remarks>
/// Changing any field forks the baseline rather than polluting it. A game patch, a driver
/// update, a different monitor mode, or one of our own applied optimizations all produce
/// genuinely different performance, and comparing across them would manufacture regressions
/// out of changes the user already knows about.
/// </remarks>
public sealed record ConfigRecord(
    GameRecord Game,
    MachineRecord Machine,
    string? GpuDriver,
    double? MonitorHz,
    int? MonitorWidth,
    int? MonitorHeight,
    string? PowerScheme,
    string? PowerOverlay,
    bool? GameMode,
    string? Optimizations)
{
    /// <summary>Field separator that cannot occur in any of the joined values.</summary>
    private const char Separator = '';

    /// <summary>Stable hash of every comparability-relevant field.</summary>
    public string KeyHash()
    {
        var material = string.Join(
            Separator,
            Game.ExecutableName,
            Game.ExecutableHash ?? string.Empty,
            Machine.Fingerprint,
            GpuDriver ?? string.Empty,
            MonitorHz?.ToString("F2", CultureInfo.InvariantCulture) ?? string.Empty,
            MonitorWidth?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            MonitorHeight?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            PowerScheme ?? string.Empty,
            PowerOverlay ?? string.Empty,
            GameMode?.ToString() ?? string.Empty,
            Optimizations ?? string.Empty);

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(material)))[..32];
    }
}

/// <summary>A stored session.</summary>
public sealed record SessionRecord(
    Guid Id,
    long EpochUtcTicks,
    long TickFrequency,
    long DurationTicks,
    int FrameCount,
    SessionState State,
    int DiscontinuityCount,
    double? SensitivityFloorMs,
    string? SegmentPath,
    long? SegmentBytes,
    bool BaselineEligible)
{
    /// <summary>Database identifier, assigned on insert.</summary>
    public long RowId { get; init; }
}

/// <summary>A stored frame-timing event.</summary>
public sealed record EventRecord(
    long StartTicks,
    long EndTicks,
    int Class,
    double PeakFrameTimeMs,
    double ExcessMs,
    double ThresholdMs,
    double BaselineMedianMs,
    double BaselineScaleMs,
    int FrameCount,
    int MergedCount,
    bool DuringWarmUp,
    bool ForceClosed,
    bool CountsTowardTally)
{
    public long RowId { get; init; }
}

/// <summary>One evidence item behind a diagnosis.</summary>
public sealed record EvidenceRecord(
    int Metric,
    int Instance,
    string Statement,
    double LikelihoodRatio,
    int EvidenceClass,
    int Role,
    int SampleCount,
    double? NativeRateHz,
    bool CanEstablishOrdering,
    int Quality);

/// <summary>A hypothesis considered and rejected.</summary>
public sealed record RuledOutRecord(
    string RuleId,
    string Title,
    string Reason,
    bool WasCheckable);

/// <summary>A stored diagnosis.</summary>
public sealed record DiagnosisRecord(
    string? RuleId,
    string Title,
    double Confidence,
    double RawConfidence,
    double LogOdds,
    int BindingCap,
    string WhatHappened,
    string? Mechanism,
    string? RecommendedAction,
    IReadOnlyList<EvidenceRecord> Evidence,
    IReadOnlyList<RuledOutRecord> RuledOut);

/// <summary>Session-wide aggregate for one metric.</summary>
public sealed record SessionStatRecord(
    int Metric,
    int Instance,
    int SampleCount,
    int Availability,
    int Quality,
    double? Min,
    double? P50,
    double? P95,
    double? P99,
    double? P999,
    double? Max,
    double? Sum);
