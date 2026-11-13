@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - PROXY + CLOUDFLARE TUNNEL (FOTO)
REM  ------------------------------------------------------------
REM  Menjalankan DUA proses sekaligus:
REM    1. server\proxy-server.mjs   (melayani /photos/* dan /storage-api/*)
REM    2. cloudflared tunnel        (membuka proxy ke domain publik)
REM
REM  Prasyarat (sekali saja, lihat server\PANDUAN-DOMAIN-FOTO.md):
REM    - cloudflared terpasang  (winget install Cloudflare.cloudflared)
REM    - tunnel sudah dibuat    (cloudflared tunnel create foto-woeng)
REM    - DNS sudah diarahkan    (cloudflared tunnel route dns ...)
REM    - %USERPROFILE%\.cloudflared\config.yml sudah diisi
REM
REM  Double-click file ini. Dua jendela akan terbuka.
REM  Tutup jendela untuk menghentikan prosesnya.
REM ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0.."

set "TUNNEL_NAME=foto-woeng"
set "PROXY_PORT=8000"

echo.
echo ============================================================
echo   EQUIPMENT MONITOR - PROXY + TUNNEL FOTO
echo ============================================================

REM ---------- 1. Cek Node.js ----------
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
  echo [X] Node.js TIDAK ditemukan. Install dari https://nodejs.org lalu jalankan lagi.
  pause
  exit /b 1
)
echo [OK] Node.js: %NODE%

REM ---------- 2. Cek cloudflared ----------
set "CFD="
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CFD=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CFD if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CFD=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CFD if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe" set "CFD=%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe"
if not defined CFD (
  where cloudflared >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where cloudflared') do if not defined CFD set "CFD=%%i"
  )
)
if not defined CFD (
  echo [X] cloudflared TIDAK ditemukan.
  echo     Install dengan:  winget install --id Cloudflare.cloudflared
  echo     Lalu tutup dan buka ulang terminal / file ini.
  pause
  exit /b 1
)
echo [OK] cloudflared: %CFD%

REM ---------- 3. Cek config.yml tunnel ----------
if not exist "%USERPROFILE%\.cloudflared\config.yml" (
  echo [X] File konfigurasi tunnel belum ada:
  echo     %USERPROFILE%\.cloudflared\config.yml
  echo.
  echo     Salin dari server\cloudflared-config.example.yml lalu isi UUID tunnel.
  echo     Panduan: server\PANDUAN-DOMAIN-FOTO.md langkah 4-6.
  pause
  exit /b 1
)
echo [OK] config.yml: %USERPROFILE%\.cloudflared\config.yml

REM ---------- 4. Cek .env.local-proxy ----------
if not exist ".env.local-proxy" (
  echo [!] .env.local-proxy belum ada. Dibuat dari contoh...
  copy ".env.local-proxy.example" ".env.local-proxy" >nul
  echo     Isi SUPABASE_URL dan ANON_KEY di .env.local-proxy lalu jalankan lagi.
  pause
  exit /b 1
)

REM Peringatkan bila STORAGE_ONLY belum true (proxy terbuka ke internet).
set "STORAGE_ONLY="
set "ALLOWED_ORIGIN="
for /f "usebackq tokens=1,* delims==" %%a in (".env.local-proxy") do (
  set "_key=%%a"
  set "_val=%%b"
  if /i "!_key!"=="STORAGE_ONLY"    set "STORAGE_ONLY=!_val!"
  if /i "!_key!"=="ALLOWED_ORIGIN"  set "ALLOWED_ORIGIN=!_val!"
  if /i "!_key!"=="PORT"            set "PROXY_PORT=!_val!"
)
if /i not "!STORAGE_ONLY!"=="true" (
  echo.
  echo [!] PERINGATAN: STORAGE_ONLY belum "true" di .env.local-proxy.
  echo     Proxy akan terbuka ke internet untuk SEMUA path, termasuk file
  echo     aplikasi dan proxy API Supabase.
  echo     Disarankan set:  STORAGE_ONLY=true
  echo.
  choice /c YN /m "Lanjutkan tetap?"
  if errorlevel 2 exit /b 1
)
if "!ALLOWED_ORIGIN!"=="" (
  echo [!] ALLOWED_ORIGIN belum diisi. Disarankan: ALLOWED_ORIGIN=https://monitoreng.pages.dev
)

REM ---------- 5. Pastikan node_modules ada ----------
if not exist "node_modules" (
  echo [!] node_modules belum ada. Memasang dependensi...
  call npm install
  if errorlevel 1 (
    echo [X] Gagal instal dependensi.
    pause
    exit /b 1
  )
)

REM ---------- 6. Jalankan proxy di jendela baru ----------
echo.
echo [1/2] Menjalankan proxy di port %PROXY_PORT% ...
start "Monitoring - Proxy (port %PROXY_PORT%)" cmd /k ""%NODE%" server\proxy-server.mjs"

REM Beri waktu proxy siap sebelum tunnel menyambung.
timeout /t 3 /nobreak >nul

REM ---------- 7. Jalankan tunnel di jendela baru ----------
echo [2/2] Menjalankan Cloudflare Tunnel "%TUNNEL_NAME%" ...
start "Monitoring - Cloudflare Tunnel" cmd /k ""%CFD%" tunnel run %TUNNEL_NAME%"

echo.
echo ============================================================
echo   DUA JENDELA DIBUKA:
echo     - Monitoring - Proxy (port %PROXY_PORT%)
echo     - Monitoring - Cloudflare Tunnel
echo.
echo   Tutup kedua jendela untuk menghentikan layanan.
echo   Uji dari internet:
echo     curl.exe -i https://foto.woeng.my.id/photos/uji.jpg
echo ============================================================
echo.
pause
