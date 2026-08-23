using System.Runtime.Versioning;
using System.Text;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Platform.Windows.Gpu;

/// <summary>
/// GPU telemetry from the NVIDIA Management Library.
/// </summary>
/// <remarks>
/// <para>
/// Still Tier 0: <c>nvml.dll</c> ships with the display driver, needs no elevation and installs
/// nothing. It is nonetheless the richest source FrameDoctor has, because it is the only one
/// that reports <i>why</i> the hardware reduced its clocks. That single call is what makes GPU
/// throttling a diagnosis rather than a correlation.
/// </para>
/// <para>
/// Absent NVML is the normal state on an AMD or Intel machine, not an error. The source reports
/// itself unavailable with a reason, and the diagnostic engine treats the metrics as blind spots
/// that cap confidence rather than as evidence against anything.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: cannot execute on the Linux container this repository is
/// developed in.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class NvmlGpuSensorSource : ISensorSource
{
    /// <summary>One NVML reading and whether the card still answers it.</summary>
    private sealed class Reading
    {
        public required MetricId Metric { get; init; }
        public required Unit Unit { get; init; }
        public required Func<nint, (uint Status, double Value)> Read { get; init; }
        public Quality Quality { get; init; } = Quality.Exact;
        public bool Retired { get; set; }
        public uint LastStatus { get; set; } = NvmlReturn.Uninitialized;
    }

    private readonly TimeSpan _interval;
    private readonly List<Reading> _readings = [];
    private nint _device;
    private bool _initialized;
    private string _deviceName = "NVIDIA GPU";

    /// <summary>
    /// Whether the driver still exports the current name for the clock-reason call.
    /// </summary>
    /// <remarks>
    /// NVIDIA renamed it from "throttle reasons" to "clocks event reasons" and kept both exports
    /// for a while. Older drivers have only the deprecated name, so the source resolves which
    /// one works once and then stops asking.
    /// </remarks>
    private bool _useDeprecatedThrottleCall;

    public NvmlGpuSensorSource(TimeSpan? interval = null)
    {
        // 4 Hz, matching the counter source, so GPU and CPU series line up in a correlation
        // window without one being interpolated onto the other's grid.
        _interval = interval ?? TimeSpan.FromMilliseconds(250);
    }

    public SourceId Id => SourceId.NvidiaNvml;

    public string DisplayName => _initialized ? $"NVIDIA NVML ({_deviceName})" : "NVIDIA NVML";

    public IReadOnlyList<MetricId> DeclaredMetrics { get; } =
    [
        MetricId.GpuUtilization,
        MetricId.GpuClockCore,
        MetricId.GpuClockMemory,
        MetricId.GpuTemperature,
        MetricId.GpuPower,
        MetricId.GpuVramUsed,
        MetricId.GpuVramTotal,
        MetricId.GpuThrottleReason,
    ];

    public TimeSpan Interval => _interval;

    public int MaxSamplesPerPoll => DeclaredMetrics.Count + 1;

    public ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        uint init;
        try
        {
            init = NvmlNative.Init();
        }
        catch (DllNotFoundException)
        {
            // The ordinary case on a machine with no NVIDIA GPU. An exception here is a fact
            // about the hardware, so it is answered rather than propagated.
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, UnavailableReason.NoSensor,
                "No NVIDIA management library is installed, which is normal without an NVIDIA GPU."));
        }
        catch (EntryPointNotFoundException)
        {
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, UnavailableReason.NoSensor,
                "The installed NVIDIA management library is too old for FrameDoctor to use."));
        }

        if (init != NvmlReturn.Success)
        {
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, NvmlStatus.Classify(init).Reason,
                NvmlStatus.Describe(init, _deviceName)));
        }

        _initialized = true;

        // Device 0 deliberately. A multi-GPU machine needs the adapter the game is presenting
        // on, which is a question the frame source can answer and this one cannot; picking the
        // wrong card would attribute one GPU's temperature to another's frames. Tracked as a
        // known limitation rather than guessed at.
        if (NvmlNative.GetDeviceCount(out var count) != NvmlReturn.Success || count == 0)
        {
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, UnavailableReason.NoSensor,
                "The NVIDIA driver is loaded but reports no devices."));
        }

        var handleStatus = NvmlNative.GetDeviceHandle(0, out _device);
        if (handleStatus != NvmlReturn.Success)
        {
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, NvmlStatus.Classify(handleStatus).Reason,
                NvmlStatus.Describe(handleStatus, _deviceName)));
        }

        _deviceName = ReadDeviceName(_device);
        ResolveThrottleCall(_device);
        BuildReadings();

        var metrics = new List<MetricAvailability>();
        foreach (var reading in _readings)
        {
            var (status, _) = reading.Read(_device);
            reading.LastStatus = status;
            if (NvmlStatus.IsPermanent(status)) reading.Retired = true;

            metrics.Add(status == NvmlReturn.Success
                ? MetricAvailability.Available(reading.Metric)
                : MetricAvailability.Missing(
                    reading.Metric, NvmlStatus.Classify(status).Reason,
                    NvmlStatus.Describe(status, _deviceName)));
        }

        // NVML exposes no hotspot channel at all. Named so the System view can say why rather
        // than leaving a dash the user has to interpret.
        metrics.Add(MetricAvailability.Missing(
            MetricId.GpuTemperatureHotspot,
            UnavailableReason.NotExposedByVendor,
            "NVIDIA's management library does not expose a hotspot temperature. Reading it needs " +
            "a third-party kernel driver, which FrameDoctor does not install."));

        return ValueTask.FromResult(SourceProbe.Working(Id, DisplayName, metrics));
    }

    private static string ReadDeviceName(nint device)
    {
        Span<byte> buffer = stackalloc byte[NvmlNative.DeviceNameBufferSize];

        if (NvmlNative.GetName(device, buffer, (uint)buffer.Length) != NvmlReturn.Success)
            return "NVIDIA GPU";

        var end = buffer.IndexOf((byte)0);
        return Encoding.UTF8.GetString(end < 0 ? buffer : buffer[..end]);
    }

    private void ResolveThrottleCall(nint device)
    {
        try
        {
            if (NvmlNative.GetCurrentClocksEventReasons(device, out _) != NvmlReturn.FunctionNotFound)
                return;
        }
        catch (EntryPointNotFoundException)
        {
            // Older driver: only the deprecated export exists.
        }

        _useDeprecatedThrottleCall = true;
    }

    private uint ReadThrottleReasons(nint device, out ulong reasons)
    {
        try
        {
            return _useDeprecatedThrottleCall
                ? NvmlNative.GetCurrentClocksThrottleReasons(device, out reasons)
                : NvmlNative.GetCurrentClocksEventReasons(device, out reasons);
        }
        catch (EntryPointNotFoundException)
        {
            reasons = 0;
            return NvmlReturn.FunctionNotFound;
        }
    }

    private void BuildReadings()
    {
        const double BytesPerMegabyte = 1024.0 * 1024.0;

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuUtilization,
            Unit = Unit.Percent,
            Read = d =>
            {
                var status = NvmlNative.GetUtilizationRates(d, out var u);
                return (status, u.Gpu);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuClockCore,
            Unit = Unit.Megahertz,
            Read = d =>
            {
                var status = NvmlNative.GetClockInfo(d, NvmlNative.ClockGraphics, out var mhz);
                return (status, mhz);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuClockMemory,
            Unit = Unit.Megahertz,
            Read = d =>
            {
                var status = NvmlNative.GetClockInfo(d, NvmlNative.ClockMemory, out var mhz);
                return (status, mhz);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuTemperature,
            Unit = Unit.Celsius,
            Read = d =>
            {
                var status = NvmlNative.GetTemperature(d, NvmlNative.TemperatureGpu, out var c);
                return (status, c);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuPower,
            Unit = Unit.Watts,
            Read = d =>
            {
                // Milliwatts. Publishing the raw number would report a 285 W card as drawing
                // 285,000 W, which is obvious — and a 0.285 W reading from the inverse mistake
                // would not be.
                var status = NvmlNative.GetPowerUsage(d, out var milliwatts);
                return (status, milliwatts / 1000.0);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuVramUsed,
            Unit = Unit.Megabytes,
            Read = d =>
            {
                var status = NvmlNative.GetMemoryInfo(d, out var memory);
                return (status, memory.Used / BytesPerMegabyte);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuVramTotal,
            Unit = Unit.Megabytes,
            Read = d =>
            {
                var status = NvmlNative.GetMemoryInfo(d, out var memory);
                return (status, memory.Total / BytesPerMegabyte);
            },
        });

        _readings.Add(new Reading
        {
            Metric = MetricId.GpuThrottleReason,
            Unit = Unit.Flags,
            Read = d =>
            {
                var status = ReadThrottleReasons(d, out var reasons);
                return (status, reasons);
            },
        });
    }

    public ValueTask StartAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!_initialized) throw new InvalidOperationException("Probe the source before starting it.");

        return ValueTask.CompletedTask;
    }

    public int Poll(MonotonicTimestamp now, Span<TelemetrySample> destination)
    {
        if (destination.Length < MaxSamplesPerPoll)
            throw new ArgumentException(
                $"Needs room for {MaxSamplesPerPoll} samples, got {destination.Length}.",
                nameof(destination));

        var written = 0;

        foreach (var reading in _readings)
        {
            if (reading.Retired)
            {
                destination[written++] = TelemetrySample.Unavailable(
                    now, reading.Metric, Id, NvmlStatus.Classify(reading.LastStatus).Reason,
                    reading.Unit);
                continue;
            }

            var (status, value) = reading.Read(_device);
            reading.LastStatus = status;

            if (status == NvmlReturn.Success)
            {
                destination[written++] = TelemetrySample.Measured(
                    now, reading.Metric, Id, value, reading.Unit, reading.Quality);
                continue;
            }

            if (NvmlStatus.IsPermanent(status)) reading.Retired = true;

            var (state, reason) = NvmlStatus.Classify(status);
            destination[written++] = state switch
            {
                Availability.Denied => TelemetrySample.Denied(now, reading.Metric, Id, reason, reading.Unit),
                Availability.Failed => TelemetrySample.Failed(now, reading.Metric, Id, reason, reading.Unit),
                _ => TelemetrySample.Unavailable(now, reading.Metric, Id, reason, reading.Unit),
            };
        }

        // Stated every poll rather than only at probe time, so a stored session records that the
        // channel was absent throughout rather than leaving a gap that reads as a dropout.
        destination[written++] = TelemetrySample.Unavailable(
            now, MetricId.GpuTemperatureHotspot, Id, UnavailableReason.NotExposedByVendor, Unit.Celsius);

        return written;
    }

    public ValueTask DisposeAsync()
    {
        if (_initialized)
        {
            // The status is not acted on: this is teardown, and there is no recovery from a
            // failed shutdown other than leaving the process, which is happening anyway.
            try { _ = NvmlNative.Shutdown(); }
            catch (DllNotFoundException) { /* the library went away with the driver */ }
            _initialized = false;
        }

        _readings.Clear();
        return ValueTask.CompletedTask;
    }
}
