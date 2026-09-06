#!/usr/bin/env python3
"""Makes a launcher for a compiled .NET app, the way `dotnet build` would.

An apphost ships with a placeholder where the managed entry assembly's name belongs.
Roslyn's own csc launcher, already patched by toolchain.sh, is the nearest copy of one,
so the name in it is simply replaced. Without this a compiled dll has nothing to run it.

Usage: apphost.py <toolchain dir> <output dir> <AppName.dll>
"""
import pathlib
import stat
import sys

toolchain, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
# Accepts the assembly with or without its extension; the launcher is named after the stem.
stem = sys.argv[3][:-4] if sys.argv[3].endswith(".dll") else sys.argv[3]
app = stem + ".dll"

host = bytearray((toolchain / "roslyn" / "csc").read_bytes())
at = host.find(b"csc.dll\0")
if at < 0:
    raise SystemExit("csc launcher carries no name to replace — toolchain.sh did not patch it")

name = app.encode() + b"\0"
host[at:at + len(name)] = name

launcher = out / stem
launcher.write_bytes(bytes(host))
launcher.chmod(launcher.stat().st_mode | stat.S_IEXEC)

(out / (stem + ".runtimeconfig.json")).write_text(
    '{"runtimeOptions":{"tfm":"net8.0",'
    '"framework":{"name":"Microsoft.NETCore.App","version":"8.0.0"},'
    '"rollForward":"Major"}}\n'
)
print(launcher)
