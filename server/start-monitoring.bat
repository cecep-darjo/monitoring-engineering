@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - START PROXY SERVER (Windows)
REM  ------------------------------------------------------------
REM  Menjalankan proxy server dengan otomatis build bila perlu.
REM  Klik dua kali file ini (atau jalankan dari command prompt).
REM ============================================================
setlocal enabledelayedexpansion

REM --- Pindah ke root proyek (folder parent dari folder server) ---
cd /d "%~dp0.."

echo.
echo ============================================================
echo   EQUIPMENT MONITOR - START PROXY SERVER
echo ============================================================

REM --- Pastikan .env.local-proxy ada ---
if not exist ".env.local-proxy" (
  echo [!] File .env.local-proxy belum ada. Dibuat dari contoh...
  copy ".env.local-proxy.example" ".env.local-proxy" >nul
  echo     Silakan isi SUPABASE_URL dan ANON_KEY di .env.local-proxy.
)

REM --- Baca PORT dari .env.local-proxy (default 400) ---
set "PORT=400"
for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
  set "_line=%%a"
  if /i "!_line!"=="PORT" set "PORT=%%b"
)

REM --- Pastikan node_modules ada ---
if not exist "node_modules" (
  echo [!] node_modules belum ada. Memasang dependensi...
  call npm install
  if errorlevel 1 (
    echo [X] Gagal install dependensi.
    pause
    exit /b 1
  )
)

REM --- Build bila belum ada (atau dist kosong) ---
if not exist "dist\index.html" (
  echo [!] Build belum ada. Menjalankan build local-proxy...
  call powershell -ExecutionPolicy Bypass -File "server\build-local-proxy.ps1"
  if errorlevel 1 (
    echo [X] Gagal build. Perbaiki error lalu jalankan lagi.
    pause
    exit /b 1
  )
)

echo.
echo [OK] Menjalankan proxy di port %PORT%...
echo      Dari komputer lain, buka:  http://<IP-komputer-ini>:%PORT%/
echo.
echo      Tekan Ctrl+C untuk menghentikan.
echo ============================================================
echo.

REM --- Jalankan proxy ---
set "PORT=%PORT%"
node server\proxy-server.mjs

echo.
echo [i] Proxy dihentikan.
pause
endlocal