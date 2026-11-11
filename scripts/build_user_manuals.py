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
ROLE={'admin':'Administrator','marketing':'Marketing','sales':'Sales','presales':'Presales / Solution','finance':'Finance','approver':'Approver','legal':'Legal','project_manager':'Project Manager','viewer':'Viewer'}
# Read the actual sidebar definition rather than maintaining a second menu matrix.
nav=(ROOT/'src/lib/enterprise-navigation.ts').read_text(encoding='utf-8')
# Every role-set constant, in source order, so spreads such as TENDER=[...PRESALES,'sales'] resolve.
sets={}
def expand(body):
    roles=re.findall(r"'([^']+)'",body)
    for name in re.findall(r'\.\.\.(\w+)',body): roles+=sets[name]
    return list(dict.fromkeys(roles))
for k,v in re.findall(r'const (\w+): BoQRole\[\] = \[([^\]]+)\]',nav): sets[k]=expand(v)
menus=[]
for label,path,expr in re.findall(r"item\('([^']+)','([^']+)',(\[[^\]]*\]|\w+)\)",nav):
    allowed=expand(expr) if expr.startswith('[') else sets[expr].copy()
    menus.append((label,path,allowed))
# The manual must list exactly the navigation: every item parsed and none silently empty.
assert len(menus)==nav.count("item('"), 'Ada item navigasi yang gagal dibaca'
assert all(roles for _,_,roles in menus), 'Ada menu tanpa role setelah parsing'

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
 task('Memverifikasi PO sebelum Closed Won','/sales/pipeline',[
  'Buka Opportunity Pipeline, pilih Opportunity pada tahap Pending PO, lalu buka Detail Opportunity.',
  'Pastikan BoQ approved telah terhubung pada bagian BoQ & Persetujuan Terkait dan nomor quotation sama dengan BoQ tersebut.',
  'Cocokkan nomor PO, tanggal PO, referensi dokumen dan nilai PO sebelum PPN pada section 06 dengan dokumen asli di Vault dan nilai quotation final.',
  'Klik Verifikasi PO (Finance/Approver). Baca dialog konfirmasi dan lanjutkan hanya bila dokumen asli, nomor, tanggal, scope dan nilai sebelum PPN sudah diperiksa.',
  'Periksa catatan PO diverifikasi oleh akun Anda beserta waktunya. Bila Sales mengubah data PO setelah itu, verifikasi lama batal dan pemeriksaan harus diulang.'
 ],'Verifikasi PO tercatat dengan identitas pemeriksa dan menjadi syarat Sales menutup Closed Won.',
  'Finance tidak dapat mengubah field Opportunity, nilai pipeline atau tahap. Koreksi data PO dilakukan Sales pemilik lalu diverifikasi ulang.'),
 task('Menyusun milestone dan menerima BAST','/sales/delivery',[
  'Buka Service Delivery & Projects dan pilih proyek dari Opportunity Closed Won. Periksa nomor PO, nilai kontrak dan baseline proyek.',
  'Buat milestone penagihan: judul, pemicu (trigger), tanggal jatuh tempo dan nilai. Total seluruh milestone tidak boleh melebihi nilai PO.',
  'Ubah milestone hanya selama status masih draft. Milestone accepted tidak dapat diubah.',
  'Setelah pekerjaan diserahkan, unggah BAST asli ke Vault sebagai dokumen supporting, lalu terima milestone dengan memilih dokumen tersebut.',
  'Penerima BAST harus berbeda dari pembuat milestone. Bila Anda pembuat milestone, minta Finance, Presales atau Admin lain menerima BAST.'
 ],'Milestone accepted dengan BAST asli menjadi dasar sah pembuatan invoice.',
  'Assignment PM, task delivery serta aktivasi dan penyelesaian proyek dikelola Presales/Admin. Setiap perubahan dikunci versi proyek; muat ulang bila muncul konflik versi.'),
 task('Memproses invoice dan collection','/sales/billing',['Pilih proyek/milestone yang didukung BAST atau penerimaan yang telah ditandatangani dan diperiksa.','Buat draft invoice sesuai nilai milestone/PO yang diterima. Periksa nomor, pajak, tanggal dan nominal sebelum diajukan.','Minta reviewer independen menyetujui draft. Periksa status approved sebelum menjadikannya dasar collection.','Catat draft penerimaan bank sesuai bukti pembayaran, termasuk pembayaran sebagian. Ajukan untuk persetujuan independen.','Periksa outstanding/overdue dan rekonsiliasi. Koreksi pembayaran yang disetujui melalui reversal yang tersedia dan direview; jangan menimpa riwayat.'],'Invoice, pembayaran dan saldo dapat direkonsiliasi ke bukti penerimaan.','Invoice kumulatif dibatasi nilai yang diterima/PO; collection tidak boleh melampaui gross invoice approved. Invoice atau penerimaan kas tidak otomatis menjadi revenue.'),
 task('Mencatat dan meninjau revenue','/sales/revenue',[
  'Buka Revenue Register dan pilih Opportunity Closed Won yang memiliki PO tervalidasi dan paket approved aktif.',
  'Gunakan formulir pencatatan revenue. Isi tanggal pengakuan (tidak sebelum tanggal PO dan tidak di masa depan), nilai sebelum PPN (maksimal 2 desimal), referensi GL, nomor invoice dan referensi BAST.',
  'Isi SHA-256 bukti pendukung dari Vault serta catatan minimal 12 karakter, lalu simpan sebagai draft.',
  'Minta Finance, Approver atau Admin lain mereview. Sebagai reviewer, Anda hanya dapat memutuskan entri yang tidak Anda buat dengan catatan minimal 12 karakter.',
  'Untuk koreksi, gunakan Reversal terhadap entri approved. Setelah approved, tautkan revenue ke invoice approved di workspace proyek; alokasi tidak boleh melebihi nilai invoice.'
 ],'Revenue diakui dengan bukti, tidak melampaui PO, dan dapat direkonsiliasi ke invoice.',
  'Invoice dan penerimaan kas tidak otomatis menjadi revenue. Entri approved tidak diedit; gunakan reversal.'),
 task('Mengelola kontrak, renewal dan FlexGuard','/sales/renewals',[
  'Buka Contracts & Renewal dan pilih kontrak proyek yang masih draft.',
  'Isi model kontrak (OTC, MRC, managed service, license, retainer atau FlexGuard), tanggal mulai dan akhir, notice period 1-365 hari, MRR, nilai renewal, probabilitas renewal serta risiko churn beserta alasannya. Kontrak OTC wajib memiliki MRR nol.',
  'Minta Finance, Approver atau Admin lain menyetujui kontrak. Anda dapat menyetujui kontrak yang dikonfigurasi orang lain dengan catatan minimal 12 karakter.',
  'Untuk kontrak aktif, perbarui penilaian risiko churn atau tandai churn dengan alasan yang jelas. Opportunity renewal/expansion dibuat oleh Sales/Admin.',
  'Untuk kontrak FlexGuard aktif, buka FlexGuard Token Wallet, buat wallet dengan jumlah entitlement, lalu minta Approver/Admin lain mengaktifkannya. Posting ISSUE, TOPUP, REFUND atau EXPIRY memerlukan request key unik dan alasan minimal 12 karakter.'
 ],'Kontrak aktif memiliki parameter renewal yang dapat dipantau dan saldo token FlexGuard tercatat di ledger.',
  'Kontrak approved tidak dapat ditimpa. Ledger FlexGuard immutable; koreksi dilakukan dengan event baru, bukan menghapus riwayat.'),
 task('Costing feasibility dan validasi vendor','/sales/feasibility',[
  'Buka Resource & Solution Feasibility dari Opportunity yang akan dihitung biayanya.',
  'Daftarkan profil engineer bila belum ada: nama, email, keahlian, kapasitas person-day per bulan dan HPP harian.',
  'Tambahkan cost line: jenis biaya, deskripsi, SKU untuk lisensi, satuan, kuantitas, jumlah periode dan harga satuan. Bila memakai penawaran vendor, pilih offer yang sudah tervalidasi dan pastikan harga, satuan, kapasitas serta masa berlakunya cocok.',
  'Di Tender Compliance, validasi atau tolak data vendor dan penawaran vendor yang dibuat orang lain, serta review klausul kategori commercial dengan status compliant, partial, non_compliant atau not_applicable. Perubahan di modul ini hanya dapat dilakukan selama Opportunity berada pada tahap prospecting sampai solution design.',
  'Review rencana feasibility yang dibuat Presales: setujui hanya bila laporan kesiapan tanpa gap; isi catatan minimal 12 karakter.'
 ],'Biaya solusi dan kapasitas resource tervalidasi sebelum BoQ diajukan.',
  'Reviewer tidak boleh menyetujui plan, biaya atau alokasi yang dibuatnya sendiri. Plan dan alokasi engineer dibuat Presales/Admin.'),
 task('Mencatat biaya aktual dan membaca laporan','/reports',[
  'Buka Enterprise Reports. Pilih jenis laporan: pipeline, marketing, deal intelligence, gross margin atau profitability. Gross margin dan profitability khusus Finance/Admin.',
  'Pilih periode dan kolom (maksimal 15). Simpan definisi laporan bila sering digunakan, atau unduh CSV.',
  'Catat biaya aktual per Opportunity dan periode: kategori (vendor, labor, license, travel, cloud, other), nilai rupiah bulat, referensi bukti, SHA-256 dan catatan minimal 12 karakter.',
  'Minta Finance/Admin lain mereview biaya. Sebagai reviewer, putuskan hanya biaya yang tidak Anda buat.',
  'Koreksi biaya approved dengan entri reversal yang memiliki kategori dan nilai yang sama.'
 ],'Profitabilitas dihitung dari revenue approved dikurangi biaya aktual approved.',
  'Margin profitability bersifat provisional sampai seluruh biaya direkonsiliasi. Gross margin adalah estimasi dari BoQ approved, bukan realisasi.'),
 task('Meninjau timesheet proyek','/psa/timesheets',[
  'Buka Project Timesheets dan pilih proyek.',
  'Periksa tanggal, menit kerja, alokasi, penanda billable dan deskripsi pekerjaan setiap entri submitted.',
  'Isi catatan review minimal 12 karakter, lalu pilih Setujui atau Tolak. Entri milik Anda sendiri tidak dapat Anda review.',
  'Muat ulang untuk memastikan status berubah. Entri yang ditolak dapat diajukan ulang oleh pemiliknya setelah koreksi.'
 ],'Jam kerja proyek terverifikasi secara independen.',
  'Timesheet tidak otomatis diposting ke General Ledger atau payroll.'),
 task('Mengelola General Ledger','/erp/general-ledger',[
  'Pastikan Anda memiliki capability grant finance_gl yang disetujui untuk legal entity terkait. Tanpa grant, modul menolak akses.',
  'Pilih legal entity. Tambahkan akun Chart of Accounts (kode, nama, kategori asset, liability, equity, revenue atau expense) dan buka periode akuntansi bila belum ada.',
  'Buat draft jurnal pada periode open: memo minimal 12 karakter, source key, sumber (manual, ar, ap, expense atau reversal), 2-100 baris yang masing-masing hanya debit atau kredit, dan total debit sama dengan kredit dalam satuan sen.',
  'Minta Approver mengesahkan jurnal. Setelah approved oleh orang lain, posting jurnal dari akun Finance.',
  'Untuk koreksi, buat reversal atas jurnal posted. Untuk tutup buku, ajukan close periode setelah semua jurnal posted dan seimbang; Approver memutuskan close.'
 ],'Jurnal posted seimbang, dapat ditelusuri ke sumber dan disahkan secara independen.',
  'Pembuat jurnal tidak dapat mengesahkan jurnalnya sendiri. Periode dengan jurnal draft atau approved belum dapat diajukan close.'),
 task('Treasury dan Accounts Payable','/erp/procurement',[
  'Pastikan Anda memiliki capability grant finance_ap untuk legal entity terkait.',
  'Di Procurement & Accounts Payable, buat budget per legal entity dan periode dengan batas nilai, lalu minta Approver menyetujuinya.',
  'Setelah PO pengadaan approved dan barang/jasa diterima, catat supplier invoice: nomor invoice supplier, kuantitas, dokumen asli dari Vault dan jatuh tempo. Nilai dihitung otomatis dari kuantitas dikali harga PO.',
  'Minta Approver mereview supplier invoice. Di Treasury & Payments, daftarkan rekening bank dalam format tersamar (contoh **1234), lalu ajukan pembayaran untuk supplier invoice approved.',
  'Pantau status: Approver menyetujui pembayaran, Admin lain mencatat bukti bank, lalu Approver mengonfirmasi settlement.'
 ],'Hutang usaha dan pembayaran supplier dapat ditelusuri dari budget, PO, penerimaan, invoice hingga bukti bank.',
  'Aplikasi tidak mengeksekusi transfer bank. Requisition, PO dan penerimaan barang dibuat Presales/Admin; Finance tidak menyetujui transaksinya sendiri.')],
'approver':[REVIEW,
 task('Memutuskan kesiapan dan pengecualian','/sales/bid-readiness',['Buka transaksi dari Approval Center atau modul asal. Pastikan dokumen sumber dan versi masih sesuai.','Untuk tender, tinjau alasan bid, kesiapan persyaratan dan gap teknis/komersial sebelum merekam keputusan yang tersedia.','Periksa rencana resource dan bukti vendor pada Feasibility. Jangan menyamakan kapasitas rencana dengan ketersediaan yang sudah disetujui.','Berikan catatan keputusan yang menjelaskan alasan dan tindak lanjut. Hindari self-approval dan mintalah reviewer lain jika Anda pembuat.','Muat ulang sumber dan periksa status. Untuk jenis yang tidak tercakup antrean, periksa langsung modul terkait.'],'Keputusan dapat dipertanggungjawabkan terhadap sumber dan pemeriksa.','Approver tidak memperoleh hak menulis seluruh modul hanya karena menu tersedia.'), SUBREVIEW,
 task('Meninjau transaksi operasional dan keuangan','/sales/billing',['Untuk invoice, periksa BAST/penerimaan, nilai milestone, PO, pajak serta batas kumulatif sebelum keputusan.','Untuk penerimaan bank, periksa invoice approved, bukti bank dan saldo. Tinjau reversal terhadap transaksi asal bila ada.','Untuk timesheet, periksa alokasi, tanggal dan durasi; catatan review minimal 12 karakter. Gunakan Setujui/Tolak dan pastikan bukan entri Anda sendiri.','Untuk kontrak, periksa jenis, tanggal, nilai bulanan dan ketentuan renewal sebelum persetujuan yang diizinkan.','Untuk ERP, cocokkan unit organisasi, scope legal entity dan capability grant yang telah disetujui sebelum tindakan review.'],'Review mencakup bukti dan batas transaksi, bukan sekadar tampilan status.','Biaya pada timesheet mengikuti kontrol modul tersendiri. Jangan menganggap semua akses biaya sama dengan akses HPP BoQ.'),
 task('Membaca dashboard untuk pengawasan','/sales/executive',['Pilih periode dan filter yang diperlukan di Executive Dashboard.','Cocokkan pipeline, forecast, revenue dan collection menurut definisi masing-masing.','Telusuri angka ke transaksi sumber melalui menu yang tersedia. Periksa apakah daftar dibatasi atau data gagal dimuat.','Tindak lanjuti gap dengan owner dan catat keputusan di modul terkait.'],'Pengawasan menggunakan definisi metrik dan cakupan data yang benar.','Forecast bukan revenue yang diakui dan collection bukan otomatis pengakuan revenue.')],
