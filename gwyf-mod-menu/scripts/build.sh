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

echo "==> installer"
# The installer embeds the plugin and BepInEx, so both are refreshed from this build
# rather than from whatever happened to be in resources/ last time.
mkdir -p installer/GambleMenu.Installer/resources
cp src/GambleMenu/bin/Release/GambleMenu.dll installer/GambleMenu.Installer/resources/
cp .cache/bepinex.zip installer/GambleMenu.Installer/resources/BepInExPack.zip 2>/dev/null || \
  curl -sSL -o installer/GambleMenu.Installer/resources/BepInExPack.zip \
    "https://thunderstore.io/package/download/BepInEx/BepInExPack/$BEPINEX_VERSION/"
dotnet build installer/GambleMenu.Installer/GambleMenu.Installer.csproj -c Release -v minimal

echo "==> package"
rm -rf dist && mkdir -p dist/plugins
cp src/GambleMenu/bin/Release/GambleMenu.dll dist/plugins/
cp package/manifest.json package/icon.png dist/
cp README.md dist/
cp installer/GambleMenu.Installer/bin/Release/GambleMenu-Installer.exe dist/

( cd dist && zip -qr GambleMenu.zip manifest.json icon.png README.md plugins )
echo "==> dist/GambleMenu.zip          (for Thunderstore / manual install)"
echo "==> dist/GambleMenu-Installer.exe (double-click on Windows)"
