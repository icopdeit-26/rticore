'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {
  WalletCards, Calculator, ShieldCheck, Landmark, Receipt, TrendingUp,
  ChevronDown, ArrowUpRight,
} from 'lucide-react';

export interface FinanceMenuSection {
  groupCode: string;
  groupTitle: string;
  menus: {
    label: string;
    href: string;
    preserveOpportunity?: boolean;
    badge: string;
    functions: string;
    features: string[];
  }[];
}

export const FINANCE_ROLE_CATALOG: FinanceMenuSection[] = [
  {
    groupCode: '01 · Executive & My Workspace',
    groupTitle: 'Pemantauan Realisasi Target, Pipeline & Aktivitas Lintas Sales',
    menus: [
      {
        label: 'Executive Dashboard',
        href: '/sales/executive',
        badge: 'Target vs Booked vs Revenue',
        functions: 'Konsolidasi eksekutif realisasi Booked Sales (PO Verified) dan Recognized Revenue (GL Approved) terhadap target bulanan.',
        features: [
          'Filter kinerja per Sales Owner atau gabungan seluruh tim Sales beserta ekspor laporan CSV',
          'Pemantauan metrik Target Bulanan, Booked Sales, Pencapaian Target (%), dan Revenue Diakui per lini layanan (VAPT, SOC/MDR, GRC, FortiSIEM)',
          'Analisis Deal Aging, Proposal Conversion Rate, dan deteksi otomatis Data Quality Gaps',
        ],
      },
      {
        label: 'Sales Forecast',
        href: '/sales/forecast',
        badge: 'Audit Pipeline & Commit Gate',
        functions: 'Pemeriksaan proyeksi penutupan penjualan (Pipeline, Best Case, Commit) dan rekonsiliasi realisasi bulanan.',
        features: [
          'Inspeksi nilai Open Pipeline, Weighted Pipeline (berbobot tahap), Commit, Booked Sales, dan Recognized Revenue',
          'Deteksi anomali nilai atau forecast Commit yang kehilangan kelayakan persetujuan PO',
          'Unduh matriks Sales Forecast resmi dalam format CSV terproteksi formula',
        ],
      },
      {
        label: 'Activity, SLA & Follow-up',
        href: '/sales/activities',
        badge: 'Monitor Eksekusi & SLA Sales',
        functions: 'Pemantauan jadwal tindak lanjut, antrean overdue, dan kepatuhan SLA respons awal lintas pemilik Opportunity.',
        features: [
          'Filter kalender mingguan dan riwayat aktivitas per Sales Owner dalam zona waktu WIB',
          'Inspeksi antrean Overdue dan pelanggaran batas waktu respons Lead (SLA Breached)',
        ],
      },
    ],
  },
  {
    groupCode: '03 · Customer 360 & Sales CRM',
    groupTitle: 'Rekam Jejak Tagihan Pelanggan & Verifikasi Finansial Pipeline',
    menus: [
      {
        label: 'Customer 360',
        href: '/customers',
        badge: 'Profil Billing & Kontrak',
        functions: 'Tinjauan menyeluruh identitas badan hukum pelanggan, PIC Billing, histori kontrak, faktur, dan pembayaran.',
        features: [
          'Inspeksi kontak Billing pelanggan (Billing Name & Billing Email), alamat penagihan, dan relasi induk/anak usaha',
          'Rekapitulasi histori kontrak layanan, daftar nomor invoice, tanggal jatuh tempo, dan nominal terbayar (Paid IDR)',
        ],
      },
      {
        label: 'Opportunity Pipeline',
        href: '/sales/pipeline',
        preserveOpportunity: true,
        badge: 'Verifikasi PO & Stage Gate',
        functions: 'Pemeriksaan seluruh Opportunity lintas Sales dan pengesahan finansial PO sebelum penutupan transaksi.',
        features: [
          'Akses penuh ke daftar Opportunity dari seluruh Sales beserta nilai estimasi, BoQ tertaut, dan riwayat audit',
          'Eksekusi verifikasi finansial PO (Verify PO) dengan prinsip Segregation of Duties (Maker != Checker)',
        ],
      },
    ],
  },
  {
    groupCode: '04 · Presales, Tender & Solution',
    groupTitle: 'Validasi Vendor, Costing HPP Engineer/Lisensi & Kelayakan Margin',
    menus: [
      {
        label: 'Tender Compliance',
        href: '/sales/compliance',
        preserveOpportunity: true,
        badge: 'Validasi Vendor, Harga & Klausul Komersial',
        functions: 'Pendaftaran dan pengesahan independen master vendor, kuotasi harga supplier, serta review klausul komersial tender.',
        features: [
          'Registrasi vendor baru, pengajuan kuotasi harga vendor, serta validasi/suspensi independen atas vendor & penawaran harga',
          'Kewenangan eksklusif (bersama Admin) untuk mereview dan mengesahkan klausul tender berkategori Komersial (Commercial)',
          'Pemeriksaan klausul Administratif dan kecocokan bukti SHA-256 di Document Vault',
        ],
      },
      {
        label: 'Bid Readiness',
        href: '/sales/bid-readiness',
        preserveOpportunity: true,
        badge: 'Review Dokumen Komersial & Administratif',
        functions: 'Pemeriksaan kesiapan dokumen penawaran wajib komersial/administratif sebelum pengajuan tender.',
        features: [
          'Review dan pengesahan independen item Tender Checklist berkategori Komersial dan Administratif',
          'Unduh laporan Compliance Matrix, Tender Checklist, dan Bid Readiness Report dalam format CSV',
        ],
      },
      {
        label: 'Resource & Solution Feasibility',
        href: '/sales/feasibility',
        preserveOpportunity: true,
        badge: 'Eksklusif HPP, Tarif Engineer & Margin',
        functions: 'Pengelolaan struktur biaya pengiriman (HPP internal & eksternal), registrasi tarif engineer, dan persetujuan kelayakan margin.',
        features: [
          'Visibilitas penuh atas Estimasi Pendapatan, HPP Tim Internal, HPP Supplier/Lisensi, HPP Total, dan Gross Margin (%)',
          'Kewenangan eksklusif mendaftarkan engineer beserta tarif rahasia HPP per Person-Day (`daily_cost_idr`)',
          'Input dan penghapusan komponen biaya proyek (`license`, `supplier`, `platform`, `operations`) yang terhubung ke penawaran vendor tervalidasi',
          'Review dan pengesahan independen (*Independent Solution Feasibility Review*) sebelum paket masuk Commercial Review',
        ],
      },
    ],
  },
  {
    groupCode: '05 · Commercial, Pricing & Approval',
    groupTitle: 'Kendali HPP BoQ, Antrean Persetujuan, Dual Gate PO/SPK & Verifikasi Submission',
    menus: [
      {
        label: 'BoQ Management',
        href: '/boq',
        badge: 'Input HPP (`edit_cost`) & Margin BoQ',
        functions: 'Pengelolaan komponen Harga Pokok Penjualan (HPP), perhitungan Gross Profit/Margin pada BoQ, dan ekspor dokumen harga.',
        features: [
          'Hak akses eksklusif (`edit_cost`) untuk melihat dan mengubah rincian biaya modal (`cost_items`), HPP, Gross Profit (Rp), dan Gross Margin (%)',
          'Pembuatan dan penyuntingan BoQ komersial, perhitungan PPN 11%, serta pengaturan Payment Terms',
          'Ekspor rincian BoQ ke format Excel (.xlsx) dan dokumen Quotation resmi (.docx)',
        ],
      },
      {
        label: 'Service Catalog & Pricing',
        href: '/erp/service-catalog',
        badge: 'Approved rates & pricing',
        functions: 'Pengelolaan master layanan, rate card, aktivitas, complexity dan snapshot harga dengan persetujuan independen.',
        features: ['Scope legal entity, versi immutable dan approval limit', 'Harga dihitung dari rate card approved, sebelum pajak'],
      },
      {
        label: 'Approval Center · Lintas Modul',
        href: '/approvals',
        badge: '6 Kategori Antrean Finance',
        functions: 'Pusat pemantauan seluruh transaksi lintas modul yang membutuhkan verifikasi dan persetujuan Role Finance.',
        features: [
          'Menarik otomatis 6 antrean kerja Finance: Tender Checklist (Komersial/Admin), Finance PO/SPK, Resource Feasibility, Draft Invoice, Collection/Payment, dan Service Contract',
          'Prinsip Maker-Checker otomatis: menyaring keluar transaksi yang dibuat oleh email pengguna Finance itu sendiri',
        ],
      },
      {
        label: 'PO / SPK Verification',
        href: '/sales/award',
        preserveOpportunity: true,
        badge: 'Dual Verification Gate (Finance Check)',
        functions: 'Verifikasi finansial atas dokumen PO, SPK, Kontrak, dan Award Letter sebelum Opportunity diizinkan menjadi Closed Won.',
        features: [
          'Pemeriksaan dan pengesahan independen (**Verifikasi sebagai Finance**) atas keaslian dokumen PO/SPK di Document Vault',
          'Rekonsiliasi nilai PO sebelum PPN terhadap nilai BoQ Approved (bekerja berpasangan dengan verifikasi Legal)',
        ],
      },
      {
        label: 'Submission & Proposal Evidence',
        href: '/sales/submission',
        preserveOpportunity: true,
        badge: 'Verifikasi Bukti Pengiriman Quotation',
        functions: 'Pengesahan independen atas bukti pengiriman penawaran harga final kepada pelanggan.',
        features: [
          'Pemeriksaan tanda terima pengiriman (Email/Portal Pengadaan/Fisik) dan pencocokan hash SHA-256 file asli di Vault',
          'Kewenangan mengubah status pengiriman dari `Reported` menjadi `Verified` atau `Rejected` (catatan wajib min. 15 karakter)',
        ],
      },
    ],
  },
  {
    groupCode: '06 · Project Delivery & Operations',
    groupTitle: 'Milestone Penagihan, Penerimaan BAST, Cost Timesheet & Dokumen Pasca-PO',
    menus: [
      {
        label: 'Service Delivery & Projects',
        href: '/sales/delivery',
        preserveOpportunity: true,
        badge: 'Milestone Billing, Budget & BAST',
        functions: 'Pengelolaan jadwal milestone penagihan proyek, pemantauan budget HPP BoQ, dan penerimaan BAST.',
        features: [
          'Visibilitas eksklusif atas angka `Budget approved BoQ` pada kartu proyek delivery',
          'Pembuatan dan penyuntingan jadwal Milestone pembayaran beserta nilai sebelum PPN dan pemicu tagihan (Trigger)',
          'Review dan pengesahan Berita Acara Serah Terima (`Terima BAST`) berbasis dokumen asli di Vault sebagai syarat penerbitan Invoice',
        ],
      },
      {
        label: 'Project Timesheets',
        href: '/psa/timesheets',
        badge: 'Review Jam Kerja & Cost Snapshot',
        functions: 'Pemeriksaan dan pengesahan lembar waktu kerja (timesheet) engineer beserta nilai biaya aktual per jam/hari.',
        features: [
          'Akses reviewer lintas seluruh proyek aktif tanpa dibatasi alokasi pribadi',
          'Visibilitas penuh atas `cost_snapshot_cents` (biaya aktual jam kerja berdasarkan tarif harian engineer saat pengerjaan)',
          'Kewenangan menyetujui (`Approve`) atau menolak (`Reject`) timesheet yang diajukan oleh tim teknis (Maker-Checker)',
        ],
      },
      {
        label: 'Official Post-PO Forms',
        href: '/post-po',
        preserveOpportunity: true,
        badge: 'Inspeksi Jadwal Tagihan & Ekspor DOCX',
        functions: 'Pemeriksaan parameter penagihan pasca-PO (termin pembayaran, kontak invoice) dan pengunduhan dokumen resmi.',
        features: [
          'Verifikasi kesiapan alamat penagihan, NPWP, jadwal penagihan, dan referensi PO terverifikasi',
          'Unduh dokumen resmi Form Registrasi (.docx) dan Form Project (.docx)',
        ],
      },
    ],
  },
  {
    groupCode: '07 · Contract-to-Cash & Renewal',
    groupTitle: 'Faktur (Invoicing), Penerimaan Kas, Pengakuan Pendapatan (GL) & Wallet FlexGuard',
    menus: [
      {
        label: 'Billing & Collections',
        href: '/sales/billing',
        preserveOpportunity: true,
        badge: 'Invoicing, Payment, DSO & Laba Provisional',
        functions: 'Siklus penuh penagihan pelanggan (Contract-to-Cash), pencatatan pembayaran bank, reversal, dan rekonsiliasi GL.',
        features: [
          'Dashboard kas proyek: Outstanding, Overdue, DSO (90 hari), Pembayaran Approved, Revenue Approved, dan Laba Provisional',
          'Pembuatan Draft Invoice dari Milestone yang telah BAST Accepted (dijaga otomatis agar tidak melebihi batas kumulatif PO)',
          'Pencatatan pembayaran masuk (Payment), pengajuan Reversal pembayaran, serta Review Independen Invoice & Payment oleh rekan Finance/Approver',
          'Penautan Invoice Approved ke entri Revenue GL Approved (`Hubungkan revenue GL approved`)',
        ],
      },
      {
        label: 'Revenue Register',
        href: '/sales/revenue',
        preserveOpportunity: true,
        badge: 'Maker & Checker Pengakuan Pendapatan',
        functions: 'Pencatatan dan pengesahan pengakuan pendapatan (Revenue Recognition) yang terefleksi ke Executive Dashboard.',
        features: [
          'Kewenangan eksklusif Maker (`Catat revenue draft` & `Reversal transaksi`) dengan referensi unik Jurnal GL, Nomor Invoice, BAST, dan SHA-256',
          'Kewenangan Checker (`Review rekonsiliasi`) untuk mengesahkan entri revenue yang dibuat oleh pengguna Finance/Admin lain',
          'Perlindungan otomatis terhadap pengakuan pendapatan berlebih (Cumulative PO Cap) dan duplikasi referensi jurnal GL',
        ],
      },
      {
        label: 'Contracts & Renewal',
        href: '/sales/renewals',
        preserveOpportunity: true,
        badge: 'Konfigurasi MRR, Approval & Churn',
        functions: 'Pengaturan parameter finansial kontrak berlangganan (MRR, nilai renewal) serta persetujuan kontrak independen.',
        features: [
          'Konfigurasi model kontrak (`OTC`, `MRC`, `managed_service`, `license`, `retainer`, `FlexGuard`), nilai MRR bulanan, dan nilai total renewal',
          'Kewenangan **Approval Kontrak Independen** (`approve_contract`) serta pembaruan status risiko churn / pencatatan kontrak berakhir',
        ],
      },
      {
        label: 'FlexGuard Token Wallet',
        href: '/flexguard',
        badge: 'Maker Entitlement & Token Ledger',
        functions: 'Penerbitan kuota token layanan FlexGuard dan pencatatan mutasi buku besar (ledger) token pelanggan.',
        features: [
          'Kewenangan eksklusif Maker (bersama Admin) untuk mendaftarkan *Entitlement Wallet* dari kontrak FlexGuard yang telah aktif',
          'Pencatatan transaksi buku besar token (`ISSUE`, `TOPUP`, `RESERVE`, `RELEASE`, `DEBIT`, `REFUND`, `EXPIRY`) yang terhubung ke ID Invoice dan bukti Vault',
        ],
      },
    ],
  },
  {
    groupCode: '08 · Vendor, OEM & Partners',
    groupTitle: 'Pembelian ke Supplier (Purchase Tracking), Harga Vendor & Evaluasi Kinerja',
    menus: [
      {
        label: 'Vendor & Partner Records',
        href: '/partners',
        badge: 'Purchase Tracking, Harga & Evaluasi Vendor',
        functions: 'Pengelolaan profil mitra, pemesanan pembelian ke vendor (PO Supplier), penerimaan barang/jasa, dan evaluasi kinerja.',
        features: [
          'Visibilitas penuh atas tab rahasia **Purchase Tracking** dan **Vendor Evaluation** beserta harga satuan penawaran supplier (`unit_price_idr`)',
          'Pembuatan draft Partner Profile, OEM Licensing, Purchase Tracking (PO ke vendor), dan Vendor Evaluation (skor 1–100)',
          'Pembaruan siklus pembelian ke vendor (`order`, `receive` bertahap/kumulatif, `cancel`) dan review independen transaksi partner',
        ],
      },
      {
        label: 'Procurement & Supplier',
        href: '/sales/procurement',
        preserveOpportunity: true,
        badge: 'Review Vendor Quote & Kepatuhan Pengadaan',
        functions: 'Pemeriksaan dokumen penawaran harga vendor (`vendor_quote`) dan pemantauan keputusan Bid/No-Bid pada pengadaan.',
        features: [
          'Kewenangan eksklusif (bersama Admin) untuk mereview dan mengesahkan requirement berjenis **Vendor Quote (`vendor_quote`)**',
          'Inspeksi status keputusan Bid/No-Bid serta matriks kelengkapan dokumen RKS/KAK/RFP',
        ],
      },
    ],
  },
  {
    groupCode: '09 · Reporting, Analytics & AI',
    groupTitle: 'Laporan Gross Margin, Profitabilitas Pelanggan & Rekonsiliasi Biaya Aktual',
    menus: [
      {
        label: 'Enterprise Reports',
        href: '/reports',
        badge: 'Eksklusif Gross Margin, Profitability & Actual Cost',
        functions: 'Pembuat laporan kustom (Report Builder), analisis margin estimasi vs realisasi, dan pencatatan biaya aktual proyek.',
        features: [
          'Akses eksklusif (bersama Admin) ke laporan rahasia **Gross Margin (Estimasi)** dan **Customer Profitability** (selain Pipeline, Marketing Funnel, & Deal Intelligence)',
          'Kewenangan eksklusif mencatat **Biaya Aktual (`Register biaya aktual untuk rekonsiliasi`)** per kategori (`vendor`, `labor`, `license`, `travel`, `cloud`, `other`) beserta koreksi reversal',
          'Kewenangan **Review Biaya Independen (`review_cost`)** atas entri biaya aktual yang diajukan pengguna Finance/Admin lain',
          'Penyimpanan definisi laporan pribadi dan ekspor data ke format CSV maupun JSON',
        ],
      },
    ],
  },
  {
    groupCode: '10 · Document Center & Governance',
    groupTitle: 'Arsip Dokumen Terenkripsi & Bukti Pendukung Penagihan/Delivery',
    menus: [
      {
        label: 'Secure Document Vault',
        href: '/sales/documents',
        preserveOpportunity: true,
        badge: 'Unduh Bukti Asli & Unggah Supporting Won',
        functions: 'Pengunduhan dokumen kontrak/PO/BAST/faktur asli terenkripsi dan pengunggahan bukti pendukung pasca-Won.',
        features: [
          'Unduh dan verifikasi integritas SHA-256 atas seluruh dokumen penawaran, PO, SPK, Kontrak, dan bukti penagihan',
          'Unggah dokumen asli kategori **Supporting Document (`supporting`)** untuk kelengkapan bukti delivery, BAST, dan penagihan setelah tahap Closed Won',
        ],
      },
    ],
  },
  {
    groupCode: '12 · ERP Finance, Procurement & Cybersecurity',
    groupTitle: 'Inti Akuntansi Perusahaan: Buku Besar (GL), Kebendaharaan (Treasury) & Hutang Usaha (AP)',
    menus: [
      {
        label: 'General Ledger & Journal',
        href: '/erp/general-ledger',
        badge: 'CoA, Jurnal 2-Baris, Posting & Financial Close',
        functions: 'Pengelolaan bagan akun (Chart of Accounts), periode akuntansi, penjurnalan berimbang, dan penutupan buku bulanan.',
        features: [
          'Pembuatan Chart of Account (`asset`, `liability`, `equity`, `revenue`, `expense`) dan pembukaan periode akuntansi (`YYYY-MM`) per entitas hukum',
          'Pembuatan Jurnal Dua Baris berimbang (Debit = Kredit dalam sen IDR), Review Jurnal independen, Posting Jurnal ke buku besar, dan Jurnal Reversal',
          'Pengajuan (`Ajukan Financial Close`) dan pengesahan independen (`Approve Financial Close`) penutupan periode akuntansi',
        ],
      },
      {
        label: 'Operations Center',
        href: '/erp/operations-center',
        badge: 'Read-only native operations',
        functions: 'Pemantauan antrean maintenance dan percobaan integrasi Finance berdasarkan legal entity yang diotorisasi.',
        features: ['Status job dan percobaan retry terakhir', 'Tidak melakukan posting, retry atau expiry otomatis'],
      },
      {
        label: 'Treasury & Payments',
        href: '/erp/treasury',
        badge: 'Rekening Bank, Instruksi Bayar & Rekonsiliasi',
        functions: 'Pengelolaan rekening bank perusahaan, instruksi pembayaran hutang vendor (AP), dan rekonsiliasi penyelesaian bank.',
        features: [
          'Registrasi rekening bank entitas yang terhubung ke akun GL Bank (`Daftar Bank Account`)',
          'Pengajuan pembayaran atas faktur supplier yang telah disetujui (`Ajukan Pembayaran AP`) dan Review Instruksi Pembayaran secara independen',
          'Pencatatan referensi bukti transfer bank (`Catat Bukti Bank` dengan dokumen asli Vault) dan Konfirmasi Settlement pembayaran',
        ],
      },
      {
        label: 'Procurement & Accounts Payable',
        href: '/erp/procurement',
        badge: 'Budget, PR, PO Vendor & 3-Way Match AP',
        functions: 'siklus pengadaan terintegrasi dari anggaran, Purchase Requisition, PO Vendor, penerimaan barang, hingga persetujuan faktur AP.',
        features: [
          'Pembuatan dan persetujuan Budget Procurement bulanan per entitas hukum serta pengajuan/persetujuan Purchase Requisition (PR)',
          'Penerbitan PO ke vendor dari kuotasi tervalidasi (`Buat PO`), persetujuan PO (`Approve/Reject PO`), dan pencatatan penerimaan barang/jasa (`Terima Barang/Jasa`)',
          'Input faktur tagihan vendor (`Input Supplier Invoice`) dan pengesahan **Accounts Payable (`Approve/Reject AP`)** dengan pemeriksaan *Three-Way Match* (PO + Receipt + Invoice)',
        ],
      },
    ],
  },
];

