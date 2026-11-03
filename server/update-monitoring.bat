@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - UPDATE APPLICATION (Windows)
REM  ------------------------------------------------------------
REM  Memperbarui aplikasi dari git (jika ada), memasang dependensi
REM  baru, lalu membangun ulang dalam mode local-proxy.
REM  Jalankan setelah ada update di repository.
REM ============================================================
setlocal enabledelayedexpansion

REM --- Pindah ke root proyek (folder parent dari folder server) ---
cd /d "%~dp0.."

echo.
echo ============================================================
echo   EQUIPMENT MONITOR - UPDATE APPLICATION
echo ============================================================

REM --- Temukan Node.js & npm (path absolut) ---
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe"      set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where node') do if not defined NODE set "NODE=%%i"
  )
)
if not defined NODE (
  echo [X] Node.js TIDAK ditemukan. Install dari https://nodejs.org lalu jalankan lagi.
  pause
  exit /b 1
)
set "NPM="
for %%p in ("%ProgramFiles%\nodejs\npm.cmd" "%ProgramFiles(x86)%\nodejs\npm.cmd") do if exist %%~p if not defined NPM set "NPM=%%~p"
if not defined NPM set "NPM=call npm"
echo [OK] Node.js: %NODE%

REM --- Pastikan konfigurasi proxy tersedia ---
if not exist ".env.local-proxy" (
  if exist ".env.local-proxy.example" (
    copy ".env.local-proxy.example" ".env.local-proxy" >nul
    echo [!] .env.local-proxy belum ada. File contoh sudah disalin.
  ) else (
    echo [X] .env.local-proxy tidak ditemukan dan .env.local-proxy.example juga tidak ada.
    pause
    exit /b 1
  )
  echo     Isi SUPABASE_URL dan ANON_KEY di .env.local-proxy, lalu jalankan lagi.
  pause
  exit /b 1
)

REM --- Baca PORT + SUPABASE_URL dari .env.local-proxy ---
set "PORT=8000"
set "SUPABASE_URL="
for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
  set "_key=%%a"
  set "_val=%%b"
  if /i "!_key!"=="PORT" set "PORT=!_val!"
  if /i "!_key!"=="SUPABASE_URL" set "SUPABASE_URL=!_val!"
)
if defined SUPABASE_URL if "!SUPABASE_URL:~-1!"=="/" set "SUPABASE_URL=!SUPABASE_URL:~0,-1!"
echo [OK] Port proxy: %PORT%

REM --- Cek apakah repo git ---
if exist ".git" (
  echo [1/4] Mengambil update dari git...
  git pull
  if errorlevel 1 (
    echo.
    echo [X] Gagal git pull. Status repository saat ini:
    git status --short
    echo.
    echo     Kemungkinan penyebab dan solusinya:
    echo       - Ada perubahan lokal yang belum di-commit:
    echo           git stash    ^(simpan sementara^)  lalu jalankan ulang skrip ini
    echo       - Branch lokal dan remote berbeda ^(diverged^):
    echo           git pull --rebase
    echo       - Belum login GitHub / tidak ada akses internet.
    pause
    exit /b 1
  )
) else (
  echo [!] Bukan folder git ^(folder .git tidak ditemukan^). Lewati git pull.
  echo     Pastikan file sumber sudah diganti dengan versi terbaru sebelum build.
)

echo.
echo [2/4] Memasang dependensi...
if /i "%NPM%"=="call npm" (
  call npm install
) else (
  "%NPM%" install
)
if errorlevel 1 (
  echo [X] Gagal npm install.
  pause
  exit /b 1
)

echo.
echo [3/4] Membangun ulang aplikasi (mode local-proxy)...
powershell -ExecutionPolicy Bypass -File "server\build-local-proxy.ps1"
if errorlevel 1 (
  echo [X] Gagal build. Periksa error lalu jalankan lagi.
  pause
  exit /b 1
)

echo.
echo [4/4] Memeriksa hasil build...
set "BUNDLE_LEAK="
if defined SUPABASE_URL (
  findstr /c:"!SUPABASE_URL!" dist\assets\index-*.js >nul 2>nul
  if not errorlevel 1 set "BUNDLE_LEAK=1"
)
if defined BUNDLE_LEAK (
  echo [X] Bundle masih berisi URL Supabase asli ^(!SUPABASE_URL!^).
  echo     Mode local-proxy TIDAK aktif, sehingga komputer tanpa internet akan
  echo     gagal dengan pesan "Network Error when attempting to fetch resource".
  echo     Periksa src\lib\supabase.ts dan server\build-local-proxy.ps1.
  pause
  exit /b 1
)
echo [OK] Bundle bersih: URL Supabase asli tidak ikut ter-bundle.

echo.
echo ============================================================
echo   UPDATE SELESAI
echo ============================================================
echo   Alamat untuk komputer lain di jaringan LAN:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:!PORT!
echo.
echo   Langkah berikutnya:
echo     1. Restart proxy:  server\start-monitoring.bat
echo        ^(wajib bila server\proxy-server.mjs ikut berubah^)
echo     2. Di komputer client: tekan Ctrl+F5
echo.
echo   PENTING - bila update ini mengubah database / edge function:
echo     npx supabase db push
echo     npx supabase functions deploy send-shift-report
echo     npx supabase functions deploy create-user
echo     npx supabase functions deploy delete-user
echo ============================================================
echo.
pause
endlocal
