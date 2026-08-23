using FrameDoctor.Simulation.Scenarios;

namespace FrameDoctor.Simulation;

/// <summary>
/// Every simulation scenario the product ships.
/// </summary>
/// <remarks>
/// <para>
/// The list starts at six, not eighteen, and grows under one rule: <b>a scenario with no
/// detector consuming it tests nothing.</b> Twelve scenarios describing failures no diagnosis
/// covers would exercise rendering while quietly enshrining twelve guesses about what those
/// failures look like — and a detector tuned against a guess is beautiful on the fixture and
/// useless on a real machine.
/// </para>
/// <para>
/// Two of the six deliberately have no cause to find: <see cref="HealthyScenario"/> asserts we
/// can say "nothing happened", and <see cref="UnexplainedHitchScenario"/> asserts we can say
/// "something happened and I cannot tell you why". Those two matter more than the four that
/// have answers.
/// </para>
/// </remarks>
public static class ScenarioCatalog
{
    public static IReadOnlyList<SimulationScenario> All { get; } =
    [
        new HealthyScenario(),
        new BackgroundCpuSpikeScenario(),
        new CpuFrequencyCollapseScenario(),
        new GpuThermalThrottleScenario(),
        new GpuPowerLimitScenario(),
        new PagingStormScenario(),
        new UnexplainedHitchScenario(),
    ];

    public static SimulationScenario ById(string id) =>
        All.FirstOrDefault(s => s.Id == id)
        ?? throw new ArgumentOutOfRangeException(nameof(id), id, "No such scenario.");
}