'legal':[VAULT, AWARD,
 task('Meninjau konteks penawaran dan komunikasi','/customers',['Buka Customer 360 dan pilih customer yang terkait dengan transaksi yang diperiksa.','Cocokkan identitas badan usaha, stakeholder dan hubungan Opportunity yang dapat diakses.','Buka Communication Timeline untuk memeriksa konteks komunikasi dan Submission & Proposal Evidence untuk bukti versi penawaran.','Periksa lingkup dan ketentuan komersial di BoQ/berkas penawaran tanpa meminta akses HPP yang tidak diberikan kepada Legal.','Sampaikan ketidaksesuaian melalui catatan review dan koordinasikan koreksi dengan owner Sales.'],'Pemeriksaan legal memiliki konteks customer dan versi penawaran.','Legal tidak menjadi reviewer Finance atau Approver BoQ hanya karena dapat membuka dokumen.'),
 task('Meninjau dan menyetujui kontrak layanan','/sales/renewals',[
  'Buka Contracts & Renewal dan pilih kontrak draft yang terkait dengan customer dan Opportunity yang tepat.',
  'Unduh dokumen asli dari Vault. Periksa para pihak, model kontrak (OTC, MRC, managed service, license, retainer atau FlexGuard), tanggal mulai dan akhir, notice period, kewajiban, lingkup serta ketentuan perpanjangan.',
  'Cocokkan konfigurasi kontrak di aplikasi dengan dokumen. Bila berbeda, minta pembuat konfigurasi (Sales/Finance) memperbaikinya sebelum disetujui.',
  'Setujui kontrak yang dikonfigurasi orang lain dengan catatan review minimal 12 karakter. Kontrak yang Anda konfigurasi sendiri tidak dapat Anda setujui.',
  'Pantau status renewal: kontrak berstatus renewal due bila sisa hari sampai tanggal akhir sudah sama atau kurang dari notice period kontrak tersebut. Opportunity renewal/expansion dibuat Sales/Admin dan memerlukan persetujuan baru.'
 ],'Kontrak aktif sesuai dokumen yang direview dan dipantau terhadap notice period-nya.',
  'Legal tidak mengonfigurasi kontrak, tidak mengubah risiko churn dan tidak membuat Opportunity renewal. Kontrak approved tidak dapat ditimpa.'),
 task('Legal hold, retensi dan audit Vault','/sales/documents',[
  'Buka Secure Document Vault dari Opportunity yang sedang diperiksa.',
  'Unggah dokumen yang menjadi kewenangan Legal: NDA atau dokumen supporting hukum. Format yang diterima: PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB. Setelah Closed Won hanya dokumen supporting yang dapat ditambahkan.',
  'Pasang legal hold pada dokumen yang harus dibekukan untuk audit atau sengketa, dengan alasan minimal 15 karakter. Dokumen dengan legal hold tetap dapat dibuka walaupun masa retensinya terlampaui.',
  'Lepaskan legal hold hanya bila dasar hukumnya selesai, juga dengan alasan minimal 15 karakter. Pelepasan legal hold hanya dapat dilakukan role Legal.',
  'Buka audit log akses dokumen untuk melihat siapa mengunggah atau mengunduh dokumen dan kapan. Perubahan retensi atau hold atas dokumen yang Anda unggah sendiri harus dilakukan orang lain.'
 ],'Dokumen yang relevan secara hukum terlindungi dan setiap akses tercatat.',
  'Penetapan tanggal retensi hanya oleh Admin dan retensi tidak dapat diperpendek. Legal tidak mengunggah dokumen paket penjualan seperti quotation, RKS atau KAK.'),
 task('Mendaftarkan dan meninjau persyaratan tender','/sales/procurement',[
  'Buka Procurement & Supplier dari Opportunity tender atau non-tender.',
  'Daftarkan dokumen persyaratan yang menjadi kewenangan Anda, misalnya NDA: jenis, judul, ringkasan persyaratan minimal 15 karakter, referensi arsip dan SHA-256 dari Vault.',
  'Review requirement buatan orang lain yang bukan RKS, KAK, RFP, RFQ, technical atau vendor quote (misalnya NDA, commercial dan clarification). Pilih status compliance dan isi catatan minimal 8 karakter. Referensi arsip dan SHA-256 wajib tersedia sebelum review.',
  'Di Tender Compliance, review klausul kategori administrative dengan status compliant, partial, non_compliant atau not_applicable, selama Opportunity masih pada tahap prospecting sampai solution design.',
  'Di Bid Readiness, review item checklist administratif yang dibuat orang lain, lalu unduh CSV compliance matrix, checklist atau bid readiness report bila diperlukan.'
 ],'Persyaratan hukum dan administratif tender tercatat dan direview independen.',
  'RKS, KAK, RFP, RFQ dan technical direview Presales/Admin; vendor quote oleh Finance/Admin; keputusan GO/NO-GO oleh Approver/Admin. Pembuat tidak mereview miliknya sendiri.'),
 task('Mengelola Partnership Agreement','/partners',[
  'Pastikan vendor sudah tervalidasi dan masih berlaku di Tender Compliance, dan dokumen perjanjian asli sudah diunggah sebagai supporting di Vault pada Opportunity yang sama.',
  'Buka Vendor & Partner Records, buat record jenis agreement: vendor, judul, Opportunity, dokumen Vault, tanggal mulai dan akhir, nomor perjanjian serta ketentuan minimal 12 karakter.',
  'Minta Legal atau Admin lain mereview. Sebagai reviewer, setujui atau tolak agreement buatan orang lain dengan catatan minimal 12 karakter.',
  'Persetujuan ditolak bila perjanjian sudah kedaluwarsa atau checksum dokumen Vault tidak lagi cocok. Unggah ulang dokumen yang benar dan buat record baru bila perlu.'
 ],'Perjanjian kemitraan tercatat dengan dokumen asli dan review independen.',
  'Legal tidak melihat data pembelian dan evaluasi vendor (data biaya) dan tidak mengelola lisensi atau pembelian.')],
'project_manager':[
 task('Menerima penugasan dan membuka proyek','/sales/delivery',[
  'Presales/Admin menetapkan akun Anda sebagai PM pada draft proyek melalui form Assignment PM & jadwal (atau otomatis dari rencana Feasibility approved yang memuat satu PM). Tanpa penugasan, daftar proyek Anda kosong.',
  'Buka Service Delivery & Projects. Pemilih proyek hanya berisi Opportunity Closed Won yang menetapkan Anda sebagai PM.',
  'Periksa ringkasan proyek: layanan, status, versi, nomor PO, nilai kontrak, PM, tanggal mulai dan selesai.',
  'Baca Scope baseline approved: scope teknis, spesifikasi, kuantitas, deliverable, model delivery, lokasi, PIC proyek, timeline, durasi, SKU/lisensi, service level, termin dan model kontrak. Baseline adalah acuan; perubahan scope melalui alur yang disetujui, bukan diubah di proyek.',
  'Bila jadwal atau PIC tidak sesuai, minta Presales/Admin memperbaiki assignment selama proyek masih draft.'
 ],'PM mengetahui baseline, jadwal dan nilai proyek yang menjadi acuan delivery.',
  'PM tidak dapat menugaskan PM, mengubah jadwal assignment atau membuat handover Won lama. Budget HPP, BoQ dan CRM tidak tersedia untuk PM.'),
 task('Menyelesaikan kickoff dan mengaktifkan proyek','/sales/delivery',[
  'Unggah bukti kickoff (notulen, daftar hadir, konfirmasi timeline) ke Vault sebagai dokumen supporting melalui panel Vault di halaman delivery atau Secure Document Vault.',
  'Pada setiap task kickoff yang pending, isi catatan pelaksanaan minimal 12 karakter, parameter layanan yang diminta form, target selesai dan pilih dokumen Vault.',
  'Centang Tandai selesai dengan evidence lalu simpan. Task hanya dapat diselesaikan dengan dokumen supporting asli pada Opportunity yang sama dan setelah tahap prasyaratnya selesai.',
  'Setelah assignment, jadwal dan seluruh checklist kickoff selesai, klik Aktifkan setelah kickoff lengkap.',
  'Muat ulang dan pastikan status proyek berubah menjadi active serta versi bertambah.'
 ],'Proyek aktif dengan checklist kickoff yang memiliki bukti.',
  'Setiap perubahan dikunci versi proyek. Bila muncul pesan versi berubah (HTTP 409), muat ulang lalu ulangi.'),
 task('Menjalankan deliverable dan laporan layanan','/sales/delivery',[
  'Kerjakan task layanan sesuai urutan prasyarat, misalnya VAPT: scope, pengujian, laporan, retest; SOC: log, SLA, laporan; GRC: assessment, gap, remediasi; teknologi: lisensi, implementasi, dukungan.',
  'Untuk setiap task, isi parameter dan catatan, lalu selesaikan dengan dokumen evidence dari Vault.',
  'Untuk SOC/MDR, tambahkan laporan bulanan dengan periode YYYY-MM yang berada di dalam jadwal proyek; satu laporan per bulan kontrak.',
  'Pantau tabel Kickoff & service deliverables: status, target dan pengguna yang menyelesaikan.',
  'Setelah semua task (dan seluruh laporan SOC bulanan) selesai, klik Selesaikan proyek.'
 ],'Setiap deliverable selesai dengan bukti dan proyek dapat ditutup.',
  'Proyek completed tidak dapat diubah lagi. Task yang sudah done tidak dapat dibuka ulang.'),
 task('Mengusulkan milestone dan menerima BAST','/sales/delivery',[
  'Tambahkan milestone: nama, trigger pembayaran (misalnya BAST ditandatangani), nilai sebelum PPN dan target. Total semua milestone tidak boleh melebihi nilai PO.',
  'Perbaiki milestone yang masih draft melalui Lengkapi milestone. Milestone accepted terkunci.',
  'Setelah serah terima, unggah BAST asli yang ditandatangani pelanggan ke Vault sebagai dokumen supporting.',
  'Terima BAST hanya untuk milestone yang dibuat pengguna lain (misalnya Finance): pilih milestone dan dokumen BAST lalu klik Terima BAST.',
  'Untuk milestone yang Anda buat, minta Finance, Presales atau Admin lain menerima BAST. Milestone accepted menjadi dasar invoice Finance.'
 ],'Milestone accepted dengan BAST asli siap ditagih oleh Finance.',
  'PM tidak membuat invoice, mencatat pembayaran, mereview keuangan atau mengakui revenue.'),
 task('Mereview timesheet tim proyek','/psa/timesheets',[
  'Buka Project Timesheets dan pilih proyek. Proyek yang Anda pimpin menampilkan seluruh entri tim.',
  'Periksa tanggal, durasi (menit), alokasi, penanda billable dan keterangan pekerjaan terhadap rencana kerja.',
  'Isi catatan review minimal 12 karakter, lalu pilih Setujui atau Tolak untuk entri submitted.',
  'Untuk mencatat jam Anda sendiri, pilih alokasi aktif milik Anda, isi tanggal, menit kelipatan 15 (15-480), billable dan keterangan minimal 12 karakter.',
  'Entri milik Anda direview Finance, Approver atau PM lain. Muat ulang untuk melihat status terbaru.'
 ],'Jam kerja tim terverifikasi oleh PM proyek secara independen.',
  'PM hanya mereview proyek yang dipimpinnya, tidak mereview entri sendiri dan tidak melihat snapshot biaya. Timesheet tidak otomatis menjadi payroll atau jurnal GL.'),
 task('Mengelola pemakaian token FlexGuard','/flexguard',[
  'Buka FlexGuard Token Wallet. Daftar hanya berisi wallet dari kontrak proyek yang Anda pimpin.',
  'Periksa status wallet (harus active), masa berlaku dan saldo: issued, available, reserved, consumed dan expired.',
  'RESERVE token untuk pekerjaan yang dijadwalkan, dengan Opportunity Won milik customer wallet. RELEASE reservasi yang batal dengan event sumbernya.',
  'Setelah layanan diberikan, DEBIT token dengan ID dokumen supporting asli dari Vault sebagai bukti delivery.',
  'Setiap event memakai request key unik dan justifikasi minimal 12 karakter. Kesalahan dikoreksi dengan event baru, bukan menghapus riwayat.'
 ],'Konsumsi token layanan tercatat pada ledger dengan bukti delivery.',
  'ISSUE, TOPUP, REFUND dan EXPIRY dilakukan Finance/Admin; aktivasi wallet oleh Approver/Admin.'),
 task('Menyimpan evidence di Document Vault','/sales/documents',[
  'Buka Secure Document Vault dan pilih proyek (hanya proyek yang Anda pimpin).',
  'Pilih jenis Supporting Document lalu unggah file asli (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB).',
  'Periksa pesan sukses: versi dan awalan SHA-256 dokumen. File historis tidak ditimpa saat revisi.',
  'Gunakan dokumen tersebut sebagai evidence task, BAST milestone atau bukti DEBIT FlexGuard.',
  'Unduh dokumen library proyek (misalnya RKS/KAK atau NDA) sebagai referensi scope bila diperlukan.'
 ],'Evidence delivery tersimpan asli, berversi dan dapat ditelusuri.',
  'PM tidak membuka paket komersial (proposal, negosiasi, PO/SPK), tidak mengatur retensi atau legal hold dan tidak membuka audit log.')],
