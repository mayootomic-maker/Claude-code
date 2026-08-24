#!/usr/bin/env bash
#
# Builds the MSI from packaging/out/app.
#
# WiX v5 runs on .NET and is installable here, but it emits a Windows Installer package and has
# never been run against one on this machine. The MSI this produces is REQUIRES-WINDOWS-VALIDATION
# in full: nothing about installing, upgrading or uninstalling has been observed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$root/packaging/out/app"

# One source of truth for the version. Directory.Build.props is what the compiler stamps into
# the binaries, so reading it here is what keeps the package version and the binary version from
# being two numbers that agree only until someone changes one of them.
version="${1:-$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$root/Directory.Build.props" | head -1)}"
[ -n "$version" ] || { echo "No <Version> in Directory.Build.props." >&2; exit 1; }

export PATH="$PATH:/opt/dotnet:$HOME/.dotnet/tools"

# The wix tool targets net6.0 and looks for a runtime in the default locations, none of which
# exist in the development container. Pointing it at the SDK is what lets it run at all there.
#
# Guarded on the directory existing, because /opt/dotnet is this container's layout and nowhere
# else's: setting DOTNET_ROOT to a path that is not there is worse than leaving it unset, and on
# Windows — the only host that can actually finish this script — it would break the tool the
# check below exists to reach.
if [ -z "${DOTNET_ROOT:-}" ] && [ -d /opt/dotnet ]; then
    export DOTNET_ROOT=/opt/dotnet
fi

[ -d "$app" ] || { echo "Run packaging/publish.sh first." >&2; exit 1; }

if ! command -v wix >/dev/null; then
    echo "==> Installing the WiX tool"
    dotnet tool install --global wix --version 5.* >/dev/null
fi

# Pinned to the WiX 5 line. Left unpinned, the tool resolves the 7.x extension and then cannot
# load it, with an error that says the extension was not found rather than that it was the wrong
# version.
wix extension add -g WixToolset.UI.wixext/5.0.2 >/dev/null 2>&1 || true

# WiX 5 warns that it supports Windows only, and on Linux the warning is not decorative: its
# directory-name validation rejects every name, including plain ones like "FrameDoctor". The
# check below turns that into a sentence rather than a confusing WIX0389, because the .wxs is
# not the problem and someone debugging it would waste an hour deciding that.
# `[ "$x" != "MINGW64_NT"* ]` was here and does not glob — inside [ ] the pattern is a literal,
# so the test was "is this string not exactly MINGW64_NT*", which is true on every host including
# Windows. It passed only because Git Bash also sets OS=Windows_NT. A case statement globs.
on_windows=no
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) on_windows=yes ;; esac
[ "${OS:-}" = "Windows_NT" ] && on_windows=yes

if [ "$on_windows" = "no" ]; then
    echo
    echo "  The WiX toolset builds MSIs on Windows only."
    echo "  Everything up to this point — the published payload in packaging/out/app — is ready."
    echo "  Run this script on Windows to produce the MSI."
    echo
    exit 3
fi

echo "==> Harvesting $app"
# Every published file becomes a component, generated rather than listed. A hand-maintained file
# list is a list that goes stale, and a stale one leaves files behind on uninstall.
wix build \
    -arch x64 \
    -define AppDir="$app" \
    -define Version="$version" \
    -ext WixToolset.UI.wixext \
    -out "$root/packaging/out/FrameDoctor-$version-x64.msi" \
    "$root/packaging/FrameDoctor.wxs" \
    "$root/packaging/Files.wxs"

echo "MSI at packaging/out/FrameDoctor-$version-x64.msi"
