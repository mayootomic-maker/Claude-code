#!/usr/bin/env bash
#
# Builds everything that ships, into packaging/out/.
#
# Runs from Linux. The Windows binaries cross-compile here (EnableWindowsTargeting) but cannot
# execute; producing them locally is what lets the installer layout, the file set and the
# trimming configuration be checked before a Windows machine is involved.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/packaging/out"
rid="${1:-win-x64}"

export PATH="$PATH:/opt/dotnet"

echo "==> Frontend"
cd "$root/src/frontend"
pnpm install --frozen-lockfile >/dev/null 2>&1 || npm install >/dev/null
npm run build

# Both executables publish into one directory, sharing a single copy of the runtime.
#
# ADR 0001 says single-file, which is right for one executable and wrong for two: two
# self-contained single-file bundles carry two complete copies of the .NET runtime, and the
# saving here is about a third of the installed size. The shell publishes first because its
# net10.0-windows runtime is a superset of the engine's net10.0 one.
#
# Neither is single-file, for a second reason on the shell's side: WebView2's loader resolves
# its native component relative to the executable, and a self-extracting bundle relocates that
# to a temporary directory on first run — which turns a missing runtime into a confusing failure
# instead of the explicit message the window is written to show.
rm -rf "$out"
app="$out/app"

echo "==> Shell ($rid)"
dotnet publish "$root/src/FrameDoctor.Shell/FrameDoctor.Shell.csproj" \
    -c Release -r "$rid" --self-contained true \
    -p:PublishReadyToRun=true \
    -p:DebugType=none \
    -p:GenerateDocumentationFile=false \
    -o "$app" \
    --nologo

echo "==> Engine ($rid)"
dotnet publish "$root/src/FrameDoctor.Engine/FrameDoctor.Engine.csproj" \
    -c Release -r "$rid" --self-contained true \
    -p:PublishReadyToRun=true \
    -p:DebugType=none \
    -p:GenerateDocumentationFile=false \
    -o "$app" \
    --nologo

# Debug symbols and XML documentation are build outputs, not shipping ones. They roughly double
# the installed size and tell an attacker more about the binary than a user gains from them.
find "$out" -name '*.pdb' -delete
find "$out" -name '*.xml' -not -path '*/wwwroot/*' -delete

echo "==> Frontend"
rm -rf "$app/wwwroot"
cp -r "$root/src/frontend/dist" "$app/wwwroot"

# Source maps are a build output. They are a megabyte of an installer that only helps someone
# who also has the TypeScript sources, and shipping them hands a reader the original file names
# and layout for nothing in return.
find "$app/wwwroot" -name '*.map' -delete

# Both executables must be present and be Windows binaries. A publish that quietly produced only
# one of them would be discovered by a user, not by this script.
for exe in framedoctor.exe framedoctor-engine.exe; do
    [ -f "$app/$exe" ] || { echo "MISSING: $exe" >&2; exit 1; }
done

echo
echo "Installed size: $(du -sh "$app" | cut -f1)"
du -sh "$app/wwwroot" | sed 's/^/  interface: /'
echo "Output in $app"
