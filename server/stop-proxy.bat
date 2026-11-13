@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - HENTIKAN PROXY (port dari .env.local-proxy)
REM  ------------------------------------------------------------
REM  Berguna bila proxy masih berjalan di jendela lain sehingga
REM  muncul error "EADDRINUSE: address already in use".
REM ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0.."

set "PORT=8000"
if exist ".env.local-proxy" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
    if /i "%%a"=="PORT" set "PORT=%%b"
  )
)

echo.
echo ============================================================
echo   MENG HENTIKAN PROXY DI PORT %PORT%
echo ============================================================

set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:%PORT% .*LISTENING"') do (
  if not defined FOUND (
    set "FOUND=1"
    echo [i] Menghentikan PID %%p ...
    taskkill /PID %%p /F >nul 2>nul
    if errorlevel 1 (
      echo [X] Gagal menghentikan PID %%p. Coba jalankan sebagai Administrator.
    ) else (
      echo [OK] PID %%p dihentikan.
    )
  )
)

if not defined FOUND (
  echo [i] Tidak ada proses yang memakai port %PORT%. Proxy memang tidak berjalan.
)

echo.
pause
endlocal
