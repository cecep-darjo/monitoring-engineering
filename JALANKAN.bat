@echo off
setlocal
cd /d "%~dp0"
title Monitoring Engineering - Proxy Server

set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)
if not defined NODE (
  echo [X] Node.js belum terpasang. Install dari https://nodejs.org ^(versi LTS^), lalu jalankan lagi.
  pause
  exit /b 1
)

echo.
echo Alamat yang dibuka di komputer lain ^(pilih IP jaringan LAN yang sesuai^):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo    http://%%a:8000
echo.
echo Biarkan jendela ini tetap terbuka. Tutup jendela / Ctrl+C untuk berhenti.
echo.
"%NODE%" server\proxy-server.mjs
pause
