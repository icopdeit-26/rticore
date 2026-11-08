from pathlib import Path
import re, json, html
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Flowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
TMP=ROOT/'tmp/pdfs'; TMP.mkdir(parents=True,exist_ok=True)
ROLE={'admin':'Administrator','marketing':'Marketing','sales':'Sales','presales':'Presales / Solution','finance':'Finance','approver':'Approver','legal':'Legal','viewer':'Viewer'}
# Read the actual sidebar definition rather than maintaining a second menu matrix.
nav=(ROOT/'src/lib/enterprise-navigation.ts').read_text(encoding='utf-8')
sets={k:re.findall(r"'([^']+)'",v) for k,v in re.findall(r'const (ALL|COMMERCIAL|SALES|PRESALES|FINANCE): BoQRole\[\] = \[([^\]]+)\]',nav)}
menus=[]
for label,path,expr in re.findall(r"item\('([^']+)','([^']+)',(\[[^\]]*\]|\w+)\)",nav):
    allowed=sets.get(expr,[]).copy()
    if expr.startswith('['):
        allowed=re.findall(r"'([^']+)'",expr)
        for name in re.findall(r'\.\.\.(\w+)',expr): allowed+=sets[name]
    menus.append((label,path,allowed))

def task(title,path,steps,result,check): return (title,path,steps,result,check)
BOQ=task('Menyusun dan mengajukan BoQ','/boq',[
 'Buka BoQ dari Opportunity yang benar. Cocokkan pelanggan, judul proyek, layanan, dan nomor quotation sebelum mengisi harga.',
 'Isi deskripsi item, kuantitas, satuan, jenis layanan dan harga satuan. Pilih termin pembayaran serta tarif PPN sesuai transaksi; tarif disimpan sebagai pecahan, misalnya 0.11 untuk 11%.',
 'Simpan draft. Hasil scoping yang dimuat ke BoQ belum tersimpan dan harga awalnya masih nol; lengkapi data lalu simpan.',
 'Minta Finance/Admin melengkapi HPP A-E. Simpan seluruh perubahan sebelum mengajukan persetujuan.',
 'Ajukan draft untuk approval. Pantau status submitted, approved atau rejected. Gunakan revisi untuk perubahan dokumen yang telah diajukan; periksa versi baru sebelum dipakai kembali.'
], 'BoQ tersimpan pada Opportunity yang sama dan memiliki status serta versi yang dapat ditelusuri.',
 'Sales/Presales tidak dapat melihat atau mengedit HPP. Dokumen memerlukan minimal satu item dan subtotal lebih besar dari nol. Persetujuan dilakukan Approver/Admin yang berbeda dari pembuat.')
REVIEW=task('Meninjau BoQ secara independen','/approvals',[
 'Buka Approval Center dan tekan Refresh. Pilih transaksi lalu gunakan Periksa di sumber untuk membuka modul asal.',
 'Cocokkan pelanggan, Opportunity, versi BoQ, lingkup, harga dan bukti pendukung. Pastikan Anda bukan pembuat dokumen.',
 'Pastikan Finance/Admin telah melengkapi semua HPP A-E. Jika informasi belum cukup, kembalikan untuk perbaikan dengan alasan yang jelas.',
 'Setujui atau tolak di modul BoQ. Alasan penolakan minimal 5 karakter. Margin di bawah 25% memerlukan Admin independen dengan alasan pengecualian minimal 15 karakter.',
 'Muat ulang dokumen dan pastikan keputusan tercatat. Jangan menganggap antrean kosong sebagai bukti seluruh approval perusahaan sudah selesai.'
], 'Keputusan melekat pada transaksi sumber, bukan hanya pada daftar antrean.',
 'Approver tidak memperoleh akses HPP melalui role BoQ. Mintalah pemeriksaan Finance melalui alur yang berwenang; jangan meminta berbagi akun.')
VAULT=task('Memeriksa dokumen asli','/sales/documents',[
 'Pilih Opportunity yang sesuai. Buka Secure Document Vault dari transaksi agar konteks data tetap benar.',
 'Periksa jenis dokumen, nama file, referensi arsip dan checksum yang tersedia. Unduh hanya melalui kontrol aplikasi yang diizinkan.',
 'Buka file asli dan cocokkan isi, nomor, nilai, tanggal, lingkup serta pihak terkait dengan transaksi.',
 'Jika berwenang mengunggah, pilih jenis yang benar dan simpan file asli melalui Vault. Gunakan pemilih Vault pada formulir terkait agar referensi dan SHA-256 diambil dari arsip.',
 'Catat ketidaksesuaian di modul review. Status tersimpan atau checksum cocok belum membuktikan bahwa isi dokumen sah atau telah diterima pelanggan.'
], 'Bukti dapat ditelusuri ke dokumen asli yang diperiksa.',
 'Hak unggah, unduh dan jenis file bergantung pada role serta status Opportunity. Sesudah Won, dokumen paket penjualan dikunci; tambahan bukti pendukung mengikuti izin aplikasi.')
SUBREVIEW=task('Memverifikasi bukti pengiriman quotation','/sales/submission',[
 'Buka Submission & Proposal Evidence melalui Opportunity yang akan diperiksa.',
 'Periksa penerima, kanal, waktu pengiriman, bukti asli dan versi BoQ/quotation yang dilaporkan.',
 'Pastikan pemeriksa berbeda dari pelapor. Isi catatan substantif lalu pilih verified atau rejected sesuai bukti.',
 'Muat ulang dan pastikan keputusan melekat pada versi yang benar. Jika BoQ berubah, periksa kembali bukti pengiriman versi terbaru.'
], 'Bukti Reported menjadi Verified atau Rejected setelah pemeriksaan independen.',
 'Pencatatan submission tidak mengirim email secara otomatis dan bukan pengakuan penerimaan pelanggan.')
