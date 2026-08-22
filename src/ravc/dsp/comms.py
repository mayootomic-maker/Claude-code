"""Voice-chat emulation: make clean speech sound like game comms.

A teammate on Counter-Strike does not sound like a studio recording of a
Russian speaker. They sound like a Russian speaker through a five-euro
headset, an automatic gain control fighting a desk fan, and a codec that
throws away everything above about 4 kHz -- and every so often a packet
does not arrive.

Each of those is modelled separately here so they can be dialled
independently, because the mix is what sells it:

* **bandwidth** -- Steam's voice path has historically been narrowband
  Speex, later CELT/Opus. Narrowband means an 8 kHz sample rate, so
  nothing above 4 kHz survives; that is the "tinny" quality.
* **codec coarseness** -- low-bitrate coders quantise heavily. Reducing
  the effective resolution reproduces the grainy edge on sibilants.
* **the microphone** -- a cheap boom mic has no bass, a hard presence
  peak around 3 kHz, and clips when its owner shouts.
* **automatic gain control** -- game comms ride the level hard, which
  pumps the noise floor up between words.
* **packet loss** -- brief dropouts, the giveaway of a real network.
* **the room** -- a fan, a mechanical keyboard, a television somewhere.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, List

import numpy as np

from .effects import compress, limit
from .filters import Biquad, apply_offline, db_to_linear
from .pitch import resample_to


# --------------------------------------------------------------------------
# Noise sources
# --------------------------------------------------------------------------

def pink_noise(count: int, seed: int = 0) -> np.ndarray:
    """Pink (1/f) noise, shaped in the frequency domain."""
    if count <= 0:
        return np.zeros(0, dtype=np.float32)
    rng = np.random.RandomState(seed)
    spectrum = np.fft.rfft(rng.randn(count))
    freqs = np.arange(spectrum.size, dtype=np.float64)
    freqs[0] = 1.0
    out = np.fft.irfft(spectrum / np.sqrt(freqs), n=count)
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak).astype(np.float32)


def fan_noise(count: int, sr: int, seed: int = 0) -> np.ndarray:
    """A desk or case fan: low broadband rumble plus blade tones."""
    if count <= 0:
        return np.zeros(0, dtype=np.float32)
    rumble = apply_offline([Biquad.low_pass(sr, 900), Biquad.low_pass(sr, 900)],
                           pink_noise(count, seed), sr)
    t = np.arange(count, dtype=np.float64) / sr
    rng = np.random.RandomState(seed + 1)
    base = 48.0 + rng.uniform(-6.0, 6.0)      # rotation rate
    tonal = np.zeros(count, dtype=np.float64)
    for harmonic, level in ((1, 0.5), (2, 0.3), (7, 0.18), (14, 0.08)):
        tonal += level * np.sin(2 * np.pi * base * harmonic * t
                                + rng.uniform(0, 2 * np.pi))
    out = rumble * 0.8 + (tonal / 1.06).astype(np.float32) * 0.35
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak).astype(np.float32)


def keyboard_noise(count: int, sr: int, rate_per_second: float = 3.5,
                   seed: int = 0) -> np.ndarray:
    """Mechanical keyboard clatter: sharp, bright, fast-decaying clicks."""
    if count <= 0:
        return np.zeros(0, dtype=np.float32)
    rng = np.random.RandomState(seed)
    out = np.zeros(count, dtype=np.float32)
    click_length = int(sr * 0.035)
    if click_length < 8:
        return out
    envelope = np.exp(-np.linspace(0.0, 14.0, click_length)).astype(np.float32)

    # Keystrokes cluster into bursts, the way typing actually happens.
    position = int(rng.uniform(0, sr))
    while position < count - click_length:
        burst = rng.randint(2, 9)
        for _ in range(burst):
            if position >= count - click_length:
                break
            click = rng.randn(click_length).astype(np.float32) * envelope
            click = apply_offline([Biquad.high_pass(sr, 1800),
                                   Biquad.peaking(sr, 3800, 8.0, 1.2)],
                                  click, sr)
            level = rng.uniform(0.5, 1.0)
            out[position:position + click_length] += click * level
            position += int(sr * rng.uniform(0.06, 0.16))
        position += int(sr * rng.uniform(0.4, 2.2))
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak).astype(np.float32)


def television_noise(count: int, sr: int, seed: int = 0) -> np.ndarray:
    """A television in another room: muffled, slowly-varying babble."""
    if count <= 0:
        return np.zeros(0, dtype=np.float32)
    rng = np.random.RandomState(seed)
    base = pink_noise(count, seed + 3)
    # Syllable-rate amplitude modulation is what makes noise read as speech.
    t = np.arange(count, dtype=np.float64) / sr
    envelope = np.ones(count, dtype=np.float64) * 0.45
    for frequency, depth in ((3.1, 0.30), (1.7, 0.18), (0.4, 0.16)):
        envelope += depth * np.sin(2 * np.pi * frequency * t
                                   + rng.uniform(0, 2 * np.pi))
    envelope = np.clip(envelope, 0.0, 1.4)
    muffled = apply_offline([Biquad.low_pass(sr, 1400),
                             Biquad.low_pass(sr, 1400),
                             Biquad.high_pass(sr, 120)], base, sr)
    out = (muffled * envelope).astype(np.float32)
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak).astype(np.float32)


NOISE_SOURCES = {
    "fan": fan_noise,
    "keyboard": keyboard_noise,
    "television": television_noise,
    "room": lambda count, sr, seed=0: pink_noise(count, seed) * 0.5,
}


# --------------------------------------------------------------------------
# Link degradations
# --------------------------------------------------------------------------

def codec_bandwidth(x: np.ndarray, sr: int, codec_rate: int) -> np.ndarray:
    """Squeeze through a codec's sample rate and back.

    Narrowband coding is not a gentle filter -- everything above half the
    codec rate is simply not transmitted.
    """
    if codec_rate <= 0 or codec_rate >= sr:
        return np.asarray(x, dtype=np.float32)
    return resample_to(resample_to(x, sr, codec_rate), codec_rate, sr)


def bitcrush(x: np.ndarray, bits: float) -> np.ndarray:
    """Coarse quantisation, standing in for a low-bitrate coder's grain."""
    arr = np.asarray(x, dtype=np.float32)
    if bits <= 0 or bits >= 16 or arr.size == 0:
        return arr
    levels = float(2 ** bits)
    peak = float(np.max(np.abs(arr))) or 1.0
    scaled = arr / peak
    return (np.round(scaled * levels) / levels * peak).astype(np.float32)


