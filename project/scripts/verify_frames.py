#!/usr/bin/env python3
"""Verify the rendered PNG sequence: every frame present, non-trivial, and a
structurally complete PNG. Run before encoding."""
import os, sys, struct

root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
outdir = os.path.join(root, "renders", "final")
first, last = 1, 996
if len(sys.argv) > 2:
    first, last = int(sys.argv[1]), int(sys.argv[2])

missing, tiny, broken = [], [], []
for f in range(first, last + 1):
    p = os.path.join(outdir, f"f_{f:04d}.png")
    if not os.path.exists(p):
        missing.append(f); continue
    sz = os.path.getsize(p)
    if sz < 4096:
        tiny.append((f, sz)); continue
    with open(p, "rb") as fh:
        if fh.read(8) != b"\x89PNG\r\n\x1a\n":
            broken.append(f); continue
        fh.seek(-12, os.SEEK_END)
        if fh.read()[4:8] != b"IEND":
            broken.append(f)

total = last - first + 1
ok = total - len(missing) - len(tiny) - len(broken)
print(f"VERIFY expected={total} ok={ok} missing={len(missing)} "
      f"tiny={len(tiny)} broken={len(broken)}")
for label, items in (("missing", missing), ("tiny", tiny), ("broken", broken)):
    if items:
        print(f"  {label}: {items[:40]}{' ...' if len(items) > 40 else ''}")
sys.exit(0 if ok == total else 1)
