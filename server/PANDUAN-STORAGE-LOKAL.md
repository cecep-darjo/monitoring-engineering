# Panduan Storage Lokal (tanpa Cloudflare, tanpa PostgreSQL)

Panduan ini memindahkan penyimpanan foto dari **Supabase Storage** ke **disk
komputer lokal** yang menjalankan proxy. Tidak perlu kartu kredit, tidak perlu
akun Cloudflare, dan **tidak perlu PostgreSQL**.

---

## 0. Jawaban singkat: apakah butuh PostgreSQL?

**Tidak.** PostgreSQL hanya menyimpan data (tabel `monitoring_photos`,
`work_request_photos`, `monitoring_rounds`, dst.) dan itu sudah berjalan di
Supabase. Yang dipindahkan hanyalah **file gambarnya**.

Storage lokal hanya butuh:

| Kebutuhan | Status |
|---|---|
| Folder di disk | Dibuat otomatis (`storage-data/`) |
| HTTP server untuk upload/hapus/baca | Sudah ada di `server/proxy-server.mjs` |
| Metadata foto | Tetap di Supabase (tidak berubah) |
| PostgreSQL lokal | **Tidak perlu** |
| Dependency npm baru | **Tidak ada** |

Yang berubah hanya tempat file disimpan. Semua path di database tetap sama,
jadi tidak ada migrasi skema.

---

## 1. Arsitektur

```
SEBELUM
  Browser ──upload──> Supabase Storage
  Browser ──baca────> https://<project>.supabase.co/storage/v1/object/public/...

SESUDAH (STORAGE_DRIVER=local)
  Browser ──POST /storage-api/upload──> Proxy (Node) ──tulis──> storage-data/<path>
  Browser ──GET  /photos/<path>───────> Proxy (Node) ──baca────> storage-data/<path>
  Browser ──data lain────────────────> Supabase (REST/Auth/Functions)
```

Proxy memverifikasi token login Supabase sebelum menerima upload/hapus, jadi
tidak semua orang bisa menulis file. Membaca foto bersifat publik (sama seperti
bucket Supabase Anda sekarang yang `public = true`).

---

## 2. Langkah cepat (5 menit)

### 2.1 Aktifkan driver lokal

Edit `.env.local-proxy`:

```
SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
ANON_KEY=sb_publishable_...
HOST=0.0.0.0
PORT=8000

STORAGE_DRIVER=local
STORAGE_DIR=storage-data
STORAGE_MAX_BYTES=5242880
STORAGE_REQUIRE_AUTH=true
```

`.env.local-proxy` harus disimpan **UTF-8 tanpa BOM**.

### 2.2 Build dan jalankan

```powershell
cd C:\Users\Interbat\monitoring-engineering
npm run build:proxy
npm run start:proxy
```

Saat start, log akan menampilkan:

```
Storage     : local (C:\Users\Interbat\monitoring-engineering\storage-data)
```

Folder `storage-data/` dibuat otomatis.

### 2.3 Uji

1. Buka `http://localhost:8000/`, login.
2. New Monitoring -> upload foto -> simpan.
3. Cek file muncul di `storage-data/<roundId>/<parameterId>/...`
4. Refresh halaman; foto harus tampil.
5. Hapus foto; file harus hilang dari disk.

Selesai. Untuk aplikasi baru, tidak ada langkah lain.

### 2.4 Saat pengembangan (`npm run dev`)

Vite perlu meneruskan endpoint storage ke proxy. Ini sudah disiapkan di
`vite.config.ts`, dengan target default `http://localhost:8000` (bisa diubah
lewat `VITE_DEV_PROXY_TARGET`).

1. Tambahkan di `.env`:

```
VITE_STORAGE_DRIVER=local
```

2. Jalankan proxy di satu terminal:

```powershell
$env:STORAGE_DRIVER='local'; npm run start:proxy
```

3. Jalankan dev server di terminal lain:

```powershell
npm run dev
```

