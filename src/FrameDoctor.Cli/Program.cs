using System.Globalization;
using FrameDoctor.Cli;
using FrameDoctor.Simulation;

// A console harness over the real diagnostic pipeline. It exists so the engine can be
// exercised on a real machine before the collectors and the UI exist, and so the
// win-x64 publish path is validated rather than assumed.
//
// It is NOT FrameDoctor. It reads no real telemetry: every sample it processes comes from
// the simulation source, which is the only sanctioned synthetic transport in the product.

return args switch
{
    [] or ["--help"] or ["-h"] => Commands.Usage(),
    ["list"] => Commands.List(),
    ["run", var id] => Commands.Run(id),
    ["run", var id, "--seed", var seed] when int.TryParse(seed, CultureInfo.InvariantCulture, out var s)
        => Commands.Run(id, s),
    ["run-all"] => Commands.RunAll(),
    _ => Commands.Unknown(args),
};