'viewer':[
 task('Membaca BoQ yang diizinkan','/boq',['Masuk dengan akun Viewer aktif lalu buka BoQ Management.','Pilih dokumen dari daftar yang disediakan aplikasi. Periksa nomor quotation, customer, proyek, layanan, status dan versi.','Baca item, jumlah, harga jual serta total yang ditampilkan. Bedakan draft, submitted, approved dan rejected.','Jika ada pertanyaan, sampaikan nomor dokumen dan versi kepada owner melalui kanal kerja yang disepakati.','Muat ulang untuk melihat status terbaru. Jika dokumen tidak tampil atau ditolak, minta Admin memeriksa cakupan akses.'],'Pengguna mengetahui status serta rincian BoQ yang boleh dibaca.','Viewer bersifat baca saja: tidak membuat/mengubah BoQ, mengisi HPP, mengajukan atau memutuskan approval, dan tidak mengelola pengguna.'),
 task('Memahami batas akses Viewer','/boq',['Gunakan hanya menu yang ditampilkan bagi akun Anda; daftar menu role ini terbatas pada BoQ Management.','Jangan menganggap halaman lain terbuka hanya karena menerima tautannya dari rekan kerja.','Jika membutuhkan fungsi operasional, ajukan perubahan role melalui penanggung jawab dan Admin sesuai kebutuhan pekerjaan.','Jika unduhan atau rincian tidak tersedia, gunakan informasi yang diberikan aplikasi dan minta pemilik data menyiapkan keluaran yang diizinkan.'],'Kebutuhan akses dapat disampaikan secara jelas tanpa meminjam akun.','HPP dan margin internal tidak diberikan kepada Viewer; jangan memakai akun orang lain untuk melihatnya.')]
}

# Per-menu feature catalog: (fungsi, fitur yang dapat dipakai role ini, batas/kontrol).
# Sourced from the API role checks in src/app/api. The build fails if a menu shown
# to a role with a catalog is missing here, so the manual follows the navigation.
DETAIL={
'finance':{
 '/sales/executive':('Ringkasan pipeline, forecast, booked sales, revenue dan collection untuk pengawasan keuangan.',
  ['Pilih periode dan filter yang tersedia.','Baca pipeline aktif, weighted forecast, booked sales, revenue diakui dan collection.','Telusuri angka ke Opportunity atau modul sumber.'],
  'Baca saja. Forecast bukan revenue diakui dan collection bukan pengakuan revenue.'),
 '/sales/activities':('Kalender aktivitas, SLA dan follow-up tim Sales untuk pemantauan penagihan dan closing.',
  ['Lihat kalender, next action dan antrean overdue seluruh Sales.','Filter kalender per Sales melalui pilihan Kalender per Sales.'],
  'Baca saja. Membuat, menjadwalkan ulang atau menyelesaikan aktivitas dilakukan Sales pemilik atau Admin.'),
 '/sales/forecast':('Proyeksi penjualan dan booked sales per periode dengan sumber yang sama dengan Executive Dashboard.',
  ['Pilih periode dan owner Sales.','Lihat forecast tertimbang, booked, revenue diakui dan isu data per deal.'],
  'Baca saja. Estimasi closing tidak sama dengan PO terverifikasi.'),
 '/customers':('Customer 360: profil pelanggan beserta Opportunity, kontrak dan transaksi terkait.',
  ['Cari dan pilih customer.','Lihat stakeholder, Opportunity, status komersial dan delivery dalam satu tampilan.'],
  'Finance membaca. Perubahan master customer dilakukan Sales pemilik atau Admin.'),
 '/sales/pipeline':('Daftar Opportunity per tahap dan Detail Opportunity 360.',
  ['Filter berdasarkan tahap dan buka detail, journey gate, BoQ terhubung dan checklist Post-PO.','Tombol Verifikasi PO (Finance/Approver) pada tahap Pending PO untuk mencatat pemeriksaan PO terhadap BoQ approved.','Unduh quotation Word bila BoQ approved sudah terhubung.'],
  'Finance tidak dapat mengubah field, nilai pipeline atau tahap Opportunity. Verifikasi PO batal bila data PO diubah kemudian.'),
 '/sales/compliance':('Register persyaratan tender, data vendor, penawaran vendor dan klausul compliance.',
  ['Daftarkan atau revisi vendor: identitas, kemampuan, kapasitas, masa berlaku dan bukti dengan SHA-256.','Catat penawaran vendor untuk Opportunity.','Validasi, tolak atau suspend vendor dan validasi penawaran vendor (khusus Finance/Admin).','Review klausul kategori commercial dengan status compliance.'],
  'Pembuat data tidak boleh mereview datanya sendiri. Perubahan hanya pada tahap prospecting sampai solution design. Klausul administratif direview Legal/Presales/Admin; klausul teknis dan vendor oleh Presales/Admin.'),
 '/sales/bid-readiness':('Checklist kesiapan tender sebelum submission.',
  ['Lihat checklist dan bukti per item.','Review item non-teknis yang dibuat orang lain.'],
  'Item teknis direview Presales/Admin; deadline tender direview Approver/Admin.'),
 '/sales/feasibility':('Rencana resource, kapasitas engineer dan costing solusi.',
  ['Daftarkan profil engineer dengan kapasitas person-day per bulan dan HPP harian.','Tambah atau hapus cost line, termasuk lisensi dengan SKU dan penawaran vendor tervalidasi.','Setujui atau tolak rencana feasibility dengan catatan minimal 12 karakter.'],
  'Plan dan alokasi engineer dibuat Presales/Admin. Reviewer tidak boleh menyetujui plan, biaya atau alokasi buatannya sendiri; approve hanya bila tidak ada gap kesiapan.'),
 '/boq':('Bill of Quantities penawaran beserta biaya internal (HPP).',
  ['Buat, simpan dan ajukan BoQ.','Isi HPP komponen A-E: A personil, B komisi, C dokumen/deliverables, D tools/vendor/subcon, E travel dan akomodasi.','Lihat HPP, gross profit, margin dan status kelengkapan biaya.','Verifikasi saran HPP A-E yang dibawa dari Smart Scoping (ICOP Pricing Engine) sebelum menyimpan.'],
  'HPP hanya terlihat oleh Finance/Admin. Persetujuan BoQ oleh Approver/Admin lain; margin di bawah 25% memerlukan pengecualian Admin.'),
 '/approvals':('Antrean lintas modul untuk transaksi yang menunggu review independen.',
  ['Antrean Finance mencakup: checklist tender non-teknis, review Finance PO/SPK, resource feasibility, invoice, collection dan kontrak layanan draft.','Hanya entri yang tidak dibuat oleh akun Anda yang ditampilkan.','Gunakan Periksa di sumber untuk membuka modul asal.'],
  'Keputusan diambil di modul sumber. BoQ, deadline tender dan wallet FlexGuard tidak masuk antrean Finance.'),
 '/sales/award':('Pemeriksaan dokumen PO/SPK yang diterima dari pelanggan.',
  ['Lihat dokumen terdaftar dan dokumen asli di Vault.','Rekam Review Finance atas nilai, pajak, termin dan kecocokan dengan penawaran.'],
  'Review Finance hanya sekali per dokumen. Pemeriksa Finance harus berbeda dari pendaftar dan dari pemeriksa Legal.'),
 '/sales/submission':('Bukti pengiriman quotation kepada pelanggan.',
  ['Periksa penerima, kanal, waktu, versi BoQ/quotation dan bukti asli.','Tetapkan verified atau rejected dengan catatan.'],
  'Pemeriksa harus berbeda dari pelapor. Modul ini tidak mengirim email.'),
 '/sales/delivery':('Proyek delivery setelah Won: milestone, BAST, invoice, collection dan kontrak.',
  ['Buat dan ubah milestone draft; total milestone tidak melebihi nilai PO.','Terima BAST milestone dengan dokumen Vault (penerima berbeda dari pembuat milestone).','Buat invoice dari milestone accepted dan catat collection untuk invoice approved, termasuk reversal.','Review invoice dan collection buatan orang lain.','Tautkan invoice ke revenue approved untuk rekonsiliasi.'],
  'Assignment PM, task delivery serta aktivasi dan penyelesaian proyek dikelola Presales/Admin. Semua mutasi dikunci versi proyek.'),
 '/psa/timesheets':('Review jam kerja proyek.',
  ['Pilih proyek dan periksa tanggal, menit, alokasi, billable dan deskripsi.','Setujui atau tolak dengan catatan minimal 12 karakter.'],
  'Entri sendiri tidak dapat direview. Tidak diposting otomatis ke General Ledger atau payroll.'),
 '/post-po':('Formulir resmi Post-PO (registrasi pelanggan dan formulir proyek) dari data database.',
  ['Pilih Opportunity dan periksa parameter yang belum lengkap.','Unduh DOCX unsigned dari template resmi.'],
  'Dokumen final ditandatangani di luar aplikasi lalu disimpan ke Vault. Perbaiki data di modul sumber, bukan di DOCX.'),
 '/sales/billing':('Penagihan dan penerimaan pembayaran per proyek.',
  ['Buat draft invoice dari milestone dengan BAST accepted: nomor, tanggal terbit, jatuh tempo, nilai, PPN dan dokumen asli.','Catat penerimaan bank untuk invoice approved, termasuk pembayaran sebagian dan reversal.','Pantau outstanding dan overdue; review invoice/collection buatan orang lain.'],
  'Tanggal terbit invoice tidak boleh di masa depan. Maker tidak boleh mereview sendiri. Invoice dan kas tidak otomatis menjadi revenue.'),
 '/sales/revenue':('Register pengakuan revenue per Opportunity Won.',
  ['Catat revenue dengan tanggal pengakuan, nilai sebelum PPN, referensi GL, invoice, BAST, SHA-256 bukti dan catatan.','Buat reversal atas revenue approved.','Review revenue buatan orang lain.'],
  'Memerlukan Closed Won dengan PO tervalidasi. Total revenue dibatasi nilai PO. Maker tidak boleh mereview sendiri.'),
 '/sales/renewals':('Kontrak layanan, renewal dan risiko churn.',
  ['Konfigurasi kontrak draft: model, periode, notice period, MRR, nilai renewal, probabilitas dan risiko churn.','Setujui kontrak yang dikonfigurasi orang lain.','Perbarui risiko churn atau tandai churn pada kontrak aktif.'],
  'Kontrak approved tidak dapat ditimpa. Opportunity renewal/expansion dibuat Sales/Admin.'),
 '/flexguard':('Wallet token layanan FlexGuard dengan ledger immutable.',
  ['Buat wallet entitlement untuk kontrak FlexGuard aktif (status draft).','Posting ISSUE, TOPUP, REFUND dan EXPIRY dengan request key unik dan alasan.','Lihat saldo dan riwayat event.'],
  'Wallet aktif setelah disetujui Approver/Admin lain. RESERVE, RELEASE dan DEBIT dilakukan Sales/Presales.'),
 '/partners':('Catatan vendor, OEM dan partner.',
  ['Lihat seluruh record termasuk pembelian dan evaluasi (data biaya hanya untuk Finance/Admin) serta skor kinerja vendor.','Buat record profile, license, purchase dan evaluation.','Setujui atau tolak record buatan orang lain sesuai kewenangan.','Proses pembelian: order, penerimaan kumulatif dan pembatalan; unduh CSV.'],
  'Agreement direview Legal/Admin. Persetujuan license dan agreement memerlukan dokumen Vault asli yang belum kedaluwarsa.'),
 '/sales/procurement':('Permohonan bid, register RKS/KAK dan review persyaratan tender.',
  ['Lihat bid request dan requirement.','Review requirement sebagai reviewer independen; requirement jenis vendor quote wajib direview Finance/Admin.'],
  'Bid request dibuat Sales/Admin; keputusan GO, conditional GO atau NO-GO oleh Approver/Admin.'),
 '/reports':('Laporan perusahaan dan register biaya aktual.',
  ['Laporan pipeline, marketing, deal intelligence, gross margin dan profitability (dua terakhir khusus Finance/Admin).','Pilih periode dan kolom (maksimal 15), simpan definisi laporan, unduh CSV.','Catat biaya aktual dengan bukti dan SHA-256, koreksi dengan reversal, dan review biaya buatan orang lain.'],
  'Margin profitability bersifat provisional. Gross margin adalah estimasi dari BoQ approved, bukan realisasi.'),
 '/sales/documents':('Arsip dokumen asli dengan kontrol akses dan checksum.',
  ['Baca dan unduh dokumen sesuai konteks Opportunity.','Unggah dokumen supporting (misalnya BAST atau bukti bayar) setelah Opportunity Closed Won.'],
  'Finance tidak mengunggah dokumen paket penjualan; dokumen paket dikunci setelah Won.'),
 '/erp/general-ledger':('Buku besar per legal entity.',
  ['Kelola Chart of Accounts dan buka periode akuntansi.','Buat draft jurnal seimbang (2-100 baris) dengan sumber manual, ar, ap, expense atau reversal.','Posting jurnal yang disetujui Approver lain; buat reversal jurnal posted.','Ajukan close periode setelah semua jurnal posted dan seimbang.'],
  'Memerlukan grant finance_gl pada legal entity. Persetujuan jurnal dan close periode oleh Approver.'),
 '/erp/treasury':('Rekening bank perusahaan dan pembayaran supplier.',
  ['Daftarkan rekening bank dalam format tersamar.','Ajukan pembayaran untuk supplier invoice AP yang approved.'],
  'Memerlukan grant finance_ap. Persetujuan dan konfirmasi settlement oleh Approver; bukti bank dicatat Admin lain. Aplikasi tidak mengeksekusi transfer bank.'),
 '/erp/procurement':('Budget, PO pengadaan, penerimaan barang/jasa dan hutang usaha (AP).',
  ['Buat budget per legal entity dan periode dengan batas nilai.','Catat supplier invoice terhadap PO approved dengan dokumen Vault dan jatuh tempo.','Lihat PO, penerimaan dan supplier invoice per Opportunity.'],
  'Memerlukan grant finance_ap. Requisition, PO dan penerimaan dibuat Presales/Admin; budget, PO dan AP disetujui Approver. Pembayaran melalui Treasury.'),
},
'legal':{
 '/customers':('Customer 360: identitas badan usaha pelanggan beserta Opportunity, kontrak dan transaksi terkait.',
  ['Cari dan pilih customer.','Cocokkan nama resmi badan usaha, Customer ID, stakeholder dan Opportunity terkait dengan dokumen yang diperiksa.'],
  'Baca saja. Perubahan master customer dilakukan Sales pemilik atau Admin.'),
 '/sales/communications':('Riwayat korespondensi email (EML) dan negosiasi pada Opportunity.',
  ['Baca email yang diimpor beserta header (pengirim, penerima, waktu) dan checksum.','Hubungkan korespondensi dengan catatan negosiasi dan versi paket penawaran.'],
  'Baca saja. Impor email hanya oleh Sales pemilik atau Admin; komunikasi terkunci setelah Opportunity ditutup.'),
 '/sales/compliance':('Matriks compliance klausul RKS/KAK/RFP, data vendor dan penawaran vendor.',
  ['Lihat klausul, jawaban, bukti dan status compliance.','Review klausul kategori administrative buatan orang lain dengan status compliant, partial, non_compliant atau not_applicable.'],
  'Klausul commercial direview Finance/Admin; klausul teknis dan vendor oleh Presales/Admin. Legal tidak membuat klausul dan tidak memvalidasi vendor. Perubahan hanya pada tahap prospecting sampai solution design.'),
 '/sales/bid-readiness':('Checklist kesiapan dokumen tender dan laporan kesiapan bid.',
  ['Lihat checklist, bukti dan gap kesiapan.','Review item checklist administratif buatan orang lain.','Unduh CSV compliance matrix, checklist atau bid readiness report.'],
  'Item teknis direview Presales/Admin dan deadline tender oleh Approver/Admin.'),
 '/sales/feasibility':('Rencana delivery, kapasitas resource dan dukungan vendor.',
  ['Lihat periode delivery, cakupan layanan, alokasi person-day dan masa berlaku penawaran vendor.'],
  'Baca saja. HPP harian engineer, biaya, harga vendor, revenue dan margin disembunyikan untuk Legal.'),
 '/boq':('Rincian BoQ penawaran: item, kuantitas, harga jual, PPN, total dan termin.',
  ['Baca BoQ dan statusnya (draft, submitted, approved, rejected).','Cocokkan nomor quotation, termin dan nilai jual dengan dokumen kontrak atau PO.'],
  'Baca saja. HPP, gross profit dan margin tidak ditampilkan untuk Legal; Legal tidak menyetujui BoQ.'),
 '/approvals':('Antrean review independen lintas modul.',
  ['Antrean Legal berisi dokumen PO/SPK yang belum direview Legal, bukan dibuat oleh Anda dan bukan yang telah Anda review sebagai Finance.','Gunakan Periksa di sumber untuk membuka PO / SPK Verification.'],
  'Klausul tender, checklist, kontrak layanan dan agreement tidak masuk antrean Legal; periksa langsung di modul masing-masing.'),
 '/sales/award':('Review Legal atas dokumen award dari pelanggan: PO, SPK, contract atau award letter.',
  ['Lihat dokumen terdaftar, referensi arsip dan SHA-256 dokumen asli.','Rekam Review Legal: pihak, nomor dokumen, lingkup, ketentuan dan lampiran terhadap penawaran yang disetujui.'],
  'Review Legal hanya dapat diberikan pengguna ber-role Legal (bukan Admin), sekali per dokumen, oleh orang yang berbeda dari pendaftar dan dari pemeriksa Finance. Closed Won memerlukan PO/SPK yang lolos review Finance dan Legal dengan nomor sama dengan PO di Opportunity.'),
 '/sales/submission':('Bukti pengiriman quotation kepada pelanggan.',
  ['Baca penerima, kanal, waktu, versi BoQ dan bukti asli dari Vault.','Lihat status Reported, Verified atau Rejected.'],
  'Baca saja. Verifikasi bukti pengiriman dilakukan Finance/Approver/Admin.'),
 '/post-po':('Formulir resmi Post-PO (registrasi pelanggan dan formulir proyek) dari data database.',
  ['Periksa parameter yang belum lengkap, penandatangan dan ringkasan ketentuan.','Unduh DOCX unsigned dari template resmi.'],
  'Dokumen final ditandatangani di luar aplikasi lalu disimpan ke Vault. Data diperbaiki di modul sumbernya.'),
 '/sales/renewals':('Kontrak layanan, status renewal dan churn.',
  ['Lihat kontrak, model, periode, notice period, nilai renewal dan status renewal (renewal due mengikuti notice period kontrak).','Setujui kontrak draft yang dikonfigurasi orang lain dengan catatan minimal 12 karakter.'],
  'Legal tidak mengonfigurasi kontrak, tidak mengubah risiko churn dan tidak membuat Opportunity renewal/expansion.'),
 '/partners':('Catatan vendor, OEM dan partner.',
  ['Lihat profil partner dan lisensi.','Buat record Partnership Agreement dengan dokumen Vault, periode, nomor perjanjian dan ketentuan.','Setujui atau tolak agreement buatan orang lain.'],
  'Data pembelian dan evaluasi vendor tidak ditampilkan untuk Legal. Persetujuan agreement ditolak bila kedaluwarsa atau checksum dokumen tidak cocok.'),
 '/sales/procurement':('Bid request, register persyaratan (RKS/KAK/NDA dan lainnya) dan review persyaratan.',
  ['Daftarkan requirement, misalnya NDA, dengan referensi arsip dan SHA-256.','Review requirement non-teknis buatan orang lain (misalnya NDA, commercial, clarification).','Lihat keputusan Bid/No-Bid beserta alasannya.'],
  'RKS, KAK, RFP, RFQ dan technical direview Presales/Admin; vendor quote oleh Finance/Admin; keputusan GO/NO-GO oleh Approver/Admin.'),
 '/sales/documents':('Arsip dokumen asli terenkripsi, retensi, legal hold dan audit akses.',
  ['Baca dan unduh dokumen, termasuk dokumen yang melewati masa retensi.','Unggah NDA atau dokumen supporting hukum (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB).','Pasang dan lepaskan legal hold dengan alasan minimal 15 karakter.','Buka audit log akses dokumen per Opportunity.'],
  'Pelepasan legal hold hanya oleh Legal. Penetapan retensi hanya oleh Admin dan tidak dapat diperpendek. Hold atau retensi dokumen yang Anda unggah sendiri diubah oleh orang lain.'),
},
# Project Manager: scope is the delivery project whose pm_email is the user
# (src/app/api/sales/service-operations, psa/timesheets, sales/flexguard, sales/document-vault).
'project_manager':{
 '/sales/delivery':('Eksekusi proyek setelah Closed Won pada proyek yang menetapkan Anda sebagai PM: baseline, kickoff, deliverable, laporan bulanan, aktivasi, penyelesaian serta milestone dan BAST.',
  ['Pemilih proyek hanya menampilkan proyek dengan PM = akun Anda; ringkasan PO, nilai kontrak, jadwal dan Scope baseline approved.','Perbarui task kickoff dan service deliverable: catatan minimal 12 karakter, parameter layanan, target selesai; selesaikan dengan dokumen supporting Vault dan prasyarat tahap sebelumnya.','Tambah laporan bulanan SOC/MDR (periode YYYY-MM di dalam jadwal proyek).','Aktifkan proyek setelah assignment, jadwal dan checklist kickoff lengkap; selesaikan proyek setelah seluruh task dan laporan SOC bulanan selesai.','Tambah dan ubah milestone draft (total tidak melebihi nilai PO); terima BAST milestone buatan orang lain dengan dokumen BAST Vault.'],
  'Assignment PM, jadwal dan handover Won lama oleh Presales/Admin. Invoice, pembayaran, review keuangan, kontrak dan revenue bukan kewenangan PM. Budget HPP disembunyikan. Proyek lain ditolak (HTTP 403).'),
 '/psa/timesheets':('Pencatatan jam kerja dan review timesheet tim proyek.',
  ['Proyek yang Anda pimpin: lihat seluruh entri tim dan Setujui/Tolak entri submitted dengan catatan minimal 12 karakter.','Ajukan jam kerja sendiri pada alokasi aktif: menit kelipatan 15 (15-480), billable, keterangan minimal 12 karakter; tanggal tidak di masa depan.','Proyek lain tempat Anda dialokasikan: hanya entri milik sendiri yang tampil.'],
  'Entri sendiri direview Finance/Approver atau PM lain. Snapshot biaya tidak ditampilkan. Tidak diposting otomatis ke GL atau payroll.'),
 '/flexguard':('Wallet token layanan FlexGuard dari kontrak proyek yang Anda pimpin.',
  ['Lihat saldo issued, available, reserved, consumed, expired dan riwayat event.','Posting RESERVE dan RELEASE untuk Opportunity Won milik customer wallet.','Posting DEBIT dengan dokumen supporting asli sebagai bukti delivery.','Setiap event memakai request key unik dan alasan minimal 12 karakter.'],
  'Wallet dibuat Finance dan diaktifkan Approver/Admin. ISSUE, TOPUP, REFUND dan EXPIRY oleh Finance/Admin. Ledger immutable.'),
 '/sales/documents':('Penyimpanan evidence delivery asli terenkripsi untuk proyek Anda.',
  ['Unggah dokumen supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat.','Baca dan unduh dokumen library proyek (RKS/KAK, NDA, supporting).','Gunakan dokumen sebagai evidence task, BAST milestone atau bukti DEBIT FlexGuard.'],
  'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.'),
}}
# Maker-checker summary: what the role makes, and who must check it.
AUTHORITY={
'finance':[
 ('Mengisi HPP A-E dan mengajukan BoQ','Approver/Admin lain; margin di bawah 25% perlu pengecualian Admin'),
 ('Review Finance PO/SPK','Review Legal terpisah oleh orang berbeda'),
 ('Verifikasi bukti submission quotation','Finance bertindak sebagai pemeriksa; pelapor harus orang lain'),
 ('Verifikasi PO di Opportunity','Finance/Approver/Admin; diulang bila data PO berubah'),
 ('Membuat milestone','Penerima BAST harus berbeda dari pembuat milestone'),
 ('Membuat invoice dan collection','Finance/Approver/Admin lain'),
 ('Mencatat revenue dan reversal','Finance/Approver/Admin lain'),
 ('Konfigurasi kontrak layanan','Finance/Approver/Admin lain'),
 ('Costing dan profil engineer feasibility','Finance/Approver/Admin yang tidak membuat biaya atau alokasi'),
 ('Validasi vendor dan penawaran vendor','Finance/Admin selain pembuat data'),
 ('Mencatat biaya aktual','Finance/Admin lain'),
 ('Membuat wallet FlexGuard','Approver/Admin lain'),
 ('Draft jurnal dan close periode GL','Approver; posting oleh Finance setelah disetujui'),
 ('Budget dan supplier invoice AP','Approver'),
 ('Pengajuan pembayaran treasury','Approver, lalu bukti bank oleh Admin dan settlement oleh Approver'),
],
'legal':[
 ('Review Legal PO/SPK','Review Finance terpisah oleh orang berbeda; pendaftar dokumen tidak boleh mereview'),
 ('Persetujuan kontrak layanan','Konfigurasi kontrak dibuat Sales/Finance lain; Legal tidak menyetujui konfigurasinya sendiri'),
 ('Membuat Partnership Agreement','Legal/Admin lain'),
 ('Mendaftarkan requirement (misalnya NDA)','Reviewer sesuai jenis: Legal/Finance/Approver/Admin lain untuk non-teknis, Presales/Admin untuk teknis'),
 ('Review klausul administrative dan checklist administratif','Klausul atau item dibuat oleh orang lain'),
 ('Memasang atau melepas legal hold','Bukan pengunggah dokumen; pelepasan hanya oleh Legal'),
 ('Mengunggah NDA atau supporting hukum','Hold dan retensi dokumen tersebut diubah oleh Legal/Admin lain'),
],
'project_manager':[
 ('Ditugaskan sebagai PM dan jadwal proyek','Ditetapkan Presales/Admin; PM tidak menugaskan dirinya sendiri'),
 ('Menyelesaikan task kickoff dan deliverable','Wajib dokumen supporting asli di Vault dan prasyarat tahap sebelumnya'),
 ('Mengaktifkan dan menyelesaikan proyek','Gate sistem: checklist kickoff, seluruh task dan laporan SOC bulanan'),
 ('Membuat milestone','BAST diterima Finance, Presales, Admin atau PM lain; bukan pembuat milestone'),
 ('Menerima BAST milestone','Milestone harus dibuat orang lain; invoice kemudian dibuat Finance dan direview Approver/Admin'),
 ('Mereview timesheet tim','Hanya proyek yang dipimpin; entri sendiri direview Finance/Approver atau PM lain'),
 ('Posting RESERVE, RELEASE dan DEBIT FlexGuard','Wallet diaktifkan Approver/Admin; DEBIT wajib bukti delivery asli'),
 ('Mengunggah evidence supporting','Retensi dan legal hold diatur Admin/Legal'),
]}

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
 'project_manager':(['Ditugaskan sebagai PM oleh Presales/Admin','Baca baseline scope, PO dan jadwal','Lengkapi kickoff dengan evidence Vault','Aktifkan proyek; kerjakan deliverable','Evidence dan prasyarat lengkap?','Usulkan milestone; BAST diterima pihak lain','Review timesheet tim; tutup proyek'],
                    {0:'Presales / Admin',5:'Finance / reviewer lain'},'Lengkapi evidence\natau perbaiki task','Invoice, collection dan revenue dilanjutkan Finance setelah BAST accepted. PM hanya bekerja pada proyek yang menetapkannya sebagai PM.'),
 'viewer':(['Login sebagai Viewer aktif','Buka BoQ Management','Pilih dokumen dalam daftar akses','Baca nomor, versi dan status','Informasi dapat dibaca?','Tinjau rincian dan total yang tampil','Sampaikan pertanyaan ke owner'],
            {},'Minta Admin\nmemeriksa akses','Viewer hanya membaca BoQ yang diizinkan. Tidak membuat, mengubah, mengajukan atau menyetujui transaksi; tidak melihat HPP.')
}

