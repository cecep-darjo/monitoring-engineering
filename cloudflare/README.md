# Migrasi Storage: Supabase Storage -> Cloudflare R2

Panduan ini memindahkan foto aplikasi Monitoring Engineering dari bucket Supabase
`monitoring-photos` ke **Cloudflare R2**, dengan **Worker** sebagai pengganti RLS
untuk upload/hapus.

> **Panduan langkah-demi-langkah yang lebih rinci (dengan verifikasi, troubleshooting,
> dan checklist go-live): [PANDUAN-MIGRASI.md](PANDUAN-MIGRASI.md)**
>
> Untuk menyalin data lama tanpa rclone, gunakan skrip bawaan:
> `cd cloudflare/worker && npm install && npm run migrate -- --dry-run`

Aplikasi sudah mendukung dua driver sekaligus, jadi migrasi bisa bertahap dan
mudah di-rollback.

```
VITE_STORAGE_DRIVER=supabase   (default, perilaku lama)
VITE_STORAGE_DRIVER=r2         (Cloudflare R2)
```

---

## 1. Buat bucket R2

1. Cloudflare Dashboard -> **R2** -> **Create bucket**.
2. Nama bucket: `monitoring-photos` (harus sama dengan `R2_BUCKET` di `wrangler.toml`).
3. Buka bucket -> **Settings** -> **Public access**:
   - Aktifkan **Custom domain** (disarankan), mis. `photos.example.com`, atau
   - Aktifkan **r2.dev subdomain** untuk uji coba.
4. Catat URL publiknya, mis. `https://photos.example.com`.

> Struktur path dipertahankan persis sama dengan Supabase, contoh:
> `1234-uuid/param-uuid/1712345678-ab12cd.jpg` dan `work-requests/<id>/...`

## 2. Buat API token R2 (S3)

1. R2 -> **Manage R2 API Tokens** -> **Create API token**.
2. Permission: **Object Read & Write**, scope bucket `monitoring-photos`.
3. Catat:
   - `Access Key ID`
   - `Secret Access Key`
   - `Account ID` (ada di halaman overview R2)

## 3. Deploy Worker

```powershell
cd cloudflare\worker
npm install

npx wrangler login

npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put SUPABASE_URL          # https://qkdosuplybkdfdwuzzxx.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY     # anon/publishable key

npm run deploy
```

Setelah deploy, catat URL Worker, mis. `https://monitoring-storage.<subdomain>.workers.dev`.

Uji cepat (harus 401 tanpa token):

```powershell
curl.exe -i -X POST https://monitoring-storage.<subdomain>.workers.dev/upload
```

## 4. Konfigurasi aplikasi

### Build normal (internet)

`.env`:

```
VITE_STORAGE_DRIVER=r2
VITE_R2_PUBLIC_URL=https://photos.example.com
VITE_STORAGE_API_URL=https://monitoring-storage.<subdomain>.workers.dev
```

### Mode local-proxy (LAN tanpa internet)

`.env.local-proxy`:

```
STORAGE_DRIVER=r2
R2_PUBLIC_URL=https://photos.example.com
STORAGE_API_URL=https://monitoring-storage.<subdomain>.workers.dev
```

Lalu build ulang:

```powershell
npm run build:proxy
```

Pada mode ini aplikasi otomatis memakai path relatif ke proxy:

| Path aplikasi | Diteruskan proxy ke |
|---|---|
| `/storage-api/upload` | `<STORAGE_API_URL>/upload` |
| `/storage-api/delete` | `<STORAGE_API_URL>/delete` |
| `/photos/<path>` | `<R2_PUBLIC_URL>/<path>` |

Jadi komputer LAN tidak perlu akses internet langsung ke Cloudflare.

### Edge function `send-shift-report`

Tambahkan secret agar PDF email mengambil foto dari R2:

```powershell
npx supabase secrets set R2_PUBLIC_URL=https://photos.example.com
npx supabase functions deploy send-shift-report
```

Jika `R2_PUBLIC_URL` tidak diset, edge function tetap memakai Supabase Storage.

## 5. Salin data lama

Gunakan `rclone` (mendukung S3 dan Supabase Storage).

```powershell
# 1) Konfigurasi remote Supabase Storage (S3-compatible)
rclone config create supabase s3 `
  provider Other `
  access_key_id "<SUPABASE_S3_ACCESS_KEY>" `
  secret_access_key "<SUPABASE_S3_SECRET_KEY>" `
  endpoint "https://qkdosuplybkdfdwuzzxx.storage.supabase.co/storage/v1/s3" `
  region "ap-southeast-1"

# 2) Konfigurasi remote R2
rclone config create r2 s3 `
  provider Cloudflare `
  access_key_id "<R2_ACCESS_KEY_ID>" `
  secret_access_key "<R2_SECRET_ACCESS_KEY>" `
  endpoint "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" `
  region "auto"

# 3) Salin (dry-run dulu)
rclone copy supabase:monitoring-photos r2:monitoring-photos --dry-run --progress
rclone copy supabase:monitoring-photos r2:monitoring-photos --progress
```

Alternatif tanpa rclone: script Node dengan `@aws-sdk/client-s3` yang membaca
`monitoring_photos.storage_path` + `work_request_photos.storage_path` lalu
`CopyObject`/`PutObject` ke R2.

## 6. Verifikasi

1. Buka aplikasi -> History -> buka satu round -> foto harus tampil.
2. New Monitoring -> upload foto baru -> cek objek muncul di bucket R2.
3. Hapus foto (edit round) -> objek hilang dari R2.
4. Titipan Pekerjaan -> selesaikan dengan foto -> tampil & tersimpan.
5. Reports -> Download PDF -> foto masuk ke lampiran.
6. Kirim report email -> PDF berisi foto.

Cek jumlah objek:

```powershell
rclone size r2:monitoring-photos
```

Cek referensi DB yang belum ada di R2 (jalankan di SQL editor Supabase):

```sql
select 'monitoring_photos' as src, storage_path from monitoring_photos
union all
select 'work_request_photos', storage_path from work_request_photos
order by 1;
```

## 7. Rollback

Cukup kembalikan env ke driver lama lalu build ulang:

```
VITE_STORAGE_DRIVER=supabase
```

Data di Supabase Storage tidak dihapus selama proses migrasi, jadi rollback
tidak kehilangan foto. Hapus bucket Supabase hanya setelah yakin.

## Catatan keamanan

- Bucket R2 dibuat **publik** untuk baca, sama seperti bucket Supabase saat ini
  (`public = true`). Siapa pun yang tahu URL bisa melihat foto.
- Upload/hapus tetap butuh token Supabase yang valid (diverifikasi Worker).
- Jangan commit `R2_SECRET_ACCESS_KEY` atau file `.env*`.
- Set `ALLOWED_ORIGIN` di `wrangler.toml` ke domain aplikasi saat produksi,
  jangan biarkan `*`.
