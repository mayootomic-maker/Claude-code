using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace FrameDoctor.Shell;

/// <summary>
/// The application window: a web view, a telemetry bridge, and nothing else.
/// </summary>
/// <remarks>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: this compiles in the Linux container this repository is
/// developed in and has never executed. Every visual judgement made so far comes from headless
/// screenshots of the frontend, not from this window.
/// </remarks>
public partial class MainWindow : Window, IDisposable
{
    /// <summary>
    /// A virtual host name for the bundled frontend.
    /// </summary>
    /// <remarks>
    /// The frontend is served from a mapped folder under a synthetic host rather than from
    /// <c>file://</c>. File URLs get a unique opaque origin in Chromium, which disables
    /// <c>localStorage</c>, breaks module imports and makes every behaviour subtly different
    /// from what the frontend was developed and screenshotted against.
    /// </remarks>
    private const string VirtualHost = "app.framedoctor.local";

    private TelemetryBridge? _bridge;
    private ControlBridge? _control;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await StartWebViewAsync().ConfigureAwait(true);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowStartupFailure(
                "FrameDoctor draws its interface with the Microsoft Edge WebView2 runtime, which " +
                "is not installed on this machine. It ships with current versions of Windows and " +
                "can be installed separately from Microsoft. Measurement is unaffected: the " +
                "engine records sessions whether or not this window can open.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // A user profile that cannot be written is the other realistic failure: a roaming
            // profile, a locked-down machine, a full disk.
            ShowStartupFailure(
                "FrameDoctor could not create its display data folder. " + ex.Message);
        }
    }

    private async Task StartWebViewAsync()
    {
        // The user data folder is explicit rather than defaulted. WebView2's default is beside
        // the executable, which fails outright when the application is installed under Program
        // Files and the user is not an administrator.
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FrameDoctor",
            "WebView2");

        Directory.CreateDirectory(userData);

        var options = new CoreWebView2EnvironmentOptions
        {
            // The frontend is local, bundled and offline (invariant 7). Nothing it does needs a
            // network stack, and switching the renderer off the discrete GPU keeps the interface
            // from competing with the game for the exact resource being measured.
            AdditionalBrowserArguments =
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection " +
                "--disable-background-timer-throttling " +
                "--force_low_power_gpu",
        };

        var environment = await CoreWebView2Environment
            .CreateAsync(browserExecutableFolder: null, userData, options)
            .ConfigureAwait(true);

        await Host.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

        var core = Host.CoreWebView2;
        var settings = core.Settings;

        // Everything a browser offers that an instrument does not need. Each of these is a
        // surface that can misbehave in front of a user who did not ask for a browser.
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsZoomControlEnabled = false;

#if DEBUG
        settings.AreDevToolsEnabled = true;
#else
        settings.AreDevToolsEnabled = false;
#endif

        var frontend = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (!Directory.Exists(frontend))
        {
            ShowStartupFailure(
                "The interface files are missing from this installation. Reinstalling " +
                "FrameDoctor will restore them. Sessions already recorded are not affected.");
            return;
        }

        core.SetVirtualHostNameToFolderMapping(
            VirtualHost, frontend, CoreWebView2HostResourceAccessKind.Allow);

        // A navigation away from the bundled frontend can only come from something going wrong,
        // and there is nowhere for a user to browse to. Blocking it keeps the window from ever
        // becoming an unlabelled browser.
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
                args.Cancel = true;
        };

        // An external link opens in the user's browser rather than replacing the instrument.
        core.NewWindowRequested += (_, args) => args.Handled = true;

        _bridge = new TelemetryBridge(core);
        _bridge.Start();

        // The other direction, on its own pipe. Started before navigation so a settings screen
        // opened immediately has somewhere to send its first request.
        _control = new ControlBridge(core);
        _control.Start();

        core.Navigate($"https://{VirtualHost}/index.html");
    }

    private void ShowStartupFailure(string detail)
    {
        StartupFailureDetail.Text = detail;
        StartupFailure.Visibility = Visibility.Visible;
        Host.Visibility = Visibility.Collapsed;
    }

    private void OnClosed(object? sender, EventArgs e) => Dispose();

    /// <summary>
    /// Releases the telemetry bridge. Does not stop the engine.
    /// </summary>
    /// <remarks>
    /// Closing the window disconnects from the engine and nothing more. A capture the user
    /// started keeps running, which is the whole reason the two are separate processes.
    /// </remarks>
    public void Dispose()
    {
        _bridge?.Dispose();
        _bridge = null;
        _control?.Dispose();
        _control = null;
        GC.SuppressFinalize(this);
    }
}
