# ============================================================
# SETUP CLOUDFLARE TUNNEL UNTUK FOTO (sekali jalan)
# ------------------------------------------------------------
# Membuat tunnel, mengarahkan subdomain, dan menulis config.yml
# secara otomatis.
#
# Cara pakai (dari folder proyek):
#   powershell -ExecutionPolicy Bypass -File server\setup-cloudflared-tunnel.ps1
#
# Atau dengan parameter:
#   ... -TunnelName foto-woeng -Hostname monitoring.woeng.my.id -Port 8000
#
# Prasyarat:
#   - cloudflared terpasang (winget install --id Cloudflare.cloudflared)
#   - domain sudah aktif di Cloudflare (nameserver sudah dipindah)
# ============================================================

param(
  [string]$TunnelName = 'foto-woeng',
  [string]$Hostname   = 'monitoring.woeng.my.id',
  [int]$Port          = 8001
)

# CATATAN: JANGAN memakai $ErrorActionPreference = 'Stop' di skrip ini.
# PowerShell 5.1 menganggap tulisan cloudflared ke stderr (mis. peringatan
# "Your version ... is outdated") sebagai NativeCommandError yang fatal.
$ErrorActionPreference = 'Continue'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    [!] $msg" -ForegroundColor Yellow }

# Jalankan perintah native dengan aman: tangkap stdout+stderr tanpa melempar
# NativeCommandError, kembalikan objek berisi Output (string[]) dan ExitCode.
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return [pscustomobject]@{ Output = @($out); ExitCode = $code }
}

# ------- 1. Cari cloudflared -------
Write-Step 'Mencari cloudflared'
$cfdCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
$cfd = if ($cfdCmd) { $cfdCmd.Source } else { $null }
if (-not $cfd) {
  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )
  $cfd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cfd) {
  Write-Host 'cloudflared tidak ditemukan.' -ForegroundColor Red
  Write-Host 'Install dulu:  winget install --id Cloudflare.cloudflared' -ForegroundColor Yellow
  Write-Host 'Lalu tutup & buka ulang PowerShell, kemudian jalankan skrip ini lagi.'
  exit 1
}
Write-Ok $cfd

# ------- 2. Login (bila belum) -------
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
$certFile = Join-Path $cfDir 'cert.pem'
if (-not (Test-Path $certFile)) {
  Write-Step 'Login ke Cloudflare (browser akan terbuka)'
  Write-Warn2 'Pilih zone domain Anda, lalu klik Authorize.'
  $login = Invoke-Native $cfd tunnel login
  $login.Output | ForEach-Object { Write-Host "    $_" }
  if (-not (Test-Path $certFile)) {
    Write-Host 'Login gagal: cert.pem tidak terbentuk.' -ForegroundColor Red
    exit 1
  }
}
Write-Ok "Sertifikat: $certFile"

# ------- 3. Buat tunnel (bila belum) -------
Write-Step "Menyiapkan tunnel '$TunnelName'"
$list = Invoke-Native $cfd tunnel list --output json
$tunnelId = $null
if ($list.ExitCode -eq 0 -and $list.Output.Count -gt 0) {
  # cloudflared bisa menulis peringatan (mis. "Your version ... is outdated")
  # ke stderr, yang bisa muncul di awal ATAU akhir output. Ambil hanya blok
  # JSON: dari baris pertama yang diawali '[' sampai baris terakhir yang ']'.
  $startIdx = -1
  $endIdx = -1
  for ($i = 0; $i -lt $list.Output.Count; $i++) {
    if ($startIdx -lt 0 -and $list.Output[$i] -match '^\s*\[') { $startIdx = $i }
    if ($list.Output[$i] -match '^\s*\]\s*$') { $endIdx = $i }
  }
  if ($startIdx -ge 0 -and $endIdx -ge $startIdx) {
    $jsonText = ($list.Output[$startIdx..$endIdx]) -join "`n"
    try {
      $tunnels = $jsonText | ConvertFrom-Json
      $existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
      if ($existing) { $tunnelId = $existing.id }
    } catch { }
  }
}

if ($tunnelId) {
  Write-Ok "Tunnel sudah ada: $tunnelId"
} else {
  $create = Invoke-Native $cfd tunnel create $TunnelName
  $create.Output | ForEach-Object { Write-Host "    $_" }
  $match = [regex]::Match(($create.Output -join "`n"), '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  if (-not $match.Success) {
    Write-Host 'Gagal membaca UUID tunnel dari output di atas.' -ForegroundColor Red
    exit 1
  }
  $tunnelId = $match.Groups[1].Value
  Write-Ok "Tunnel dibuat: $tunnelId"
}

$credFile = Join-Path $cfDir "$tunnelId.json"
if (-not (Test-Path $credFile)) {
  Write-Host "File kredensial tidak ditemukan: $credFile" -ForegroundColor Red
  exit 1
}
Write-Ok "Kredensial: $credFile"

# ------- 4. Arahkan DNS -------
Write-Step "Mengarahkan $Hostname ke tunnel"
$route = Invoke-Native $cfd tunnel route dns $TunnelName $Hostname
$route.Output | ForEach-Object { Write-Host "    $_" }
if ($route.ExitCode -ne 0) {
  Write-Warn2 'Perintah route dns gagal. Kemungkinan record DNS sudah ada.'
  Write-Warn2 "Cek dashboard Cloudflare -> DNS: pastikan ada CNAME '$Hostname' (Proxied)."
} else {
  Write-Ok "DNS diarahkan: $Hostname"
}

# ------- 5. Tulis config.yml -------
Write-Step 'Menulis config.yml'
$configPath = Join-Path $cfDir 'config.yml'
if (Test-Path $configPath) {
  $backup = "$configPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $configPath $backup
  Write-Warn2 "config.yml lama dicadangkan ke: $backup"
}

$yaml = @"
tunnel: $tunnelId
credentials-file: $credFile

ingress:
  - hostname: $Hostname
    service: http://localhost:$Port
  - service: http_status:404
"@
Set-Content -Path $configPath -Value $yaml -Encoding UTF8
Write-Ok $configPath

# ------- 6. Ringkasan -------
Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  SETUP TUNNEL SELESAI' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "  Tunnel     : $TunnelName ($tunnelId)"
Write-Host "  Hostname   : https://$Hostname"
Write-Host "  Layanan    : http://localhost:$Port"
Write-Host ''
Write-Host '  Langkah berikutnya:' -ForegroundColor Yellow
Write-Host '  1. Isi .env.local-proxy:'
Write-Host '       STORAGE_DRIVER=local'
Write-Host '       STORAGE_ONLY=true'
Write-Host "       ALLOWED_ORIGIN=https://monitoreng.pages.dev"
Write-Host '  2. Jalankan:  server\start-foto-tunnel.bat'
Write-Host '  3. Set env di Cloudflare Pages:'
Write-Host "       VITE_STORAGE_PUBLIC_URL=https://$Hostname"
Write-Host "       VITE_STORAGE_API_URL=https://$Hostname/storage-api"
Write-Host '  4. Redeploy aplikasi.'
Write-Host '============================================================' -ForegroundColor Cyan
