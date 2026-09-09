<#
    Builds and drops the plugin straight into a local BepInEx install.

    Point -GameDir at the game folder (the one containing the .exe). The default is the
    usual Steam library path; override it if yours lives elsewhere.
#>
param(
    [string] $GameDir = "C:\Program Files (x86)\Steam\steamapps\common\Gamble With Your Friends",
    [string] $Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $GameDir)) {
    throw "Game folder not found: $GameDir`nPass -GameDir with the folder that contains the game's .exe."
}

$pluginDir = Join-Path $GameDir "BepInEx\plugins\GambleMenu"
if (-not (Test-Path (Join-Path $GameDir "BepInEx"))) {
    throw "No BepInEx folder in $GameDir. Install BepInExPack first (via r2modman, Gale, or by hand)."
}

Write-Host "==> building"
dotnet build (Join-Path $root "src\GambleMenu\GambleMenu.csproj") -c $Configuration -v minimal

New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
Copy-Item (Join-Path $root "src\GambleMenu\bin\$Configuration\GambleMenu.dll") $pluginDir -Force

Write-Host "==> deployed to $pluginDir"
