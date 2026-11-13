# Panduan: Foto di Server Sendiri + Domain `woeng.my.id`

Panduan langkah-demi-langkah memakai **domain `woeng.my.id`** untuk menyajikan
foto aplikasi yang tetap disimpan di folder `storage-data/` komputer Anda,
sementara aplikasinya tetap statis di Cloudflare Pages
(`https://monitoreng.pages.dev/`).

Hasil akhir:

```
Browser (monitoreng.pages.dev)
   │
   ├── data & login ──────────────> Supabase (langsung, seperti biasa)
   │
   └── foto ──> https://foto.woeng.my.id
                  │  (Cloudflare Tunnel, tanpa buka port / tanpa IP publik)
                  └──> server/proxy-server.mjs di komputer Anda
                          ├── /photos/*      -> baca file dari storage-data/
                          └── /storage-api/* -> upload & hapus file
```

Kenapa perlu tunnel: Cloudflare Pages itu **statis**, tidak punya disk. Jadi
folder `storage-data/` harus dilayani oleh komputer Anda, dan Cloudflare Tunnel
membuat komputer itu bisa diakses lewat domain tanpa membuka port router.

---

## 0. Ringkasan yang akan dibuat

| Hal | Nilai |
|---|---|
| Domain | `woeng.my.id` (dikelola Cloudflare) |
| Subdomain foto | `foto.woeng.my.id` |
| Nama tunnel | `foto-woeng` |
| Layanan lokal | `http://localhost:8000` (proxy) |
| Env build Pages | `VITE_STORAGE_PUBLIC_URL`, `VITE_STORAGE_API_URL` |
| Biaya | Gratis (Cloudflare Tunnel + Pages free plan) |

> Boleh juga memakai `woeng.my.id` langsung (tanpa subdomain). Panduan ini
> memakai `foto.woeng.my.id` supaya domain utama tetap bebas untuk hal lain.

---

## 0.1 Cara cepat (otomatis)

Setelah langkah 2 (domain aktif di Cloudflare) dan langkah 3 (cloudflared
terpasang), sisa langkah 4–6 bisa dijalankan otomatis:

```powershell
cd C:\Users\Interbat\monitoring-engineering
npm.cmd run setup:tunnel
```

Skrip `server/setup-cloudflared-tunnel.ps1` akan:

1. Mencari `cloudflared` (PATH, Program Files, atau WinGet).
2. Membuka browser untuk `cloudflared tunnel login` bila `cert.pem` belum ada.
3. Membuat tunnel `foto-woeng` (atau memakai yang sudah ada).
4. Menjalankan `cloudflared tunnel route dns foto-woeng foto.woeng.my.id`.
5. Menulis `%USERPROFILE%\.cloudflared\config.yml` (config lama dicadangkan).

Parameter opsional:

```powershell
powershell -ExecutionPolicy Bypass -File server\setup-cloudflared-tunnel.ps1 `
  -TunnelName foto-woeng -Hostname foto.woeng.my.id -Port 8000
