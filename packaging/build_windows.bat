@echo off
REM One-click Windows build. Requires Python 3.9+ and (for the installer)
REM Inno Setup 6: https://jrsoftware.org/isdl.php
setlocal
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "packaging\build_windows.ps1" %*
echo.
pause
