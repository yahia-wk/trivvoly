@echo off
rem Double-click to start Trivia Night. Close this window to stop it.
cd /d "%~dp0"
node server.js %*
pause
