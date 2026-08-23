using System.Threading;
using System.Windows;

namespace FrameDoctor.Shell;

/// <summary>
/// The user interface process.
/// </summary>
/// <remarks>
/// <para>
/// Presentation only, by invariant 2. It holds no collectors, no detector and no rules; it
/// renders what the engine sends and sends back what the user asked for. The consequence that
/// matters is that closing this window ends nothing — the engine keeps measuring.
/// </para>
/// </remarks>
public partial class App : Application, IDisposable
{
    /// <summary>
    /// Guards against a second shell attaching to the same engine.
    /// </summary>
    /// <remarks>
    /// The telemetry channel serves one client, so a second window would either be starved or
    /// would steal the first one's stream. Named per user rather than globally: two people
    /// signed into one machine each get their own engine, their own sessions and their own
    /// window.
    /// </remarks>
    private Mutex? _singleInstance;

    protected override void OnStartup(StartupEventArgs e)
    {
        var name = $@"Local\FrameDoctor.Shell.{Environment.UserName}";
        _singleInstance = new Mutex(initiallyOwned: true, name, out var isFirst);

        if (!isFirst)
        {
            // No dialog. A second launch of a running application should bring the first one
            // forward, and until that is implemented, silently doing nothing is better than an
            // error box for something the user did not do wrong.
            Shutdown(0);
            return;
        }

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Dispose();
        base.OnExit(e);
    }

    public void Dispose()
    {
        _singleInstance?.Dispose();
        _singleInstance = null;
        GC.SuppressFinalize(this);
    }
}
