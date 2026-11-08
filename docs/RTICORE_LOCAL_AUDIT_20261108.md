# Audit aplikasi lokal — 8 November 2026

Lingkup pemeriksaan: autentikasi lokal, sesi dan origin, role/ACL, navigasi, regresi bisnis otomatis, dependensi, serta build Next.js dan OpenNext Cloudflare. Ini bukan sertifikasi transaksi dengan data produksi atau layanan cloud.

## Temuan dan perbaikan

- **P1 — Login lokal dari `127.0.0.1` ditolak.** Next menormalisasi URL request, sehingga perbandingan origin langsung gagal. Pemeriksaan origin kini membandingkan host browser dan protokol, menerima loopback yang sama, serta menolak port berbeda, origin asing, dan request cross-site.
- **P2 — Logout navigasi masih menuju Cloudflare.** Tombol logout bersama sekarang memakai penghapusan sesi lokal saat mode lokal aktif dan tetap memakai logout Cloudflare pada mode cloud.
- **P2 — Penghapusan sesi lokal tidak dibatasi dengan mode dan origin.** Endpoint `DELETE /api/local-auth` sekarang memerlukan mode lokal dan pemeriksaan same-origin sebelum menghapus cookie.
- **P2 — Dependensi transitif memiliki 5 temuan moderate.** Override dependensi build disesuaikan agar versi perbaikan tetap kompatibel dengan OpenNext. `npm audit` kini melaporkan 0 temuan pada semua tingkat keparahan.
- **P2 — Suite regresi sebelumnya gagal karena prasyarat dan baseline usang.** Runner HTTP memakai port ephemeral; tes browser dapat memakai Microsoft Edge terpasang; tes Python memakai runtime embeddable lokal yang diabaikan Git; ekspektasi logout dan jumlah navigasi diperbarui. Suite penuh sekarang lulus tanpa skip.
- **P3 — Konvensi `middleware` Next.js 16 deprecated.** Temuan ini belum bisa dihilangkan dengan aman: adapter OpenNext Cloudflare pada versi proyek ini memakai middleware Edge, sedangkan jalur `proxy` berbasis Node yang disarankan Next masih eksperimental/tidak didukung untuk adapter ini ([panduan OpenNext Cloudflare](https://opennext.js.org/cloudflare), [status dukungan Proxy](https://github.com/cloudflare/workers-sdk/issues/13937)). Konvensi yang kompatibel dipertahankan sampai adapter mendukung jalur baru secara resmi. Peringatan deprecation Next tetap muncul.
- **Build Windows — OpenNext memperingatkan bahwa Windows belum sepenuhnya didukung dan merekomendasikan WSL.** Build adapter aktual tetap berhasil di Windows; peringatan lingkungan ini bukan kegagalan build.

Peringatan bundling `unpdf` dihilangkan dengan mengeksternalkan paket pada server runtime.

## Verifikasi akhir

- `npm run build` — berhasil; TypeScript dan 53 halaman selesai dibuat.
- `npx opennextjs-cloudflare build` — berhasil; middleware, aset statis, cache, dan fungsi server berhasil dibundel.
- `npm audit` — 0 critical, 0 high, 0 moderate, 0 low.
- `npm run test:all` — **676 lulus, 0 gagal, 0 dilewati** (sekitar 49 detik).
- Tes browser mencakup login lokal lewat loopback, logout dan invalidasi sesi, serta navigasi/role pada desktop dan mobile. Tidak ditemukan error halaman atau tautan Cloudflare pada alur lokal.
- Runtime Python 3.12.10 untuk tes disimpan di `.local-data/python312-embed` (diabaikan Git); tidak mengubah instalasi Python sistem.

## Batas penggunaan login lokal

Mode lokal memungkinkan pemilihan akun terdaftar tanpa password dan hanya sesuai model kepercayaan satu komputer. Pengguna lokal lain yang dapat mengakses komputer juga dapat memilih akun Admin. Server lokal dibatasi ke loopback; role dan status akun tetap diverifikasi server dari database. Jangan mengekspos server ini ke jaringan bersama sebagai pengganti autentikasi multiuser.

Tidak dilakukan deploy, pemanggilan layanan cloud eksternal, pengiriman pesan, transaksi keuangan, atau penghapusan data bisnis.
