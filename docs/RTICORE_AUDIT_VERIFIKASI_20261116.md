# Verifikasi audit RTICore

16 November 2026. Pemeriksaan memakai working tree lokal, termasuk remediasi yang sudah tercatat dalam [audit sebelumnya](RTICORE_AUDIT_MENYELURUH_20261112.md). Dokumen tersebut memuat matriks role, inventaris menu dan API, alur bisnis, serta rincian lima temuan awal.

## Cakupan yang diverifikasi

| Area | Hasil | Metode |
|---|---|---|
| Navigasi semua role | 17 role × 42 menu, 193 pasangan tampil dan 521 tersembunyi. Semua landing termasuk dalam menu role bersangkutan, dan semua tujuan menu memiliki halaman. | Evaluasi `navigationForRole`, `firstAccessibleHref` dan `canOpenRoute` terhadap deklarasi navigasi. Ini menguji konsistensi UI dengan konfigurasi. |
| Inventaris rute | 50 halaman dan 58 rute API, ditambah rute logout Cloudflare Access. | Inventaris file `page.tsx` dan `route.ts`. |
| Elemen tombol | 211 deklarasi `<button>` pada TSX. Sebanyak 199 punya callback klik, 7 punya tipe submit eksplisit, dan 5 menggunakan submit standar HTML dalam form dengan `onSubmit`. | Pemeriksaan AST dan inspeksi form. Angka menghitung deklarasi di kode, termasuk elemen yang dapat dirender berulang. |
| Build dan tipe | Build dan typecheck lulus. Build masih mengeluarkan peringatan deprekasi konvensi `middleware`. | `npm run build` dan `npm run typecheck`. |
| Suite utama | 743 lulus, 0 gagal, 0 dilewati. | `npm run test:all` menjalankan HTTP lokal, tes browser terpilih, handler dengan data uji, serta pengujian domain dan regresi. |

Suite utama menguji, antara lain, isolasi kepemilikan ekspor BoQ, pencabutan alokasi pada Feasibility, pembulatan BoQ, pemisahan harga jual dan biaya internal pada Scoping, persetujuan independen, konflik versi, dan batas akses transaksi. Uji browser membuat verifikasi tindakan pengguna untuk skenario dan data uji yang tercakup.

## Skenario browser tambahan

| Alur | Hasil |
|---|---|
| Proposal sampai Closed Won | Lulus saat diulang secara terpisah setelah sesi browser terputus pada eksekusi paralel. Skenario mencakup upload bukti, pengiriman, unduhan PO, dan review Finance serta Legal. |
| Commercial | 3 lulus. Mencakup klausul tender, upload email dan perubahan forecast serta persetujuan revenue. |
| Service Operations | 5 lulus. Mencakup Customer 360, stakeholder, penugasan PM, dokumen Billing, konfigurasi kontrak dan pembatasan lintas owner. |
| Partner, Reports dan Admin | Skenario yang dijalankan lulus. Mencakup formulir Partner, Report Builder, pengaturan Admin, persetujuan konfigurasi independen, registrasi user dan pembatasan akses form. |
| AI Chat dan Composer | Kedua skrip lulus di desktop dan viewport Android, dengan respons provider dari fixture. |
| Campaign | Lulus untuk Marketing di viewport Android, Admin di desktop, dan Sales di viewport Android. Skrip UAT diperbarui mengikuti checkbox multi-owner dan pesan konfirmasi yang berlaku. Fixture memeriksa kedua owner terkirim dan Sales bisa membaca campaign aktif tanpa tombol buat atau simpan. |

Skenario tambahan dijalankan pada build lokal dengan Microsoft Edge. Sebagian tes tumpang tindih dengan suite utama. Perubahan pada tahap ini terbatas pada skrip UAT Campaign dan laporan verifikasi.

## Remediasi lanjutan

Sidebar memilih satu menu aktif berdasarkan rute paling spesifik. Saat Admin membuka Registrasi User, hanya `/boq/users` ditandai sebagai halaman aktif. Perubahan ini juga berlaku pada sidebar mobile.

`npm run test:all` dan workflow Sales Multirole UAT kini menjalankan skenario browser tambahan. Pengujian browser dijalankan berurutan setelah regresi umum. Suite sesi role menggunakan akun sintetis, autentikasi lokal, dan SQLite sementara. Suite ini memeriksa menu desktop dan mobile terhadap izin masing-masing role, lalu mengklik setiap tautan menu yang tersedia di sidebar desktop. Pencarian, tombol hapus pencarian, buka dan tutup menu mobile, serta logout turut diuji.

## Batas pembuktian

Pengujian browser terhadap aksi transaksi mencakup skenario yang tersedia. Cakupan setiap tombol bergantung pada kombinasi role, status transaksi, kepemilikan, grant, alokasi, dan validasi input. Integrasi Cloudflare Access/D1 produksi dan pengujian setiap kombinasi tombol–role–status transaksi masih terbuka.
