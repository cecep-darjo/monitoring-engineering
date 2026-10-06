# Local Proxy Server — Jalankan aplikasi untuk komputer TANPA internet

Dokumen ini menjelaskan bagaimana komputer lokal yang **memiliki akses internet**
bisa menjadi **proxy** sehingga komputer lain di jaringan yang **tidak punya
internet** tetap bisa menjalankan aplikasi Equipment Monitor secara penuh
(login, input monitoring, upload foto, lihat history, generate PDF).

## Cara kerja

Aplikasi dibuat dengan mode **local-proxy**:

1. Saat build, `VITE_SUPABASE_URL` dikosongkan. Kode `src/lib/supabase.ts`
   punya fallback:
   ```ts
   const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.location.origin;
   ```
   Jadi `supabaseUrl` menjadi **asal halaman** (yaitu `http://<IP-proxy>:<port>`)
   di komputer lain.
2. Server `server/proxy-server.mjs` menyajikan file build `dist/` DAN meneruskan
   semua request API ke Supabase asli:
   - `/rest/v1/*`   → PostgREST (query data)
   - `/auth/v1/*`   → autentikasi (login)
   - `/storage/v1/*`→ storage (upload & foto, termasuk `/object/public/`)
   - `/functions/v1/*` → edge functions (`create-user`, `delete-user`, `send-shift-report`)
3. Header `apikey` / `Authorization` dari browser diteruskan apa adanya. Untuk
   request tanpa header (mis. `<img>` foto public object), proxy menyuntikkan
   anon key sebagai fallback.

> Catatan: pemanggilan edge function di kode (`AuthContext`, `AdminUsers`, `Reports`)
> memakai `${import.meta.env.VITE_SUPABASE_URL || window.location.origin}`. Karena build
> mengosongkan `VITE_SUPABASE_URL`, hasilnya menunjuk ke proxy (`/functions/v1/...`).
> Jadi semua jalur — REST, Auth, Storage, dan Edge Functions — konsisten lewat proxy.

## Prasyarat

- Node.js (>= 18) terpasang di komputer lokal (yang ada internet).
- Dependensi proyek sudah diinstal: `npm install`.
- Nama `.env.local-proxy.example` disalin menjadi `.env.local-proxy` dan diisi.

## 1) Siapkan konfigurasi

Salin file contoh:

```
Copy-Item .env.local-proxy.example .env.local-proxy
```

Lalu edit `.env.local-proxy` (nilai default dari contoh):
```
SUPABASE_URL=https://xzyglfiecvmwsatpiemy.supabase.co
ANON_KEY=sb_publishable_LfhqaupabddAgKjtTbzNAQ_uFpQ83Pr
HOST=0.0.0.0
PORT=4000
```

- `HOST=0.0.0.0` berarti didengar di semua antarmuka (wajib agar terjangkau LAN).
- `PORT=4000` port prost. Bisa diganti (mis. 80 jika ingin tanpa port di URL).

## 2) Bangun aplikasi dalam mode local-proxy

Di PowerShell, dari folder proyek:

```
npm run build:proxy
```

Perintah ini menjalankan `server/build-local-proxy.ps1`, yang:
- membaca `.env.local-proxy`,
- mengosongkan `VITE_SUPABASE_URL`,
- mengisi `VITE_SUPABASE_ANON_KEY`,
- lalu menjalankan `npm run build` → menghasilkan folder `dist/`.

## 3) Jalankan proxy server

Cara paling mudah: **klik dua kali** file `server\start-monitoring.bat`.
File itu otomatis:
- membuat salinan `.env.local-proxy` dari contoh bila belum ada,
- memasang dependensi bila belum ada,
- membangun `dist/` bila belum ada,
- lalu menjalankan proxy pada port yang dibaca dari `.env.local-proxy` (default `4000`).

Atau secara manual (di PowerShell):
```
npm run start:proxy
```
atau langsung:
```
node server/proxy-server.mjs
```

Anda akan melihat ringkasan seperti:
```
  Proxy listen: http://0.0.0.0:4000
```

## 4) Biarkan komputer lain mengakses

- Pastikan komputer proxy dan komputer lain berada di **jaringan yang sama** (LAN).
- Cari IP lokal komputer proxy: jalankan `ipconfig`, lihat **IPv4** pada adapter
  yang aktif (mis. `192.168.1.50`).
- Di komputer lain (tanpa internet), buka browser dan akses:

  ```
  http://192.168.1.50:4000
  ```

  (ganti IP dan port sesuai milik Anda).

## Troubleshooting singkat

| Gejala | Penyebab / Solusi |
|---|---|
| Halaman tidak terbuka di komputer lain | Firewall Windows memblokir port. Buka port TCP 4000 (atau port yang dipakai) di Windows Firewall, atau gunakan `netsh advfirewall firewall add rule name="monitor-proxy" dir=in action=allow protocol=TCP localport=4000`. |
| Login gagal / data kosong | Pastikan `.env.local-proxy` benar dan proxy berhasil terkoneksi. Cek log terminal proxy untuk error backend. |
| Foto tidak tampil | Beberapa bucket storage perlu akses anon. Pastikan `ANON_KEY` benar di `.env.local-proxy`. |
| Port sudah terpakai | Ganti `PORT` di `.env.local-proxy`, lalu jalankan ulang. |
| `npm run build:proxy` gagal | Pastikan Node & PowerShell tersedia, dan `.env.local-proxy` sudah diisi `ANON_KEY`. |

## Update aplikasi (bila ada versi baru)

Klik dua kali file `server\update-monitoring.bat`. File itu akan:
1. `git pull` — mengambil update terbaru dari repository (jika folder adalah repo git),
2. `npm install` — memasang dependensi baru jika ada,
3. membangun ulang aplikasi dalam mode local-proxy (menggunakan `build-local-proxy.ps1`).

Setelah selesai, jalankan lagi `server\start-monitoring.bat` untuk menjalankan proxy
dengan versi yang sudah ter-update.

## Catatan keamanan

- Proxy ini meneruskan kredensial (anon key + token user) dari browser ke Supabase
  asli. Hanya jalankan di jaringan tepercaya.
- Jangan commit `.env.local-proxy` (sudah masuk `.gitignore`).
- Untuk pemakaian di jaringan lebar (bukan LAN) pertimbangkan akses HTTPS / VPN.