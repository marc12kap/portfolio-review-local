@echo off
setlocal
cd /d "%~dp0"

echo.
echo Portfolio Review Local
echo.
echo This will install dependencies, build the app, and start the local server.
if "%PORT%"=="" (
  echo When startup finishes, open http://127.0.0.1:8787/
) else (
  echo When startup finishes, open http://127.0.0.1:%PORT%/
)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1"

if errorlevel 1 (
  echo.
  echo Startup did not finish successfully.
  echo Read the message above, then press any key to close this window.
  pause >nul
)
