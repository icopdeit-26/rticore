# RTICore — Panduan Eksekusi Repository Lokal

Panduan untuk Windows PowerShell, dijalankan dari `C:\Users\THINKPAD\Downloads\RTICore`.
Perintah di bawah mengikuti script dan implementasi lokal yang tersedia di repository.

## 1. Prasyarat

- Node.js yang menyediakan modul bawaan `node:sqlite` tanpa flag, misalnya Node.js 22.13 atau lebih baru. Next.js sendiri mensyaratkan minimal 20.9, tetapi setup RTICore memerlukan `node:sqlite`.
- npm; `package.json` mencatat `npm@11.9.0`.
- Internet untuk memasang dependency yang belum tersedia. Mode database dan login lokal tidak memerlukan akun Cloudflare maupun instalasi server PostgreSQL terpisah.

```powershell
Set-Location -LiteralPath 'C:\Users\THINKPAD\Downloads\RTICore'
node --version
npm.cmd --version
node -e "require('node:sqlite'); console.log('node:sqlite tersedia')"
```

Gunakan `npm.cmd` di PowerShell untuk menghindari masalah execution policy pada `npm.ps1`.

## 2. Pasang dependency

Untuk instalasi awal atau setelah dependency berubah:

```powershell
npm.cmd ci
```

Perintah ini memasang versi dari `package-lock.json` dan mengganti isi `node_modules`. Jika dependency sudah terpasang dan sesuai lockfile, lanjutkan ke setup.

## 3. Siapkan database dan akun lokal

Hentikan server lokal yang sedang berjalan dengan `Ctrl+C` sebelum menjalankan setup. Ganti alamat email contoh dengan email akun lokal yang ingin digunakan:

```powershell
npm.cmd run local:setup -- --admin admin@example.com
```

Script `scripts/rticore-local-setup.mjs` akan:

1. Menambahkan konfigurasi yang belum ada ke `.env.local`, termasuk `RTICORE_LOCAL_MODE=1` dan secret/encryption key acak.
2. Menjalankan migrasi SQLite di `.local-data/rticore.db` secara default.
3. Membuat atau mengaktifkan akun admin di SQLite.
4. Menerapkan `rticore_postgresql_schema.sql` ke PGlite di `.pgdata` dan membuat atau mengaktifkan akun admin di sana.

Setup mempertahankan nilai `.env.local` yang sudah ada. Pastikan `RTICORE_LOCAL_MODE` bernilai `1`; nilai lama `0` tidak otomatis diganti.

Database runtime default adalah **PGlite**, yaitu PostgreSQL embedded di `.pgdata`. Untuk mengikuti jalur default panduan ini, pastikan `DATABASE_URL`, `POSTGRES_URL`, dan `PGLITE_DATA_DIR` tidak disetel, baik di file env maupun environment terminal; jangan gunakan `RTICORE_DB_ENGINE=sqlite`.

Catatan: runtime dapat memakai PostgreSQL eksternal melalui `DATABASE_URL` atau `POSTGRES_URL`, tetapi script setup saat ini tetap menyiapkan `.pgdata`. Panduan ini menggunakan database embedded agar akun yang dibuat setup sama dengan akun yang dibaca aplikasi.

Role lain dapat disiapkan dengan menjalankan setup kembali, misalnya:

```powershell
npm.cmd run local:setup -- --admin sales@example.com --role sales
```

Setup menerima seluruh 17 role, termasuk `project_manager`, `offense_lead`, `offense_member`, `defense_leader`, `defense_member`, `governance_leader`, `governance_member`, `itdev_leader`, dan `itdev_member`. Menjalankan setup untuk email yang sudah ada akan mengaktifkan akun dan memperbarui role-nya.

## Verifikasi browser semua role

```powershell
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:all
```

`test:all` menjalankan regresi, HTTP lokal, skenario browser per modul, dan login, navigasi, serta logout untuk seluruh role. Untuk mengulang bagian sesi role saja setelah build, jalankan `node tests/run-browser-http-uat.cjs --role-sessions`. Bagian ini membuat akun sintetis dan database SQLite sementara, lalu menghapusnya setelah pengujian.

## 4. Jalankan aplikasi

Untuk pencarian kode pos nasional pada database PGlite, hentikan server lalu jalankan sekali:

```powershell
npm.cmd run local:postal:import
```

Importer mengambil referensi dari commit yang dipatok oleh repository, memverifikasi cakupan minimal 80.000 desa/kelurahan dan 38 provinsi, lalu menyimpan data secara atomik. Unduhan awal memerlukan internet; salinan CSV digunakan ulang dari `.local-data/postal-reference.csv`. Jangan menjalankan importer bersamaan dengan aplikasi yang memakai `.pgdata` yang sama. Cadangkan direktori database sebelum impor. Database baru tidak lagi menggunakan tiga contoh kode pos sebagai master nasional.

### Mode cepat untuk pemakaian harian

```powershell
npm.cmd run local:fast
```

Atau klik dua kali `start-local.bat`. Launcher ini membuat build production saat pertama kali atau ketika input build berubah. Jika build masih sesuai, kompilasi dilewati. Halaman tidak dikompilasi lagi saat dibuka seperti pada mode development. Buka `http://127.0.0.1:3000/login` setelah server siap.

