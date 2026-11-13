# Panduan Lengkap Migrasi Storage ke Cloudflare R2

Panduan ini memindahkan **foto monitoring** dan **foto bukti titipan pekerjaan** dari
Supabase Storage ke Cloudflare R2, tanpa mengubah data di database.

Perkiraan waktu: 45-90 menit (di luar waktu salin data, yang tergantung jumlah foto).

---

## 0. Gambaran besar

```
SEBELUM
  Browser ──upload──> Supabase Storage (bucket monitoring-photos)
  Browser ──baca────> https://<project>.supabase.co/storage/v1/object/public/...

SESUDAH
  Browser ──minta izin──> Worker (Cloudflare)  ──verifikasi token──> Supabase Auth
  Browser ──PUT file────> R2 (presigned URL)
  Browser ──baca────────> https://photos.domain-anda.com/<path>
  Edge send-shift-report ──GET──> https://photos.domain-anda.com/<path>
```

Yang **tidak berubah**:

- Tabel `monitoring_photos` dan `work_request_photos` tetap menyimpan `storage_path`
  yang sama. Tidak ada migrasi database.
- Struktur folder objek tetap sama (`<roundId>/<parameterId>/<file>` dan
  `work-requests/<id>/<file>`).
- Login, RLS tabel, dan seluruh fitur aplikasi lain tidak tersentuh.

Yang **berubah**:

- Foto tidak lagi disimpan di Supabase, melainkan di R2.
- Upload/hapus lewat Worker (karena R2 tidak punya RLS seperti Supabase).

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
|---|---|
| Akun Cloudflare | R2 butuh kartu kredit terdaftar, tapi ada kuota gratis 10 GB |
| Node.js 18+ | Untuk `wrangler` dan skrip migrasi |
| Akses Supabase | Service role key (Settings -> API) |
| Akses ke folder proyek | `C:\Users\Interbat\monitoring-engineering` |

Cek versi Node:

```powershell
node -v
```

Harus `v18` atau lebih baru.

---

## 2. Membuat bucket R2

1. Buka <https://dash.cloudflare.com> lalu login.
2. Di sidebar kiri pilih **R2 Object Storage**.
3. Klik **Create bucket**.
4. Isi:
   - **Bucket name**: `monitoring-photos` (harus sama persis)
   - **Location**: pilih **Automatic** (atau Asia-Pacific bila tersedia)
5. Klik **Create bucket**.

> Nama bucket boleh berbeda, asalkan `R2_BUCKET` di `wrangler.toml` dan
> `.env.migrate` diubah mengikuti.

### 2.1 Aktifkan akses baca publik

1. Buka bucket `monitoring-photos`.
2. Tab **Settings**.
3. Bagian **Public access**:
   - **Cara disarankan**: klik **Connect Domain**, masukkan subdomain milik Anda,
     mis. `photos.perusahaan.com`. Cloudflare akan membuat record DNS otomatis
     (domain harus dikelola Cloudflare).
   - **Cara cepat untuk uji coba**: aktifkan **R2.dev subdomain**. URL-nya berbentuk
     `https://pub-xxxxxxxx.r2.dev`. Cocok untuk testing, **jangan** untuk produksi
     karena ada rate limit.
4. Catat URL publiknya. Contoh: `https://photos.perusahaan.com`

> Catatan: bucket ini **publik untuk dibaca**, sama seperti bucket Supabase Anda
> sekarang (`public = true`). Siapa pun yang tahu URL file bisa membukanya.
> Upload dan hapus tetap butuh login (dijaga Worker).

---

## 3. Membuat API token R2

1. Di halaman **R2 Object Storage**, klik **Manage R2 API Tokens** (kanan atas).
2. Klik **Create API token**.
3. Isi:
   - **Token name**: `monitoring-storage-worker`
   - **Permissions**: **Object Read & Write**
   - **Specify bucket**: pilih `monitoring-photos` saja (least privilege)
   - **TTL**: biarkan default / no expiry
4. Klik **Create API Token**.
5. **Salin sekarang** (tidak bisa dilihat lagi):
   - **Access Key ID**
   - **Secret Access Key**
6. Catat juga **Account ID** Anda. Ada di halaman overview R2, di panel kanan
   (atau di URL dashboard: `dash.cloudflare.com/<ACCOUNT_ID>/r2`).

Simpan ketiga nilai ini di tempat aman sementara. Jangan dimasukkan ke git.

---

## 4. Deploy Worker