Upload/hapus/tampil akan berjalan lewat proxy, file tetap masuk ke
`storage-data/`.

---

## 3. Menyalin foto lama dari Supabase

Foto lama masih di Supabase Storage. Salin ke disk dengan skrip bawaan
(tanpa dependency tambahan).

### 3.1 Siapkan konfigurasi

```powershell
cd C:\Users\Interbat\monitoring-engineering
Copy-Item server\.env.migrate.example server\.env.migrate
```

Isi `server\.env.migrate`:

```
SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_BUCKET=monitoring-photos
STORAGE_DIR=storage-data
```

Service role key (pilih salah satu, sesuai tampilan dashboard Anda):

- **Project Settings** -> **API Keys** -> **Secret keys** -> salin nilai
  berawalan `sb_secret_...` (format baru).
- **Project Settings** -> **API** -> bagian `service_role` -> salin JWT
  berawalan `eyJ...` (format lama).

**Jangan** memakai `sb_publishable_...` atau anon key. Kunci itu hanya bisa
membaca data publik; RLS akan menyembunyikan semua bucket sehingga migrasi
terlihat seperti "0 objek". Skrip sekarang mendeteksi ini dan berhenti dengan
pesan yang jelas.

### 3.2 Uji tanpa menulis

```powershell
npm run migrate:local -- --dry-run
```

Periksa jumlah objek dan contoh path.

### 3.3 Uji sebagian

```powershell
npm run migrate:local -- --limit=10
```

Cek 10 file muncul di `storage-data/` dengan path yang sama.

### 3.4 Salin semuanya

```powershell
npm run migrate:local
```

Kalau terputus, lanjutkan tanpa mengunduh ulang:

```powershell
npm run migrate:local -- --skip-existing
```

Opsi lain:

| Opsi | Fungsi |
|---|---|
| `--prefix=work-requests` | hanya satu folder |
| `--concurrency=8` | lebih cepat (default 4) |
| `--limit=100` | batasi jumlah file |

---

## 4. Verifikasi

### 4.1 Bandingkan jumlah

```sql
-- Supabase SQL Editor
select 'monitoring_photos' as sumber, count(*) from monitoring_photos
union all
select 'work_request_photos', count(*) from work_request_photos;
```

Jumlah file di `storage-data/`:

```powershell
(Get-ChildItem storage-data -Recurse -File).Count
```

Jumlah file harus >= jumlah baris DB.

### 4.2 Uji fitur

| # | Langkah | Harapan |
|---|---|---|
| 1 | History -> buka round lama | Foto tampil dari `/photos/...` |
| 2 | New Monitoring -> upload | File baru muncul di `storage-data/` |
| 3 | Edit round -> hapus foto | File terhapus dari disk |
| 4 | Titipan Pekerjaan -> selesai + foto | Foto tampil |
| 5 | Hapus titipan | File foto ikut terhapus |
| 6 | Reports -> Download PDF | Foto masuk lampiran |
| 7 | Reports -> Kirim Email | PDF berisi foto |
| 8 | Akses dari komputer LAN | Foto tetap tampil |

### 4.3 Cek DevTools

Buka **Network**:

- Gambar harus menuju `http://<ip-proxy>:8000/photos/...`
- Upload: `POST /storage-api/upload?path=...` -> `200`
- Hapus: `POST /storage-api/delete` -> `200`
- Tidak boleh ada request ke `*.supabase.co/storage/v1/object`

> Catatan: PDF email dibuat oleh edge function di server Supabase. Edge function
> tidak bisa membaca disk komputer Anda. Lihat bagian 6.

---

## 5. Backup dan perawatan

Foto sekarang **hanya ada di satu komputer**. Lakukan backup rutin.

### Backup manual

```powershell
$tanggal = Get-Date -Format 'yyyy-MM-dd'
Compress-Archive -Path storage-data\* `
  -DestinationPath "backup-foto-$tanggal.zip"
