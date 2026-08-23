namespace FrameDoctor.Diagnostics.Evidence;

/// <summary>
/// The family a piece of evidence belongs to, for independence weighting.
/// </summary>
/// <remarks>
/// Five thermal sensors agreeing is close to one observation, not five. Weighting the k-th item
/// in a class by 1/k is what stops a hypothesis stacking correlated readings into false
/// certainty — which is otherwise the easiest way to build a confident wrong answer, because
/// correlated sensors are exactly the ones most likely to be available together.
/// </remarks>
public enum EvidenceClass : byte
{
    /// <summary>Frame-timing behaviour itself.</summary>
    Frame = 0,

    /// <summary>Temperatures and vendor thermal-limit reports.</summary>
    Thermal = 1,

    /// <summary>Clocks, power draw, power limits, throttle state.</summary>
    Power = 2,

    /// <summary>CPU or GPU contention from other work on the machine.</summary>
    Contention = 3,

    /// <summary>Memory availability, commit pressure, paging.</summary>
    Memory = 4,

    /// <summary>Disk latency, queueing, throughput.</summary>
    Storage = 5,

    /// <summary>Kernel-mode time: deferred procedure calls and interrupts.</summary>
    Driver = 6,

    /// <summary>System configuration and changes to it.</summary>
    Configuration = 7,
}
