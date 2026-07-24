@echo off
REM Wrapper for scripts/dev-windows.ps1 — runs PowerShell with -ExecutionPolicy
REM Bypass so the user doesn't have to fiddle with `Set-ExecutionPolicy`.
REM
REM Usage:
REM   scripts\dev-windows.cmd
REM   scripts\dev-windows.cmd -SkipStart
REM   scripts\dev-windows.cmd -Force -DatabasePassword mypass

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dev-windows.ps1" %*
exit /b %ERRORLEVEL%
