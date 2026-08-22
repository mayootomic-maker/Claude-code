"""Generate the application icon.

Written in pure Python (zlib + struct) so the build needs no image library
and the icon can be regenerated reproducibly from this one file.

The mark is an audio waveform on a dark rounded square: it stays legible
at 16x16 in the Windows taskbar, which a detailed illustration would not.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import List, Sequence, Tuple

RGBA = Tuple[int, int, int, int]

BG = (22, 26, 32, 255)
BG_EDGE = (32, 38, 46, 255)
RED = (224, 72, 60, 255)
WHITE = (233, 238, 245, 255)

# Relative bar heights, centred; the silhouette of a spoken phrase.
BARS = (0.30, 0.52, 0.86, 0.62, 1.00, 0.74, 0.44, 0.24)
BAR_COLOURS = (WHITE, WHITE, RED, WHITE, RED, WHITE, WHITE, WHITE)


def _blend(dst: RGBA, src: RGBA) -> RGBA:
    alpha = src[3] / 255.0
    if alpha >= 1.0:
        return src
    return (
        round(dst[0] * (1 - alpha) + src[0] * alpha),
        round(dst[1] * (1 - alpha) + src[1] * alpha),
        round(dst[2] * (1 - alpha) + src[2] * alpha),
        max(dst[3], src[3]),
    )


def _coverage(px: float, py: float, inside) -> float:
    """4x4 supersampled coverage of ``inside`` over one pixel."""
    hits = 0
    for sy in range(4):
        for sx in range(4):
            if inside(px + (sx + 0.5) / 4.0, py + (sy + 0.5) / 4.0):
                hits += 1
    return hits / 16.0


def render(size: int) -> List[List[RGBA]]:
    pixels = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    radius = size * 0.22
    inset = size * 0.02

    def in_rounded_square(x: float, y: float) -> bool:
        lo, hi = inset, size - inset
        if not (lo <= x <= hi and lo <= y <= hi):
            return False
        cx = min(max(x, lo + radius), hi - radius)
        cy = min(max(y, lo + radius), hi - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2

    for y in range(size):
        for x in range(size):
            cover = _coverage(x, y, in_rounded_square)
            if cover <= 0:
                continue
            # A subtle top-to-bottom lift so the tile has some depth.
            t = y / max(1, size - 1)
            base = tuple(round(BG_EDGE[i] * (1 - t) + BG[i] * t) for i in range(3))
            pixels[y][x] = _blend(pixels[y][x],
                                  (base[0], base[1], base[2],
                                   round(255 * cover)))

    count = len(BARS)
    span = size * 0.66
    left = (size - span) / 2.0
    slot = span / count
    bar_w = slot * 0.56
    bar_r = min(bar_w / 2.0, size * 0.05)
    centre_y = size / 2.0

    for index, height_ratio in enumerate(BARS):
        x0 = left + index * slot + (slot - bar_w) / 2.0
        x1 = x0 + bar_w
        half = (size * 0.62 * height_ratio) / 2.0
        y0, y1 = centre_y - half, centre_y + half
        colour = BAR_COLOURS[index]

        def in_bar(px: float, py: float, x0=x0, x1=x1, y0=y0, y1=y1) -> bool:
            if not (x0 <= px <= x1 and y0 <= py <= y1):
                return False
            cx = min(max(px, x0 + bar_r), x1 - bar_r)
            cy = min(max(py, y0 + bar_r), y1 - bar_r)
            return (px - cx) ** 2 + (py - cy) ** 2 <= bar_r ** 2 + 1e-9

        lo_x, hi_x = max(0, int(x0) - 1), min(size, int(x1) + 2)
        lo_y, hi_y = max(0, int(y0) - 1), min(size, int(y1) + 2)
        for y in range(lo_y, hi_y):
            for x in range(lo_x, hi_x):
                cover = _coverage(x, y, in_bar)
                if cover <= 0:
                    continue
                pixels[y][x] = _blend(
                    pixels[y][x],
                    (colour[0], colour[1], colour[2], round(255 * cover)))
    return pixels


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + tag + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))


def png_bytes(pixels: Sequence[Sequence[RGBA]]) -> bytes:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type: none
        for px in row:
            raw.extend(px)
    return (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR",
                     struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + _chunk(b"IEND", b""))


def ico_bytes(sizes: Sequence[int]) -> bytes:
    images = [png_bytes(render(size)) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blobs = b"", b""
    for size, blob in zip(sizes, images):
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32,
                               len(blob), offset)
        offset += len(blob)
        blobs += blob
    return header + entries + blobs


def main() -> None:
    here = Path(__file__).resolve().parent
    sizes = (16, 24, 32, 48, 64, 128, 256)
    (here / "ravc.ico").write_bytes(ico_bytes(sizes))
    (here / "ravc-256.png").write_bytes(png_bytes(render(256)))
    (here / "ravc-64.png").write_bytes(png_bytes(render(64)))
    print(f"wrote ravc.ico ({(here / 'ravc.ico').stat().st_size} bytes), "
          f"ravc-256.png, ravc-64.png")


if __name__ == "__main__":
    main()
