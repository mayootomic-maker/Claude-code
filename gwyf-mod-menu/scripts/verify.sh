#!/usr/bin/env bash
# Compiles the plugin and runs the unit tests. Uses the .NET SDK when one is installed,
# and otherwise assembles a compiler from NuGet (see toolchain.sh).
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
out="$root/.toolchain/out"; mkdir -p "$out"

refs() { local d; for d in "$@"; do find "$REFDIR/$d" -name '*.dll' -printf '\055r:%p\n'; done; }

echo "==> tests"
refs net8 > "$out/net8.rsp"
"$CSC" -noconfig -nostdlib+ -target:exe -langversion:latest -nologo "@$out/net8.rsp" \
  -out:"$out/GambleMenu.Tests.dll" \
  tests/GambleMenu.Tests/Tests.cs \
  src/GambleMenu/Core/Json.cs \
  src/GambleMenu/Core/JsonField.cs \
  installer/GambleMenu.Installer/ConfigPatch.cs

cat > "$out/GambleMenu.Tests.runtimeconfig.json" <<'JSON'
{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"8.0.0"},"rollForward":"Major"}}
JSON
# The tests are a plain console app; give them a host built the same way csc's was.
python3 - "$out" <<'PY'
import pathlib, stat, sys
out = pathlib.Path(sys.argv[1])
host = bytearray((out.parent/"roslyn"/"csc").read_bytes())
i = host.find(b"csc.dll\0")
name = b"GambleMenu.Tests.dll\0"
host[i:i+len(name)] = name
t = out/"GambleMenu.Tests"; t.write_bytes(bytes(host))
t.chmod(t.stat().st_mode | stat.S_IEXEC)
PY
( cd "$out" && ./GambleMenu.Tests )

echo "==> build"
refs net472 unity > "$out/plugin.rsp"
printf -- '-r:%s\n' "$REFDIR/BepInEx.dll" "$REFDIR/0Harmony.dll" >> "$out/plugin.rsp"
find src/GambleMenu -name '*.cs' >> "$out/plugin.rsp"
"$CSC" -noconfig -nostdlib+ -target:library -langversion:latest -nologo \
  -nowarn:CS0649,CS0436 -warnaserror+ -out:"$out/GambleMenu.dll" "@$out/plugin.rsp"
echo "   GambleMenu.dll  $(stat -c%s "$out/GambleMenu.dll") bytes"