Worker inilah pengganti aturan RLS Storage: hanya user yang login yang boleh
minta URL upload dan menghapus file.

### 4.1 Install dependency

```powershell
cd C:\Users\Interbat\monitoring-engineering\cloudflare\worker
npm install
```

### 4.2 Login wrangler

```powershell
npx wrangler login
```

Browser akan terbuka. Klik **Allow**.

### 4.3 Sesuaikan `wrangler.toml`

Buka [wrangler.toml](worker/wrangler.toml). Pastikan:

```toml
[vars]
R2_BUCKET = "monitoring-photos"
ALLOWED_ORIGIN = "*"     # ganti ke domain aplikasi saat produksi
```

Untuk produksi, ganti `ALLOWED_ORIGIN` menjadi domain aplikasi Anda, mis.
`"https://monitor.perusahaan.com"`. Ini membatasi browser mana yang boleh
memanggil Worker.

### 4.4 Set secrets

Jalankan satu per satu. Setiap perintah akan meminta nilai (input tersembunyi):

```powershell
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

Nilai yang diisi:

| Secret | Nilai |
|---|---|
| `R2_ACCOUNT_ID` | Account ID dari langkah 3 |
| `R2_ACCESS_KEY_ID` | Access Key ID dari langkah 3 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key dari langkah 3 |
| `SUPABASE_URL` | `https://qkdosuplybkdfdwuzzxx.supabase.co` |
| `SUPABASE_ANON_KEY` | anon/publishable key (sama dengan `VITE_SUPABASE_ANON_KEY`) |

> `SUPABASE_ANON_KEY` hanya dipakai untuk memverifikasi token user ke
> `/auth/v1/user`. Bukan service role key.

### 4.5 Deploy

```powershell
npm run deploy
```

Output akan menampilkan URL Worker, mis.:

```
https://monitoring-storage.<subdomain>.workers.dev
```

Catat URL ini.

### 4.6 Uji Worker

Tanpa token harus ditolak:

```powershell
curl.exe -i -X POST https://monitoring-storage.<subdomain>.workers.dev/upload
```

Harapan: `HTTP/1.1 401` dengan body `{"error":"Unauthorized"}`.

Dengan token asli (ambil dari aplikasi setelah login, atau lewat DevTools):

```powershell
curl.exe -i -X POST https://monitoring-storage.<subdomain>.workers.dev/upload `
  -H "Authorization: Bearer <ACCESS_TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"path\":\"test/hello.txt\",\"contentType\":\"text/plain\"}"
```

Harapan: `200` dan body berisi `{"url":"https://<account>.r2.cloudflarestorage.com/..."}`.

---

## 5. Konfigurasi aplikasi

### 5.1 Build normal (server punya internet)

Edit `.env`:

```
VITE_SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_STORAGE_DRIVER=r2
VITE_R2_PUBLIC_URL=https://photos.perusahaan.com
VITE_STORAGE_API_URL=https://monitoring-storage.<subdomain>.workers.dev
```

Lalu:

```powershell
npm run build
```

### 5.2 Mode local-proxy (LAN tanpa internet)

Edit `.env.local-proxy`:

```
SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
ANON_KEY=sb_publishable_...
HOST=0.0.0.0
PORT=8000

STORAGE_DRIVER=r2
R2_PUBLIC_URL=https://photos.perusahaan.com
STORAGE_API_URL=https://monitoring-storage.<subdomain>.workers.dev
```

Lalu:

```powershell
npm run build:proxy
```

Pada mode ini aplikasi **tidak** memakai URL Cloudflare langsung. Semua request
dibuat relatif ke proxy:

| Request dari browser | Diteruskan proxy ke |
|---|---|
| `POST /storage-api/upload` | `<STORAGE_API_URL>/upload` |
| `POST /storage-api/delete` | `<STORAGE_API_URL>/delete` |
| `GET /photos/<path>` | `<R2_PUBLIC_URL>/<path>` |

Artinya komputer LAN cukup bisa menjangkau komputer proxy; proxy yang butuh
internet ke Cloudflare.

> Penting: file `.env.local-proxy` harus disimpan **UTF-8 tanpa BOM**. Kalau
> baris pertama tidak terbaca, proxy akan bilang `SUPABASE_URL belum terisi`.

### 5.3 Edge function `send-shift-report`

Agar PDF yang dikirim lewat email juga mengambil foto dari R2:

```powershell
npx supabase secrets set R2_PUBLIC_URL=https://photos.perusahaan.com
npx supabase functions deploy send-shift-report
```

Kalau `R2_PUBLIC_URL` tidak diset, edge function tetap memakai Supabase Storage
(berguna saat masa transisi).

---

## 6. Menyalin data lama

Ada dua cara. Cara A tidak butuh aplikasi tambahan.

### Cara A — skrip bawaan (disarankan)

1. Salin file konfigurasi:

```powershell
cd C:\Users\Interbat\monitoring-engineering\cloudflare\worker
Copy-Item .env.migrate.example .env.migrate
```

2. Buka `.env.migrate` dan isi:

```
SUPABASE_URL=https://qkdosuplybkdfdwuzzxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_BUCKET=monitoring-photos

