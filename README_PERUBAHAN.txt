PERUBAHAN VERSI REVISI
1. Round 1 dan Round 2 tidak dapat dibuat berulang untuk kombinasi Mesin + Tanggal + Shift + Round.
2. Jika Round sudah ada, aplikasi memuat data yang sama untuk diedit.
3. Edit/create hanya diperbolehkan selama shift aktif.
4. Database memiliki UNIQUE INDEX untuk mencegah duplikasi.
5. Database memiliki trigger untuk mengunci monitoring setelah shift berakhir.
6. PDF report digabung menjadi satu tabel compact, format A4 Landscape, tanpa section besar per mesin/round.

PENTING:
Jalankan migration baru di Supabase:
supabase/migrations/20260908100000_prevent_duplicate_rounds_and_lock_shifts.sql