AWARD=task('Melakukan review PO/SPK','/sales/award',[
 'Buka PO / SPK Verification dari Opportunity. Periksa nomor PO yang tercatat di Sales.',
 'Unduh dokumen asli dari Vault. Cocokkan identitas pihak, nomor PO/SPK, harga, pajak, lingkup, termin dan lampiran dengan penawaran yang disetujui.',
 'Isi catatan sesuai tanggung jawab Anda. Finance memeriksa aspek finansial; Legal memeriksa aspek legal. Rekam review menggunakan pilihan sesuai role.',
 'Pastikan pembuat, pemeriksa Finance dan pemeriksa Legal memenuhi pemisahan tugas. Kedua review harus merujuk dokumen yang sama.',
 'Periksa indikator kesiapan kembali. Pemeriksaan ganda PO tidak menggantikan gate lain menuju Closed Won.'
], 'Review Finance dan Legal tersimpan terpisah pada bukti PO/SPK.',
 'Dokumen belum sesuai: minta koreksi kepada Sales sebelum menyatakan pemeriksaan selesai.')
TIMES=task('Mencatat waktu proyek','/psa/timesheets',[
 'Pilih proyek, lalu pilih alokasi aktif milik akun Anda. Jika tidak tersedia, minta penanggung jawab memeriksa penugasan dan periode proyek.',
 'Isi tanggal kerja, menit kerja dalam kelipatan 15 (15-480), penanda Billable, dan keterangan pekerjaan minimal 12 karakter.',
 'Klik Simpan dan ajukan review. Periksa riwayat untuk memastikan status submitted muncul.',
 'Pantau keputusan Finance/Approver. Entri yang ditolak dapat diajukan ulang sesuai koreksi; entri approved tidak dapat diedit atau dihapus.'
], 'Jam kerja tercatat terhadap alokasi proyek dan menunggu pemeriksaan independen.',
 'Timesheet adalah bukti waktu/biaya proyek; pencatatan ini tidak otomatis membuat payroll atau posting General Ledger.')