const FINANCE_MENU_COUNT = FINANCE_ROLE_CATALOG.reduce((count, section) => count + section.menus.length, 0);

export function FinanceWorkspaceGuide({
  role,
  opportunityId,
  currentStation,
  defaultOpen = false,
}: {
  role: string;
  opportunityId?: string;
  currentStation?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || role === 'finance');
  if (role !== 'finance' && role !== 'admin') return null;

  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;

  return (
    <section
      aria-label="Detail Fitur, Fungsi dan Menu Role Finance"
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-900 text-white shadow-sm">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-950">
                Finance, Accounting & Commercial Control Desk
              </span>
              <span className="rounded-full border border-teal-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-teal-900">
                {FINANCE_ROLE_CATALOG.length} Kelompok · {FINANCE_MENU_COUNT} Menu Aktif
              </span>
              {currentStation && (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                  Modul Aktif: {currentStation}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">
              Pusat Kendali Fitur, Fungsi & Menu Role Finance (`finance@rticore.local`)
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Role <b>Finance</b> memegang otoritas penuh atas <i>Costing & HPP</i>, <i>Validasi Harga Vendor</i>, <i>Dual Verification PO/SPK</i>, siklus <i>Contract-to-Cash (Invoicing, Payment, Revenue Recognition)</i>, <i>Profitabilitas Aktual</i>, hingga modul inti <i>ERP General Ledger, Treasury & Accounts Payable</i>.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-xs font-bold text-emerald-950 shadow-sm transition hover:bg-emerald-50"
        >
          {open ? 'Ringkas Detail Fitur Finance' : `Tampilkan Semua Fitur & Menu Finance (${FINANCE_MENU_COUNT} Modul)`}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {/* 4 Pilar Utama Kewenangan Finance */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
            <Calculator className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            1. Kendali HPP, BoQ & Feasibility
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Hak eksklusif input & audit <b>HPP (`cost_items`)</b> dan Gross Margin di <Link href="/boq" className="font-bold text-emerald-800 underline">BoQ Management</Link>, registrasi tarif harian engineer & biaya lisensi di <Link href={buildHref('/sales/feasibility', true)} className="font-bold text-emerald-800 underline">Feasibility</Link>, serta validasi harga vendor di <Link href={buildHref('/sales/compliance', true)} className="font-bold text-emerald-800 underline">Compliance</Link>.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
            <Receipt className="h-4 w-4 text-teal-700" aria-hidden="true" />
            2. Billing, Kas, BAST & Revenue GL
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Terima BAST di <Link href={buildHref('/sales/delivery', true)} className="font-bold text-emerald-800 underline">Delivery</Link>, terbitkan Invoice & catat pembayaran bank di <Link href={buildHref('/sales/billing', true)} className="font-bold text-emerald-800 underline">Billing</Link>, serta catat/sahkan pengakuan pendapatan di <Link href={buildHref('/sales/revenue', true)} className="font-bold text-emerald-800 underline">Revenue Register</Link>.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
            <TrendingUp className="h-4 w-4 text-indigo-700" aria-hidden="true" />
            3. Dual Gate PO, Timesheet & Margin
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Pengesahan <b>Finance Check</b> atas PO/SPK di <Link href={buildHref('/sales/award', true)} className="font-bold text-emerald-800 underline">Award Desk</Link>, approval jam kerja & biaya di <Link href="/psa/timesheets" className="font-bold text-emerald-800 underline">Timesheets</Link>, serta rekonsiliasi biaya aktual & profitabilitas di <Link href="/reports" className="font-bold text-emerald-800 underline">Enterprise Reports</Link>.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
            <Landmark className="h-4 w-4 text-amber-700" aria-hidden="true" />
            4. ERP GL, Treasury & 3-Way Match AP
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Kelola CoA, Jurnal & Financial Close di <Link href="/erp/general-ledger" className="font-bold text-emerald-800 underline">General Ledger</Link>, instruksi bayar & settlement bank di <Link href="/erp/treasury" className="font-bold text-emerald-800 underline">Treasury</Link>, serta Budget, PO Supplier & AP di <Link href="/erp/procurement" className="font-bold text-emerald-800 underline">ERP Procurement</Link>.
          </p>
        </div>
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-emerald-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-950">
              Katalog Lengkap {FINANCE_ROLE_CATALOG.length} Kelompok & {FINANCE_MENU_COUNT} Menu Operasional Role Finance
            </h3>
            <span className="text-[11px] text-slate-500">
              Klik judul menu untuk membuka halaman kerja terkait
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {FINANCE_ROLE_CATALOG.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={buildHref(menu.href, menu.preserveOpportunity)}
                          className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-950 hover:text-emerald-700 hover:underline"
                        >
                          {menu.label}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-emerald-950">
                          {menu.badge}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{menu.functions}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-slate-600">
                        {menu.features.map((feat, idx) => (
                          <li key={idx}>{feat}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
              Aturan Pengendalian Internal, Maker-Checker & Integritas Akuntansi pada Role Finance
            </div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li>
                <b>Segregasi Maker-Checker Finansial:</b> Pembuat draft (baik pada Invoice, Pembayaran, Entri Revenue, Biaya Aktual, Vendor, Jurnal GL, maupun Instruksi Pembayaran Treasury) diblokir oleh database dan API dari menyetujui transaksinya sendiri (`created_by != reviewer`).
              </li>
              <li>
                <b>Batas Kumulatif PO (Cumulative PO Cap) & Three-Way Match:</b> Total akumulasi Invoice maupun Pengakuan Pendapatan (Revenue) tidak dapat melampaui nilai PO terverifikasi sebelum PPN. Persetujuan faktur supplier (AP) di ERP mewajibkan kecocokan kuantitas PO, Penerimaan Barang/Jasa (Receipt), dan Faktur.
              </li>
              <li>
                <b>Kerahasiaan HPP & Margin (Confidential Cost Shield):</b> Hanya <b>Finance</b> dan <b>Admin</b> (serta Approver pada ringkasan kelayakan) yang menerima data `cost_items`, `daily_cost_idr`, `unit_price_idr` vendor, `cost_snapshot_cents` timesheet, serta laporan <i>Gross Margin</i> & <i>Customer Profitability</i>.
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
