#!/usr/bin/env bash
# Builds the plugin and assembles a Thunderstore-shaped zip in dist/.
#
# Reference assemblies are fetched rather than committed: BepInEx is redistributable but
# there is no reason for this repository to carry a copy that can drift from the one players
# actually run.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

BEPINEX_VERSION="${BEPINEX_VERSION:-5.4.2305}"

if [[ ! -f lib/BepInEx.dll || ! -f lib/0Harmony.dll ]]; then
  echo "==> fetching BepInEx $BEPINEX_VERSION reference assemblies"
  mkdir -p lib .cache
  curl -sSL -o .cache/bepinex.zip \
    "https://thunderstore.io/package/download/BepInEx/BepInExPack/$BEPINEX_VERSION/"
  rm -rf .cache/bepinex && mkdir -p .cache/bepinex
  unzip -oq .cache/bepinex.zip -d .cache/bepinex
  cp .cache/bepinex/BepInExPack/BepInEx/core/BepInEx.dll lib/
  cp .cache/bepinex/BepInExPack/BepInEx/core/0Harmony.dll lib/
fi

echo "==> tests"
dotnet run --project tests/GambleMenu.Tests/GambleMenu.Tests.csproj -v quiet

echo "==> build"
dotnet build src/GambleMenu/GambleMenu.csproj -c Release -v minimal

echo "==> package"
rm -rf dist && mkdir -p dist/plugins
cp src/GambleMenu/bin/Release/GambleMenu.dll dist/plugins/
cp package/manifest.json package/icon.png dist/
cp README.md dist/

( cd dist && zip -qr GambleMenu.zip . -x GambleMenu.zip )
echo "==> dist/GambleMenu.zip"