WORK={
'admin':[
 task('Mendaftarkan dan memelihara pengguna','/boq/users',['Siapkan email kerja, role yang disetujui, unit organisasi dan status keaktifan. Gunakan email yang sama dengan identitas login.','Buka Registrasi User. Cari akun terlebih dahulu agar tidak membuat entri yang tidak perlu.','Daftarkan atau ubah role/unit/status sesuai formulir, lalu simpan. Periksa kembali data setelah daftar dimuat ulang.','Minta pengguna login dengan akunnya sendiri dan memastikan menu sesuai role. Registrasi RTICore tetap memerlukan kebijakan Cloudflare Access yang mengizinkan akun.','Saat menonaktifkan akun atau mengubah Admin, pastikan ada Admin aktif lain. Sistem melindungi Admin aktif terakhir.'],'Keanggotaan pengguna tercatat dan dapat dicocokkan dengan identitas login.','Jangan membagikan akun Admin. Hak administrator tidak membatalkan maker-checker atau otomatis membuka semua kapabilitas ERP.'),
 task('Memelihara parameter, opsi dan API key','/settings/system',['Buka Parameter untuk perubahan konfigurasi sistem. Baca nilai dan versi aktif sebelum membuat perubahan.','Ajukan perubahan parameter sesuai alur persetujuan independen; pastikan versi/status aktif berubah setelah persetujuan.','Gunakan Opsi dan Registrasi Opsi Standar untuk mengelola pilihan yang tersedia. Periksa grup, kode dan status sebelum menyimpan; nonaktifkan hanya opsi yang memang tidak lagi digunakan.','Buka API Key untuk konfigurasi provider AI. Masukkan key melalui formulir yang disediakan, lalu gunakan fungsi uji atau rotasi yang tersedia.','Setelah perubahan, uji formulir/modul yang menggunakannya. Jika terjadi konflik versi, muat ulang sebelum mengulang perubahan.'],'Konfigurasi diperbarui melalui kontrol aplikasi dan jejak perubahan.','Tidak semua dropdown memakai registri opsi yang sama. Jangan memasukkan key ke catatan, dokumen, atau tangkapan layar.'),
 task('Menggunakan mode uji role','Menu profil',['Gunakan akun Admin aktif di lingkungan UAT dengan data yang disetujui.','Buka profil di kanan atas, pilih Ganti Role / Mode Uji, lalu role tujuan.','Periksa menu dan tindakan role efektif. Identitas email tetap akun Admin; mode Sales tidak membuka seluruh data milik Sales lain.','Pilih Kembali ke Role Admin setelah selesai. Mode sementara berlaku hingga 60 menit.'],'Menu dan izin mengikuti role efektif tanpa mengganti identitas pengguna.','Mode uji dapat melakukan transaksi nyata. Ini bukan simulasi tanpa penyimpanan dan bukan pengganti UAT dengan akun terpisah.'), REVIEW, VAULT],
'marketing':[
 task('Membuat dan memantau campaign','/sales/campaigns',['Buka Campaign Management dan buat campaign baru.','Isi kode/nama, kanal, owner, anggaran, tanggal mulai/akhir dan catatan yang relevan.','Simpan sebagai planned, kemudian aktifkan sesuai kesiapan kegiatan. Periksa status active sebelum mengaitkan lead.','Pantau jumlah lead, qualified, converted dan conversion rate. Bandingkan periode serta status data sebelum menyimpulkan hasil.','Untuk perubahan, buka campaign yang benar, perbarui data yang diizinkan, lalu simpan dan muat ulang.'],'Campaign tersedia sebagai sumber lead yang dapat ditelusuri.','Sales dapat melihat campaign dalam cakupannya; pengelolaan campaign dilakukan Marketing/Admin.'),
 task('Mendaftarkan lead dan menyerahkannya ke Sales','/sales/leads',['Cari perusahaan/PIC terlebih dahulu untuk menghindari duplikasi. Pilih pembuatan lead baru.','Isi nama perusahaan, sumber, campaign bila ada, layanan, nama/email PIC, estimasi nilai dan tanggal closing bila diketahui.','Pilih Sales aktif yang bertanggung jawab sesuai kewenangan formulir. Jangan menggunakan email akun yang belum terdaftar.','Simpan dan pastikan Lead Number muncul. Buka detail, tambahkan catatan aktivitas dan konteks kebutuhan.','Serahkan Lead Number, PIC, kebutuhan awal dan rencana tindak lanjut kepada Sales. Pantau status Assigned, Qualified, Disqualified atau Converted.'],'Lead tersimpan dengan sumber dan owner yang jelas.','Marketing tidak melakukan konversi customer/opportunity dan tidak mendapat akses HPP. Sales melengkapi kualifikasi dan konversi.'),
 task('Meninjau skor dan nurturing','/sales/lead-intelligence',['Buka Lead Scoring & Nurturing dan cari lead yang relevan.','Tinjau skor, temperatur dan informasi sumber yang tampil. Cocokkan dengan aktivitas serta kondisi pelanggan yang nyata.','Gunakan antrean/rekomendasi untuk menentukan prioritas tindak lanjut sesuai kontrol yang tersedia.','Catat hasil komunikasi di lead dan koordinasikan tindak lanjut dengan Sales; jangan menganggap rekomendasi sebagai persetujuan pelanggan.'],'Prioritas tindak lanjut memiliki dasar data dan catatan hasil.','Skor atau ringkasan AI tidak menggantikan kualifikasi Sales maupun bukti transaksi.')],
'sales':[
 task('Mengualifikasi dan mengonversi lead','/sales/leads',['Buka lead yang ditugaskan kepada akun Anda. Periksa perusahaan, PIC dan layanan.','Lengkapi kebutuhan/pain point, budget/status pendanaan, pengambil keputusan dan proses pengadaan. Tambahkan discovery serta tindak lanjut.','Tandai qualified jika memenuhi syarat; jika tidak diteruskan, catat alasan disqualified yang jelas.','Lengkapi profil customer, judul proyek, estimasi nilai dan target closing yang diminta formulir konversi.','Jalankan konversi satu kali, lalu buka tautan Customer dan Opportunity hasil konversi. Gunakan ID tersebut pada tahap berikutnya.'],'Lead Converted terhubung dengan customer dan Opportunity resmi.','Sales hanya mengakses data dalam cakupan kepemilikannya. Jangan membuat customer/opportunity baru untuk menggandakan hasil konversi.'),
 task('Mengelola pipeline dan follow-up','/sales/pipeline',['Pilih Opportunity dan cek customer, layanan, owner, estimasi nilai serta target closing.','Buka Activity, SLA & Follow-up untuk mencatat aktivitas, jatuh tempo dan tindak lanjut. Gunakan Communication Timeline untuk riwayat komunikasi yang diizinkan.','Koordinasikan scoping dengan Presales. Untuk tender, pastikan keputusan GO dan kajian persyaratan selesai sebelum melanjutkan.','Perbarui tahap berdasarkan bukti dan gate yang tampil. Saat gagal maju, baca persyaratan yang belum lengkap.','Tinjau Sales Forecast dengan tanggal dan status terbaru. Jika kalah, gunakan proses Closed Lost beserta alasan/bukti sesuai formulir.'],'Pipeline mencerminkan kemajuan yang dapat dibuktikan.','Jangan menandai Won hanya karena pelanggan menyampaikan minat. Approval, submission, bukti PO dan review tetap diperlukan.'), BOQ,
 task('Mencatat pengiriman dan award','/sales/submission',['Dari Opportunity, pastikan quotation menggunakan BoQ approved yang benar. Periksa dokumen keluaran sebelum dikirim melalui kanal bisnis yang disetujui.','Simpan bukti pengiriman asli di Vault. Buka Submission & Proposal Evidence, isi penerima, kanal, waktu dan pilih bukti melalui Vault.','Catat pengiriman sebagai Reported. Tunggu Finance/Approver memverifikasi; revisi quotation memerlukan bukti versi yang sesuai.','Setelah menerima PO/SPK, unggah dokumen asli. Buka PO / SPK Verification, pilih jenis dan nomor dokumen serta file Vault lalu klik Register Dokumen (Pending Review).','Minta review Finance dan Legal yang terpisah. Lanjutkan Closed Won hanya setelah seluruh persyaratan di Opportunity terpenuhi.'],'Rantai quotation, submission dan PO tetap terhubung pada Opportunity.','Form submission mencatat pengiriman yang telah dilakukan; form ini bukan layanan pengirim email.'),
 task('Menyiapkan post-PO dan renewal','/post-po',['Buka Official Post-PO Forms dari transaksi yang telah memenuhi prasyarat.','Periksa data customer, proyek, kontak dan sumber BoQ/PO. Lengkapi data yang belum tersedia tanpa mengarang persetujuan.','Buat dokumen melalui pilihan yang tersedia dan tinjau hasil sebelum dipakai untuk handover.','Pada Contracts & Renewal, pilih kontrak terkait customer yang sama dan pantau tanggal akhir serta tindak lanjut renewal.','Gunakan proses renewal/expansion yang diizinkan. Opportunity baru memerlukan penawaran, bukti dan approval baru.'],'Handover dan tindak lanjut kontrak memakai referensi transaksi yang sama.','Notifikasi expiry dalam aplikasi tidak berarti email/WhatsApp sudah terkirim; renewal tidak mewarisi persetujuan transaksi lama.')],
'presales':[
 task('Menyusun scoping dan sizing','/scoping',['Buka Smart Scoping & Sizing dan pilih layanan yang sesuai kebutuhan pelanggan.','Lengkapi parameter aset, cakupan, metodologi, durasi dan deliverable yang diminta untuk layanan tersebut.','Jika menggunakan berkas RKS/KAK, unggah melalui fitur yang tersedia lalu periksa kembali hasil ekstraksi terhadap dokumen asli.','Untuk VAPT multi-aset, periksa setiap baris aset, kompleksitas dan estimasi mandays; jangan menyatukan aset berbeda tanpa dasar.','Tinjau hasil teknis. Bila diteruskan ke BoQ, segera lengkapi Opportunity/harga dan simpan; draft browser berlaku terbatas dan belum menjadi transaksi tersimpan.'],'Lingkup dan estimasi teknis siap ditinjau serta diteruskan ke proses komersial.','Hasil ekstraksi/AI perlu verifikasi manusia; harga dan HPP tidak otomatis sah dari hasil sizing.'),
 task('Menyiapkan tender dan kelayakan solusi','/sales/compliance',['Buka konteks Opportunity yang tepat. Tinjau Tender Compliance dan catat persyaratan terhadap dokumen sumber.','Lengkapi bukti pemenuhan serta gap. Minta kajian independen sesuai alur; jangan mereview sendiri bukti yang dibuat sendiri ketika sistem mensyaratkan pemeriksa berbeda.','Periksa Bid Readiness untuk kelengkapan keputusan dan persyaratan tender.','Buka Resource & Solution Feasibility. Lengkapi kebutuhan personel, jadwal, kapasitas, resource dan dukungan vendor yang diperlukan.','Serahkan gap teknis, estimasi dan kebutuhan vendor kepada Sales/Approver; lanjutkan hanya setelah gate terkait terpenuhi.'],'Kesiapan tender dan rencana sumber daya dapat ditelusuri.','Keputusan GO/NO-GO dan approval formal tetap milik reviewer berwenang; menu yang terlihat bukan izin untuk seluruh tindakan.'), BOQ,
 task('Menjalankan delivery proyek','/sales/delivery',['Pilih proyek hasil Opportunity Won dan periksa baseline customer, PO, BoQ serta scope.','Pastikan PM, penugasan dan tanggal proyek tersedia. Jika belum, koordinasikan penetapan dengan penanggung jawab yang berwenang.','Lengkapi kickoff, milestone dan parameter layanan sesuai formulir. Lampirkan bukti asli sebelum menyelesaikan tahapan yang memerlukannya.','Perbarui tugas dan bukti deliverable berdasarkan pekerjaan nyata. Untuk SOC, periksa periode pelaporan yang mengikuti jadwal proyek.','Siapkan bukti serah terima/BAST untuk pemeriksaan sebelum proses penagihan.'],'Status delivery memiliki bukti pekerjaan dan dasar serah terima.','Baseline approved tidak boleh diganti untuk menyembunyikan perubahan scope. Koordinasikan perubahan melalui alur yang disetujui.'), TIMES],
'finance':[
 task('Melengkapi HPP dan memeriksa komersial','/boq',['Pilih BoQ dan cocokkan Opportunity, versi, item serta termin pembayaran.','Isi semua komponen HPP A-E berdasarkan data biaya yang dapat dipertanggungjawabkan. Isi nol hanya bila komponen memang tidak memiliki biaya.','Periksa subtotal, pajak, total, HPP dan margin. Jangan membagikan ekspor biaya kepada role yang tidak berwenang.','Simpan draft dan ajukan bila data lengkap. Minta Approver/Admin independen memutuskan approval BoQ.','Jika diperlukan revisi, gunakan versi baru dan pastikan bukti transaksi berikutnya diperbarui.'],'HPP lengkap mendukung pemeriksaan margin dan keputusan komersial.','Role Finance dapat mengisi HPP, tetapi persetujuan BoQ dilakukan Approver/Admin.'), SUBREVIEW, AWARD,
 task('Memproses invoice dan collection','/sales/billing',['Pilih proyek/milestone yang didukung BAST atau penerimaan yang telah ditandatangani dan diperiksa.','Buat draft invoice sesuai nilai milestone/PO yang diterima. Periksa nomor, pajak, tanggal dan nominal sebelum diajukan.','Minta reviewer independen menyetujui draft. Periksa status approved sebelum menjadikannya dasar collection.','Catat draft penerimaan bank sesuai bukti pembayaran, termasuk pembayaran sebagian. Ajukan untuk persetujuan independen.','Periksa outstanding/overdue dan rekonsiliasi. Koreksi pembayaran yang disetujui melalui reversal yang tersedia dan direview; jangan menimpa riwayat.'],'Invoice, pembayaran dan saldo dapat direkonsiliasi ke bukti penerimaan.','Invoice kumulatif dibatasi nilai yang diterima/PO; collection tidak boleh melampaui gross invoice approved. Invoice atau penerimaan kas tidak otomatis menjadi revenue.'),
 task('Meninjau revenue, timesheet dan ERP','/sales/revenue',['Di Revenue Register, cocokkan pengakuan revenue dengan invoice approved dan batas alokasi yang berlaku.','Di Project Timesheets, pilih proyek, periksa tanggal, menit, alokasi dan deskripsi. Isi catatan review minimal 12 karakter lalu Setujui atau Tolak secara independen.','Periksa laporan dengan periode dan cakupan yang benar. Profitabilitas masih bersifat sementara sampai kelengkapan biaya disertifikasi Finance.','Untuk General Ledger, Treasury atau Procurement/AP, pastikan penempatan staff, legal-unit dan capability grant telah disetujui. Pilih unit/periode/referensi pada modul yang tersedia.','Periksa prasyarat dan status setiap transaksi ERP sebelum mengajukan tindakan; minta reviewer independen sesuai kebijakan modul.'],'Pencatatan operasional dipisahkan dari persetujuan dan pembukuan yang sah.','Timesheet tidak otomatis diposting ke GL. Role Finance saja belum cukup untuk operasi ERP tanpa grant yang sesuai.')],
'approver':[REVIEW,
 task('Memutuskan kesiapan dan pengecualian','/sales/bid-readiness',['Buka transaksi dari Approval Center atau modul asal. Pastikan dokumen sumber dan versi masih sesuai.','Untuk tender, tinjau alasan bid, kesiapan persyaratan dan gap teknis/komersial sebelum merekam keputusan yang tersedia.','Periksa rencana resource dan bukti vendor pada Feasibility. Jangan menyamakan kapasitas rencana dengan ketersediaan yang sudah disetujui.','Berikan catatan keputusan yang menjelaskan alasan dan tindak lanjut. Hindari self-approval dan mintalah reviewer lain jika Anda pembuat.','Muat ulang sumber dan periksa status. Untuk jenis yang tidak tercakup antrean, periksa langsung modul terkait.'],'Keputusan dapat dipertanggungjawabkan terhadap sumber dan pemeriksa.','Approver tidak memperoleh hak menulis seluruh modul hanya karena menu tersedia.'), SUBREVIEW,
 task('Meninjau transaksi operasional dan keuangan','/sales/billing',['Untuk invoice, periksa BAST/penerimaan, nilai milestone, PO, pajak serta batas kumulatif sebelum keputusan.','Untuk penerimaan bank, periksa invoice approved, bukti bank dan saldo. Tinjau reversal terhadap transaksi asal bila ada.','Untuk timesheet, periksa alokasi, tanggal dan durasi; catatan review minimal 12 karakter. Gunakan Setujui/Tolak dan pastikan bukan entri Anda sendiri.','Untuk kontrak, periksa jenis, tanggal, nilai bulanan dan ketentuan renewal sebelum persetujuan yang diizinkan.','Untuk ERP, cocokkan unit organisasi, scope legal entity dan capability grant yang telah disetujui sebelum tindakan review.'],'Review mencakup bukti dan batas transaksi, bukan sekadar tampilan status.','Biaya pada timesheet mengikuti kontrol modul tersendiri. Jangan menganggap semua akses biaya sama dengan akses HPP BoQ.'),
 task('Membaca dashboard untuk pengawasan','/sales/executive',['Pilih periode dan filter yang diperlukan di Executive Dashboard.','Cocokkan pipeline, forecast, revenue dan collection menurut definisi masing-masing.','Telusuri angka ke transaksi sumber melalui menu yang tersedia. Periksa apakah daftar dibatasi atau data gagal dimuat.','Tindak lanjuti gap dengan owner dan catat keputusan di modul terkait.'],'Pengawasan menggunakan definisi metrik dan cakupan data yang benar.','Forecast bukan revenue yang diakui dan collection bukan otomatis pengakuan revenue.')],
'legal':[VAULT, AWARD,
 task('Meninjau konteks penawaran dan komunikasi','/customers',['Buka Customer 360 dan pilih customer yang terkait dengan transaksi yang diperiksa.','Cocokkan identitas badan usaha, stakeholder dan hubungan Opportunity yang dapat diakses.','Buka Communication Timeline untuk memeriksa konteks komunikasi dan Submission & Proposal Evidence untuk bukti versi penawaran.','Periksa lingkup dan ketentuan komersial di BoQ/berkas penawaran tanpa meminta akses HPP yang tidak diberikan kepada Legal.','Sampaikan ketidaksesuaian melalui catatan review dan koordinasikan koreksi dengan owner Sales.'],'Pemeriksaan legal memiliki konteks customer dan versi penawaran.','Legal tidak menjadi reviewer Finance atau Approver BoQ hanya karena dapat membuka dokumen.'),
 task('Meninjau kontrak, renewal dan handover','/sales/renewals',['Pilih kontrak yang terkait dengan customer dan Opportunity yang tepat.','Periksa dokumen asli, para pihak, masa berlaku, kewajiban, lingkup, termin serta ketentuan perpanjangan.','Cocokkan ringkasan aplikasi dengan dokumen; catat perbedaan untuk pemilik transaksi sebelum proses dilanjutkan.','Periksa Official Post-PO Forms bila dibutuhkan untuk memastikan data handover konsisten.','Pada renewal/expansion, periksa dokumen dan persetujuan transaksi baru; jangan menganggap persetujuan lama berlaku otomatis.'],'Kontrak dan handover konsisten dengan dokumen yang direview.','Tersedianya menu kontrak tidak otomatis memberi Legal izin membuat atau menyetujui semua transaksi kontrak.')],
'viewer':[
 task('Membaca BoQ yang diizinkan','/boq',['Masuk dengan akun Viewer aktif lalu buka BoQ Management.','Pilih dokumen dari daftar yang disediakan aplikasi. Periksa nomor quotation, customer, proyek, layanan, status dan versi.','Baca item, jumlah, harga jual serta total yang ditampilkan. Bedakan draft, submitted, approved dan rejected.','Jika ada pertanyaan, sampaikan nomor dokumen dan versi kepada owner melalui kanal kerja yang disepakati.','Muat ulang untuk melihat status terbaru. Jika dokumen tidak tampil atau ditolak, minta Admin memeriksa cakupan akses.'],'Pengguna mengetahui status serta rincian BoQ yang boleh dibaca.','Viewer bersifat baca saja: tidak membuat/mengubah BoQ, mengisi HPP, mengajukan atau memutuskan approval, dan tidak mengelola pengguna.'),
 task('Memahami batas akses Viewer','/boq',['Gunakan hanya menu yang ditampilkan bagi akun Anda; daftar menu role ini terbatas pada BoQ Management.','Jangan menganggap halaman lain terbuka hanya karena menerima tautannya dari rekan kerja.','Jika membutuhkan fungsi operasional, ajukan perubahan role melalui penanggung jawab dan Admin sesuai kebutuhan pekerjaan.','Jika unduhan atau rincian tidak tersedia, gunakan informasi yang diberikan aplikasi dan minta pemilik data menyiapkan keluaran yang diizinkan.'],'Kebutuhan akses dapat disampaikan secara jelas tanpa meminjam akun.','HPP dan margin internal tidak diberikan kepada Viewer; jangan memakai akun orang lain untuk melihatnya.')]
}

styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyRT',fontName='Helvetica',fontSize=10,leading=15,textColor=colors.HexColor('#24364b'),spaceAfter=9))
styles.add(ParagraphStyle(name='SmallRT',parent=styles['BodyRT'],fontSize=8,leading=11))
styles.add(ParagraphStyle(name='TitleRT',fontName='Helvetica-Bold',fontSize=34,leading=39,textColor=colors.HexColor('#122a47'),spaceAfter=18))
styles.add(ParagraphStyle(name='HeadRT',fontName='Helvetica-Bold',fontSize=20,leading=25,textColor=colors.HexColor('#122a47'),spaceAfter=14))
styles.add(ParagraphStyle(name='SubRT',fontName='Helvetica-Bold',fontSize=11,leading=16,textColor=colors.HexColor('#087d8c'),spaceBefore=10,spaceAfter=7))
def p(text,style='BodyRT'): return Paragraph(html.escape(text),styles[style])
def footer(c,d):
    w,h=d.pagesize
    c.setStrokeColor(colors.HexColor('#d5dfe8'));c.line(42,43,w-42,43)
    c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#53667b'))
    c.drawString(42,30,'RTICore | Panduan '+ROLE[d.role]+' | 8 November 2026')
    c.drawRightString(w-42,30,str(d.page))
