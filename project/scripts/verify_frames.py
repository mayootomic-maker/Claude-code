#!/usr/bin/env python3
"""Verify a rendered PNG sequence: every frame present, non-trivial, and a
structurally complete PNG. Run before encoding.

  python3 verify_frames.py [--dir NAME] [FIRST LAST]

--dir matches render_final.py's --outdir, so a preview pass can be checked the
same way as the final one."""
import os, sys, struct

root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(root, "scripts"))
import shots as SH

args = sys.argv[1:]
name = "final"
if "--dir" in args:
    i = args.index("--dir")
    name = args[i + 1]
    del args[i:i + 2]
outdir = os.path.join(root, "renders", name)
first, last = SH.FIRST_FRAME, SH.LAST_FRAME
if len(args) >= 2:
    first, last = int(args[0]), int(args[1])

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
