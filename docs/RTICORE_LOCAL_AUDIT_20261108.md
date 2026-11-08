# Audit aplikasi lokal — 8 November 2026

Lingkup: autentikasi lokal, sesi, role/ACL, navigasi, regresi bisnis otomatis, dependensi dan build. Ini bukan sertifikasi seluruh transaksi dengan data produksi.

## Temuan dan tindakan

- P1 — Login browser dari 127.0.0.1 ditolak 403 Origin tidak diizinkan. Direproduksi melalui Microsoft Edge headless. Next menormalisasi request.url ke localhost, sehingga perbandingan origin langsung salah. Diperbaiki dengan memeriksa host browser dan protokol, tetap membatasi alamat loopback dan menolak origin asing/port berbeda.
- P2 — Logout sidebar masih menuju Cloudflare. Diganti dengan komponen logout bersama yang menghapus sesi lokal.
- P2 — DELETE sesi belum memeriksa mode lokal dan origin. Kini memeriksa keduanya sebelum menghapus cookie.
- P2 — Audit npm seluruh dependensi melaporkan 5 paket berstatus moderate pada rantai alat build OpenNext/glob/minimatch. Audit dependency produksi: 0 kerentanan. Tidak dilakukan pembaruan paksa atau downgrade otomatis.
- P2 — Suite penuh belum hijau: sebagian prasyarat lingkungan dan ekspektasi tes sudah tertinggal. Baseline navigasi mengharapkan 40 halaman tetapi aktual 41.
- P3 — Build memperingatkan deprecation middleware dan import.meta pada unpdf.

## Bukti pemeriksaan

- Suite penuh sebelum perbaikan: 666 tes, 651 lulus, 15 gagal.
- Rincian 15 kegagalan: 6 tes browser tidak menemukan executable Chromium; 1 HTTP UAT membutuhkan server port 3100; 4 tes membutuhkan Python; 3 tes source masih mengharuskan tautan logout Cloudflare langsung; 1 baseline jumlah menu berbeda.
- Ketiga kegagalan source login/logout telah diperbarui untuk komponen bersama; seluruh 6 tes pada kedua file terkait lulus saat dijalankan ulang.
- Tes sesi lokal sesudah perbaikan: 5/5 lulus, termasuk regresi origin browser 127.0.0.1, localhost, port berbeda, origin asing dan cross-site.
- Pemeriksaan awal ACL/sesi/role/bisnis: 38/38 lulus.
- Tampilan login lokal: tidak memuat tombol Cloudflare; akun lokal tersedia. Browser mobile lebar 390 tidak mengalami overflow horizontal pada pemeriksaan login.
- Log suite penuh tersimpan di .local-data/audit-tests.log (lokal, tidak untuk commit).

## Batas penggunaan lokal

Pemilihan akun lokal tidak meminta password. Siapa pun yang dapat mengakses aplikasi pada komputer ini dapat memilih akun aktif, termasuk Admin. Ini adalah model kepercayaan komputer lokal, bukan autentikasi multiuser untuk jaringan bersama. Server tetap terikat pada 127.0.0.1; role dan status aktif dibaca server dari database.

Tidak dilakukan pengiriman pesan, transaksi keuangan, penghapusan data bisnis, atau pengujian layanan cloud eksternal. Pemeriksaan browser memakai sesi terpisah.

## Verifikasi akhir

Build production terbaru berhasil dan server lokal dimulai ulang. Microsoft Edge headless dengan konteks terpisah berhasil login melalui 127.0.0.1: identity HTTP 200 role admin. Setelah logout identity HTTP 401; tidak ada pageerror dan tidak ada tombol Cloudflare pada halaman lokal. Suite penuh belum diulang setelah perbaikan; angka 666/651/15 di atas adalah baseline sebelum perbaikan.