def packet_loss(x: np.ndarray, sr: int, probability: float,
                frame_ms: float = 20.0, seed: int = 0) -> np.ndarray:
    """Drop occasional frames, the way a real voice link does.

    Lost frames are faded rather than cut to silence: a hard edge clicks,
    and real decoders conceal a gap rather than muting outright.
    """
    arr = np.asarray(x, dtype=np.float32).copy()
    if probability <= 0 or arr.size == 0:
        return arr
    frame = max(32, int(sr * frame_ms / 1000))
    rng = np.random.RandomState(seed)
    fade = np.hanning(min(frame, 64)).astype(np.float32)
    half = fade.size // 2
    for start in range(0, arr.size - frame, frame):
        if rng.random_sample() >= probability:
            continue
        end = start + frame
        arr[start:end] = 0.0
        if half > 0:
            arr[max(0, start - half):start] *= fade[:half][::-1]
            arr[end:end + half] *= fade[:half]
    return arr


def microphone_response(x: np.ndarray, sr: int, presence_db: float = 7.0,
                        body_db: float = -8.0) -> np.ndarray:
    """A cheap headset boom mic: no bass, a hard presence peak."""
    stages = [
        Biquad.high_pass(sr, 180.0),
        Biquad.low_shelf(sr, 320.0, body_db),
        Biquad.peaking(sr, 3100.0, presence_db, q=1.1),
        Biquad.peaking(sr, 850.0, -4.0, q=0.9),
    ]
    return apply_offline(stages, x, sr)


def auto_gain(x: np.ndarray, sr: int, amount: float = 0.8) -> np.ndarray:
    """The AGC in a game client: rides the level and pumps the noise up."""
    if amount <= 0:
        return np.asarray(x, dtype=np.float32)
    return compress(x, sr, threshold_db=-32.0 - 6.0 * (1.0 - amount),
                    ratio=1.0 + 9.0 * amount, attack_ms=2.0,
                    release_ms=90.0, makeup_db=6.0 * amount, knee_db=3.0)


def overdrive(x: np.ndarray, gain_db: float) -> np.ndarray:
    """Input gain set too high, as it invariably is."""
    arr = np.asarray(x, dtype=np.float32)
    if gain_db <= 0:
        return arr
    driven = arr * db_to_linear(gain_db)
    return np.clip(driven, -1.0, 1.0).astype(np.float32)


# --------------------------------------------------------------------------
# Profiles
# --------------------------------------------------------------------------