# Governance Team (migration 0050): governance_leader / governance_member.
# Scope = Governance, Risk & Compliance delivery projects with an active resource allocation
# (src/lib/governance-team.ts; API: sales/service-operations, psa/timesheets, sales/document-vault,
# sales/feasibility (Leader, read-only) and /api/sales deal selector).
ROLE['governance_leader']='Governance Team Leader'
ROLE['governance_member']='Governance Team Member'
_GOV_START=task('Menerima alokasi dan membuka engagement GRC','/sales/delivery',[
  'Presales mengalokasikan Anda pada Resource & Solution Feasibility: profil engineer dengan email yang sama dengan email login dan alokasi aktif per bulan pada Opportunity GRC.',
  'Setelah Opportunity Closed Won dan draft proyek tersedia, buka Service Delivery & Projects. Pemilih proyek hanya berisi engagement Governance, Risk & Compliance (Cybersecurity Governance, GRC / Risk, ISO 27001 / 27701, PDP, DPO, IT Audit, IT Governance, ICOFR, BCM / BCP / DRP, Third Party Risk) yang mengalokasikan Anda.',
  'Periksa ringkasan proyek: layanan, status, versi, PM dan jadwal. Nilai PO, termin pembayaran dan model kontrak sengaja tidak ditampilkan.',
  'Baca Scope baseline approved: scope teknis, spesifikasi, kuantitas, deliverable, lokasi, PIC, timeline, durasi dan service level. Perubahan scope melalui PM/Presales, bukan di proyek.',
  'Tunggu PM menyelesaikan kickoff dan mengaktifkan proyek. Selama proyek draft, task GRC belum dapat dikerjakan.'
 ],'Anggota tim mengetahui engagement, baseline dan jadwal yang menjadi acuan pekerjaan GRC.',
 'Proyek di luar kelompok GRC atau tanpa alokasi aktif ditolak (HTTP 403). CRM, BoQ, HPP, nilai PO, invoice dan kontrak tidak tersedia.')
