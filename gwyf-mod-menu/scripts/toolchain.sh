#!/usr/bin/env bash
# Assembles a C# toolchain from NuGet when no .NET SDK is installed.
#
# The plugin had never been compiled in CI — the repository's only workflow builds an
# unrelated project — so "it does not work" could not be told apart from "it does not
# build". This makes the compile reproducible on a machine with nothing but curl.
#
# Everything lands in .toolchain/ (gitignored). Sets DOTNET_ROOT and CSC for the caller.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tc="$root/.toolchain"
RT_VER=8.0.11
ROSLYN_VER=4.12.0
BEPINEX_VER=5.4.21
UNITY_VER=2021.3.33

export DOTNET_ROOT="$tc/dotnet"
export CSC="$tc/roslyn/csc"
export REFDIR="$tc/refs"

[[ -x "$CSC" && -d "$REFDIR/net472" ]] && return 0 2>/dev/null || true

echo "==> assembling toolchain in .toolchain/ (first run only)"
mkdir -p "$tc/pkg"

nuget() { # id version -> pkg/<id>.nupkg
  local id="$1" ver="$2" out="$tc/pkg/$1.nupkg"
  [[ -s "$out" ]] && return 0
  curl -sSL --fail --max-time 300 -o "$out" \
    "https://api.nuget.org/v3-flatcontainer/$id/$ver/$id.$ver.nupkg"
}

nuget microsoft.netcore.app.runtime.linux-x64 "$RT_VER"
nuget microsoft.netcore.app.host.linux-x64    "$RT_VER"
nuget microsoft.net.compilers.toolset         "$ROSLYN_VER"
nuget microsoft.netcore.app.ref               "$RT_VER"
nuget microsoft.netframework.referenceassemblies.net472 1.0.3
nuget unityengine.modules                     "$UNITY_VER"

# BepInEx is not published to nuget.org; its own feed is unreachable from here.
if [[ ! -s "$tc/pkg/bepinex.zip" ]]; then
  curl -sSL --fail --max-time 300 -o "$tc/pkg/bepinex.zip" \
    "https://github.com/BepInEx/BepInEx/releases/download/v$BEPINEX_VER/BepInEx_x64_$BEPINEX_VER.0.zip"
fi

TC="$tc" RT_VER="$RT_VER" python3 - <<'PY'
import zipfile, pathlib, os, json, stat
tc = pathlib.Path(os.environ["TC"]); ver = os.environ["RT_VER"]
pkg = tc/"pkg"

fx  = tc/"dotnet"/"shared"/"Microsoft.NETCore.App"/ver
fxr = tc/"dotnet"/"host"/"fxr"/ver
for d in (fx, fxr): d.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(pkg/"microsoft.netcore.app.runtime.linux-x64.nupkg") as z:
    for n in z.namelist():
        base = os.path.basename(n)
        if n.startswith("runtimes/linux-x64/lib/net8.0/") and (n.endswith(".dll") or base.endswith(".json")):
            (fx/base).write_bytes(z.read(n))
        elif n.startswith("runtimes/linux-x64/native/") and not n.endswith("/"):
            (fx/base).write_bytes(z.read(n))
            if base == "libhostfxr.so": (fxr/base).write_bytes(z.read(n))
# hostfxr refuses to resolve a framework directory that does not declare its version.
(fx/".version").write_text(ver + "\n")

comp = tc/"roslyn"; comp.mkdir(exist_ok=True)
with zipfile.ZipFile(pkg/"microsoft.net.compilers.toolset.nupkg") as z:
    for n in z.namelist():
        if n.startswith("tasks/netcore/bincore/") and not n.endswith("/"):
            (comp/os.path.basename(n)).write_bytes(z.read(n))

# An apphost ships with a placeholder where the managed entry assembly's name belongs;
# writing the name in is what `dotnet build` would otherwise do for us.
PLACEHOLDER = b"c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2\0"
def make_host(dest, appdll):
    with zipfile.ZipFile(pkg/"microsoft.netcore.app.host.linux-x64.nupkg") as z:
        host = bytearray(z.read("runtimes/linux-x64/native/apphost"))
    i = host.find(PLACEHOLDER)
    if i < 0: raise SystemExit("apphost placeholder missing — package layout changed")
    name = appdll.encode() + b"\0"
    host[i:i+len(PLACEHOLDER)] = name + b"\0"*(len(PLACEHOLDER)-len(name))
    dest.write_bytes(bytes(host)); dest.chmod(dest.stat().st_mode | stat.S_IEXEC)
make_host(comp/"csc", "csc.dll")

refs = tc/"refs"
def extract(nupkg, prefix, dest, depth=None):
    d = refs/dest; d.mkdir(parents=True, exist_ok=True); n = 0
    with zipfile.ZipFile(pkg/nupkg) as z:
        for e in z.namelist():
            if e.startswith(prefix) and e.endswith(".dll") and (depth is None or e.count("/") == depth):
                (d/os.path.basename(e)).write_bytes(z.read(e)); n += 1
    return n

extract("microsoft.netframework.referenceassemblies.net472.nupkg", "build/.NETFramework/v4.7.2/", "net472", 3)
extract("microsoft.netcore.app.ref.nupkg", "ref/net8.0/", "net8")
extract("unityengine.modules.nupkg", "lib/", "unity")

# Mixed-mode COM interop stubs are not managed assemblies, and the managed
# System.EnterpriseServices that references them drags them in. None are wanted here.
for junk in ("System.EnterpriseServices.Wrapper.dll", "System.EnterpriseServices.Thunk.dll",
             "System.EnterpriseServices.dll"):
    (refs/"net472"/junk).unlink(missing_ok=True)

with zipfile.ZipFile(pkg/"bepinex.zip") as z:
    for e in ("BepInEx/core/BepInEx.dll", "BepInEx/core/0Harmony.dll"):
        (refs/os.path.basename(e)).write_bytes(z.read(e))
print("   toolchain ready")
PY
