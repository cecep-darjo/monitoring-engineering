@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - START PROXY SERVER (Windows)
REM  ------------------------------------------------------------
REM  Double-click untuk menjalankan proxy. Otomatis build bila
REM  perlu dan memeriksa konfigurasi .env.local-proxy.
REM ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0.."

echo.
echo ============================================================
echo   EQUIPMENT MONITOR - START PROXY SERVER
echo ============================================================

REM ---------- Temukan Node.js (path absolut, tidak bergantung PATH) ----------
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe"      set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "C:\NodeJS\node.exe" set "NODE=C:\NodeJS\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where node') do if not defined NODE set "NODE=%%i"
  )
)
if not defined NODE (
  echo [X] Node.js TIDAK ditemukan.
  echo     Silakan install Node.js dari https://nodejs.org lalu jalankan lagi.
  echo     Lokasi yang dicoba: Program Files\nodejs, C:\NodeJS, dan PATH.
  pause
  exit /b 1
)
echo [OK] Node.js: %NODE%

REM Tentukan NPM (pendamping node) melalui jalur standar
set "NPM="
for %%p in ("%ProgramFiles%\nodejs\npm.cmd" "%ProgramFiles(x86)%\nodejs\npm.cmd" "C:\NodeJS\npm.cmd") do if exist %%~p if not defined NPM set "NPM=%%~p"
if not defined NPM set "NPM=call npm"

REM ---------- Pastikan .env.local-proxy ada ----------
if not exist ".env.local-proxy" (
  echo [!] File .env.local-proxy belum ada. Dibuat dari contoh...
  copy ".env.local-proxy.example" ".env.local-proxy" >nul
  echo     Silakan isi SUPABASE_URL dan ANON_KEY di .env.local-proxy lalu jalankan lagi.
  pause
  exit /b 1
)

REM ---------- Baca PORT + SUPABASE_URL ----------
set "PORT=4000"
set "SUPABASE_URL="
for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
  set "_key=%%a"
  set "_val=%%b"
  if /i "!_key!"=="PORT" set "PORT=!_val!"
  if /i "!_key!"=="SUPABASE_URL" set "SUPABASE_URL=!_val!"
)
if "!SUPABASE_URL!"=="" (
  echo [X] .env.local-proxy belum berisi SUPABASE_URL yang valid.
  echo     Edit .env.local-proxy dan pastikan ada baris seperti:
  echo         SUPABASE_URL=https://xxxx.supabase.co
  echo         ANON_KEY=sb_publishable_......
  echo         PORT=4000
  pause
  exit /b 1
)
echo [OK] SUPABASE_URL:  %SUPABASE_URL%
echo [OK] Port proxy:    %PORT%

REM ---------- Pastikan node_modules ada ----------
if not exist "node_modules" (
  echo [!] node_modules belum ada. Memasang dependensi...
  "%NPM%" install
  if errorlevel 1 (
    echo [X] Gagal instal dependensi.
    pause
    exit /b 1
  )
)

REM ---------- Build bila belum ada ----------
if not exist "dist\index.html" (
  echo [!] Build belum ada. Menjalankan build local-proxy...
  powershell -ExecutionPolicy Bypass -File "server\build-local-proxy.ps1"
  if errorlevel 1 (
    echo [X] Gagal build. Perbaiki error lalu jalankan lagi.
    pause
    exit /b 1
  )
)

echo.
echo [OK] Menjalankan proxy di port %PORT%...
echo      Dari komputer lain, buka:  http://[IP-komputer-ini]:%PORT%/
echo      Tekan Ctrl+C untuk menghentikan.
echo ============================================================
echo.

set "PORT=%PORT%"
if /i "%NODE%"=="call node" (
  call node server\proxy-server.mjs
) else (
  "%NODE%" server\proxy-server.mjs
)

echo.
echo [i] Proxy dihentikan.
pause
endlocal