_GOV_EVIDENCE=task('Menyimpan evidence dan kertas kerja di Document Vault','/sales/documents',[
  'Buka Secure Document Vault dan pilih engagement GRC Anda.',
  'Pilih jenis Supporting Document lalu unggah file asli (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB): evidence assessment, kertas kerja, gap report, risk register, remediation plan atau laporan akhir.',
  'Periksa pesan sukses: versi dan awalan SHA-256 dokumen. Revisi tersimpan sebagai versi baru, file lama tidak ditimpa.',
  'Unduh dokumen library proyek (RKS/KAK, NDA, supporting) sebagai referensi scope bila diperlukan.'
 ],'Evidence engagement tersimpan asli, berversi dan dapat dipilih saat task diselesaikan.',
 'Unggahan hanya jenis supporting setelah Closed Won. Paket komersial (proposal, negosiasi, PO/SPK), retensi, legal hold dan audit log tidak tersedia.')
_GOV_TIME=task('Mencatat jam kerja engagement','/psa/timesheets',[
  'Buka Project Timesheets lalu pilih engagement GRC yang aktif.',
  'Pilih alokasi aktif milik sendiri, tanggal kerja (tidak di masa depan, di dalam bulan alokasi dan jadwal proyek), menit kelipatan 15 (15-480), billable dan keterangan pekerjaan minimal 12 karakter.',
  'Klik Simpan dan ajukan review; entri berstatus submitted.',
  'Pantau riwayat: status approved/rejected, reviewer dan versi entri.'
 ],'Jam kerja tercatat pada alokasi yang benar dan menunggu review independen.',
 'Snapshot biaya/tarif harian tidak ditampilkan. Timesheet tidak diposting otomatis ke GL atau payroll. Pembuat entri tidak dapat mereview entrinya sendiri.')
WORK['governance_leader']=[_GOV_START,
 task('Mengerjakan dan menyelesaikan tahapan GRC','/sales/delivery',[
  'Kerjakan task sesuai urutan prasyarat: Assessment dan evidence, lalu Gap analysis, lalu Remediation dan action plan. Untuk ISO 27001/27701, PDP, DPO, IT Audit, IT Governance, ICOFR, BCM dan Third Party Risk, task berupa Deliverable dan acceptance layanan.',
  'Isi parameter per tahap: standar/regulasi acuan dan domain/unit (assessment); gap dan referensi kontrol serta prioritas/tingkat risiko (gap); remediation action plan, pemilik action plan dan target penyelesaian (remediation). Tambahkan catatan pelaksanaan minimal 12 karakter dan target selesai.',
  'Periksa progres yang disimpan Member, lengkapi bila perlu, lalu pilih dokumen supporting dari Vault.',
  'Centang Tandai selesai dengan evidence (Leader) lalu simpan. Sistem menolak bila tahap prasyarat belum selesai atau dokumen bukan supporting asli pada Opportunity yang sama.',
  'Pantau tabel Kickoff & service deliverables. Setelah semua tahap selesai, informasikan PM agar proyek dapat ditutup.'
 ],'Setiap tahapan GRC selesai dengan evidence dan dapat ditelusuri ke Leader yang menyelesaikannya.',
 'Kickoff, aktivasi, penutupan proyek, milestone dan BAST tetap milik PM. Task yang sudah done tidak dapat dibuka ulang. Konflik versi (HTTP 409): muat ulang lalu ulangi.'),
 task('Mereview timesheet anggota tim','/psa/timesheets',[
  'Buka Project Timesheets dan pilih engagement GRC yang dialokasikan kepada Anda; seluruh entri tim pada proyek tersebut tampil.',
  'Periksa tanggal, durasi, billable dan keterangan terhadap progres task pada Service Delivery.',
  'Tulis catatan review minimal 12 karakter lalu klik Setujui atau Tolak pada entri submitted milik anggota lain.',
  'Ajukan jam kerja sendiri seperti anggota tim; entri Anda direview Finance, Approver, PM proyek atau Leader lain.'
 ],'Jam kerja tim tervalidasi oleh Leader sebelum dipakai untuk analisis utilisasi.',
 'Leader hanya mereview proyek GRC yang mengalokasikannya dan tidak dapat menyetujui entri sendiri. Biaya tidak ditampilkan.'),
 task('Membaca Feasibility engagement GRC','/sales/feasibility',[
  'Buka Resource & Solution Feasibility lalu pilih Opportunity GRC yang masih terbuka (ditandai sebagai perencanaan pada pemilih).',
  'Baca plan, alokasi engineer per bulan (person-days), kapasitas dan gap readiness.',
  'Sampaikan masukan komposisi tim, kompetensi auditor/konsultan dan jadwal kepada Presales.'
 ],'Leader memahami rencana resource sebelum engagement dimulai.',
 'Hanya baca: plan dan alokasi oleh Presales/Admin, costing oleh Finance, review oleh Finance/Approver. HPP, tarif, revenue dan margin disembunyikan. Opportunity non-GRC atau Closed Lost ditolak.'),
 _GOV_EVIDENCE]
WORK['governance_member']=[_GOV_START,
 task('Mengerjakan tahapan GRC dan menyimpan progres','/sales/delivery',[
  'Pilih task GRC yang pending pada proyek aktif: Assessment dan evidence, Gap analysis, Remediation dan action plan, atau Deliverable dan acceptance layanan.',
  'Isi catatan pelaksanaan minimal 12 karakter, parameter layanan (standar/regulasi, domain/unit, gap dan kontrol, prioritas risiko, action plan, pemilik, target) dan target selesai.',
  'Klik Simpan. Progres tersimpan dan task tetap pending.',
  'Unggah evidence ke Vault, lalu informasikan Governance Team Leader agar task diselesaikan dengan evidence tersebut.'
 ],'Progres dan parameter assessment tersimpan untuk QA dan penyelesaian oleh Leader.',
 'Member tidak dapat menandai task selesai (HTTP 403) dan tidak mengelola kickoff, aktivasi, milestone atau BAST.'),
 _GOV_TIME,_GOV_EVIDENCE]
_GOV_DETAIL_DELIVERY=lambda leader:('Eksekusi engagement Governance, Risk & Compliance setelah Closed Won dan aktivasi proyek oleh PM, pada proyek yang mengalokasikan Anda.',
  ['Pemilih proyek hanya menampilkan engagement GRC dengan alokasi resource aktif atas email Anda.','Ringkasan proyek dan Scope baseline approved teknis; nilai PO, termin dan model kontrak tidak ditampilkan.',
   'Task Assessment dan evidence, Gap analysis, Remediation dan action plan (atau Deliverable dan acceptance layanan) dengan parameter layanan per tahap; prasyarat berurutan.']
  +(['Menandai task selesai dengan dokumen supporting Vault setelah memeriksa progres Member.'] if leader else ['Menyimpan progres (catatan, parameter, target); penyelesaian task dilakukan Leader.']),
  'Kickoff, aktivasi, penutupan, milestone/BAST, invoice, pembayaran, kontrak dan renewal bukan kewenangan Governance Team. Proyek lain ditolak (HTTP 403).')
_GOV_DETAIL_TIME=lambda leader:('Pencatatan jam kerja engagement GRC'+(' dan review timesheet tim.' if leader else '.'),
  ['Ajukan jam kerja sendiri pada alokasi aktif: menit kelipatan 15 (15-480), billable, keterangan minimal 12 karakter, tanggal tidak di masa depan.']
  +(['Lihat seluruh entri tim pada engagement GRC Anda dan Setujui/Tolak entri submitted dengan catatan minimal 12 karakter.'] if leader else ['Lihat status review entri milik sendiri.']),
  'Entri sendiri tidak dapat direview sendiri. Snapshot biaya tidak ditampilkan. Tidak diposting otomatis ke GL atau payroll.')
_GOV_DETAIL_DOCS=('Penyimpanan evidence engagement GRC asli terenkripsi.',
  ['Unggah dokumen supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat.','Baca dan unduh dokumen library proyek (RKS/KAK, NDA, supporting).','Gunakan dokumen sebagai evidence penyelesaian task GRC.'],
  'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.')
DETAIL['governance_leader']={'/sales/delivery':_GOV_DETAIL_DELIVERY(True),'/psa/timesheets':_GOV_DETAIL_TIME(True),'/sales/documents':_GOV_DETAIL_DOCS,
 '/sales/feasibility':('Membaca rencana resource Opportunity GRC yang masih terbuka (read-only).',
  ['Plan, alokasi engineer per bulan (person-days), kapasitas dan gap readiness.','Bahan masukan komposisi tim dan jadwal kepada Presales.'],
  'Tidak dapat mengubah plan, alokasi, costing atau review. HPP, tarif, revenue dan margin disembunyikan. Hanya Opportunity GRC yang belum Closed Lost.')}
DETAIL['governance_member']={'/sales/delivery':_GOV_DETAIL_DELIVERY(False),'/psa/timesheets':_GOV_DETAIL_TIME(False),'/sales/documents':_GOV_DETAIL_DOCS}
AUTHORITY['governance_leader']=[
 ('Dialokasikan pada engagement GRC','Presales/Admin pada Feasibility; Leader tidak mengalokasikan dirinya sendiri'),
 ('Menandai task GRC selesai dengan evidence','Wajib dokumen supporting asli di Vault, proyek aktif dan prasyarat tahap sebelumnya'),
 ('Mereview timesheet tim','Hanya engagement GRC yang mengalokasikan Leader; entri sendiri direview Finance/Approver, PM atau Leader lain'),
 ('Mengunggah evidence supporting','Retensi dan legal hold diatur Admin/Legal'),
 ('Membaca Feasibility GRC','Read-only; perubahan oleh Presales/Admin dan Finance, review oleh Finance/Approver')]
AUTHORITY['governance_member']=[
 ('Menyimpan progres task GRC','Penyelesaian dengan evidence oleh Governance Team Leader'),
 ('Mengajukan timesheet','Governance Team Leader, PM proyek, Finance atau Approver; bukan pembuat'),
 ('Mengunggah evidence supporting','Dipakai Leader sebagai evidence; retensi dan legal hold diatur Admin/Legal')]
FLOWS['governance_leader']=(['Dialokasikan Presales pada engagement GRC','PM selesaikan kickoff; proyek aktif','Assessment dan evidence','Gap analysis dan prioritas risiko','Evidence dan prasyarat lengkap?','Tandai selesai; remediation plan','Review timesheet tim; serahkan ke PM'],
 {0:'Presales / Admin',1:'Project Manager'},'Lengkapi evidence\natau progres Member','Leader menyelesaikan task GRC dengan evidence Vault. Penutupan proyek, milestone dan BAST dilanjutkan PM; invoice oleh Finance.')
FLOWS['governance_member']=(['Dialokasikan Presales pada engagement GRC','PM selesaikan kickoff; proyek aktif','Kerjakan assessment / gap / remediation','Simpan progres dan unggah evidence','Progres siap diperiksa Leader?','Leader menandai task selesai','Ajukan timesheet; Leader mereview'],
 {0:'Presales / Admin',1:'Project Manager',5:'Governance Team Leader',6:'Governance Team Leader'},'Perbaiki catatan\natau evidence','Member menyimpan progres dan evidence; penyelesaian task dan review timesheet dilakukan Leader.')

# Offense Team (migration 0048): offense_lead / offense_member.
# Scope = Offensive Security delivery projects (VAPT, Red Team / Adversary Simulation, Attack Surface
# Management) with an active resource allocation (src/lib/offense-team.ts; API: sales/service-operations,
# psa/timesheets, sales/document-vault; sales/feasibility read-only for the Leader).
ROLE['offense_lead']='Offense Team Leader'
ROLE['offense_member']='Offense Team Member'
_OFF_START=task('Membuka engagement yang dialokasikan','/sales/delivery',[
  'Presales mengalokasikan Anda pada rencana Resource & Solution Feasibility (email engineer harus sama dengan email login). Tanpa alokasi aktif, daftar engagement kosong.',
  'Setelah Opportunity Closed Won dan draft proyek tersedia, buka Service Delivery & Projects. Pemilih proyek hanya berisi engagement Offensive Security (VAPT, Red Team / Adversary Simulation, Attack Surface Management) yang mengalokasikan Anda.',
  'Baca Scope baseline approved: scope teknis, spesifikasi, kuantitas aset, deliverable, model delivery, lokasi, PIC, timeline dan service level. Nilai PO, termin dan budget tidak ditampilkan.',
  'Buka Secure Document Vault untuk membaca RKS/KAK, NDA dan dokumen otorisasi/rules of engagement. Lakukan pengujian hanya pada aset dan testing window yang tercatat.',
  'Task engagement baru dapat dikerjakan setelah PM menyelesaikan checklist kickoff dan mengaktifkan proyek.'
 ],'Anda mengetahui scope, otorisasi dan jadwal engagement sebelum pengujian dimulai.',
 'Kickoff, aktivasi, milestone/BAST dan penutupan proyek dikelola PM/Presales. Engagement di luar alokasi Anda ditolak (HTTP 403).')
_OFF_VAULT=task('Menyimpan evidence engagement','/sales/documents',[
  'Buka Secure Document Vault dan pilih engagement Anda.',
  'Pilih jenis Supporting Document lalu unggah file asli: hasil scan, bukti temuan terotorisasi, laporan VAPT atau hasil retest (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB). Unggahan hanya setelah Closed Won.',
  'Periksa pesan sukses: versi dan awalan SHA-256 dokumen. File historis tidak ditimpa saat revisi.',
  'Jangan menyimpan kredensial, data pribadi pelanggan atau payload berbahaya mentah di luar yang disepakati rules of engagement.'
 ],'Evidence engagement tersimpan asli, berversi dan dapat ditelusuri.',
 'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.')
