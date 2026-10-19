@echo off
rem Double-click to start Trivvoly. Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Trivvoly's helper libraries - first run only...
  call npm install --omit=dev
)
node server.js %*
pause
