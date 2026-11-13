# ============================================================
# BUILD CLOUDFLARE PAGES (PowerShell)
# ------------------------------------------------------------
# Membangun aplikasi untuk deploy statis di Cloudflare Pages.
#
# Perbedaan dengan build:proxy:
#   - VITE_USE_LOCAL_PROXY = false  -> client memakai VITE_SUPABASE_URL
#   - VITE_STORAGE_DRIVER  = supabase -> foto dibaca dari Supabase Storage
#     (bukan /photos/... yang hanya ada di proxy lokal)
#
# Hasil: folder `dist-cloudflare/` siap di-upload ke Cloudflare Pages.
# Sengaja dipisah dari `dist/` supaya build proxy lokal tidak tertimpa.
#
# Cara pakai:
#   npm run build:cloudflare
#
# Di Cloudflare Pages (Settings -> Build):
#   Build command : npm run build:cloudflare
#   Output dir    : dist-cloudflare
#   Env vars      : VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# ============================================================

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  MEMBANGUN APLIKASI (MODE CLOUDFLARE PAGES)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ------- 1. Baca .env sebagai sumber nilai (jika ada) -------
$envFile = Join-Path $ProjectDir '.env'
if (Test-Path $envFile) {
  Write-Host "Membaca konfigurasi dari .env ..." -ForegroundColor Green
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
      $parts = $line -split '=', 2
      if ($parts.Count -eq 2) {
        $k = $parts[0].Trim()
        $v = $parts[1].Trim()
        if (-not [Environment]::GetEnvironmentVariable($k)) {
          Set-Item -Path "env:$k" -Value $v
        }
      }
    }
  }
}

# ------- 2. Paksa mode statis + Supabase Storage -------
# Nilai ini MENANG atas sisa environment dari sesi build:proxy sebelumnya.
$env:VITE_USE_LOCAL_PROXY = 'false'
$env:VITE_STORAGE_DRIVER = 'supabase'
Remove-Item Env:VITE_STORAGE_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_R2_PUBLIC_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_STORAGE_PUBLIC_URL -ErrorAction SilentlyContinue

# ------- 3. Validasi konfigurasi Supabase -------
if (-not $env:VITE_SUPABASE_URL) {
  Write-Error 'VITE_SUPABASE_URL tidak ditemukan. Isi di .env atau environment Cloudflare Pages.'
}
if (-not $env:VITE_SUPABASE_ANON_KEY) {
  Write-Error 'VITE_SUPABASE_ANON_KEY tidak ditemukan. Isi di .env atau environment Cloudflare Pages.'
}

Write-Host ""
Write-Host "  Mode build            : CLOUDFLARE PAGES (statis)"
Write-Host "  VITE_USE_LOCAL_PROXY  : false"
Write-Host "  VITE_STORAGE_DRIVER   : supabase"
Write-Host "  VITE_SUPABASE_URL     : $($env:VITE_SUPABASE_URL)"
Write-Host "  VITE_SUPABASE_ANON_KEY: (terisi, dibakar ke bundle)"
Write-Host ""

# ------- 4. Build ke folder terpisah -------
Write-Host "Menjalankan build ke dist-cloudflare ..." -ForegroundColor Green
npm run build -- --outDir dist-cloudflare --emptyOutDir
if ($LASTEXITCODE -ne 0) {
  Write-Error "Build gagal (exit code $LASTEXITCODE)."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  BUILD SELESAI. Upload folder dist-cloudflare/ ke Cloudflare Pages." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
