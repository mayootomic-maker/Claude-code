"""Pitch and formant shifting.

Two independent controls, which is what you want for a voice changer:

* **pitch** moves the fundamental -- how high or low the voice sits;
* **formant** moves the resonances of the vocal tract -- how *big* the
  speaker seems.  Dropping formants without dropping pitch is what turns a
  neutral voice into a large, chest-heavy one, and it is the difference
  between "sped-up/slowed-down tape" and a believable different person.

Both are implemented with a phase vocoder plus cepstral envelope warping,
in plain numpy, so there is no scipy/librosa dependency to package.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

N_FFT = 2048
HOP = N_FFT // 4


def _window(n: int) -> np.ndarray:
    return np.hanning(n + 1)[:n].astype(np.float64)


def stft(x: np.ndarray, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    """Complex STFT, frames along axis 1."""
    x = np.asarray(x, dtype=np.float64)
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    win = _window(n_fft)
    padded = np.pad(x, (n_fft // 2, n_fft // 2), mode="reflect")
    # Pad the tail out to a whole number of hops plus one frame, so every
    # input sample is covered by a full overlap-add and the reconstruction is
    # exact at the edges rather than just in the interior.
    remainder = (padded.size - n_fft) % hop
    if remainder:
        padded = np.pad(padded, (0, hop - remainder))
    padded = np.pad(padded, (0, n_fft))
    n_frames = 1 + (padded.size - n_fft) // hop
    idx = np.arange(n_fft)[:, None] + hop * np.arange(n_frames)[None, :]
    frames = padded[idx] * win[:, None]
    return np.fft.rfft(frames, n=n_fft, axis=0)


def istft(spec: np.ndarray, n_fft: int = N_FFT, hop: int = HOP,
          length: Optional[int] = None) -> np.ndarray:
    """Inverse STFT with Hann window-sum normalisation (COLA)."""
    win = _window(n_fft)
    frames = np.fft.irfft(spec, n=n_fft, axis=0) * win[:, None]
    n_frames = frames.shape[1]
    out_len = n_fft + hop * (n_frames - 1)
    out = np.zeros(out_len, dtype=np.float64)
    norm = np.zeros(out_len, dtype=np.float64)
    for i in range(n_frames):
        start = i * hop
        out[start:start + n_fft] += frames[:, i]
        norm[start:start + n_fft] += win * win
    floor = 1e-8 * max(float(norm.max()), 1e-12)
    out = out / np.where(norm < floor, 1.0, norm)
    out = out[n_fft // 2: out.size - n_fft // 2]
    if length is not None:
        if out.size < length:
            out = np.pad(out, (0, length - out.size))
        out = out[:length]
    return out


def _peak_regions(magnitude: np.ndarray) -> np.ndarray:
    """For each bin, the index of the spectral peak that owns it.

    A partial of a voiced sound occupies several bins around its peak. Those
    bins have to keep their phase relationship to the peak, or the partial
    smears -- which is exactly what "phasiness" is.
    """
    n = magnitude.size
    interior = np.arange(1, n - 1)
    is_peak = np.zeros(n, dtype=bool)
    is_peak[interior] = ((magnitude[interior] > magnitude[interior - 1])
                         & (magnitude[interior] > magnitude[interior + 1]))
    peaks = np.flatnonzero(is_peak)
    if peaks.size == 0:
        return np.arange(n)
    # Assign every bin to the nearer of the two peaks surrounding it.
    right = np.searchsorted(peaks, np.arange(n))
    right = np.clip(right, 0, peaks.size - 1)
    left = np.clip(right - 1, 0, peaks.size - 1)
    choose_left = (np.abs(np.arange(n) - peaks[left])
                   <= np.abs(np.arange(n) - peaks[right]))
    return np.where(choose_left, peaks[left], peaks[right])


def phase_vocoder(spec: np.ndarray, rate: float, hop: int = HOP,
                  phase_lock: bool = True) -> np.ndarray:
    """Time-stretch an STFT by ``rate`` (>1 = faster/shorter).

    With ``phase_lock`` the bins around each spectral peak are given phases
    rigidly tied to that peak's, rather than each advancing independently.
    A plain phase vocoder lets the bins of one partial drift apart, which
    smears the waveform within every pitch period and is heard as the
    hollow, robotic "phasiness" the algorithm is notorious for. This is
    Laroche and Dolson's identity phase locking, and it costs one extra
    gather per frame.
    """
    if abs(rate - 1.0) < 1e-6:
        return spec
    n_bins, n_frames = spec.shape
    n_fft = 2 * (n_bins - 1)
    time_steps = np.arange(0, n_frames, rate)
    expected = 2.0 * np.pi * hop * np.arange(n_bins) / n_fft

    magnitude = np.abs(spec)
    phase = np.angle(spec)
    out = np.zeros((n_bins, time_steps.size), dtype=np.complex128)
    acc = phase[:, 0].copy()

    padded_mag = np.concatenate([magnitude, magnitude[:, -1:]], axis=1)
    padded_phase = np.concatenate([phase, phase[:, -1:]], axis=1)

    for i, step in enumerate(time_steps):
        left = int(np.floor(step))
        frac = step - left
        mag = (1.0 - frac) * padded_mag[:, left] + frac * padded_mag[:, left + 1]

        if phase_lock:
            owner = _peak_regions(mag)
            current = padded_phase[:, left]
            locked = acc[owner] + (current - current[owner])
        else:
            locked = acc
        out[:, i] = mag * np.exp(1j * locked)

        delta = padded_phase[:, left + 1] - padded_phase[:, left] - expected
        delta = delta - 2.0 * np.pi * np.round(delta / (2.0 * np.pi))
        # Carry the locked phase forward, not the free-running one, or the
        # locking is undone on the very next frame.
        acc = locked + expected + delta
    return out


def _resample(x: np.ndarray, ratio: float) -> np.ndarray:
    """Linear resample; ``ratio`` > 1 makes the signal longer (lower pitch)."""
    if abs(ratio - 1.0) < 1e-9 or x.size == 0:
        return x
    out_len = max(1, int(round(x.size * ratio)))
    src = np.linspace(0.0, x.size - 1.0, out_len)
    return np.interp(src, np.arange(x.size), x)


# --------------------------------------------------------------------------
# Spectral envelope
# --------------------------------------------------------------------------

def spectral_envelope(magnitude: np.ndarray, quefrency: int = 40) -> np.ndarray:
    """Cepstrally-smoothed spectral envelope of a magnitude spectrogram.

    Low-quefrency liftering keeps the slow variation across frequency (the
    formants) and discards the fast ripple (the harmonics of f0), which is
    exactly the split needed to move one without moving the other.
    """
    log_mag = np.log(np.maximum(magnitude, 1e-8))
    cepstrum = np.fft.irfft(log_mag, axis=0)
    lifter = np.zeros(cepstrum.shape[0])
    q = min(quefrency, cepstrum.shape[0] // 2)
    lifter[:q] = 1.0
    lifter[-q + 1:] = 1.0 if q > 1 else 0.0
    smoothed = np.fft.rfft(cepstrum * lifter[:, None], axis=0)
    envelope = np.exp(np.real(smoothed))
    # Floor each frame relative to its own peak.  An absolute floor lets the
    # envelope collapse to ~0 in bands where the signal is silent, and the
    # division in formant_shift then amplifies pure numerical noise.
    frame_floor = envelope.max(axis=0, keepdims=True) * 1e-4
    return np.maximum(envelope, np.maximum(frame_floor, 1e-9))


def warp_envelope(envelope: np.ndarray, ratio: float) -> np.ndarray:
    """Stretch the envelope along the frequency axis by ``ratio``."""
    if abs(ratio - 1.0) < 1e-6:
        return envelope
    n_bins = envelope.shape[0]
    bins = np.arange(n_bins, dtype=np.float64)
    src = np.clip(bins / ratio, 0.0, n_bins - 1.0)
    lo = np.floor(src).astype(int)
    hi = np.minimum(lo + 1, n_bins - 1)
    frac = (src - lo)[:, None]
    return (1.0 - frac) * envelope[lo, :] + frac * envelope[hi, :]


def formant_shift(x: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """Move the formants by ``semitones`` without touching the pitch."""
    if abs(semitones) < 1e-6 or x.size == 0:
        return np.asarray(x, dtype=np.float32)
    ratio = 2.0 ** (semitones / 12.0)
    spec = stft(x)
    magnitude = np.abs(spec)
    phase = np.angle(spec)
    envelope = spectral_envelope(magnitude)
    warped = warp_envelope(envelope, ratio)
    # Clamp the correction: +-24 dB is far more than any real formant move
    # needs, and it stops silent bands turning into hiss.
    gain = np.clip(warped / envelope, 10 ** (-24 / 20), 10 ** (24 / 20))
    new_mag = magnitude * gain
    out = istft(new_mag * np.exp(1j * phase), length=int(x.size))
    return out.astype(np.float32)


def pitch_shift(x: np.ndarray, sr: int, semitones: float,
                preserve_formants: bool = True) -> np.ndarray:
    """Shift pitch by ``semitones``, keeping the duration."""
    if abs(semitones) < 1e-6 or x.size == 0:
        return np.asarray(x, dtype=np.float32)
    rate = 2.0 ** (semitones / 12.0)

    stretched = istft(phase_vocoder(stft(x), 1.0 / rate))
    shifted = _resample(stretched, 1.0 / rate)

    if shifted.size < x.size:
        shifted = np.pad(shifted, (0, x.size - shifted.size))
    shifted = shifted[:x.size]

    if preserve_formants:
        shifted = formant_shift(shifted, sr, -semitones)
    return np.asarray(shifted, dtype=np.float32)


def shift(x: np.ndarray, sr: int, pitch_semitones: float = 0.0,
          formant_semitones: float = 0.0) -> np.ndarray:
    """Apply an independent pitch and formant shift."""
    out = np.asarray(x, dtype=np.float32)
    if abs(pitch_semitones) > 1e-6:
        out = pitch_shift(out, sr, pitch_semitones, preserve_formants=True)
    if abs(formant_semitones) > 1e-6:
        out = formant_shift(out, sr, formant_semitones)
    return out


def estimate_f0(x: np.ndarray, sr: int, fmin: float = 60.0,
                fmax: float = 500.0, threshold: float = 0.15) -> float:
    """Fundamental frequency, by the YIN difference function.

    Plain autocorrelation picks the wrong octave whenever a period-doubled
    peak happens to be the strongest -- which a phase vocoder's output can
    easily produce.  YIN's cumulative mean normalised difference is
    specifically designed to avoid that, and taking the *first* dip below
    the threshold rather than the global minimum is what makes it prefer
    the true period over its multiples.

    Returns 0.0 when the signal is too short or has no clear periodicity.
    """
    arr = np.asarray(x, dtype=np.float64).reshape(-1)
    lo = max(2, int(sr / fmax))
    hi = int(sr / fmin)
    if arr.size < 2 * hi or hi <= lo:
        return 0.0

    arr = arr - arr.mean()
    window = min(arr.size - hi, 4 * hi)
    if window <= lo:
        return 0.0

    # Analyse the loudest segment rather than the start of the buffer: real
    # utterances (and everything the FX chain emits) begin with silence, and
    # measuring that returns a formant or nothing at all.
    span = window + hi
    energy = np.concatenate([[0.0], np.cumsum(arr * arr)])
    hop = max(1, span // 8)
    starts = np.arange(0, arr.size - span + 1, hop)
    if starts.size:
        loudest = int(starts[np.argmax(energy[starts + span] - energy[starts])])
    else:
        loudest = 0
    frame = arr[loudest:loudest + span]

    # Digital silence makes the difference function identically zero, which
    # would trip the threshold at the shortest lag and report a pitch.
    if float(np.max(np.abs(frame))) < 1e-7:
        return 0.0

    # d(tau) = sum (x[j] - x[j+tau])^2, expanded so it can use one FFT
    # correlation plus two running power sums.
    power = np.concatenate([[0.0], np.cumsum(frame * frame)])
    head = power[window] - power[0]
    tails = power[window + np.arange(hi + 1)] - power[np.arange(hi + 1)]

    size = 1
    while size < 2 * frame.size:
        size <<= 1
    spectrum = np.fft.rfft(frame, size)
    correlation = np.fft.irfft(spectrum * np.conj(spectrum), size)[:hi + 1]

    diff = head + tails - 2.0 * correlation
    diff[0] = 0.0

    cumulative = np.cumsum(diff[1:])
    taus = np.arange(1, hi + 1)
    normalised = diff[1:] * taus / np.maximum(cumulative, 1e-12)

    candidates = np.nonzero(normalised[lo - 1:] < threshold)[0]
    if candidates.size:
        tau = int(candidates[0]) + lo
        # Walk down into the local minimum the dip belongs to.
        while (tau + 1 <= hi
               and normalised[tau] < normalised[tau - 1]):
            tau += 1
    else:
        tau = int(np.argmin(normalised[lo - 1:hi])) + lo
        if normalised[tau - 1] > 0.6:
            return 0.0

    # Parabolic interpolation around the chosen lag.
    if 1 < tau < hi:
        y0, y1, y2 = normalised[tau - 2], normalised[tau - 1], normalised[tau]
        denominator = 2.0 * (y0 - 2.0 * y1 + y2)
        if abs(denominator) > 1e-12:
            tau = tau + (y0 - y2) / denominator

    return float(sr) / tau if tau > 0 else 0.0


# --------------------------------------------------------------------------
# Sample-rate conversion
# --------------------------------------------------------------------------

def resample_to(x: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Band-limited sample-rate conversion.

    Linear interpolation is not good enough here. Resampling 22.05 kHz
    speech up to a 48 kHz device with ``np.interp`` leaves the spectral
    image of every partial only about 30 dB down -- for a 3 kHz component,
    a spurious tone at 19 kHz -- which is what makes otherwise clean
    synthesis sound thin and metallic.

    Truncating or zero-padding the spectrum instead is ideal band-limited
    interpolation: zero-padding adds no images when upsampling, and
    truncation is a brick-wall anti-alias filter when downsampling. The
    whole utterance is converted in one transform, so this is also faster
    than a time-domain polyphase filter of comparable quality.
    """
    arr = np.asarray(x, dtype=np.float32).reshape(-1)
    if src_rate == dst_rate or arr.size == 0:
        return arr
    out_len = int(round(arr.size * dst_rate / float(src_rate)))
    if out_len < 1:
        return np.zeros(0, dtype=np.float32)

    # Taper the ends: the transform treats the buffer as one period, so a
    # discontinuity between the last and first sample would ring across the
    # whole spectrum.
    fade = min(64, arr.size // 8)
    if fade > 1:
        arr = arr.copy()
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        arr[:fade] *= ramp
        arr[-fade:] *= ramp[::-1]

    spectrum = np.fft.rfft(arr)
    out_bins = out_len // 2 + 1
    resampled = np.zeros(out_bins, dtype=complex)
    keep = min(spectrum.size, out_bins)
    resampled[:keep] = spectrum[:keep]
    # A retained Nyquist bin is real and shared between positive and
    # negative frequencies; halve it or it doubles in amplitude.
    if keep == out_bins and out_len % 2 == 0 and keep > 1:
        resampled[-1] = resampled[-1].real * 0.5
    out = np.fft.irfft(resampled, out_len) * (out_len / float(arr.size))
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# WSOLA time stretching
# --------------------------------------------------------------------------

def wsola(x: np.ndarray, rate: float, sr: int = 22050,
          frame_ms: float = 40.0, search_ms: float = 12.0) -> np.ndarray:
    """Time-stretch by ``rate`` (>1 = shorter) in the time domain.

    Waveform-similarity overlap-add. For each output frame it takes the
    input segment near the ideal read position, searches a small window for
    the offset whose waveform best continues what has already been written,
    and overlap-adds there.

    For speech this beats a phase vocoder: it never separates a partial's
    bins, so it cannot smear a pitch period, and it keeps the glottal pulse
    shape intact. That pulse shape is most of what makes a voice sound like
    a person rather than a machine.
    """
    arr = np.asarray(x, dtype=np.float32).reshape(-1)
    if abs(rate - 1.0) < 1e-6 or arr.size == 0:
        return arr

    frame = max(128, int(sr * frame_ms / 1000))
    frame += frame % 2
    hop_out = frame // 2
    hop_in = int(round(hop_out * rate))
    search = max(1, int(sr * search_ms / 1000))
    window = np.hanning(frame).astype(np.float32)

    out_len = int(np.ceil(arr.size / rate)) + frame
    out = np.zeros(out_len, dtype=np.float32)
    norm = np.zeros(out_len, dtype=np.float32)

    # What the previous frame predicts the next one should continue with.
    natural = arr[:frame].copy()
    read = 0
    write = 0

    while read + frame + search < arr.size and write + frame < out_len:
        lo = max(0, read - search)
        hi = min(arr.size - frame, read + search)
        if hi <= lo:
            offset = read
        else:
            candidates = np.arange(lo, hi + 1)
            # Normalised cross-correlation against the predicted waveform.
            scores = np.empty(candidates.size, dtype=np.float64)
            for index, start in enumerate(candidates):
                segment = arr[start:start + frame]
                denominator = np.linalg.norm(segment) * np.linalg.norm(natural)
                scores[index] = (float(np.dot(segment, natural)) / denominator
                                 if denominator > 1e-9 else 0.0)
            offset = int(candidates[int(np.argmax(scores))])

        segment = arr[offset:offset + frame]
        if segment.size < frame:
            break
        out[write:write + frame] += segment * window
        norm[write:write + frame] += window

        natural_start = offset + hop_out
        natural = arr[natural_start:natural_start + frame]
        if natural.size < frame:
            natural = np.pad(natural, (0, frame - natural.size))

        read += hop_in
        write += hop_out

    used = write + frame
    out = out[:used]
    norm = norm[:used]
    out = np.divide(out, norm, out=np.zeros_like(out), where=norm > 1e-6)
    return out.astype(np.float32)