Hentikan server lama dengan `Ctrl+C` terlebih dahulu jika port 3000 masih dipakai. Perubahan kode saat server production berjalan baru diterapkan setelah server dihentikan dan launcher dijalankan ulang. Database dan validasi hak akses tetap digunakan seperti biasa.

### Mode development untuk mengedit kode

```powershell
npm.cmd run dev:local
```

Tunggu sampai Next.js menampilkan status siap, lalu buka:

<http://127.0.0.1:3000/login>

Di panel **Mode lokal**, pilih akun yang dibuat pada langkah setup dan klik **Masuk (mode lokal)**. Login lokal menggunakan pilihan akun terdaftar dan cookie bertanda tangan; tidak memerlukan password atau Cloudflare Access. Server terikat ke `127.0.0.1`, dan endpoint login hanya menerima host loopback.

Gunakan hostname yang sama sepanjang sesi agar cookie konsisten. Biarkan terminal server tetap terbuka. Untuk berhenti, tekan `Ctrl+C`.

Untuk mengedit kode dengan hot reload, gunakan `npm.cmd run dev:local` atau `start-local-dev.bat`. Untuk pemakaian berikutnya tanpa mengedit kode, gunakan `start-local.bat` agar memakai build production yang lebih cepat.

## 5. Pemeriksaan

Di terminal lain, dengan server aktif:

```powershell
Set-Location -LiteralPath 'C:\Users\THINKPAD\Downloads\RTICore'
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/local-auth'
```

Respons seharusnya menunjukkan `localMode: true` dan daftar anggota aktif. Periksa juga login dan halaman yang dapat diakses sesuai role.

Pemeriksaan kode opsional dari root repository:

```powershell
npm.cmd run test:local-mode
npm.cmd run typecheck
```

Tes mode lokal memeriksa antara lain sesi lokal dan adapter SQLite; hasilnya tidak menggantikan pemeriksaan login serta alur bisnis pada runtime PGlite.

## 6. Menjalankan hasil build

Hentikan development server terlebih dahulu agar port 3000 dan data PGlite tidak digunakan dua proses sekaligus:

```powershell
npm.cmd run build
npm.cmd run start:local
```

`start:local` memerlukan build yang berhasil. Untuk pengembangan harian gunakan `dev:local`. Perintah Cloudflare seperti `build:cf` dan `deploy:cf` tidak diperlukan untuk menjalankan aplikasi lokal.

## 7. Data dan konfigurasi

| Lokasi | Fungsi |
| --- | --- |
| `.env.local` | Mode lokal, secret sesi, dan kunci enkripsi |
| `.pgdata` | Data runtime PGlite default |
| `.local-data/rticore.db` | SQLite yang disiapkan script setup; dipakai runtime jika engine diatur ke `sqlite` |
| `.next` | Hasil kompilasi Next.js |

Cadangkan `.env.local`, `.pgdata`, dan `.local-data` saat server sudah berhenti. Simpan kunci enkripsi bersama cadangan data secara privat; kehilangan kunci dapat membuat kredensial AI atau dokumen terenkripsi tidak terbaca. Jangan commit secret atau database lokal.

Fitur AI yang memanggil provider tetap memerlukan konfigurasi kredensial dan koneksi internet. Mode lokal tidak otomatis menyediakan layanan AI offline atau menyalin data cloud ke komputer ini.

## 8. Pemecahan masalah

| Gejala | Tindakan |
| --- | --- |
| `node` / `npm.cmd` tidak ditemukan | Pasang Node.js atau perbaiki PATH, lalu buka terminal baru. |
| `No such built-in module: node:sqlite` | Gunakan Node.js yang menyediakan `node:sqlite`, lalu ulangi pemeriksaan prasyarat. |
| Dependency tidak ditemukan | Jalankan `npm.cmd ci` dari root repository. |
| Panel mode lokal tidak muncul | Periksa `RTICORE_LOCAL_MODE=1` di `.env.local` dan environment terminal, kemudian restart server. |
| Akun lokal kosong atau tidak ditemukan | Hentikan server, jalankan setup dengan `--admin`, pastikan runtime memakai `.pgdata` default, lalu jalankan server kembali. |
| Port 3000 sudah digunakan | Hentikan proses server lama dari terminalnya; jangan menjalankan dua instance pada database yang sama. |
| Database terkunci / sedang digunakan | Hentikan semua instance aplikasi yang memakai direktori data itu sebelum setup atau restart. |
| Setup gagal pada migrasi | Catat nama migrasi dan pesan error; cadangkan data sebelum memperbaiki. Jangan menghapus database untuk melewati error. |
| Login berulang atau sesi hilang | Gunakan satu hostname, pilih ulang akun, dan periksa bahwa secret sesi tidak berubah. |
| Build atau typecheck gagal | Tinjau error pertama di terminal. Perbaiki masalah kode/dependency sebelum memakai `start:local`. |

Dokumen ini adalah panduan eksekusi; keberhasilan seluruh fitur harus diverifikasi pada aplikasi yang berjalan.