@dataclass
class CommsProfile:
    """One voice-chat link, end to end."""

    enabled: bool = False
    codec_rate: int = 0            # 0 = full bandwidth
    band_low_hz: float = 0.0
    band_high_hz: float = 0.0
    bits: float = 0.0              # 0 = no quantisation
    mic_presence_db: float = 0.0
    mic_body_db: float = 0.0
    overdrive_db: float = 0.0
    agc: float = 0.0
    packet_loss: float = 0.0
    noise: Dict[str, float] = field(default_factory=dict)   # source -> dB
    noise_seed: int = 0
    output_db: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "CommsProfile":
        known = {f for f in cls.__dataclass_fields__}
        clean = {k: v for k, v in (data or {}).items() if k in known}
        if "noise" in clean and not isinstance(clean["noise"], dict):
            clean["noise"] = {}
        return cls(**clean)

    # -- processing ------------------------------------------------------

    def apply(self, samples: np.ndarray, sr: int) -> np.ndarray:
        """Run clean speech through the link."""
        arr = np.asarray(samples, dtype=np.float32).reshape(-1)
        if not self.enabled or arr.size == 0:
            return arr

        # 1. The microphone, before anything else touches the signal.
        if self.mic_presence_db or self.mic_body_db:
            arr = microphone_response(arr, sr, self.mic_presence_db,
                                      self.mic_body_db)
        # 2. Whatever else is in the room goes in through that same mic.
        if self.noise:
            arr = arr + self._noise_bed(arr.size, sr)
        # 3. The client's gain staging.
        if self.overdrive_db:
            arr = overdrive(arr, self.overdrive_db)
        if self.agc:
            arr = auto_gain(arr, sr, self.agc)
        # 4. The band the codec actually carries.
        stages: List[Biquad] = []
        if self.band_low_hz > 20:
            stages.append(Biquad.high_pass(sr, self.band_low_hz))
            stages.append(Biquad.high_pass(sr, self.band_low_hz))
        if self.band_high_hz and self.band_high_hz < sr / 2:
            stages.append(Biquad.low_pass(sr, self.band_high_hz))
            stages.append(Biquad.low_pass(sr, self.band_high_hz))
        if stages:
            arr = apply_offline(stages, arr, sr)
        if self.codec_rate:
            arr = codec_bandwidth(arr, sr, self.codec_rate)
        if self.bits:
            arr = bitcrush(arr, self.bits)
        # 5. The network.
        if self.packet_loss:
            arr = packet_loss(arr, sr, self.packet_loss, seed=self.noise_seed)
        # Every stage above only ever removes energy -- band-limiting, the
        # AGC's gain reduction, the limiter. Without restoring the level the
        # comms voice comes out 20 dB below everything else and is simply
        # too quiet to hear over a game.
        peak = float(np.max(np.abs(arr))) if arr.size else 0.0
        if peak > 1e-5:
            arr = (arr * (db_to_linear(-3.0) / peak)).astype(np.float32)
        if self.output_db:
            arr = (arr * db_to_linear(self.output_db)).astype(np.float32)
        return limit(arr, sr, ceiling_db=-1.0)

    def _noise_bed(self, count: int, sr: int) -> np.ndarray:
        bed = np.zeros(count, dtype=np.float32)
        for index, (name, level_db) in enumerate(sorted(self.noise.items())):
            source = NOISE_SOURCES.get(name)
            if source is None or level_db <= -90:
                continue
            bed = bed + source(count, sr, self.noise_seed + index * 17) * \
                db_to_linear(level_db)
        return bed


PROFILES: Dict[str, CommsProfile] = {
    "Off": CommsProfile(enabled=False),
    "CS:GO teammate": CommsProfile(
        enabled=True, codec_rate=11025, band_low_hz=220.0, band_high_hz=4200.0,
        bits=7.0, mic_presence_db=7.0, mic_body_db=-9.0, overdrive_db=7.0,
        agc=0.85, packet_loss=0.006,
        noise={"fan": -30.0, "keyboard": -26.0}, output_db=-1.0),
    "CS:GO, awful mic": CommsProfile(
        enabled=True, codec_rate=8000, band_low_hz=300.0, band_high_hz=3400.0,
        bits=5.5, mic_presence_db=10.0, mic_body_db=-13.0, overdrive_db=13.0,
        agc=1.0, packet_loss=0.02,
        noise={"fan": -22.0, "keyboard": -20.0, "television": -28.0},
        output_db=-1.0),
    "Discord, decent headset": CommsProfile(
        enabled=True, codec_rate=24000, band_low_hz=120.0, band_high_hz=9000.0,
        bits=0.0, mic_presence_db=3.0, mic_body_db=-3.0, overdrive_db=0.0,
        agc=0.45, packet_loss=0.0, noise={"room": -46.0}),
    "Speakerphone": CommsProfile(
        enabled=True, codec_rate=8000, band_low_hz=350.0, band_high_hz=3300.0,
        bits=6.0, mic_presence_db=5.0, mic_body_db=-14.0, overdrive_db=4.0,
        agc=0.9, packet_loss=0.004, noise={"room": -34.0}),
    "Family in the background": CommsProfile(
        enabled=True, codec_rate=11025, band_low_hz=240.0, band_high_hz=4000.0,
        bits=7.0, mic_presence_db=6.0, mic_body_db=-8.0, overdrive_db=6.0,
        agc=0.8, packet_loss=0.005,
        noise={"television": -20.0, "fan": -32.0, "keyboard": -34.0}),
    "Military radio": CommsProfile(
        enabled=True, codec_rate=8000, band_low_hz=450.0, band_high_hz=3000.0,
        bits=5.0, mic_presence_db=9.0, mic_body_db=-16.0, overdrive_db=16.0,
        agc=1.0, packet_loss=0.012, noise={"room": -26.0}),
}

DEFAULT_PROFILE = "Off"


def profile_names() -> List[str]:
    return list(PROFILES)


def get_profile(name: str) -> CommsProfile:
    return CommsProfile.from_dict(
        PROFILES.get(name, PROFILES[DEFAULT_PROFILE]).to_dict())
