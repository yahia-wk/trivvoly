@echo off
rem Double-click to start Trivvoly. Close this window to stop it.
cd /d "%~dp0"
node server.js %*
pause