def section(title,body): return [p(title,'SubRT'),p(body)]

# Vector flowcharts remain sharp when readers zoom or print the manual.
# Each spine has one explicit decision and a corrective loop back to review.
FLOWS={
 'admin':(['Login sebagai Admin aktif','Daftarkan user / atur role dan unit','Atur parameter, opsi atau konfigurasi','Review independen bila diwajibkan','Akses dan perubahan sesuai?','Uji menu / role di lingkungan UAT','Pantau hasil dan jejak perubahan'],
           {3:'Reviewer lain',5:'Admin'},'Perbaiki role, data\natau konfigurasi','Alur administrasi; perubahan parameter mengikuti persetujuan independen. Mode uji role dapat menyimpan transaksi nyata.'),
 'marketing':(['Login dan buka Campaign Management','Buat / aktifkan campaign','Catat lead, sumber dan PIC','Periksa kelengkapan dan Sales tujuan','Lead siap diserahkan?','Serahkan Lead Number ke Sales','Pantau skor, nurturing dan hasil'],
               {5:'Sales penerima'},'Lengkapi lead\ndan penugasan','Sales melanjutkan kualifikasi dan konversi. Marketing memantau hasil tanpa mengakses HPP.'),
 'sales':(['Terima lead dan lengkapi kualifikasi','Konversi ke Customer + Opportunity','Koordinasi scope; siapkan BoQ / HPP','Minta approval komersial independen','BoQ disetujui?','Kirim quotation; catat bukti submission','PO: review Finance + Legal; cek gate'],
           {2:'Presales / Finance',3:'Approver / Admin',6:'Finance + Legal'},'Revisi BoQ / biaya;\najukan ulang','Setelah semua gate terpenuhi: Closed Won, handover post-PO, lalu tindak lanjut kontrak/renewal. Submission perlu verifikasi Finance/Approver; penolakan dikoreksi pada sumbernya.'),
 'presales':(['Terima konteks Opportunity dari Sales','Kaji RKS/KAK; susun scope dan sizing','Siapkan resource / vendor feasibility','Minta review teknis / bid terkait','Scope dan gate siap?','Serahkan ke BoQ dan approval komersial','Setelah Won: delivery dan timesheet'],
              {0:'Sales',3:'Reviewer independen',5:'Sales / Finance / Approver'},'Perbaiki scope,\nbukti atau resource','Cabang delivery hanya berjalan setelah Opportunity Won dan penugasan tersedia. Bukti serah terima menjadi dasar proses billing Finance.'),
 'finance':(['Terima BoQ; lengkapi HPP A-E','Minta approval BoQ oleh pihak lain','Review submission dan aspek PO','Setelah delivery: periksa bukti BAST','Dasar penagihan sesuai?','Buat invoice; minta review independen','Catat collection; review dan rekonsiliasi'],
             {1:'Approver / Admin',3:'Tim delivery',5:'Reviewer independen'},'Minta koreksi bukti\natau nilai milestone','Review Finance atas PO terpisah dari Legal. Collection memerlukan persetujuan independen; invoice dan kas tidak otomatis menjadi pengakuan revenue.'),
 'approver':(['Login; buka Approval Center','Pilih item dan buka modul asal','Periksa sumber, versi dan bukti','Pastikan reviewer bukan pembuat','Layak dan sesuai kewenangan?','Setujui di modul sumber','Muat ulang; pastikan keputusan tercatat'],
              {2:'Bukti dari maker',5:'Approver independen'},'Tolak / kembalikan\ndengan alasan','Maker memperbaiki dan mengajukan ulang bila diizinkan. Jika Anda pembuat, gunakan reviewer lain. Margin BoQ di bawah 25% memerlukan Admin independen dan alasan pengecualian.'),
 'legal':(['Buka konteks Customer / Opportunity','Unduh dokumen asli dari Vault','Cocokkan pihak, scope dan ketentuan','Periksa PO/SPK terhadap penawaran','Dokumen legal sesuai?','Catat review Legal independen','Koordinasikan hasil ke Sales / Finance'],
           {5:'Legal',6:'Sales / Finance'},'Minta koreksi\nkepada Sales','Review Finance tetap dilakukan terpisah pada dokumen yang sama. Review Legal saja belum menyelesaikan seluruh gate menuju Won.'),
 'viewer':(['Login sebagai Viewer aktif','Buka BoQ Management','Pilih dokumen dalam daftar akses','Baca nomor, versi dan status','Informasi dapat dibaca?','Tinjau rincian dan total yang tampil','Sampaikan pertanyaan ke owner'],
            {},'Minta Admin\nmemeriksa akses','Viewer hanya membaca BoQ yang diizinkan. Tidak membuat, mengubah, mengajukan atau menyetujui transaksi; tidak melihat HPP.')
}