WORK['offense_lead']=[_OFF_START,
 task('Memimpin pengujian dan menyelesaikan task','/sales/delivery',[
  'Kerjakan task sesuai urutan prasyarat: VAPT scope (aset, testing window, metodologi/RoE), VAPT testing (aset diuji, temuan dan tingkat risiko), VAPT report (versi laporan final, penerima), VAPT retest (scope retest, hasil dan residual risk).',
  'Periksa progres yang disimpan anggota tim pada catatan dan parameter task; lengkapi bila perlu (catatan minimal 12 karakter dan target selesai).',
  'Pastikan evidence asli sudah diunggah ke Vault, lalu pilih dokumen tersebut dan centang Tandai selesai dengan evidence (Leader).',
  'Sistem menolak penyelesaian bila tahap sebelumnya belum selesai atau dokumen bukan supporting asli Opportunity yang sama.',
  'Setelah seluruh task engagement selesai, informasikan PM agar milestone/BAST dan penutupan proyek diproses.'
 ],'Setiap tahap engagement selesai dengan evidence dan siap diserahkan ke PM.',
 'Task kickoff dan task non-VAPT dikelola PM/Presales. Task done tidak dapat dibuka ulang. Konflik versi (HTTP 409): muat ulang lalu ulangi.'),
 task('Mereview timesheet tim','/psa/timesheets',[
  'Buka Project Timesheets dan pilih engagement. Seluruh entri tim pada engagement Offensive yang mengalokasikan Anda ditampilkan.',
  'Periksa tanggal, durasi, alokasi, penanda billable dan keterangan pekerjaan terhadap rencana pengujian.',
  'Isi catatan review minimal 12 karakter, lalu pilih Setujui atau Tolak untuk entri submitted milik anggota tim.',
  'Catat jam kerja Anda sendiri pada alokasi aktif (menit kelipatan 15, maksimal 480, keterangan minimal 12 karakter); entri Anda direview Finance, Approver atau PM proyek.'
 ],'Jam kerja tim terverifikasi oleh Leader secara independen.',
 'Leader tidak mereview entri sendiri dan tidak melihat snapshot biaya. Timesheet tidak otomatis menjadi payroll atau jurnal GL.'),
 task('Membaca rencana kapasitas (Feasibility)','/sales/feasibility',[
  'Buka Resource & Solution Feasibility dan pilih Opportunity Offensive Security yang masih terbuka.',
  'Baca estimasi kebutuhan person-days (aset x PD per aset x (1 + retest%) + PM/QA), rentang tanggal delivery, status plan dan reviewer.',
  'Periksa Resource Capacity Calendar: alokasi engineer per bulan dan pemakaian kapasitas lintas proyek.',
  'Sampaikan usulan komposisi tim, skill dan kapasitas kepada Presales; alokasi dibuat Presales/Admin.'
 ],'Leader mengetahui beban tim sebelum engagement baru dimulai.',
 'Baca saja. HPP, tarif engineer, cost line, penawaran supplier dan margin tidak ditampilkan; Leader tidak membuat atau mereview plan.'),
 _OFF_VAULT]
WORK['offense_member']=[_OFF_START,
 task('Melaksanakan pengujian dan menyimpan progres','/sales/delivery',[
  'Kerjakan pengujian sesuai scope, testing window dan rules of engagement yang tercatat.',
  'Pada task VAPT yang pending, isi catatan pelaksanaan minimal 12 karakter, parameter layanan (aset diuji, temuan dan tingkat risiko, hasil retest) dan target selesai, lalu simpan progres.',
  'Unggah evidence ke Vault, lalu informasikan Offense Team Leader agar task diselesaikan dengan evidence tersebut.',
  'Pantau status task pada tabel Kickoff & service deliverables.'
 ],'Progres pengujian tercatat dan siap diperiksa Leader.',
 'Member tidak menandai task selesai. Task kickoff dan non-VAPT dikelola PM/Presales.'),
 task('Mencatat jam kerja','/psa/timesheets',[
  'Buka Project Timesheets dan pilih engagement Anda.',
  'Pilih alokasi aktif milik Anda, isi tanggal (tidak di masa depan dan di dalam jadwal proyek), menit kelipatan 15 (15-480), penanda billable dan keterangan minimal 12 karakter.',
  'Klik Simpan dan ajukan review, lalu pastikan status submitted muncul pada riwayat.',
  'Entri ditinjau Offense Team Leader, PM proyek, Finance atau Approver. Entri yang ditolak dapat diajukan ulang sesuai koreksi.'
 ],'Jam kerja pengujian tercatat terhadap alokasi engagement.',
 'Hanya entri milik sendiri yang terlihat; snapshot biaya tidak ditampilkan.'),
 _OFF_VAULT]
_OFF_DETAIL_DELIVERY=lambda leader:('Eksekusi teknis engagement Offensive Security setelah Closed Won dan aktivasi proyek oleh PM, pada proyek yang mengalokasikan Anda.',
  ['Pemilih proyek hanya menampilkan engagement VAPT, Red Team / Adversary Simulation dan Attack Surface Management yang mengalokasikan Anda.','Baca Scope baseline approved tanpa nilai PO, termin pembayaran atau model kontrak.',
   'Perbarui task VAPT scope, testing, report dan retest: catatan minimal 12 karakter, parameter layanan dan target selesai.']+
  (['Tandai task selesai dengan dokumen supporting asli dari Vault; prasyarat tahap sebelumnya ditegakkan sistem.'] if leader else ['Simpan progres; penyelesaian task dengan evidence dilakukan Offense Team Leader.']),
  'Kickoff, aktivasi, penutupan, milestone/BAST, invoice, pembayaran, kontrak dan renewal bukan kewenangan Offense Team. Proyek lain ditolak (HTTP 403).')
_OFF_DETAIL_TIME=lambda leader:('Pencatatan jam kerja engagement'+(' dan review timesheet tim.' if leader else '.'),
  ['Ajukan jam kerja sendiri pada alokasi aktif: menit kelipatan 15 (15-480), billable, keterangan minimal 12 karakter; tanggal tidak di masa depan.']+
  (['Lihat seluruh entri tim pada engagement Offensive yang mengalokasikan Anda; Setujui/Tolak entri submitted milik orang lain dengan catatan minimal 12 karakter.'] if leader else ['Lihat riwayat dan status entri milik sendiri.']),
  ('Entri sendiri direview Finance/Approver atau PM proyek.' if leader else 'Review oleh Offense Team Leader, PM proyek, Finance atau Approver.')+' Snapshot biaya tidak ditampilkan. Tidak diposting otomatis ke GL atau payroll.')
_OFF_DETAIL_DOCS=('Penyimpanan evidence engagement asli terenkripsi.',
  ['Unggah dokumen supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat.','Baca dan unduh dokumen library engagement (RKS/KAK, NDA, rules of engagement, supporting).','Dokumen menjadi pilihan evidence saat Leader menyelesaikan task.'],
  'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.')
DETAIL['offense_lead']={'/sales/delivery':_OFF_DETAIL_DELIVERY(True),'/psa/timesheets':_OFF_DETAIL_TIME(True),'/sales/documents':_OFF_DETAIL_DOCS,
 '/sales/feasibility':('Rencana kapasitas engagement Offensive Security yang masih terbuka (baca saja).',
  ['Lihat estimasi person-days, tanggal delivery, status plan, reviewer dan gap kesiapan.','Lihat alokasi engineer per bulan dan pemakaian kapasitas lintas proyek.','Lihat engineer aktif, skills dan kapasitas PD per bulan.'],
  'Tidak membuat plan, alokasi, resource atau cost line dan tidak mereview plan. HPP, tarif engineer, cost line, penawaran supplier dan margin tidak ditampilkan.')}
DETAIL['offense_member']={'/sales/delivery':_OFF_DETAIL_DELIVERY(False),'/psa/timesheets':_OFF_DETAIL_TIME(False),'/sales/documents':_OFF_DETAIL_DOCS}
AUTHORITY['offense_lead']=[
 ('Dialokasikan pada engagement','Alokasi dibuat Presales/Admin pada Feasibility; Leader tidak mengalokasikan dirinya sendiri'),
 ('Menyelesaikan task VAPT','Wajib dokumen supporting asli di Vault dan prasyarat tahap sebelumnya; proyek diaktifkan PM'),
 ('Mereview timesheet tim','Hanya engagement yang mengalokasikan Leader; bukan entri sendiri'),
 ('Mengajukan timesheet sendiri','Finance, Approver atau PM proyek'),
 ('Mengunggah evidence supporting','Retensi dan legal hold diatur Admin/Legal')]
AUTHORITY['offense_member']=[
 ('Menyimpan progres task VAPT','Penyelesaian dengan evidence oleh Offense Team Leader'),
 ('Mengajukan timesheet','Offense Team Leader, PM proyek, Finance atau Approver; bukan pembuat'),
 ('Mengunggah evidence supporting','Dipakai Leader sebagai evidence; retensi dan legal hold diatur Admin/Legal')]
FLOWS['offense_lead']=(['Dialokasikan Presales pada engagement Offensive','PM selesaikan kickoff; proyek aktif','Scope, RoE dan pengujian tim','Laporan VAPT dan retest','Evidence dan prasyarat lengkap?','Tandai task selesai dengan evidence','Review timesheet tim; serahkan ke PM'],
 {0:'Presales / Admin',1:'Project Manager'},'Lengkapi evidence\natau progres Member','Leader menyelesaikan task VAPT dengan evidence Vault. Penutupan proyek, milestone dan BAST dilanjutkan PM; invoice oleh Finance.')
FLOWS['offense_member']=(['Dialokasikan Presales pada engagement Offensive','PM selesaikan kickoff; proyek aktif','Uji aset sesuai scope dan RoE','Simpan progres dan unggah evidence','Progres siap diperiksa Leader?','Leader menandai task selesai','Ajukan timesheet; Leader mereview'],
 {0:'Presales / Admin',1:'Project Manager',5:'Offense Team Leader',6:'Offense Team Leader'},'Perbaiki catatan\natau evidence','Member menyimpan progres dan evidence; penyelesaian task dan review timesheet dilakukan Leader.')

# SOC Defense Team / Blue Team (migration 0049): defense_leader / defense_member.
# Scope = ERP capability cyber_ops: approved staff placement + approved cyber_ops grant on the legal unit
# of an approved SOC/DFIR project scope (src/lib/defense-team.ts; API: erp/cyber-operations,
# erp/security-integrations, psa/timesheets, sales/document-vault, sales?entity=deals).
ROLE['defense_leader']='Defense Team Leader (SOC)'
ROLE['defense_member']='Defense Team Member (SOC Analyst)'
_DEF_ACCESS=task('Menyiapkan akses SOC Defense','/erp/cyber-operations',[
  'Minta Admin mengajukan penempatan staff Anda pada unit organisasi dan capability cyber_ops pada legal entity proyek SOC/DFIR (Organization & ERP Access). Approver lain harus menyetujui keduanya.',
  'Pastikan proyek SOC/MDR, DFIR, Incident Response atau Managed Security memiliki scope legal entity yang sudah disetujui (Ajukan/Review Scope Project).',
  'Buka Cybersecurity Operations. Board SOC Defense menampilkan tabel proyek dalam grant Anda beserta Project ID. Jika tabel kosong, grant atau scope belum disetujui.',
  'Gunakan Project ID dari tabel saat membuka case baru, dan Case ID/versi dari board saat memproses case.'
 ],'Board SOC Defense menampilkan proyek yang dapat Anda tangani.',
 'Role saja tidak membuka data apa pun: tanpa grant cyber_ops yang disetujui pihak independen, API menolak (HTTP 403). CRM, BoQ, harga, billing dan desk ERP lain tidak tersedia.')
_DEF_OPEN=task('Membuka case insiden SOC/DFIR','/erp/cyber-operations',[
  'Pada form Transaksi dan approval pilih Buka Case.',
  'Isi Project ID, referensi case unik (ID alert/ticket SIEM, 3-120 karakter), jenis soc_incident (proyek SOC/MDR) atau dfir_incident (proyek DFIR/IR/Managed Security), judul 8-240 karakter, severity dan klasifikasi restricted/confidential.',
  'Klik Simpan lalu Muat Ulang Database; case baru berstatus open versi 1.',
  'Proyek harus berstatus aktif dan family-nya sesuai jenis case; referensi yang sama pada proyek dan jenis yang sama ditolak.'
 ],'Case tercatat dengan pembuat, waktu dan severity, siap ditriage Leader.',
 'Defense Team tidak membuka vapt_finding (milik tim Offense/Presales). Case tidak dapat dihapus atau diubah judul/severity-nya setelah dibuat.')
_DEF_VAULT=task('Menyimpan evidence investigasi di Vault','/sales/documents',[
  'Buka Secure Document Vault; pemilih Opportunity hanya berisi proyek SOC/DFIR dalam grant Anda.',
  'Pilih jenis Supporting Document lalu unggah file asli: export log, timeline, screenshot konsol, laporan insiden atau memo containment (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB). Unggahan hanya setelah Closed Won.',
  'Catat ID dokumen yang tampil pada daftar dokumen; ID inilah yang diisi pada form kirim investigasi atau review QA.',
  'Jangan mengunggah kredensial, token atau data pribadi mentah di luar yang disepakati kontrak layanan.'
 ],'Evidence asli tersimpan terenkripsi, berversi dan ber-SHA-256.',
 'Paket komersial (proposal, negosiasi, PO/SPK), retensi, legal hold dan audit log tidak tersedia; dikelola Admin/Legal.')
_DEF_TIME=task('Mencatat jam kerja SOC','/psa/timesheets',[
  'Buka Project Timesheets dan pilih proyek tempat Anda memiliki alokasi resource aktif.',
  'Pilih alokasi, isi tanggal (tidak di masa depan), menit kelipatan 15 (15-480), penanda billable dan uraian monitoring/triage/investigasi minimal 12 karakter.',
  'Klik Simpan dan ajukan review; status submitted muncul pada riwayat.'
 ],'Jam kerja analis tercatat terhadap alokasi proyek.',
 'Hanya entri sendiri; review oleh PM proyek, Finance atau Approver. Snapshot biaya tidak ditampilkan.')