```

Setelah itu lanjut ke **langkah 7** (konfigurasi proxy). Untuk menjalankan
sehari-hari cukup double-click **`server\start-foto-tunnel.bat`** (atau
`npm run start:foto`) — file itu menyalakan proxy **dan** tunnel sekaligus.

Langkah 4–6 di bawah tetap disediakan bila Anda ingin melakukannya manual.

---

## 1. Prasyarat

1. Domain `woeng.my.id` sudah Anda miliki (punya akses ke registrar/pengelola DNS).
2. Node.js 18+ sudah terpasang (`node -v`).
3. Proyek ada di `C:\Users\Interbat\monitoring-engineering`.
4. Akun Cloudflare (gratis) — sama akun yang dipakai untuk Pages.

---

## 2. Pindahkan `woeng.my.id` ke Cloudflare

Cloudflare Tunnel hanya bisa membuat DNS otomatis untuk domain yang
nameserver-nya sudah di Cloudflare. Lewati langkah ini bila sudah.

1. Buka <https://dash.cloudflare.com> → **Add a site**.
2. Masukkan `woeng.my.id` → pilih plan **Free** → **Continue**.
3. Cloudflare menampilkan 2 nameserver, misalnya:
   ```
   alina.ns.cloudflare.com
   kip.ns.cloudflare.com
   ```
4. Login ke registrar domain Anda (tempat membeli `woeng.my.id`), cari menu
   **Nameserver / DNS Server**, ganti menjadi dua nameserver di atas.
5. Tunggu 5 menit – 24 jam. Cek dengan:
   ```powershell
   nslookup -type=NS woeng.my.id
   ```
   Harus muncul `*.ns.cloudflare.com`.
6. Di dashboard Cloudflare, status domain harus **Active**.

> Jangan ubah nameserver sebelum yakin, karena email/website lain di domain itu
> bisa ikut terpengaruh. Catat dulu record DNS lama, lalu buat ulang di Cloudflare.

---

## 3. Pasang `cloudflared`

```powershell
winget install --id Cloudflare.cloudflared
```

Tutup dan buka ulang terminal, lalu cek:

```powershell
cloudflared --version
```

---

## 4. Login dan buat tunnel

```powershell
cloudflared tunnel login
```

Browser terbuka → pilih zone **woeng.my.id** → **Authorize**.
File sertifikat tersimpan di `C:\Users\Interbat\.cloudflared\cert.pem`.

Buat tunnel bernama `foto-woeng`:

```powershell
cloudflared tunnel create foto-woeng
```

Output berisi **UUID** tunnel, misalnya:

```
Created tunnel foto-woeng with id 6f1c2a3b-1111-2222-3333-444455556666
```

Catat UUID itu. File kredensialnya ada di:

```
C:\Users\Interbat\.cloudflared\6f1c2a3b-1111-2222-3333-444455556666.json
```

---

## 5. Arahkan subdomain ke tunnel

```powershell
cloudflared tunnel route dns foto-woeng foto.woeng.my.id
```

Perintah ini otomatis membuat record CNAME `foto` → `<UUID>.cfargotunnel.com`
di zona `woeng.my.id`. Cek di dashboard Cloudflare → **DNS** → harus ada record
`foto` bertanda *Proxied* (awan oranye).

---

## 6. Buat file konfigurasi tunnel

Cara termudah: salin contoh lalu ganti UUID.

```powershell
copy server\cloudflared-config.example.yml "$env:USERPROFILE\.cloudflared\config.yml"
notepad "$env:USERPROFILE\.cloudflared\config.yml"
```

Isi yang benar (ganti `<UUID-TUNNEL>` dan `<NAMA-ANDA>`):

```yaml
tunnel: <UUID-TUNNEL>
credentials-file: C:\Users\<NAMA-ANDA>\.cloudflared\<UUID-TUNNEL>.json

ingress:
  - hostname: foto.woeng.my.id
    service: http://localhost:8000
  - service: http_status:404
```

**Jangan** pakai tanda kutip pada path Windows.

Uji jalankan (biarkan terminal ini terbuka):

```powershell
cloudflared tunnel run foto-woeng
```

Bila muncul `Registered tunnel connection`, tunnel sudah tersambung.

---

## 7. Siapkan proxy lokal

### 7.1 Konfigurasi `.env.local-proxy`

Buka `C:\Users\Interbat\monitoring-engineering\.env.local-proxy` dan pastikan:

```ini
SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
ANON_KEY=<anon/publishable key>
HOST=0.0.0.0
PORT=8000

STORAGE_DRIVER=local
STORAGE_DIR=storage-data
STORAGE_MAX_BYTES=5242880
STORAGE_REQUIRE_AUTH=true

# Hanya izinkan aplikasi Pages memakai foto
ALLOWED_ORIGIN=https://monitoreng.pages.dev