class RoleFlow(Flowable):
    def __init__(self,role):
        super().__init__();self.role=role;self.width=501;self.height=526
    def draw(self):
        c=self.canv;labels,owners,fix,_=FLOWS[self.role]
        navy=colors.HexColor('#173954');teal=colors.HexColor('#087d8c')
        def text_at(x,y,text,size=9,bold=False):
            c.setFillColor(navy);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size)
            lines=text.split('\n')
            for j,line in enumerate(lines):c.drawCentredString(x,y+(len(lines)-1)*5-j*11,line)
        def arrow(points,color=teal):
            c.setStrokeColor(color);c.setFillColor(color);c.setLineWidth(1.3)
            q=c.beginPath();q.moveTo(*points[0])
            for pt in points[1:]:q.lineTo(*pt)
            c.drawPath(q)
            x,y=points[-1];px,py=points[-2]
            import math
            a=math.atan2(y-py,x-px);q=c.beginPath();q.moveTo(x,y)
            q.lineTo(x-6*math.cos(a-.45),y-6*math.sin(a-.45));q.lineTo(x-6*math.cos(a+.45),y-6*math.sin(a+.45));q.close();c.drawPath(q,stroke=0,fill=1)
        cx=174;ys=[494,426,358,290,214,132,58]
        for i,label in enumerate(labels):
            y=ys[i];external=i in owners
            if i==4:
                c.setFillColor(colors.HexColor('#fff1cf'));c.setStrokeColor(colors.HexColor('#ba8c23'))
                q=c.beginPath();q.moveTo(cx,y+31);q.lineTo(cx+135,y);q.lineTo(cx,y-31);q.lineTo(cx-135,y);q.close();c.drawPath(q,stroke=1,fill=1)
                text_at(cx,y-3,label,9,True)
            else:
                c.setFillColor(colors.HexColor('#eaf0f7') if external else colors.HexColor('#e2f3f2'));c.setStrokeColor(colors.HexColor('#a4b7ca') if external else teal)
                c.roundRect(14,y-23,320,46,8,stroke=1,fill=1)
                text_at(cx,y+2 if external else y-3,label,8.7,True)
                if external:text_at(cx,y-12,owners[i],7.5)
            if i<6:
                start=y-(31 if i==4 else 23);end=ys[i+1]+(31 if i+1==4 else 23)
                arrow([(cx,start),(cx,end)])
                if i==4:text_at(cx+20,(start+end)/2-3,'Ya',8)
        # Rework branch returns to the source review step, not directly to approval.
        c.setFillColor(colors.HexColor('#fff7e5'));c.setStrokeColor(colors.HexColor('#ba8c23'))
        c.roundRect(364,191,130,46,7,stroke=1,fill=1);text_at(429,211,fix,8.5)
        arrow([(309,214),(364,214)],colors.HexColor('#ba8c23'));text_at(340,225,'Tidak',8)
        arrow([(429,237),(429,290),(334,290)],colors.HexColor('#ba8c23'))
        text_at(426,305,'Periksa kembali',7.5)

