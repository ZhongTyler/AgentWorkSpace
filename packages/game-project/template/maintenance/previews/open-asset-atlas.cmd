@echo off
setlocal
cd /d "%~dp0..\.."
node maintenance/scripts/asset-atlas.mjs . --open
if errorlevel 1 pause
endlocal