```

### Backup harian otomatis (Task Scheduler)

Simpan sebagai `server\backup-storage.ps1`:

```powershell
$root = 'C:\Users\Interbat\monitoring-engineering'
$tanggal = Get-Date -Format 'yyyy-MM-dd'
$tujuan = Join-Path $root 'backup'
New-Item -ItemType Directory -Force -Path $tujuan | Out-Null
Compress-Archive -Path (Join-Path $root 'storage-data\*') `
  -DestinationPath (Join-Path $tujuan "foto-$tanggal.zip") -Force
# Simpan 30 hari terakhir
Get-ChildItem $tujuan -Filter 'foto-*.zip' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
```

Daftarkan di Task Scheduler (harian, mis. 23:00).

### Pindah ke komputer lain

1. Copy folder `storage-data/` ke komputer baru (path sama).
2. Copy `.env.local-proxy`.
3. Jalankan `npm run build:proxy` lalu `npm run start:proxy`.

Tidak ada database yang perlu dipindah.

---

## 6. Batasan penting

### 6.1 Edge function `send-shift-report`

Edge function berjalan di cloud Supabase, bukan di komputer Anda, sehingga
**tidak bisa membaca `storage-data/`**. Ada tiga pilihan:

| Pilihan | Cara |
|---|---|
| **A. Biarkan foto lama di Supabase** (paling mudah) | Jangan hapus bucket Supabase. Edge function tetap mengambil dari Supabase. Foto **baru** (di disk) tidak akan masuk PDF email. |
| **B. Ekspos folder lokal ke internet** | Pakai tunnel (Cloudflare Tunnel gratis, ngrok, Tailscale Funnel) lalu set secret `R2_PUBLIC_URL=https://<tunnel>/photos`. Nama secret tetap `R2_PUBLIC_URL` agar kode tidak berubah. |
| **C. Nonaktifkan lampiran foto di email** | PDF tetap terkirim, hanya tanpa foto. |

Pilihan A aman untuk transisi. Pilihan B memberi hasil lengkap.

### 6.2 Satu komputer = satu titik kegagalan

Kalau disk rusak, foto hilang. Wajib backup (bagian 5).

### 6.3 Ukuran file

Default maksimum 5 MB per file (`STORAGE_MAX_BYTES`). Foto dari kamera HP
biasanya 2-4 MB, jadi masih aman. Naikkan bila perlu:

```
STORAGE_MAX_BYTES=10485760
```

### 6.4 Akses publik

Siapa pun di jaringan yang tahu URL `/photos/<path>` bisa membuka foto.
Ini setara dengan bucket Supabase `public`. Kalau perlu lebih aman, matikan
`STORAGE_REQUIRE_AUTH`? Tidak — itu justru mematikan proteksi upload. Untuk
membatasi baca, tambahkan aturan di firewall/reverse proxy.

---

## 7. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | Execution policy PowerShell = Restricted | Pakai `npm.cmd` (lihat bagian 7.1) atau `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Storage: supabase` di log | `STORAGE_DRIVER` tidak terbaca | Pastikan `.env.local-proxy` UTF-8 tanpa BOM, restart proxy |
| Upload 401 | Token tidak terkirim / kedaluwarsa | Login ulang; cek header `Authorization` di DevTools |
| Upload 413 | File melebihi `STORAGE_MAX_BYTES` | Naikkan nilainya, restart proxy |
| Upload 400 "Path tidak valid" | Path mengandung `..` atau `\` | Normalnya tidak terjadi; laporkan bila muncul |
| Foto 404 | File belum tersalin | `npm run migrate:local -- --skip-existing` |
| Foto tampil di server, tidak di LAN | Akses lewat IP berbeda | Pastikan semua klien memakai `http://<ip-proxy>:8000` |
| Foto tidak tampil setelah pindah driver | Build belum diperbarui | `npm run build:proxy` lalu Ctrl+F5 |
| PDF tanpa foto | Edge function tidak bisa baca disk | Lihat bagian 6.1 |
| Migrasi `List gagal (400)` | Service role key / bucket salah | Cek `server/.env.migrate` |
| Folder `storage-data` tidak muncul | `STORAGE_DRIVER` bukan `local` | Perbaiki env, restart |

