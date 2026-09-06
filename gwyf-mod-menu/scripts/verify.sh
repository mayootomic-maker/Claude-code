#!/usr/bin/env bash
# Compiles the plugin, runs the unit tests, and — when the game's own assembly is pointed
# at — checks every name this plugin reaches into the game by against the game itself.
#
# Uses the .NET SDK when one is installed, and otherwise assembles a compiler from NuGet
# (see toolchain.sh).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if command -v dotnet >/dev/null 2>&1; then
  dotnet run --project tests/GambleMenu.Tests/GambleMenu.Tests.csproj -v quiet
  dotnet build src/GambleMenu/GambleMenu.csproj -c Release -v minimal
  exit 0
fi

# shellcheck source=toolchain.sh
source "$root/scripts/toolchain.sh"
tc="$root/.toolchain"
out="$tc/out"
mkdir -p "$out"

refs() { local d; for d in "$@"; do find "$REFDIR/$d" -name '*.dll' -printf '\055r:%p\n'; done; }

echo "==> tests"
refs net8 > "$out/net8.rsp"
"$CSC" -noconfig -nostdlib+ -target:exe -langversion:latest -nologo "@$out/net8.rsp" \
  -out:"$out/GambleMenu.Tests.dll" \
  tests/GambleMenu.Tests/Tests.cs \
  src/GambleMenu/Core/Json.cs \
  src/GambleMenu/Core/JsonField.cs \
  installer/GambleMenu.Installer/ConfigPatch.cs
python3 scripts/apphost.py "$tc" "$out" GambleMenu.Tests >/dev/null
( cd "$out" && ./GambleMenu.Tests )

echo "==> build"
refs net472 unity > "$out/plugin.rsp"
printf -- '-r:%s\n' "$REFDIR/BepInEx.dll" "$REFDIR/0Harmony.dll" >> "$out/plugin.rsp"
find src/GambleMenu -name '*.cs' >> "$out/plugin.rsp"
"$CSC" -noconfig -nostdlib+ -target:library -langversion:latest -nologo \
  -nowarn:CS0649,CS0436 -warnaserror+ -out:"$out/GambleMenu.dll" "@$out/plugin.rsp"
echo "   GambleMenu.dll  $(stat -c%s "$out/GambleMenu.dll") bytes"

# Every game type, field and method this plugin names as a string, looked up in the real
# assembly. The game's files belong to whoever owns the game and are not in this
# repository, so this runs only when one is pointed at — but when it does not run, nothing
# is checking those names at all, which is the state that let a binding to a method the
# game never had survive twenty-odd commits.
#
#   GWYF_ASSEMBLY=/path/to/Assembly-CSharp.dll ./scripts/verify.sh
#   GWYF_MIRROR=/path/to/Mirror.dll            (optional; covers the Mirror bindings too)
if [[ -n "${GWYF_ASSEMBLY:-}" && -f "$GWYF_ASSEMBLY" ]]; then
  echo "==> bindings, against $(basename "$GWYF_ASSEMBLY")"
  refs net8 cecil > "$out/check.rsp"
  "$CSC" -noconfig -nostdlib+ -target:exe -langversion:latest -nologo "@$out/check.rsp" \
    -out:"$out/BindingCheck.dll" tools/BindingCheck/Program.cs
  cp "$REFDIR/cecil/Mono.Cecil.dll" "$out/"
  python3 scripts/apphost.py "$tc" "$out" BindingCheck >/dev/null
  # Piping straight into tail would hand back tail's exit code, and a check that cannot
  # fail the build is a check everyone learns to scroll past.
  "$out/BindingCheck" "$GWYF_ASSEMBLY" src ${GWYF_MIRROR:+"$GWYF_MIRROR"} > "$out/bindings.txt" || {
    tail -20 "$out/bindings.txt"
    echo "   bindings FAILED — see $out/bindings.txt"
    exit 1
  }
  tail -3 "$out/bindings.txt"
else
  echo "==> bindings NOT checked — set GWYF_ASSEMBLY to the game's Assembly-CSharp.dll"
fi