manifest=[]
for role,name in ROLE.items():
    story=[Spacer(1,50),p('RTICore','TitleRT'),p('Buku Panduan Penggunaan','HeadRT'),p(name,'HeadRT'),Spacer(1,16),p('Edisi 1.1 | Bahasa Indonesia | 8 November 2026','SubRT'),p('Panduan kerja per role untuk platform bisnis, komersial, delivery dan tata kelola RTICore.'),Spacer(1,25)]
    story+=section('Cara menggunakan buku ini','Mulai dari akses dan peta menu, lalu ikuti prosedur sesuai tugas Anda. Setiap prosedur memuat langkah, hasil yang harus diperiksa, serta batas kewenangan.')
    story+=section('Dasar panduan','Disusun dari kode dan dokumentasi di workspace RTICore. Buku ini tidak menyatakan bahwa semua fitur pada kode telah dirilis atau diuji pada produksi. Tampilan, kebijakan dan ketersediaan modul dapat mengikuti versi lingkungan yang digunakan.')
    story+=section('Isi buku','01 Akses dan navigasi | 02 Peta menu role | Diagram alur proses | 03 Prosedur kerja | 04 Checklist dan kendala | 05 Istilah dan acuan')
    story+=[PageBreak(),p('01 / Akses dan navigasi','HeadRT')]
    for i,t in enumerate(['Gunakan alamat aplikasi yang dikonfirmasi Admin organisasi. Jika memakai landing login resmi, pilih Masuk dengan Cloudflare Access.','Selesaikan autentikasi menggunakan email kerja dan metode yang diminta penyedia identitas. Akun juga harus terdaftar aktif di RTICore.','Periksa nama/email dan role pada menu profil. Jika role salah atau menu tidak sesuai, hubungi Admin sebelum membuat transaksi.','Gunakan sidebar untuk membuka modul. Pada layar kecil, buka panel navigasi aplikasi dan pilih menu yang sama.','Untuk transaksi terkait Opportunity, mulai dari detail Opportunity atau tautan sumbernya. Beberapa halaman tidak dapat dipakai tanpa konteks Opportunity.','Setelah menyimpan, tunggu pesan sukses lalu periksa ID, versi dan status pada daftar/detail. Isian formulir saja belum berarti data tersimpan.','Saat selesai, gunakan pilihan keluar sesi yang tersedia di lingkungan Anda dan tutup sesi pada perangkat bersama. Jika sesi habis, login ulang sebelum melanjutkan.'],1): story.append(p(f'{i}. {t}'))
    story+=section('Alamat referensi konfigurasi','Dokumentasi login mencatat landing https://rticore-login.elang-haqeem.workers.dev/login dan aplikasi https://rticore.elang-haqeem.workers.dev/. Alamat ini berasal dari konfigurasi repo, belum diverifikasi langsung untuk edisi panduan ini; utamakan alamat yang diberikan Admin.')
    story+=section('Aturan yang berlaku untuk semua role','Hak akses ditentukan oleh identitas, role, kepemilikan data dan kewenangan transaksi. Menu yang terlihat belum menjamin seluruh tombol dapat digunakan. Jangan menyetujui pekerjaan sendiri ketika proses memerlukan pemeriksa independen. Gunakan dokumen asli dan pertahankan ID sumber antar-tahap.')
    story+=[PageBreak(),p('02 / Peta menu '+name,'HeadRT'),p('Menu berikut mengikuti definisi navigasi pada kode. Akses data serta tindakan tetap diperiksa oleh aplikasi. Path di kolom kanan dapat dipakai untuk mengenali halaman.')]
    rows=[[p('Menu','SmallRT'),p('Halaman','SmallRT')]]
    selected=[m for m in menus if role in m[2]]
    for label,path,_ in selected: rows.append([p(label.replace('·','-'),'SmallRT'),p(path,'SmallRT')])
    table=Table(rows,colWidths=[290,211],repeatRows=1,hAlign='LEFT')
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dceef2')),('VALIGN',(0,0),(-1,-1),'TOP'),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f3f6fa')]),('BOTTOMPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#83b5c2'))]))
    story.append(table)
    if role!='viewer': story+=section('Khusus menu ERP','Organization, General Ledger, Treasury, HR, Procurement/AP dan Cybersecurity memerlukan pengendalian tambahan. Penempatan staff dan capability grant pada legal-unit harus disetujui secara independen. Jika ditolak, minta Admin/Approver memeriksa grant; role umum tidak otomatis membuka operasi ERP.')
    story += [PageBreak(),p('Diagram alur / '+name,'HeadRT'),p('Baca dari atas ke bawah. Kotak biru menandai keterlibatan role lain; belah ketupat adalah keputusan. Cabang Tidak memerlukan koreksi sebelum pemeriksaan ulang.','SmallRT'),RoleFlow(role),p(FLOWS[role][3],'SmallRT')]
    for idx,(title,path,steps,result,check) in enumerate(WORK[role],1):
        story += [PageBreak(),p(f'03.{idx} / {title}','HeadRT'),p('Mulai dari: '+path,'SubRT'),p('Langkah penggunaan','SubRT')]
        for n,step in enumerate(steps,1): story.append(p(f'{n}. {step}'))
        story+=section('Hasil yang harus diperiksa',result)+section('Kontrol dan batas akses',check)
    story += [PageBreak(),p('04 / Checklist dan kendala','HeadRT')]
    for title,body in [('Sebelum bekerja','Pastikan role benar, customer/proyek/Opportunity sesuai, dokumen sumber tersedia dan periode transaksi tepat. Gunakan data contoh hanya di lingkungan UAT.'),('Sesudah menyimpan','Periksa pesan sukses, nomor/ID transaksi, versi, status dan bukti terkait. Serahkan ID serta tindakan berikutnya kepada role penerima. Jangan mengandalkan tangkapan layar formulir yang belum disimpan.'),('Sesi habis atau HTTP 401','Catat pekerjaan yang belum disimpan secara aman. Login ulang dengan akun kerja, buka kembali transaksi dan periksa apakah penyimpanan sebelumnya sudah tercatat sebelum mengulang.'),('Akses ditolak atau HTTP 403','Periksa role, kepemilikan data dan status keanggotaan. Untuk ERP, periksa grant/unit yang disetujui. Sampaikan konteks kepada Admin; jangan mencoba menggunakan akun rekan.'),('Konflik versi atau HTTP 409','Muat ulang detail, bandingkan perubahan terbaru dan ulangi hanya perubahan yang masih diperlukan. Jangan berulang kali menekan simpan pada data lama.'),('Tidak bisa lanjut tahap/approval','Baca pesan validasi. Periksa bukti asli, versi BoQ, status pengiriman, review independen, PO dan kecocokan referensi. Minta role pemilik prasyarat menyelesaikannya.'),('Layanan belum siap atau HTTP 503','Catat modul, waktu, pesan dan ID transaksi lalu hubungi Admin. Gangguan baca tidak berarti daftar kosong atau data hilang.'),('Format laporan kendala','Sertakan email akun, role, halaman, waktu kejadian, langkah yang dilakukan, ID/versi transaksi dan pesan kesalahan. Hindari menyertakan password, OTP, API key atau dokumen rahasia di kanal yang tidak disetujui.')]: story+=section(title,body)
    story += [PageBreak(),p('05 / Istilah dan acuan','HeadRT')]
    for title,body in [('Lead dan Opportunity','Lead adalah calon prospek. Opportunity adalah peluang bisnis yang menjadi pengikat proses komersial. Gunakan hubungan hasil konversi agar data tidak berulang.'),('BoQ, HPP dan margin','BoQ adalah rincian kuantitas/harga penawaran. HPP adalah biaya internal yang pada BoQ dibatasi untuk Finance/Admin. Margin dihitung dari harga jual dan biaya lengkap.'),('Maker-checker','Pembuat dan pemeriksa adalah orang berbeda. Persetujuan suatu modul tidak otomatis menggantikan review pada modul lain.'),('Vault dan SHA-256','Vault menyimpan dokumen asli dengan kontrol akses. SHA-256 adalah sidik jari file untuk mengecek konsistensi, bukan bukti tanda tangan atau persetujuan pelanggan.'),('Submission dan award','Submission mencatat bukti pengiriman penawaran. Award/PO/SPK mendukung pemeriksaan pesanan; status Won tetap memerlukan seluruh gate.'),('BAST, invoice, collection dan revenue','BAST adalah bukti serah terima. Invoice adalah tagihan. Collection adalah penerimaan pembayaran. Revenue adalah pengakuan pendapatan dengan proses tersendiri.'),('Draft, submitted, approved dan rejected','Draft belum final; submitted menunggu review; approved disetujui untuk konteks/versi terkait; rejected memerlukan tindak lanjut. Reported pada pengiriman berbeda dari Verified.')]: story+=section(title,body)
    story+=section('Acuan penyusunan','Kode: src/lib/enterprise-navigation.ts, boq-domain.ts, boq-workflow.ts, erp-core.ts; halaman src/app/boq, sales, approvals, psa, dan komponen admin. Dokumen: RTICORE_LOGIN_ACCESS, ADMIN_REGISTRATION_20261026, ADMIN_ROLE_SWITCH_20261101, CUSTOMER_DELIVERY_CASH_RENEWAL_20261023 dan ERP_PSA_WP0_WP4_20261030 di folder docs.')
    story+=section('Pemeliharaan panduan','Perbarui buku ini bila navigasi, role, formulir, alur persetujuan atau versi rilis berubah. Prosedur berfokus pada perilaku yang tersedia pada kode; langkah integrasi produksi dan administrasi infrastruktur dikelola melalui runbook teknis tersendiri.')
    dest=OUT/f'RTICore_Manual_{role.title()}.pdf'
    doc=SimpleDocTemplate(str(dest),pagesize=(595.28,841.89),leftMargin=47,rightMargin=47,topMargin=48,bottomMargin=61,title=f'RTICore - Panduan {name}',author='RTICore',pageCompression=1)
    doc.role=role;doc.build(story,onFirstPage=footer,onLaterPages=footer)
    reader=PdfReader(dest)
    assert len(reader.pages)>=6
    assert all(len(page.extract_text().strip())>100 for page in reader.pages)
    flow_pages=[i for i,page in enumerate(reader.pages) if 'Diagram alur /' in page.extract_text()]
    assert len(flow_pages)==1
    manifest.append({'role':role,'file':dest.name,'pages':len(reader.pages),'menu_count':len(selected),'flow_page':flow_pages[0]+1})
    pdf=pdfium.PdfDocument(str(dest))
    for i in range(len(pdf)):
        image=pdf[i].render(scale=.85).to_pil().convert('RGB')
        image.save(TMP/f'{role}_{i+1:02}.png')
    pdf.close()
(TMP/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
# Every page included in contact sheets for visual inspection.
for role in ROLE:
    files=sorted(TMP.glob(f'{role}_*.png'))
    thumbs=[]
    for file in files:
        im=Image.open(file).convert('RGB');im.thumbnail((238,337))
        tile=Image.new('RGB',(258,367),'#dfe6ee');tile.paste(im,((258-im.width)//2,8));ImageDraw.Draw(tile).text((10,348),file.stem,fill='black');thumbs.append(tile)
    sheet=Image.new('RGB',(258*4,367*((len(thumbs)+3)//4)),'white')
    for i,im in enumerate(thumbs):sheet.paste(im,((i%4)*258,(i//4)*367))
    sheet.save(TMP/f'contact-{role}.jpg')
print(json.dumps(manifest,indent=2))