WORK['defense_leader']=[_DEF_ACCESS,_DEF_OPEN,
 task('Triage dan menugaskan investigasi','/erp/cyber-operations',[
  'Buka Board SOC Defense, bagian Antrean Tim. Case diurutkan dari critical, high, medium, low sampai informational.',
  'Pada case open yang belum ditugaskan, pilih analis Defense Team aktif lalu klik Tugaskan. Analis wajib memiliki grant cyber_ops pada legal entity proyek.',
  'Untuk memindahkan case ke analis lain sebelum disubmit, pilih analis baru lalu klik Tugaskan Ulang.',
  'Status penugasan berubah menjadi assigned dan case muncul di Antrean Saya milik analis.'
 ],'Setiap case open memiliki analis penanggung jawab.',
 'Hanya case soc_incident/dfir_incident berstatus open. Investigasi yang sudah disubmit harus dikembalikan dulu sebelum ditugaskan ulang. Konflik versi (HTTP 409): muat ulang.'),
 task('QA investigasi: kembalikan atau review','/erp/cyber-operations',[
  'Pada case berstatus submitted, baca catatan investigasi analis dan unduh evidence dari Vault.',
  'Jika belum memadai, isi alasan minimal 12 karakter lalu klik Kembalikan ke Analis; status menjadi returned dan catatan tampil di antrean analis.',
  'Jika memadai, isi catatan QA minimal 12 karakter lalu klik Setujui (reviewed) atau Tolak (rejected). Evidence analis dipakai otomatis; untuk case tanpa penugasan isi ID dokumen supporting Vault.',
  'Sistem menolak bila Anda pembuat case, analis yang menyelidiki, atau investigasi belum disubmit.'
 ],'Case memiliki keputusan QA independen dengan evidence asli.',
 'Reviewer ≠ pembuat case ≠ analis. Keputusan review tidak dapat diubah.'),
 task('Menutup case dan eskalasi ke SIEM/EDR','/erp/security-integrations',[
  'Pada Antrean Tim, klik Tutup Case untuk case reviewed yang direview orang lain; sistem memvalidasi ulang evidence asli.',
  'Untuk eskalasi, buka SIEM / EDR Integrations, masukkan Legal Entity ID dan Muat Ulang Database untuk melihat konektor enabled.',
  'Pilih Antrekan Cyber Case (Connector ID + Case ID), lalu Kirim Outbound dengan Dispatch ID. Periksa status delivered/retryable dan HTTP code.',
  'Dispatch gagal dapat dikirim ulang hingga 5 percobaan; payload hanya berisi metadata case, tanpa kredensial.'
 ],'Case selesai tercatat closed dan, bila perlu, terkirim ke SIEM/EDR.',
 'Penutup ≠ reviewer. Registrasi konektor oleh Admin dan aktivasi oleh Approver; endpoint wajib HTTPS dalam allowlist.'),
 _DEF_VAULT,_DEF_TIME]
WORK['defense_member']=[_DEF_ACCESS,_DEF_OPEN,
 task('Menyelidiki dan mengirim hasil investigasi','/erp/cyber-operations',[
  'Buka Board SOC Defense, bagian Antrean Saya; berisi case open yang ditugaskan kepada Anda.',
  'Lakukan investigasi pada konsol SIEM/EDR pelanggan sesuai kontrak; unggah evidence ke Vault dan catat ID dokumennya (tautan Unggah bukti tersedia per case).',
  'Isi catatan investigasi 12-2.000 karakter: ringkasan temuan, timeline, IOC, aset terdampak dan tindakan containment/rekomendasi, lalu isi ID dokumen Vault.',
  'Klik Kirim Investigasi; status penugasan menjadi submitted dan menunggu QA Leader.',
  'Jika dikembalikan (returned), baca catatan Leader, perbaiki lalu kirim ulang.'
 ],'Hasil investigasi lengkap dengan evidence siap di-review Leader.',
 'Hanya analis yang ditugaskan yang dapat mengirim. Member tidak menugaskan, me-review atau menutup case.'),
 task('Memantau eskalasi SIEM/EDR','/erp/security-integrations',[
  'Buka SIEM / EDR Integrations, isi Legal Entity ID lalu Muat Ulang Database.',
  'Periksa konektor (siem/edr, status) dan dispatch case (status, attempt, HTTP code terakhir).',
  'Laporkan dispatch rejected atau retryable berulang kepada Defense Team Leader.'
 ],'Analis mengetahui status eskalasi case ke SIEM/EDR.',
 'Baca saja; antre dan kirim outbound oleh Leader, Presales atau Admin.'),
 _DEF_VAULT,_DEF_TIME]
_DEF_DETAIL_OPS=lambda leader:('Board SOC Defense dan register case insiden SOC/DFIR dengan alur penugasan, investigasi, QA dan penutupan.',
  ['Tabel proyek SOC/DFIR dalam grant cyber_ops beserta Project ID, customer, layanan dan status.','Buka case soc_incident/dfir_incident: referensi unik, judul, severity, klasifikasi.','Antrean Saya: case open yang ditugaskan kepada Anda, termasuk catatan pengembalian Leader.']+
  (['Antrean Tim terurut severity: tugaskan/tugaskan ulang analis, kembalikan investigasi, review QA (reviewed/rejected) dan tutup case reviewed.'] if leader else ['Kirim hasil investigasi (catatan 12-2.000 karakter + ID dokumen Vault) dan kirim ulang setelah dikembalikan.']),
  'Hanya case SOC/DFIR; vapt_finding milik tim Offense/Presales. Maker-checker: reviewer bukan pembuat atau analis; penutup bukan reviewer. Case dan penugasan tidak dapat dihapus; konflik versi HTTP 409.')
_DEF_DETAIL_SIEM=lambda leader:('Konektor SIEM/EDR per legal entity dan riwayat dispatch case.',
  ['Lihat konektor (nama, jenis siem/edr, status, pembuat, reviewer).','Lihat dispatch (case, status, attempt, HTTP code, waktu).']+
  (['Antrekan case ke konektor enabled dan kirim outbound (Idempotency-Key, maksimal 5 percobaan).'] if leader else []),
  'Registrasi konektor oleh Admin, aktivasi oleh Approver independen. Endpoint HTTPS dalam allowlist; token di Secrets, tidak pernah tampil.'+('' if leader else ' Member hanya membaca.'))
_DEF_DETAIL_TIME=('Pencatatan jam kerja analis SOC pada alokasi resource aktif.',
  ['Ajukan entri sendiri: tanggal, menit kelipatan 15 (15-480), billable, uraian minimal 12 karakter.','Lihat riwayat dan status entri sendiri.'],
  'Review oleh PM proyek, Finance atau Approver. Snapshot biaya tidak ditampilkan; tidak diposting otomatis ke GL atau payroll.')
_DEF_DETAIL_DOCS=('Evidence investigasi asli terenkripsi pada Opportunity proyek SOC/DFIR dalam grant.',
  ['Unggah dokumen supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat.','Unduh dokumen library proyek.','ID dokumen dipakai pada kirim investigasi dan review QA.'],
  'Paket komersial, retensi, legal hold dan audit log tidak tersedia.')
DETAIL['defense_leader']={'/erp/cyber-operations':_DEF_DETAIL_OPS(True),'/erp/security-integrations':_DEF_DETAIL_SIEM(True),'/psa/timesheets':_DEF_DETAIL_TIME,'/sales/documents':_DEF_DETAIL_DOCS}
DETAIL['defense_member']={'/erp/cyber-operations':_DEF_DETAIL_OPS(False),'/erp/security-integrations':_DEF_DETAIL_SIEM(False),'/psa/timesheets':_DEF_DETAIL_TIME,'/sales/documents':_DEF_DETAIL_DOCS}
AUTHORITY['defense_leader']=[
 ('Membuka case SOC/DFIR','Leader lain atau Approver me-review; pembuat tidak me-review case sendiri'),
 ('Menugaskan / mengembalikan investigasi','Analis yang ditugaskan wajib anggota Defense aktif dengan grant cyber_ops; pengembali bukan analis'),
 ('Review QA case','Investigasi wajib submitted; reviewer bukan pembuat case dan bukan analis'),
 ('Menutup case reviewed','Penutup bukan reviewer; evidence asli divalidasi ulang'),
 ('Antre/kirim dispatch SIEM/EDR','Konektor diregistrasi Admin dan diaktifkan Approver independen'),
 ('Mengajukan timesheet sendiri','PM proyek, Finance atau Approver')]
AUTHORITY['defense_member']=[
 ('Membuka case SOC/DFIR','Defense Team Leader atau Approver me-review secara independen'),
 ('Mengirim hasil investigasi','Defense Team Leader mengembalikan atau me-review; analis tidak me-review case sendiri'),
 ('Mengunggah evidence supporting','Dipakai sebagai bukti QA; retensi dan legal hold diatur Admin/Legal'),
 ('Mengajukan timesheet','PM proyek, Finance atau Approver')]
FLOWS['defense_leader']=(['Grant cyber_ops disetujui Admin + Approver','Alert SIEM menjadi case open','Triage severity; tugaskan analis','Analis menyelidiki dan submit evidence','Investigasi memadai?','Review QA: reviewed / rejected','Tutup case; eskalasi SIEM/EDR'],
 {0:'Admin / Approver',3:'Defense Team Member'},'Kembalikan ke analis\ndengan alasan','Leader melakukan triage, QA independen dan penutupan. Reviewer bukan pembuat case maupun analis; penutup bukan reviewer.')
FLOWS['defense_member']=(['Grant cyber_ops disetujui Admin + Approver','Buka case insiden SOC/DFIR','Leader menugaskan case kepada Anda','Investigasi; unggah evidence ke Vault','Investigasi lengkap?','Kirim investigasi untuk QA','Leader me-review dan menutup case'],
 {0:'Admin / Approver',2:'Defense Team Leader',6:'Defense Team Leader'},'Lengkapi temuan,\nIOC atau evidence','Member menyelidiki case yang ditugaskan dan mengirim temuan dengan evidence asli; review QA dan penutupan dilakukan Leader.')

# IT Developer Team (migration 0051): itdev_leader / itdev_member.
# Delivery scope = Technology & Implementation projects with an active resource allocation
# (src/lib/itdev-team.ts; API: sales/service-operations, psa/timesheets, sales/document-vault,
# sales/feasibility (Leader, read-only), /api/sales deal selector). Platform scope = read-only
# /api/platform/diagnostics (health for both; technical audit trail for the Leader).
ROLE['itdev_leader']='IT Developer Team Leader'
ROLE['itdev_member']='IT Developer Team Member'
_DEV_START=task('Menerima alokasi dan membuka proyek implementasi','/sales/delivery',[
  'Presales mengalokasikan Anda pada Resource & Solution Feasibility: profil engineer dengan email yang sama dengan email login dan alokasi aktif per bulan pada Opportunity Technology & Implementation.',
  'Setelah Opportunity Closed Won dan draft proyek tersedia, buka Service Delivery & Projects. Pemilih proyek hanya berisi proyek Technology & Implementation (Cybersecurity Technology, SIEM / SOAR, IAM / PAM, Network / Endpoint, Cloud Security, Data Security / DLP, DevSecOps / Secure Code Review, OT / ICS, Security Hardening) yang mengalokasikan Anda.',
  'Periksa ringkasan proyek: layanan, status, versi, PM dan jadwal. Nilai PO, termin pembayaran dan model kontrak sengaja tidak ditampilkan.',
  'Baca Scope baseline approved: scope teknis, spesifikasi, kuantitas, SKU/lisensi, deliverable, model delivery, lokasi, PIC, timeline, durasi dan service level. Perubahan scope melalui PM/Presales.',
  'Tunggu PM menyelesaikan kickoff dan mengaktifkan proyek. Selama proyek draft, task implementasi belum dapat dikerjakan.'
 ],'Engineer mengetahui proyek, baseline teknis dan jadwal yang menjadi acuan implementasi.',
 'Proyek di luar kelompok Technology & Implementation atau tanpa alokasi aktif ditolak (HTTP 403). CRM, BoQ, HPP, nilai PO, invoice dan kontrak tidak tersedia.')
_DEV_EVIDENCE=task('Menyimpan evidence implementasi di Document Vault','/sales/documents',[
  'Buka Secure Document Vault dan pilih proyek implementasi Anda.',
  'Pilih jenis Supporting Document lalu unggah file asli (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB): bukti lisensi/entitlement, desain dan konfigurasi, as-built, hasil UAT, laporan secure code review atau berita handover support.',
  'Periksa pesan sukses: versi dan awalan SHA-256 dokumen. Revisi tersimpan sebagai versi baru, file lama tidak ditimpa.',
  'Jangan mengunggah kredensial, private key, token atau konfigurasi berisi secret pelanggan; samarkan nilai rahasia sebelum diunggah.'
 ],'Evidence implementasi tersimpan asli, berversi dan dapat dipilih saat task diselesaikan.',
 'Unggahan hanya jenis supporting setelah Closed Won. Paket komersial (proposal, negosiasi, PO/SPK), retensi, legal hold dan audit log dokumen tidak tersedia.')
_DEV_TIME=task('Mencatat jam kerja implementasi','/psa/timesheets',[
  'Buka Project Timesheets lalu pilih proyek implementasi yang aktif.',
  'Pilih alokasi aktif milik sendiri, tanggal kerja (tidak di masa depan, di dalam bulan alokasi dan jadwal proyek), menit kelipatan 15 (15-480), billable dan keterangan pekerjaan minimal 12 karakter.',
  'Klik Simpan dan ajukan review; entri berstatus submitted.',
  'Pantau riwayat: status approved/rejected, reviewer dan versi entri.'
 ],'Jam kerja tercatat pada alokasi yang benar dan menunggu review independen.',
 'Snapshot biaya/tarif harian tidak ditampilkan. Timesheet tidak diposting otomatis ke GL atau payroll. Pembuat entri tidak dapat mereview entrinya sendiri.')
_DEV_HEALTH=task('Memeriksa kesehatan platform RTICORE','/platform/diagnostics',[
  'Buka Platform Diagnostics (13 · Platform & Developer Tools). Halaman memeriksa platform saat dibuka; klik Periksa ulang untuk pemeriksaan baru.',
  'Baca tile status: Database (OK dan latensi ms), Skema migrasi (reconciled/incomplete), Migrasi terakhir, Transaction guard tertunda, AI provider aktif/teruji dan Production gate.',
  'Periksa tabel User aktif per role (jumlah saja, tanpa email) dan Ledger migrasi (versi dan waktu diterapkan) untuk memastikan migrasi terbaru, termasuk 0051, sudah diterapkan.',
  'Bila ada status merah (database gagal, skema incomplete, guard tertunda), catat waktu dan nilai tile lalu laporkan ke Admin bersama langkah reproduksi.'
 ],'Kondisi platform diketahui sebelum troubleshooting, UAT atau persiapan rilis.',
 'Read-only: tidak ada tombol ubah. Parameter, Opsi, API Key, Registrasi User dan status production gate HOLD tetap dikelola Admin melalui maker-checker; API key tidak pernah ditampilkan.')
