@echo off
REM ============================================================
REM  EQUIPMENT MONITOR - UPDATE APPLICATION (Windows)
REM  ------------------------------------------------------------
REM  Memperbarui aplikasi dari git (jika ada), memasang dependensi
REM  baru, lalu membangun ulang dalam mode local-proxy.
REM  Jalankan setelah ada update di repository.
REM ============================================================
setlocal

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

REM --- Cek apakah repo git ---
if exist ".git" (
  echo [1/3] Mengambil update dari git...
  git pull
  if errorlevel 1 (
    echo [X] Gagal git pull. Pastikan repo sudah di-clone / ada akses internet.
    pause
    exit /b 1
  )
) else (
  echo [!] Bukan folder git (folder .git tidak ditemukan). Lewati git pull.
  echo     Ganti-clone/pindahkan file update sesuai proses Anda.
)

echo.
echo [2/3] Memasang dependensi...
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
echo [3/3] Membangun ulang aplikasi (mode local-proxy)...
powershell -ExecutionPolicy Bypass -File "server\build-local-proxy.ps1"
if errorlevel 1 (
  echo [X] Gagal build. Periksa error lalu jalankan lagi.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   UPDATE SELESAI. Jalankan proxy dengan:  start-monitoring.bat
echo ============================================================
echo.
pause
endlocal