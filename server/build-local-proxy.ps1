# ============================================================
# BUILD LOCAL-PROXY (PowerShell)
# ------------------------------------------------------------
# Membangun aplikasi dalam mode "local-proxy":
#   - VITE_SUPABASE_URL dikosongkan  -> supabase client memakai
#     window.location.origin (yaitu IP komputer proxy), sehingga
#     semua request API dari komputer lain menuju proxy.
#   - VITE_SUPABASE_ANON_KEY tetap diisi -> dibakar ke bundle JS
#     untuk header apikey client (login, query, upload, dst).
#
# Hasil: folder `dist/` yang siap disajikan oleh `node server/proxy-server.mjs`.
#
# Cara pakai:
#   Setelah mengisi .env.local-proxy, jalankan di PowerShell:
#      .\server\build-local-proxy.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  MEMBANGUN APLIKASI (MODE LOCAL-PROXY)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ------- 1. Baca konfigurasi dari .env.local-proxy (jika ada) -------
$envFile = Join-Path $ProjectDir '.env.local-proxy'
if (Test-Path $envFile) {
  Write-Host "Membaca konfigurasi dari .env.local-proxy ..." -ForegroundColor Green
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
      $parts = $line -split '=', 2
      if ($parts.Count -eq 2) {
        $k = $parts[0].Trim()
        $v = $parts[1].Trim()
        # Hanya set jika belum ada di environment.
        if (-not [Environment]::GetEnvironmentVariable($k)) {
          Set-Item -Path "env:$k" -Value $v
        }
      }
    }
  }
}

# ------- 2. Pastikan anon key tersedia -------
if (-not $env:VITE_SUPABASE_ANON_KEY -and $env:ANON_KEY) {
  $env:VITE_SUPABASE_ANON_KEY = $env:ANON_KEY
}
if (-not $env:VITE_SUPABASE_ANON_KEY) {
  Write-Error 'VITE_SUPABASE_ANON_KEY tidak ditemukan. Isi ANON_KEY di .env.local-proxy terlebih dahulu.'
}

# ------- 3. Kekosongkan VITE_SUPABASE_URL agar pakai window.location.origin -------
$env:VITE_SUPABASE_URL = ''

Write-Host ""
Write-Host "  VITE_SUPABASE_URL        : (kosong -> window.location.origin = proxy)"
Write-Host "  VITE_SUPABASE_ANON_KEY   : (terisi, dibakar ke bundle)"
if ($env:SUPABASE_URL) {
  Write-Host "  Backend Supabase (proxy)  : $($env:SUPABASE_URL)"
}
Write-Host ""

# ------- 4. Jalankan build -------
Write-Host "Menjalankan npm run build ..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
  Write-Host "node_modules belum ada, memasang dependensi dulu ..." -ForegroundColor Yellow
  npm install
}
npm run build

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  BUILD SELESAI. Hasil di folder: dist\" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Jalankan proxy dengan:"
Write-Host "   node server/proxy-server.mjs"
Write-Host "   (pastikan .env.local-proxy sudah diisi / env SUPABASE_URL & ANON_KEY diset)"
Write-Host "============================================================" -ForegroundColor Green