R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
R2_BUCKET=monitoring-photos
```

> Service role key diambil dari Supabase Dashboard -> **Project Settings** ->
> **API** -> **service_role** (bagian `secret`). Jangan pakai anon key.

3. Uji dulu tanpa menulis apa pun:

```powershell
npm run migrate -- --dry-run
```

Output menampilkan jumlah objek dan contoh path. Periksa apakah jumlahnya masuk akal.

4. Uji salin sebagian (mis. 10 file):

```powershell
npm run migrate -- --limit=10
```

5. Buka bucket R2 di dashboard, pastikan 10 file muncul dengan path yang sama.

6. Salin semuanya:

```powershell
npm run migrate
```

7. Kalau terputus di tengah jalan, jalankan ulang dengan `--skip-existing`
   supaya file yang sudah ada tidak diunduh ulang:

```powershell
npm run migrate -- --skip-existing
```

Opsi lain:

| Opsi | Fungsi |
|---|---|
| `--prefix=work-requests` | hanya menyalin satu folder |
| `--concurrency=8` | mempercepat (default 4) |
| `--limit=100` | batasi jumlah file |

### Cara B — rclone

Kalau lebih nyaman memakai rclone:

```powershell
rclone config create supabase s3 `
  provider Other `
  access_key_id "<SUPABASE_S3_ACCESS_KEY>" `
  secret_access_key "<SUPABASE_S3_SECRET_KEY>" `
  endpoint "https://qkdosuplybkdfdwuzzxx.storage.supabase.co/storage/v1/s3" `
  region "ap-southeast-1"

rclone config create r2 s3 `
  provider Cloudflare `
  access_key_id "<R2_ACCESS_KEY_ID>" `
  secret_access_key "<R2_SECRET_ACCESS_KEY>" `
  endpoint "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" `
  region "auto"

rclone copy supabase:monitoring-photos r2:monitoring-photos --dry-run --progress
rclone copy supabase:monitoring-photos r2:monitoring-photos --progress
```

Kredensial S3 Supabase dibuat di Dashboard -> **Storage** -> **S3 access keys**.

---

## 7. Verifikasi menyeluruh

Lakukan berurutan. Jangan lewati.

### 7.1 Cek jumlah objek

```powershell
cd C:\Users\Interbat\monitoring-engineering\cloudflare\worker
npm run migrate -- --dry-run
```

Bandingkan jumlah objek Supabase dengan isi bucket R2 di dashboard
(atau `rclone size r2:monitoring-photos`).

### 7.2 Cek referensi database

Jalankan di Supabase SQL Editor:

```sql
select 'monitoring_photos' as sumber, count(*) as jumlah from monitoring_photos
union all
select 'work_request_photos', count(*) from work_request_photos;
```

Jumlah baris DB seharusnya **sama atau lebih kecil** dari jumlah objek
(karena satu baris = satu objek). Kalau lebih besar, ada objek yang belum tersalin.

### 7.3 Uji di aplikasi

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Login | Berhasil seperti biasa |
| 2 | History -> buka round lama | Foto tampil (berasal dari R2) |
| 3 | New Monitoring -> upload foto baru | Foto muncul, objek baru ada di R2 |
| 4 | Edit round -> hapus foto | Objek hilang dari R2 |
| 5 | Titipan Pekerjaan -> selesaikan + foto | Foto tersimpan & tampil |
| 6 | Hapus titipan | Foto ikut terhapus dari R2 |
| 7 | Reports -> Download PDF | Foto masuk lampiran PDF |
| 8 | Reports -> Kirim ke Email | PDF email berisi foto |

### 7.4 Cek di DevTools browser

Buka **Network**, lalu buka History:

- Request gambar harus menuju `https://photos.perusahaan.com/...`
  (atau `/photos/...` bila mode proxy).
