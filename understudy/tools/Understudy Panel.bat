@echo off
rem  Opens the Understudy panel as its own window, with no address bar and its
rem  own entry in the taskbar — which is the whole difference between a web page
rem  and something that behaves like an application.
rem
rem  Run /panel in Minecraft first. The mod writes the current link, token and
rem  all, to the file this reads: the token changes every session on purpose, so
rem  a bookmark would go stale and this never does.
setlocal
set "LINK_FILE=%APPDATA%\.minecraft\config\understudy\panel-url.txt"
if not exist "%LINK_FILE%" (
  echo Run /panel in Minecraft first — no address has been written yet.
  echo Looked in: %LINK_FILE%
  pause
  exit /b 1
)
set /p LINK=<"%LINK_FILE%"

for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%B (
    start "" %%B --app="%LINK%" --window-size=1400,900
    exit /b 0
  )
)
rem  No Chromium anywhere: an ordinary browser tab still works fine.
start "" "%LINK%"
