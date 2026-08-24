using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace FrameDoctor.Platform.Windows.Processes;

/// <summary>The process that owns the foreground window, and what can be established about it.</summary>
/// <param name="ProcessId">The owning process.</param>
/// <param name="ImagePath">
/// Full path to its executable, or empty when it could not be read — which happens for processes
/// running at a higher integrity level, and is a fact rather than an error.
/// </param>
/// <param name="SignerSubject">
/// Authenticode signer subject, or null when the image is unsigned or the signature could not be
/// read. Unsigned and unverifiable are not distinguished, because neither identifies the binary.
/// </param>
public readonly record struct ForegroundProcess(int ProcessId, string ImagePath, string? SignerSubject);

/// <summary>
/// Reads which process the user is currently looking at.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately a poll rather than a <c>SetWinEventHook</c>. The hook is the lower-overhead
/// answer for an application that needs every focus change; this needs only to know what has been
/// in front for the last couple of seconds, and a hook would put our callback on the code path of
/// every foreground change on the machine — including the game's own — which is a place invariant
/// 8 says we do not belong.
/// </para>
/// <para>
/// The signer lookup is cached by path and write time. Reading an Authenticode signature parses
/// the PE and walks a certificate chain; doing that every poll of every session would be a
/// measurable cost for an answer that cannot change while the file is open.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class ForegroundWatcher
{
    private readonly Dictionary<string, (DateTime WrittenUtc, string? Signer)> _signers = new(
        StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Reads the foreground process, or null when there is not one.
    /// </summary>
    /// <remarks>
    /// Null is a real state: during a desktop switch, on the lock screen, and briefly while a
    /// fullscreen application changes mode, there is no foreground window. Reporting it as
    /// "process 0" would give the detector a candidate that does not exist.
    /// </remarks>
    public ForegroundProcess? Read()
    {
        var window = ForegroundNative.GetForegroundWindow();
        if (window == 0) return null;

        _ = ForegroundNative.GetWindowThreadProcessId(window, out var processId);
        if (processId <= 0) return null;

        var path = ImagePathOf(processId);

        return new ForegroundProcess(processId, path, path.Length == 0 ? null : SignerOf(path));
    }

    /// <summary>
    /// The full image path, or empty when it cannot be read.
    /// </summary>
    /// <remarks>
    /// <c>QueryFullProcessImageName</c> under <c>PROCESS_QUERY_LIMITED_INFORMATION</c>, which is
    /// the right of the two: the older <c>PROCESS_QUERY_INFORMATION</c> is denied for processes at
    /// a higher integrity level even when only the name is wanted.
    /// </remarks>
    private static string ImagePathOf(int processId)
    {
        var handle = ForegroundNative.OpenProcess(
            ForegroundNative.ProcessQueryLimitedInformation, false, processId);

        if (handle == 0) return string.Empty;

        try
        {
            return Read(handle, 260) ?? Read(handle, 32_768) ?? string.Empty;
        }
        finally
        {
            _ = ForegroundNative.CloseHandle(handle);
        }

        // A pointer rather than a marshalled array: this assembly's other imports are
        // source-generated and marshaller-free, and a char[] parameter would force runtime
        // marshalling back on for the whole assembly.
        static unsafe string? Read(nint handle, int capacity)
        {
            var buffer = new char[capacity];
            var size = capacity;

            fixed (char* p = buffer)
            {
                // The second call exists for a path longer than MAX_PATH. Two fixed sizes rather
                // than a growing loop, because a loop here would spin on any other failure.
                return ForegroundNative.QueryFullProcessImageName(handle, 0, p, ref size)
                    ? new string(buffer, 0, size)
                    : null;
            }
        }
    }

    /// <summary>The signer subject, cached against the file's write time.</summary>
    private string? SignerOf(string path)
    {
        DateTime written;
        try
        {
            written = File.GetLastWriteTimeUtc(path);
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }

        if (_signers.TryGetValue(path, out var cached) && cached.WrittenUtc == written)
            return cached.Signer;

        var signer = ReadSigner(path);
        _signers[path] = (written, signer);
        return signer;
    }

    /// <summary>
    /// Reads the Authenticode subject, or null.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This establishes <b>who the certificate says signed it</b>. It deliberately does not
    /// validate the chain or check revocation: the deny-list uses the subject to avoid excluding
    /// the wrong binary, not to make a trust decision, and a revocation check would put a network
    /// timeout on the collector's path.
    /// </para>
    /// <para>
    /// Every failure is the same answer — null — because to this caller they are the same fact:
    /// the binary was not positively identified, so the deny-list does not apply to it.
    /// </para>
    /// </remarks>
    private static string? ReadSigner(string path)
    {
        try
        {
            using var certificate = X509CertificateLoader.LoadCertificateFromFile(path);
            return certificate.Subject;
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}

/// <summary>The foreground and process-identity entry points.</summary>
[SupportedOSPlatform("windows")]
internal static partial class ForegroundNative
{
    /// <summary>Enough to read a process's name; granted where the older right is denied.</summary>
    internal const int ProcessQueryLimitedInformation = 0x1000;

    [LibraryImport("user32.dll")]
    internal static partial nint GetForegroundWindow();

    [LibraryImport("user32.dll")]
    internal static partial uint GetWindowThreadProcessId(nint window, out int processId);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandleCore(nint handle);

    internal static bool CloseHandle(nint handle) => CloseHandleCore(handle);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    internal static partial nint OpenProcess(
        int desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        int processId);

    [LibraryImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool QueryFullProcessImageName(
        nint process,
        int flags,
        char* buffer,
        ref int size);
}