# Karena proxy terbuka ke internet, layani HANYA foto
STORAGE_ONLY=true
```

Penjelasan:

- `ALLOWED_ORIGIN` → browser dari origin lain tidak boleh upload/hapus.
- `STORAGE_ONLY=true` → semua path selain `/photos/*` dan `/storage-api/*`
  dijawab 404, jadi file aplikasi dan proxy API Supabase tidak ikut terbuka.
- `STORAGE_REQUIRE_AUTH=true` → upload/hapus wajib token login Supabase yang valid.

### 7.2 Jalankan proxy

```powershell
cd C:\Users\Interbat\monitoring-engineering
npm.cmd run start:proxy
```

Pastikan muncul:

```
Storage     : local (C:\Users\Interbat\monitoring-engineering\storage-data)
Proxy listen: http://0.0.0.0:8000
Mode        : STORAGE_ONLY (hanya /photos/* dan /storage-api/*)
CORS origin : https://monitoreng.pages.dev
```

### 7.3 Uji dari internet

Di terminal lain:

```powershell
# harus 404 (bukan 200) karena STORAGE_ONLY
curl.exe -i https://foto.woeng.my.id/

# harus 404 juga (file belum ada) — yang penting bukan error tunnel
curl.exe -i https://foto.woeng.my.id/photos/uji.jpg

# preflight CORS harus 204
curl.exe -i -X OPTIONS https://foto.woeng.my.id/storage-api/upload `
  -H "Origin: https://monitoreng.pages.dev" `
  -H "Access-Control-Request-Method: POST"
```

---

## 8. Set environment di Cloudflare Pages

Dashboard Cloudflare → **Workers & Pages** → proyek `monitoreng` →
**Settings** → **Environment variables** → tab **Production** → **Add**:

| Nama | Nilai |
|---|---|
| `VITE_SUPABASE_URL` | `https://qkdosuplybkdfdwuzzxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<anon/publishable key>` |
| `VITE_STORAGE_PUBLIC_URL` | `https://foto.woeng.my.id` |
| `VITE_STORAGE_API_URL` | `https://foto.woeng.my.id/storage-api` |

Jangan set `VITE_STORAGE_DRIVER` — skrip build mengisinya otomatis menjadi
`local` karena dua variabel `VITE_STORAGE_*` di atas terisi.

Pastikan juga **Build command** = `npm run build:cloudflare` dan
**Build output directory** = `dist-cloudflare`.

---

## 9. Deploy ulang

**Cara A — lewat Git (disarankan)**

```powershell
cd C:\Users\Interbat\monitoring-engineering
git add -A
git commit -m "Foto: dukung storage lokal via domain foto.woeng.my.id"
git push
```

Cloudflare Pages otomatis build ulang.

**Cara B — build lokal lalu upload manual**

```powershell
$env:VITE_STORAGE_PUBLIC_URL='https://foto.woeng.my.id'
$env:VITE_STORAGE_API_URL='https://foto.woeng.my.id/storage-api'
npm.cmd run build:cloudflare
```

Lalu upload isi `dist-cloudflare/` ke Pages (drag & drop di tab *Deployments*).

---

## 10. Verifikasi

1. Buka `https://monitoreng.pages.dev/` → login.
2. Buka DevTools → **Network** → filter `Img`.
3. URL foto harus berbentuk:
   ```
   https://foto.woeng.my.id/photos/<roundId>/<parameterId>/<file>.jpg
   ```
   **Bukan** `*.supabase.co/storage/v1/object/public/...`.
4. Upload foto baru → harus muncul tanpa error, dan file benar-benar ada di:
   ```
   C:\Users\Interbat\monitoring-engineering\storage-data\<path>
   ```
5. Hapus foto → file di folder itu ikut hilang.

Cek cepat isi bundle yang ter-deploy:

```powershell
$h = (Invoke-WebRequest https://monitoreng.pages.dev/ -UseBasicParsing).Content
$js = [regex]::Match($h, '/assets/index-[A-Za-z0-9\-_]+\.js').Value
$c = (Invoke-WebRequest "https://monitoreng.pages.dev$js" -UseBasicParsing).Content
"foto.woeng.my.id : $([regex]::Matches($c,'foto\.woeng\.my\.id').Count)"
"supabase storage : $([regex]::Matches($c,'/storage/v1/object/public').Count)"
```

Harus: `foto.woeng.my.id` ≥ 1 dan `supabase storage` = 0.

---

## 11. Jalankan otomatis saat komputer menyala

Tunnel dan proxy harus hidup terus. Pilih salah satu.

### Opsi A — Windows Service (paling rapi, butuh admin)

1. Salin konfigurasi ke folder service:
   ```powershell
   $dst = "C:\Windows\System32\config\systemprofile\.cloudflared"
   New-Item -ItemType Directory -Force -Path $dst | Out-Null
   Copy-Item "$env:USERPROFILE\.cloudflared\config.yml" $dst -Force
   Copy-Item "$env:USERPROFILE\.cloudflared\*.json" $dst -Force
   ```
2. Buka PowerShell **as Administrator**, lalu:
   ```powershell
   cloudflared service install
   ```
3. Cek: `Get-Service cloudflared` → status **Running**.

### Opsi B — Task Scheduler (tanpa admin)

Buat dua task, keduanya *At startup* / *At log on*, **Run whether user is logged on or not**:

| Task | Program | Arguments | Start in |
|---|---|---|---|
| Proxy | `node.exe` | `server\proxy-server.mjs` | `C:\Users\Interbat\monitoring-engineering` |
| Tunnel | `cloudflared.exe` | `tunnel run foto-woeng` | `C:\Users\Interbat` |

### Opsi C — pakai file .bat yang sudah ada

Double-click **`server\start-foto-tunnel.bat`** (atau `npm run start:foto`).
File ini:

- memeriksa Node.js, `cloudflared`, `config.yml`, dan `.env.local-proxy`;
- memperingatkan bila `STORAGE_ONLY` belum `true`;
- membuka **dua jendela**: proxy dan tunnel.

Tutup kedua jendela untuk menghentikan layanan.

---

## 12. Menyalin foto lama dari Supabase

Foto yang sudah ada di Supabase Storage tidak otomatis pindah.

```powershell
copy server\.env.migrate.example server\.env.migrate
notepad server\.env.migrate      # isi SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

node server\migrate-storage-local.mjs --dry-run
node server\migrate-storage-local.mjs --skip-existing
```

Setelah selesai, foto lama langsung tampil dari `foto.woeng.my.id` karena
`storage_path` di database tidak berubah.

---

## 13. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `EADDRINUSE: address already in use 0.0.0.0:8000` | Proxy sudah berjalan di jendela lain. Jalankan `npm run stop:proxy` (atau `server\stop-proxy.bat`), lalu start lagi. Bisa juga ubah `PORT` di `.env.local-proxy` + `config.yml` tunnel. |
| `foto.woeng.my.id` → 502/1033 | Tunnel mati atau proxy mati. Jalankan `cloudflared tunnel run foto-woeng` dan `npm run start:proxy`. |
| `foto.woeng.my.id` → 404 untuk semua path | `STORAGE_ONLY=true` dan path bukan `/photos/` atau `/storage-api/`. Ini normal untuk `/`. |
| Foto 404 padahal file ada | Cek `STORAGE_DIR` di `.env.local-proxy`; path harus relatif ke folder proyek. |
| Upload gagal, console: *CORS policy* | `ALLOWED_ORIGIN` tidak memuat `https://monitoreng.pages.dev`. Perbaiki lalu restart proxy. |
| Upload 401 | Token login kedaluwarsa / `STORAGE_REQUIRE_AUTH=true`. Login ulang di aplikasi. |
| Upload 413 | File > `STORAGE_MAX_BYTES` (default 5 MB). Naikkan nilainya bila perlu. |
| Foto masih ke `*.supabase.co` | Env `VITE_STORAGE_*` belum di-set di Pages, atau belum redeploy. Cek langkah 8–10. |
| `cloudflared tunnel route dns` gagal | Nameserver domain belum di Cloudflare (langkah 2), atau subdomain sudah dipakai. |
| Tunnel putus tiap beberapa jam | Jalankan sebagai service (langkah 11), jangan di terminal manual. |
| `npm` → `SecurityError` di PowerShell | Pakai `npm.cmd`. |
| `cloudflared.exe : {"level":"warn",...}` + `NativeCommandError` saat setup | Peringatan versi cloudflared ditulis ke stderr dan PowerShell 5.1 menganggapnya error. Sudah ditangani di `setup-cloudflared-tunnel.ps1` (fungsi `Invoke-Native`). Bila memakai skrip versi lama, perbarui skripnya. |
| `Your version ... is outdated` | Hanya peringatan. Perbarui dengan `winget upgrade --id Cloudflare.cloudflared` (opsional). |

---

## 14. Keamanan & perawatan

- **Jangan** set `STORAGE_ONLY=false` saat tunnel aktif — seluruh file aplikasi
  dan proxy API Supabase akan ikut terbuka.
- `STORAGE_REQUIRE_AUTH=true` wajib di produksi.
- Backup folder `storage-data/` secara berkala (minimal mingguan):
  ```powershell
  Compress-Archive -Path storage-data\* -DestinationPath "backup-foto-$(Get-Date -f yyyyMMdd).zip"
  ```
- Opsional: lindungi `foto.woeng.my.id` dengan **Cloudflare Access** (Zero Trust)
  bila foto tidak boleh diakses publik. Catatan: `<img>` dari browser pengguna
  juga harus lolos Access, jadi biasanya cukup andalkan path acak + auth upload.
- Cloudflare Tunnel gratis, tanpa batas bandwidth yang relevan untuk foto.

---

## 15. Checklist go-live

- [ ] `woeng.my.id` aktif di Cloudflare (nameserver sudah pindah)
- [ ] `cloudflared tunnel create foto-woeng` selesai, UUID dicatat
- [ ] `cloudflared tunnel route dns foto-woeng foto.woeng.my.id` selesai
- [ ] `config.yml` berisi hostname + `service: http://localhost:8000`
- [ ] `.env.local-proxy`: `STORAGE_DRIVER=local`, `STORAGE_ONLY=true`,
      `ALLOWED_ORIGIN=https://monitoreng.pages.dev`
- [ ] `npm run start:proxy` jalan tanpa error
- [ ] `cloudflared tunnel run foto-woeng` tersambung
- [ ] Env `VITE_STORAGE_PUBLIC_URL` + `VITE_STORAGE_API_URL` diisi di Pages
- [ ] Redeploy sukses, bundle tidak lagi memuat `/storage/v1/object/public`
- [ ] Upload & hapus foto diuji dari `monitoreng.pages.dev`
- [ ] Foto lama disalin (`migrate-storage-local.mjs`)
- [ ] Tunnel + proxy otomatis jalan saat komputer restart
- [ ] Backup `storage-data/` terjadwal

---

## 16. Berkas bantu di folder `server/`

| Berkas | Fungsi |
|---|---|
| `setup-cloudflared-tunnel.ps1` | Setup otomatis: login, buat tunnel, route DNS, tulis `config.yml`. Jalankan sekali. |
| `start-foto-tunnel.bat` | Menyalakan proxy + tunnel sekaligus (double-click). |
| `stop-proxy.bat` | Menghentikan proxy yang masih memakai port (mengatasi `EADDRINUSE`). |
| `cloudflared-config.example.yml` | Contoh `config.yml` bila ingin setup manual. |
| `proxy-server.mjs` | Server yang melayani `/photos/*` dan `/storage-api/*`. |
| `migrate-storage-local.mjs` | Menyalin foto lama dari Supabase Storage ke `storage-data/`. |
| `PANDUAN-STORAGE-LOKAL.md` | Panduan storage lokal (LAN, tanpa domain). |

Perintah npm terkait:

```powershell
npm.cmd run setup:tunnel   # setup tunnel sekali jalan
npm.cmd run start:foto     # proxy + tunnel
npm.cmd run start:proxy    # proxy saja (LAN)
npm.cmd run stop:proxy     # hentikan proxy (atasi EADDRINUSE)
npm.cmd run migrate:local  # salin foto lama
```