### 7.1 Error execution policy (`npm.ps1 cannot be loaded`)

Windows memblokir skrip `npm.ps1` yang dipanggil saat Anda mengetik `npm`.
Ini bukan masalah aplikasi.

**Cara cepat (tanpa mengubah sistem):** selalu pakai `npm.cmd`:

```powershell
npm.cmd run migrate:local -- --dry-run
npm.cmd run migrate:local
npm.cmd run build:proxy
npm.cmd run start:proxy
```

**Cara permanen (per user, tanpa admin):**

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Setelah itu `npm` biasa bisa dipakai lagi. Verifikasi:

```powershell
Get-ExecutionPolicy -List
```

Scope `CurrentUser` harus menampilkan `RemoteSigned`, sementara scope lain
boleh tetap `Undefined`.

**Catatan:** `npm run build:proxy` memanggil PowerShell dengan
`-ExecutionPolicy Bypass`, jadi perintah itu tetap berjalan meskipun policy
Restricted. Yang terkena blokir hanya pemanggilan `npm` versi PowerShell.

### 7.2 Migrasi menemukan 0 objek

Kalau output menampilkan `Ditemukan 0 objek`, artinya bucket Supabase yang
dituju memang kosong. Periksa:

**Penyebab paling umum: kunci yang dipakai adalah publishable/anon key.**
Skrip akan berhenti dengan pesan
`SUPABASE_SERVICE_ROLE_KEY berisi PUBLISHABLE key`. Ganti dengan kunci
`sb_secret_...` (atau `eyJ...` untuk format lama) seperti di bagian 3.1.

Bila pesan itu tidak muncul, cek daftar bucket:

```powershell
node -e "const fs=require('fs');const t=fs.readFileSync('server/.env.migrate','utf8');const e={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z_]+)\s*=\s*(.*)$/);if(m)e[m[1]]=m[2].trim();}fetch(e.SUPABASE_URL+'/storage/v1/bucket',{headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY}}).then(r=>r.text()).then(console.log)"
```

- `[]` -> tidak ada bucket sama sekali, berarti `SUPABASE_URL` menunjuk proyek
  yang salah.
- Daftar berisi `monitoring-photos` -> bucket ada; cek apakah nama bucket di
  `.env.migrate` sudah benar.

Pastikan `SUPABASE_URL` di `server/.env.migrate` sama dengan
`VITE_SUPABASE_URL` yang dipakai aplikasi live.

---

## 8. Rollback ke Supabase

Data di Supabase Storage tidak dihapus selama proses ini.

1. Ubah `.env.local-proxy`:

```
STORAGE_DRIVER=supabase
```

2. Build ulang dan restart:

```powershell
npm run build:proxy
npm run start:proxy
```

Foto yang diupload selama mode lokal tidak otomatis ada di Supabase. Untuk
menyalin balik, unggah ulang lewat aplikasi atau tulis skrip kecil yang membaca
`storage-data/` dan memanggil Supabase Storage `upload`.

---

## 9. Checklist go-live

- [ ] `STORAGE_DRIVER=local` di `.env.local-proxy`
- [ ] `npm run build:proxy` sukses
- [ ] Log proxy menampilkan `Storage: local (...)`
- [ ] Folder `storage-data/` terbentuk
- [ ] Foto lama tersalin (`npm run migrate:local`), jumlah cocok
- [ ] Upload/hapus/tampil berfungsi dari server dan dari LAN
- [ ] PDF laporan berisi foto
- [ ] Jadwal backup harian aktif dan diuji
- [ ] Keputusan untuk edge function email (A/B/C di bagian 6.1) sudah dipilih
