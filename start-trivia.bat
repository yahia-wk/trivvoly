@echo off
rem Double-click to start Trivvoly. Close this window to stop it.
rem First run: sets up the Python game server and builds the screens (needs Python 3.12+ and Node.js 22+).
cd /d "%~dp0"

if not exist backend\.venv\Scripts\python.exe (
  echo Setting up the game server - first run only...
  python -m venv backend\.venv || goto fail
  backend\.venv\Scripts\python -m pip install --quiet --upgrade pip
  backend\.venv\Scripts\python -m pip install --quiet -e backend || goto fail
)

if not exist frontend\dist\index.html (
  echo Building the screens - first run only...
  pushd frontend
  call npm install --no-audit --no-fund || goto failpop
  call npm run build || goto failpop
  popd
)

backend\.venv\Scripts\python -m trivvoly %*
pause
exit /b

:failpop
popd
:fail
echo.
echo Something went wrong setting up Trivvoly. Check that Python 3.12+ and Node.js 22+ are installed.
pause