- Tidak boleh ada request ke `*.supabase.co/storage/v1/object/public/...`.

Saat upload, harus terlihat dua request:

1. `POST /upload` (atau `/storage-api/upload`) → 200, membalas `url`
2. `PUT https://<account>.r2.cloudflarestorage.com/...` → 200

---

## 8. Rollback

Data di Supabase Storage **tidak dihapus** selama proses ini, jadi rollback aman.

1. Kembalikan env:

```
VITE_STORAGE_DRIVER=supabase
```

(atau `STORAGE_DRIVER=supabase` di `.env.local-proxy`)

2. Build ulang:

```powershell
npm run build:proxy     # atau npm run build
```

3. Restart proxy / refresh browser dengan Ctrl+F5.

Foto baru yang diupload selama mode R2 **tidak** otomatis ada di Supabase.
Kalau perlu, salin balik dengan skrip yang sama (tukar arah sumber/tujuan) atau
rclone:

```powershell
rclone copy r2:monitoring-photos supabase:monitoring-photos --progress
```

---

## 9. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Worker balas `401 Unauthorized` | Token Supabase tidak dikirim / kedaluwarsa | Pastikan user login; cek header `Authorization` di DevTools |
| Worker balas `500` saat upload | Secret R2 salah | Ulangi `wrangler secret put` untuk ketiga kredensial R2 |
| Upload `403` dari R2 | Presigned URL kedaluwarsa (>15 menit) atau token R2 kurang izin | Pastikan permission **Object Read & Write** dan bucket benar |
| Foto tidak tampil, URL kosong | `VITE_R2_PUBLIC_URL` belum diisi saat build | Isi lalu build ulang (nilai ini ditanam ke bundle) |
| Foto 404 | Objek belum tersalin | Jalankan `npm run migrate -- --skip-existing` |
| Foto tampil di laptop tapi tidak di komputer LAN | Proxy belum meneruskan `/photos` | Isi `R2_PUBLIC_URL` di `.env.local-proxy`, restart proxy |
| Upload gagal di komputer LAN | `STORAGE_API_URL` kosong | Isi di `.env.local-proxy`, restart proxy |
| `STORAGE_API_URL belum dikonfigurasi` | Proxy tidak menemukan variabel | Cek `.env.local-proxy` (UTF-8 tanpa BOM), restart proxy |
| PDF email tanpa foto | Secret edge belum diset | `npx supabase secrets set R2_PUBLIC_URL=...` lalu deploy ulang |
| `List ... gagal (400)` saat migrasi | Service role key salah / bucket name salah | Cek `SUPABASE_SERVICE_ROLE_KEY` dan `SUPABASE_BUCKET` |
| Migrasi lambat | Concurrency rendah | `npm run migrate -- --concurrency=8` |
| CORS error di browser | `ALLOWED_ORIGIN` tidak cocok | Set ke domain aplikasi, atau `*` untuk uji |

---

## 10. Biaya dan batasan

| Item | Keterangan |
|---|---|
| Penyimpanan | 10 GB gratis/bulan, lalu ~$0.015/GB |
| Operasi Class A (write/list) | 1 juta gratis/bulan |
| Operasi Class B (read) | 10 juta gratis/bulan |
| **Egress (baca)** | **Gratis** — ini keuntungan utama vs Supabase |
| Worker | 100.000 request/hari gratis |

Dengan foto maksimal 500 KB dan ratusan foto per bulan, biaya hampir pasti nol.

---

## 11. Checklist go-live

- [ ] Bucket R2 dibuat, akses publik aktif, URL publik dicatat
- [ ] API token R2 dibuat (Object Read & Write, scope bucket)
- [ ] Worker ter-deploy, uji 401 tanpa token berhasil
- [ ] 5 secret Worker terisi
- [ ] `ALLOWED_ORIGIN` diset ke domain produksi
- [ ] Data lama tersalin (`npm run migrate`), jumlah objek cocok
- [ ] `.env` / `.env.local-proxy` diisi driver `r2` + 2 URL
- [ ] Build ulang (`npm run build` atau `npm run build:proxy`)
- [ ] 8 langkah verifikasi aplikasi lulus
- [ ] Secret `R2_PUBLIC_URL` diset di Supabase, edge function di-deploy ulang
- [ ] DevTools tidak menunjukkan request ke `*.supabase.co/storage`
- [ ] Backup bucket Supabase dibiarkan minimal 1-2 minggu sebelum dihapus
