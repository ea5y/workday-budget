@echo off
setlocal
set "NODE=%LOCALAPPDATA%\mise\installs\node\24.20.0\node.exe"
if exist "%NODE%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 20+ or edit this wrapper.
  exit /b 1
)
set "NODE=node"
:run
"%NODE%" "%~dp0wb.mjs" %*
