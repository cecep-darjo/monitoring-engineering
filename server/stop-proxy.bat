@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - HENTIKAN PROXY
REM  ------------------------------------------------------------
REM  Menghentikan proxy di APP_PORT dan TUNNEL_PORT (dibaca dari
REM  .env.local-proxy). Berguna bila muncul error:
REM      EADDRINUSE: address already in use
REM ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0.."

set "APP_PORT=8000"
set "TUNNEL_PORT=8001"
if exist ".env.local-proxy" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
    if /i "%%a"=="APP_PORT"    set "APP_PORT=%%b"
    if /i "%%a"=="TUNNEL_PORT" set "TUNNEL_PORT=%%b"
  )
)

echo.
echo ============================================================
echo   MENG HENTIKAN PROXY
echo     App  : port %APP_PORT%
echo     Foto : port %TUNNEL_PORT%
echo ============================================================

call :KillPort %APP_PORT%
call :KillPort %TUNNEL_PORT%

echo.
pause
endlocal
exit /b 0

:KillPort
set "P=%~1"
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:%P% .*LISTENING"') do (
  if not defined FOUND (
    set "FOUND=1"
    echo [i] Port %P%: menghentikan PID %%p ...
    taskkill /PID %%p /F >nul 2>nul
    if errorlevel 1 (
      echo [X] Gagal menghentikan PID %%p. Coba jalankan sebagai Administrator.
    ) else (
      echo [OK] Port %P%: PID %%p dihentikan.
    )
  )
)
if not defined FOUND echo [i] Port %P%: tidak ada proses yang mendengarkan.
exit /b 0
