<#
.SYNOPSIS
    Build the Accent Voice Changer installer on Windows.

.DESCRIPTION
    Creates a virtual environment, installs the app and its runtime
    dependencies, runs the tests, builds the PyInstaller folder, zips it as a
    portable build, and — if Inno Setup is present — compiles the installer.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File packaging\build_windows.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipInstaller,
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Accent Voice Changer: Windows build ==" -ForegroundColor Cyan
Write-Host "Repository: $root"

$venv = Join-Path $root ".venv-build"
if (-not (Test-Path $venv)) {
    Write-Host "Creating build virtual environment…" -ForegroundColor Yellow
    & $Python -m venv $venv
}
$py = Join-Path $venv "Scripts\python.exe"

Write-Host "Installing dependencies…" -ForegroundColor Yellow
& $py -m pip install --upgrade pip wheel  | Out-Null
& $py -m pip install -e ".[full,dev]"
& $py -m pip install pyinstaller

if (-not $SkipTests) {
    Write-Host "Running tests…" -ForegroundColor Yellow
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw "Tests failed; not building." }
}

Write-Host "Regenerating the icon…" -ForegroundColor Yellow
& $py assets\make_icon.py

Write-Host "Building with PyInstaller…" -ForegroundColor Yellow
Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue
& $py -m PyInstaller --noconfirm --clean packaging\ravc.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }

$version = (& $py -c "import sys; sys.path.insert(0,'src'); import ravc; print(ravc.__version__)").Trim()
Write-Host "Version: $version"

$portable = "dist\AccentVoiceChanger-$version-portable-win64.zip"
Write-Host "Creating portable zip…" -ForegroundColor Yellow
Compress-Archive -Path "dist\AccentVoiceChanger\*" -DestinationPath $portable -Force

if (-not $SkipInstaller) {
    $iscc = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $iscc) { $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }

    if ($iscc) {
        Write-Host "Compiling the installer with Inno Setup…" -ForegroundColor Yellow
        & $iscc "/DAppVersion=$version" "packaging\installer.iss"
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed." }
    } else {
        Write-Warning "Inno Setup 6 not found; skipping the installer."
        Write-Warning "Install it from https://jrsoftware.org/isdl.php and re-run."
    }
}

Write-Host ""
Write-Host "Done. Artifacts in dist\:" -ForegroundColor Green
Get-ChildItem dist -File | ForEach-Object {
    "{0,-52} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)
}
