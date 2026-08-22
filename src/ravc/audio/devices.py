"""Audio device discovery, including virtual-cable detection.

To be heard in Discord, Zoom, OBS or a game, the changed voice has to come
out of a device those apps can select as a *microphone*.  On Windows that
means a virtual audio cable: this module finds one if it is installed and
tells the user what to do if it is not.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from .._optional import have

# Ordered by preference.  Matching is case-insensitive substring.
VIRTUAL_CABLE_HINTS: Tuple[Tuple[str, str], ...] = (
    ("cable input", "VB-Audio Virtual Cable"),
    ("vb-audio point", "VB-Audio Cable"),
    ("voicemeeter input", "VoiceMeeter"),
    ("voicemeeter aux input", "VoiceMeeter Aux"),
    ("voicemeeter vaio3 input", "VoiceMeeter VAIO3"),
    ("line 1 (virtual audio cable)", "Virtual Audio Cable"),
    ("virtual audio cable", "Virtual Audio Cable"),
    ("blackhole", "BlackHole"),
    ("pulse", "PulseAudio null sink"),
)

VB_CABLE_DOWNLOAD = "https://vb-audio.com/Cable/"


class AudioUnavailable(RuntimeError):
    """Raised when PortAudio / sounddevice is not usable."""


@dataclass(frozen=True)
class Device:
    index: int
    name: str
    max_input_channels: int
    max_output_channels: int
    default_samplerate: float
    hostapi_name: str = ""

    @property
    def is_input(self) -> bool:
        return self.max_input_channels > 0

    @property
    def is_output(self) -> bool:
        return self.max_output_channels > 0

    @property
    def label(self) -> str:
        return f"{self.name}" + (f"  [{self.hostapi_name}]" if self.hostapi_name else "")

    @property
    def virtual_cable_brand(self) -> Optional[str]:
        low = self.name.lower()
        for hint, brand in VIRTUAL_CABLE_HINTS:
            if hint in low:
                return brand
        return None


def sounddevice_available() -> bool:
    return have("sounddevice")


def _sd():
    try:
        import sounddevice as sd
    except Exception as exc:  # pragma: no cover - depends on the host
        raise AudioUnavailable(
            "PortAudio is not available. Install the 'sounddevice' package "
            "(pip install sounddevice); on Linux also install libportaudio2."
        ) from exc
    return sd


def list_devices() -> List[Device]:
    sd = _sd()
    try:
        hostapis = sd.query_hostapis()
    except Exception:
        hostapis = []
    out: List[Device] = []
    for index, info in enumerate(sd.query_devices()):
        api = ""
        hostapi_index = info.get("hostapi")
        if isinstance(hostapi_index, int) and hostapi_index < len(hostapis):
            api = hostapis[hostapi_index].get("name", "")
        out.append(Device(
            index=index,
            name=str(info.get("name", f"device {index}")),
            max_input_channels=int(info.get("max_input_channels", 0)),
            max_output_channels=int(info.get("max_output_channels", 0)),
            default_samplerate=float(info.get("default_samplerate", 44100.0)),
            hostapi_name=api,
        ))
    return out


def input_devices() -> List[Device]:
    return [d for d in list_devices() if d.is_input]


def output_devices() -> List[Device]:
    return [d for d in list_devices() if d.is_output]


def default_input() -> Optional[Device]:
    return _default(0)


def default_output() -> Optional[Device]:
    return _default(1)


def _default(slot: int) -> Optional[Device]:
    sd = _sd()
    try:
        index = sd.default.device[slot]
    except Exception:
        return None
    if index is None or index < 0:
        return None
    for device in list_devices():
        if device.index == index:
            return device
    return None


def find_virtual_cable(devices: Optional[List[Device]] = None) -> Optional[Device]:
    """The output device that other apps will see as a microphone."""
    candidates = devices if devices is not None else output_devices()
    ranked: List[Tuple[int, Device]] = []
    for device in candidates:
        if not device.is_output:
            continue
        low = device.name.lower()
        for rank, (hint, _brand) in enumerate(VIRTUAL_CABLE_HINTS):
            if hint in low:
                ranked.append((rank, device))
                break
    if not ranked:
        return None
    ranked.sort(key=lambda pair: pair[0])
    return ranked[0][1]


def find_device_by_name(name: str, want_input: bool) -> Optional[Device]:
    """Resolve a saved device name back to an index after a reboot.

    Device indices are not stable across reboots or USB re-plugs, so the
    config stores names and resolves them here, falling back to a partial
    match before giving up and using the system default.
    """
    if not name:
        return None
    pool = input_devices() if want_input else output_devices()
    for device in pool:
        if device.name == name:
            return device
    low = name.lower()
    for device in pool:
        if low in device.name.lower() or device.name.lower() in low:
            return device
    return None


def describe_routing() -> str:
    """A human-readable summary for the UI / CLI diagnostics."""
    if not sounddevice_available():
        return "Audio backend unavailable (sounddevice / PortAudio not installed)."
    cable = find_virtual_cable()
    if cable:
        brand = cable.virtual_cable_brand or "virtual cable"
        return (f"Virtual cable found: {cable.name} ({brand}).\n"
                f"In Discord/Zoom/OBS, choose the matching *input* device as "
                f"your microphone.")
    return ("No virtual audio cable detected. Install VB-CABLE from "
            f"{VB_CABLE_DOWNLOAD} to route the changed voice into Discord, "
            "Zoom, OBS or a game. Without it you can still listen on your "
            "own speakers and use the file and type-to-speak modes.")