WORK['itdev_leader']=[_DEV_START,
 task('Mengerjakan dan menyelesaikan tahapan implementasi','/sales/delivery',[
  'Kerjakan task sesuai urutan prasyarat: SKU, lisensi dan entitlement, lalu Implementasi dan acceptance test, lalu Support, warranty dan eskalasi. Untuk family Technology lain (SIEM/SOAR, IAM/PAM, Cloud, DLP, DevSecOps, OT/ICS, Hardening), task berupa Deliverable dan acceptance layanan.',
  'Isi parameter per tahap: SKU/entitlement/jumlah lisensi dan masa berlaku (lisensi); konfigurasi dan versi solusi serta hasil UAT/acceptance test (implementasi); periode support/warranty, SLA support dan kontak eskalasi (support). Tambahkan catatan pelaksanaan minimal 12 karakter dan target selesai.',
  'Periksa progres yang disimpan Member, lengkapi bila perlu, lalu pilih dokumen supporting dari Vault.',
  'Centang Tandai selesai dengan evidence (Leader) lalu simpan. Sistem menolak bila tahap prasyarat belum selesai atau dokumen bukan supporting asli pada Opportunity yang sama.',
  'Pantau tabel Kickoff & service deliverables. Setelah semua tahap selesai, informasikan PM agar proyek dapat ditutup.'
 ],'Setiap tahapan implementasi selesai dengan evidence dan dapat ditelusuri ke Leader yang menyelesaikannya.',
 'Kickoff, aktivasi, penutupan proyek, milestone dan BAST tetap milik PM. Task yang sudah done tidak dapat dibuka ulang. Konflik versi (HTTP 409): muat ulang lalu ulangi.'),
 task('Mereview timesheet anggota tim','/psa/timesheets',[
  'Buka Project Timesheets dan pilih proyek implementasi yang dialokasikan kepada Anda; seluruh entri tim pada proyek tersebut tampil.',
  'Periksa tanggal, durasi, billable dan keterangan terhadap progres task pada Service Delivery.',
  'Tulis catatan review minimal 12 karakter lalu klik Setujui atau Tolak pada entri submitted milik anggota lain.',
  'Ajukan jam kerja sendiri seperti anggota tim; entri Anda direview Finance, Approver, PM proyek atau Leader lain.'
 ],'Jam kerja tim tervalidasi oleh Leader sebelum dipakai untuk analisis utilisasi.',
 'Leader hanya mereview proyek Technology yang mengalokasikannya dan tidak dapat menyetujui entri sendiri. Biaya tidak ditampilkan.'),
 task('Membaca Feasibility proyek Technology','/sales/feasibility',[
  'Buka Resource & Solution Feasibility lalu pilih Opportunity Technology & Implementation yang masih terbuka (ditandai sebagai perencanaan pada pemilih).',
  'Baca plan, alokasi engineer per bulan (person-days), kapasitas, gap readiness serta kebutuhan SKU/lisensi dan cakupan penawaran vendor (tanpa harga).',
  'Sampaikan masukan sizing, komposisi engineer, prasyarat lingkungan pelanggan dan jadwal implementasi kepada Presales.'
 ],'Leader memahami rencana resource dan kebutuhan teknis sebelum implementasi dimulai.',
 'Hanya baca: plan dan alokasi oleh Presales/Admin, costing oleh Finance, review oleh Finance/Approver. HPP, tarif, harga vendor, revenue dan margin disembunyikan. Opportunity non-Technology atau Closed Lost ditolak.'),
 _DEV_EVIDENCE,_DEV_HEALTH,
 task('Menelusuri audit trail teknis','/platform/diagnostics',[
  'Pada Platform Diagnostics gulir ke bagian Audit trail teknis (khusus Leader dan Admin).',
  'Baca event terbaru: waktu, area (delivery, timesheet, member, admin_options, report), aksi, entitas dan aktor. Gunakan Sebelumnya/Berikutnya untuk halaman 100 baris.',
  'Klik Ekspor CSV untuk melampirkan bukti pada laporan insiden, investigasi bug atau bukti UAT.',
  'Cocokkan event dengan keluhan pengguna (misalnya task tidak tersimpan atau perubahan role) sebelum melapor ke Admin.'
 ],'Leader dapat menelusuri siapa melakukan apa dan kapan pada area teknis tanpa membuka data bisnis.',
 'Hanya metadata event; isi event, nilai pengaturan, harga, katalog, numbering, biaya aktual dan Sales audit tidak ditampilkan. Member menerima HTTP 403 untuk audit.')]
WORK['itdev_member']=[_DEV_START,
 task('Mengerjakan tahapan implementasi dan menyimpan progres','/sales/delivery',[
  'Pilih task implementasi yang pending pada proyek aktif: SKU, lisensi dan entitlement; Implementasi dan acceptance test; Support, warranty dan eskalasi; atau Deliverable dan acceptance layanan.',
  'Isi catatan pelaksanaan minimal 12 karakter, parameter layanan (SKU/lisensi, masa berlaku, konfigurasi dan versi, hasil UAT, periode dan SLA support) dan target selesai.',
  'Klik Simpan. Progres tersimpan dan task tetap pending.',
  'Unggah evidence ke Vault, lalu informasikan IT Developer Leader agar task diselesaikan dengan evidence tersebut.'
 ],'Progres dan parameter implementasi tersimpan untuk QA dan penyelesaian oleh Leader.',
 'Member tidak dapat menandai task selesai (HTTP 403) dan tidak mengelola kickoff, aktivasi, milestone atau BAST.'),
 _DEV_TIME,_DEV_EVIDENCE,_DEV_HEALTH]
_DEV_DETAIL_DELIVERY=lambda leader:('Eksekusi implementasi Technology & Implementation setelah Closed Won dan aktivasi proyek oleh PM, pada proyek yang mengalokasikan Anda.',
  ['Pemilih proyek hanya menampilkan proyek Technology dengan alokasi resource aktif atas email Anda.','Ringkasan proyek dan Scope baseline approved teknis; nilai PO, termin dan model kontrak tidak ditampilkan.',
   'Task SKU/lisensi, Implementasi dan acceptance test, Support dan eskalasi (atau Deliverable layanan) dengan parameter per tahap; prasyarat berurutan.']
  +(['Menandai task selesai dengan dokumen supporting Vault setelah memeriksa progres Member.'] if leader else ['Menyimpan progres (catatan, parameter, target); penyelesaian task dilakukan Leader.']),
  'Kickoff, aktivasi, penutupan, milestone/BAST, invoice, pembayaran, kontrak dan renewal bukan kewenangan IT Developer Team. Proyek lain ditolak (HTTP 403).')
_DEV_DETAIL_TIME=lambda leader:('Pencatatan jam kerja implementasi'+(' dan review timesheet tim.' if leader else '.'),
  ['Ajukan jam kerja sendiri pada alokasi aktif: menit kelipatan 15 (15-480), billable, keterangan minimal 12 karakter, tanggal tidak di masa depan.']
  +(['Lihat seluruh entri tim pada proyek Technology Anda dan Setujui/Tolak entri submitted dengan catatan minimal 12 karakter.'] if leader else ['Lihat status review entri milik sendiri.']),
  'Entri sendiri tidak dapat direview sendiri. Snapshot biaya tidak ditampilkan. Tidak diposting otomatis ke GL atau payroll.')
_DEV_DETAIL_DOCS=('Penyimpanan evidence implementasi asli terenkripsi.',
  ['Unggah dokumen supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat.','Baca dan unduh dokumen library proyek (RKS/KAK, NDA, supporting).','Gunakan dokumen sebagai evidence penyelesaian task implementasi.'],
  'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dokumen dikelola Admin/Legal.')
_DEV_DETAIL_PLATFORM=lambda leader:('Diagnostik platform RTICORE read-only untuk troubleshooting dan kesiapan rilis.',
  ['Health: status dan latensi database, rekonsiliasi ledger migrasi dan manifest skema, transaction guard tertunda.','Jumlah user aktif per role (tanpa email), kesiapan AI provider (tanpa API key) dan status production gate.']
  +(['Audit trail teknis: metadata event delivery, timesheet, member, admin_options dan report dengan paging dan ekspor CSV.'] if leader else []),
  'Tidak ada jalur tulis. Parameter, Opsi, API Key, Registrasi User, nilai pengaturan, harga dan Sales audit tidak tersedia.'+('' if leader else ' Audit trail teknis khusus Leader dan Admin (HTTP 403).'))
DETAIL['itdev_leader']={'/sales/delivery':_DEV_DETAIL_DELIVERY(True),'/psa/timesheets':_DEV_DETAIL_TIME(True),'/sales/documents':_DEV_DETAIL_DOCS,'/platform/diagnostics':_DEV_DETAIL_PLATFORM(True),
 '/sales/feasibility':('Membaca rencana resource Opportunity Technology & Implementation yang masih terbuka (read-only).',
  ['Plan, alokasi engineer per bulan (person-days), kapasitas dan gap readiness.','Kebutuhan SKU/lisensi dan cakupan penawaran vendor tanpa harga.','Bahan masukan sizing, komposisi engineer dan jadwal kepada Presales.'],
  'Tidak dapat mengubah plan, alokasi, costing atau review. HPP, tarif, harga vendor, revenue dan margin disembunyikan. Hanya Opportunity Technology yang belum Closed Lost.')}
DETAIL['itdev_member']={'/sales/delivery':_DEV_DETAIL_DELIVERY(False),'/psa/timesheets':_DEV_DETAIL_TIME(False),'/sales/documents':_DEV_DETAIL_DOCS,'/platform/diagnostics':_DEV_DETAIL_PLATFORM(False)}
AUTHORITY['itdev_leader']=[
 ('Dialokasikan pada proyek Technology','Presales/Admin pada Feasibility; Leader tidak mengalokasikan dirinya sendiri'),
 ('Menandai task implementasi selesai dengan evidence','Wajib dokumen supporting asli di Vault, proyek aktif dan prasyarat tahap sebelumnya'),
 ('Mereview timesheet tim','Hanya proyek Technology yang mengalokasikan Leader; entri sendiri direview Finance/Approver, PM atau Leader lain'),
 ('Mengunggah evidence supporting','Retensi dan legal hold diatur Admin/Legal'),
 ('Membaca Feasibility dan audit trail teknis','Read-only; perubahan konfigurasi platform hanya oleh Admin dengan reviewer Admin lain')]
AUTHORITY['itdev_member']=[
 ('Menyimpan progres task implementasi','Penyelesaian dengan evidence oleh IT Developer Leader'),
 ('Mengajukan timesheet','IT Developer Leader, PM proyek, Finance atau Approver; bukan pembuat'),
 ('Mengunggah evidence supporting','Dipakai Leader sebagai evidence; retensi dan legal hold diatur Admin/Legal'),
 ('Melaporkan temuan health platform','Ditindaklanjuti Admin; Member tidak mengubah konfigurasi')]
FLOWS['itdev_leader']=(['Dialokasikan Presales pada proyek Technology','PM selesaikan kickoff; proyek aktif','Lisensi, implementasi dan UAT tim','Support handover dan evidence','Evidence dan prasyarat lengkap?','Tandai task selesai dengan evidence','Review timesheet; cek health & audit'],
 {0:'Presales / Admin',1:'Project Manager'},'Lengkapi evidence\natau progres Member','Leader menyelesaikan task implementasi dengan evidence Vault dan memantau platform. Penutupan proyek, milestone dan BAST dilanjutkan PM; invoice oleh Finance; konfigurasi platform oleh Admin.')
FLOWS['itdev_member']=(['Dialokasikan Presales pada proyek Technology','PM selesaikan kickoff; proyek aktif','Kerjakan lisensi / implementasi / support','Simpan progres dan unggah evidence','Progres siap diperiksa Leader?','Leader menandai task selesai','Ajukan timesheet; Leader mereview'],
 {0:'Presales / Admin',1:'Project Manager',5:'IT Developer Leader',6:'IT Developer Leader'},'Perbaiki catatan\natau evidence','Member menyimpan progres dan evidence serta memeriksa health platform; penyelesaian task dan review timesheet dilakukan Leader.')

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
    story=[Spacer(1,50),p('RTICore','TitleRT'),p('Buku Panduan Penggunaan','HeadRT'),p(name,'HeadRT'),Spacer(1,16),p('Edisi 1.2 | Bahasa Indonesia | 8 November 2026','SubRT'),p('Panduan kerja per role untuk platform bisnis, komersial, delivery dan tata kelola RTICore.'),Spacer(1,25)]
    story+=section('Cara menggunakan buku ini','Mulai dari akses dan peta menu, lalu ikuti prosedur sesuai tugas Anda. Setiap prosedur memuat langkah, hasil yang harus diperiksa, serta batas kewenangan.')
    story+=section('Dasar panduan','Disusun dari kode dan dokumentasi di workspace RTICore. Buku ini tidak menyatakan bahwa semua fitur pada kode telah dirilis atau diuji pada produksi. Tampilan, kebijakan dan ketersediaan modul dapat mengikuti versi lingkungan yang digunakan.')
    story+=section('Isi buku','01 Akses dan navigasi | 02 Peta menu role'+(' | 02.1 Fungsi dan fitur per menu' if role in DETAIL else '')+(' | 02.2 Matriks kewenangan' if role in AUTHORITY else '')+' | Diagram alur proses | 03 Prosedur kerja | 04 Checklist dan kendala | 05 Istilah dan acuan')
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
    if role in DETAIL:
        missing=[path for _,path,_ in selected if path not in DETAIL[role]]
        assert not missing, f'{role}: menu tanpa deskripsi fitur: {missing}'
        story+=[PageBreak(),p('02.1 / Fungsi dan fitur per menu','HeadRT'),p('Setiap menu dijelaskan dari sisi role ini: fungsi halaman, fitur yang dapat digunakan, serta batas kewenangan. Rincian bersumber dari pemeriksaan role pada API aplikasi.','SmallRT')]
        for label,path,_ in selected:
            fungsi,fitur,batas=DETAIL[role][path]
            block=[p(label.replace('·','-')+'  ('+path+')','SubRT'),p('Fungsi: '+fungsi)]
            block+=[p('- '+f,'SmallRT') for f in fitur]
            block.append(p('Batas dan kontrol: '+batas,'SmallRT'))
            story.append(KeepTogether(block))
    if role in AUTHORITY:
        story+=[PageBreak(),p('02.2 / Matriks kewenangan (maker-checker)','HeadRT'),p('Kolom kiri adalah tindakan yang dibuat '+name+'; kolom kanan adalah pihak yang wajib memeriksa atau menyetujui. Pembuat tidak pernah menyetujui transaksinya sendiri.','SmallRT')]
        rows=[[p('Tindakan '+name,'SmallRT'),p('Pemeriksa / penyetuju','SmallRT')]]+[[p(a,'SmallRT'),p(b,'SmallRT')] for a,b in AUTHORITY[role]]
        auth=Table(rows,colWidths=[250,251],repeatRows=1,hAlign='LEFT')
        auth.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dceef2')),('VALIGN',(0,0),(-1,-1),'TOP'),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f3f6fa')]),('BOTTOMPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#83b5c2'))]))
        story.append(auth)
    if role not in ('viewer','project_manager','offense_lead','offense_member','governance_leader','governance_member','itdev_leader','itdev_member'): story+=section('Khusus menu ERP','Organization, General Ledger, Treasury, HR, Procurement/AP dan Cybersecurity memerlukan pengendalian tambahan. Penempatan staff dan capability grant pada legal-unit harus disetujui secara independen. Jika ditolak, minta Admin/Approver memeriksa grant; role umum tidak otomatis membuka operasi ERP.')
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
