'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {
  Scale, ShieldCheck, FileCheck2, Lock, Handshake, ClipboardCheck,
  FileText, RefreshCw, UsersRound, MailCheck, ChevronDown, ArrowUpRight,
} from 'lucide-react';

export interface LegalMenuSection {
  groupCode: string;
  groupTitle: string;
  menus: {
    label: string;
    href: string;
    preserveOpportunity?: boolean;
    badge: string;
    features: string[];
    functions: string;
  }[];
}

export const LEGAL_ROLE_CATALOG: LegalMenuSection[] = [
  {
    groupCode: '03 · Customer 360 & Sales CRM',
    groupTitle: 'Profil Entitas Hukum Pelanggan & Bukti Korespondensi',
    menus: [
      {
        label: 'Customer 360',
        href: '/customers',
        badge: 'Read & Audit Entitas',
        functions: 'Inspeksi identitas badan hukum pelanggan, relasi grup/anak perusahaan, daftar kontrak aktif, dan histori transaksi.',
        features: [
          'Pemeriksaan nama resmi badan hukum (Legal Name) & Customer ID kanonik',
          'Pemetaan struktur grup perusahaan, induk, anak usaha (subsidiary), dan cabang',
          'Daftar stakeholder kunci (Decision Maker, Procurement, Billing) beserta histori kontrak layanan',
        ],
      },
      {
        label: 'Communication Timeline',
        href: '/sales/communications',
        preserveOpportunity: true,
        badge: 'Verifikasi EML & Negosiasi',
        functions: 'Pemeriksaan jejak korespondensi email pelanggan (.eml) dan keterkaitannya dengan keputusan negosiasi kontrak.',
        features: [
          'Inspeksi header email asli (Message-ID, In-Reply-To, pengirim, penerima, waktu kirim WIB)',
          'Verifikasi integritas email menggunakan hash kriptografi SHA-256 pada tiap pesan yang diimpor',
          'Pelacakan hubungan antara email masuk (inbound) dengan catatan negosiasi paket penawaran',
        ],
      },
    ],
  },
  {
    groupCode: '04 · Presales, Tender & Solution',
    groupTitle: 'Kepatuhan Hukum Tender, Klausul Administratif & Kelayakan Solusi',
    menus: [
      {
        label: 'Tender Compliance',
        href: '/sales/compliance',
        preserveOpportunity: true,
        badge: 'Review Klausul Administratif',
        functions: 'Pemeriksaan matriks kepatuhan klausul RKS/KAK/RFP per pasal dan pengesahan independen klausul administratif/hukum.',
        features: [
          'Review independen (Maker-Checker) untuk klausul berkategori Administratif/Hukum (Compliant / Partial / Non-Compliant)',
          'Validasi silang bukti dokumen tender terhadap file asli terenkripsi di Document Vault (SHA-256)',
          'Pemantauan status registrasi vendor dan masa berlaku penawaran pendukung tender',
        ],
      },
      {
        label: 'Bid Readiness',
        href: '/sales/bid-readiness',
        preserveOpportunity: true,
        badge: 'Gate Dokumen Administrasi',
        functions: 'Verifikasi kelengkapan dokumen wajib administrasi tender, tenggat waktu (deadline), dan ekspor laporan kesiapan penawaran.',
        features: [
          'Pemeriksaan & pengesahan independen dokumen checklist penawaran kategori Administratif (Akta, NIB, Pakta Integritas, Surat Kuasa)',
          'Pemantauan skor Bid Readiness (READY / NOT READY) dan deteksi celah kepatuhan (Open Gaps) secara real-time',
          'Unduh laporan resmi Compliance Matrix, Tender Checklist, dan Bid Readiness Report dalam format CSV terproteksi',
        ],
      },
      {
        label: 'Resource & Solution Feasibility',
        href: '/sales/feasibility',
        preserveOpportunity: true,
        badge: 'Inspeksi Komitmen Delivery',
        functions: 'Tinjauan kelayakan jadwal delivery, cakupan SLA layanan (VAPT/SOC/GRC/FortiSIEM), dan masa berlaku dukungan vendor.',
        features: [
          'Pemeriksaan periode komitmen layanan (Start Date, End Date, durasi bulan) dan jam cakupan operasional (Coverage Hours)',
          'Verifikasi ketersediaan alokasi person-days tim teknis serta masa berlaku penawaran lisensi/vendor',
          'Proteksi kerahasiaan komersial otomatis: tarif harian engineer & HPP internal disembunyikan (redacted) untuk menjaga segregasi',
        ],
      },
    ],
  },
  {
    groupCode: '05 · Commercial, Pricing & Approval',
    groupTitle: 'Pusat Persetujuan Lintas Modul, Dual Verification PO/SPK & Bukti Submission',
    menus: [
      {
        label: 'Approval Center · Lintas Modul',
        href: '/approvals',
        badge: 'Antrean Kerja Legal',
        functions: 'Meja kerja terpusat untuk memantau dan mengeksekusi seluruh antrean dokumen yang membutuhkan pengesahan Role Legal.',
        features: [
          'Antrean dokumen award (PO, SPK, Contract, Award Letter) yang belum direview Legal, bukan didaftarkan oleh akun sendiri dan bukan yang sudah Anda review sebagai Finance',
          'Tautan "Periksa di sumber" ke PO / SPK Verification; klausul tender, checklist, kontrak layanan dan agreement diperiksa langsung di modul masing-masing',
          'Penegakan aturan Maker-Checker otomatis: item yang dibuat oleh akun sendiri tidak dapat disetujui sendiri',
        ],
      },
      {
        label: 'PO / SPK Verification',
        href: '/sales/award',
        preserveOpportunity: true,
        badge: 'Dual Verification (Finance + Legal)',
        functions: 'Gerbang verifikasi ganda (Dual Gate) atas dokumen pemenang pengadaan sebelum Opportunity diizinkan menjadi Closed Won.',
        features: [
          'Review dan pengesahan independen (Legal Reviewed) atas dokumen PO, SPK, Kontrak/PKS, dan Award Letter',
          'Pencocokan nilai komitmen sebelum PPN terhadap BoQ Approved serta verifikasi keaslian file PDF/DOCX di Document Vault',
          'Kunci gerbang otomatis: tahap Closed Won diblokir oleh server sampai Finance Check dan Legal Check keduanya lengkap',
        ],
      },
      {
        label: 'BoQ Management',
        href: '/boq',
        badge: 'Inspeksi Ketentuan Komersial',
        functions: 'Pemeriksaan struktur Bill of Quantities (BoQ), termin pembayaran (Payment Terms), dan kesesuaian nomor kuotasi.',
        features: [
          'Inspeksi daftar item layanan, kuantitas, durasi, subtotal, PPN, Grand Total, serta catatan ketentuan pembayaran',
          'Verifikasi keterkaitan BoQ berstatus Approved terhadap Opportunity dan nama resmi badan hukum pelanggan',
          'Redaksi HPP & Gross Margin secara otomatis di sisi server (hanya menampilkan nilai jual/kontrak resmi)',
        ],
      },
      {
        label: 'Submission & Proposal Evidence',
        href: '/sales/submission',
        preserveOpportunity: true,
        badge: 'Audit Bukti Pengiriman',
        functions: 'Pemeriksaan bukti pengiriman penawaran resmi kepada pelanggan beserta kecocokan versi BoQ dan tanda terima.',
        features: [
          'Inspeksi saluran pengiriman (Email resmi, Portal Pengadaan/LPSE, atau Penyerahan Fisik) dan waktu pengiriman',
          'Unduh dan periksa bukti pengiriman asli dari Document Vault beserta pencocokan hash SHA-256',
          'Verifikasi status pemeriksaan independen (Reported vs Verified) sebelum masuk tahap negosiasi kontrak',
        ],
      },
    ],
  },
  {
    groupCode: '06 · Project Delivery & Operations',
    groupTitle: 'Dokumen Resmi Pasca-PO & Registrasi Proyek',
    menus: [
      {
        label: 'Official Post-PO Forms',
        href: '/post-po',
        preserveOpportunity: true,
        badge: 'Generator DOCX Pasca-PO',
        functions: 'Inspeksi dan pembuatan dokumen resmi pasca-PO (Form Registrasi & Form Project) berbasis data PO yang telah terverifikasi.',
        features: [
          'Pemeriksaan kelengkapan Klausul Kontrak, Ringkasan Ketentuan, Penandatangan (Signatory), dan jadwal penagihan',
          'Validasi kesiapan 4 gerbang utama: Form Registrasi Ready, Form Project Ready, PO/SPK Verified, dan Stage Closed Won',
          'Unduh dokumen resmi Form Registrasi (.docx) dan Form Project (.docx) yang ditarik langsung dari satu sumber data kanonik',
        ],
      },
    ],
  },
  {
    groupCode: '07 · Contract-to-Cash & Renewal',
    groupTitle: 'Siklus Hidup Kontrak Layanan, SLA & Perpanjangan (Renewal)',
    menus: [
      {
        label: 'Contracts & Renewal',
        href: '/sales/renewals',
        preserveOpportunity: true,
        badge: 'Approval Kontrak & Masa Berlaku',
        functions: 'Persetujuan independen kontrak layanan draft, pemantauan masa berlaku dan status renewal berdasarkan notice period tiap kontrak.',
        features: [
          'Persetujuan kontrak layanan draft yang dikonfigurasi pengguna lain (Maker-Checker) dengan catatan review minimal 12 karakter',
          'Daftar Service Contract (model OTC, MRC, Managed Service, License, Retainer, FlexGuard) beserta nomor PO, periode dan notice period',
          'Status Renewal Due ketika sisa hari kontrak sudah sama atau kurang dari notice period kontrak, serta alasan risiko churn',
          'Pelacakan Opportunity renewal/expansion yang dibuat Sales/Admin; konfigurasi kontrak dan risiko churn tetap milik Sales/Finance',
        ],
      },
    ],
  },
  {
    groupCode: '08 · Vendor, OEM & Partners',
    groupTitle: 'Perjanjian Kemitraan (Partnership Agreement), NDA & Kepatuhan Prinsipal/OEM',
    menus: [
      {
        label: 'Vendor & Partner Records',
        href: '/partners',
        badge: 'Maker-Checker Partnership Agreement',
        functions: 'Pengelolaan profil hukum mitra/OEM, pencatatan lisensi prinsipal, serta pengajuan dan pengesahan Partnership Agreement.',
        features: [
          'Pembuatan draft Partnership Agreement (Perjanjian Kerja Sama Mitra/Vendor) dengan masa berlaku dan bukti dokumen Vault (SHA-256)',
          'Review dan pengesahan independen (Approve / Reject) atas Partnership Agreement yang diajukan oleh pengguna lain (Maker-Checker)',
          'Inspeksi direktori partner/OEM dan masa berlaku lisensi tanpa mengekspos harga beli supplier, PO pembelian, atau skor evaluasi',
        ],
      },
      {
        label: 'Procurement & Supplier',
        href: '/sales/procurement',
        preserveOpportunity: true,
        badge: 'Registrasi & Review NDA / RKS',
        functions: 'Pencatatan dan pemeriksaan independen atas dokumen NDA, RKS, KAK, dan RFP pada pengadaan tender maupun non-tender.',
        features: [
          'Pendaftaran dokumen persyaratan hukum & pengadaan (khususnya NDA, RKS, KAK, RFP) dengan penguncian hash SHA-256 dari Document Vault',
          'Review kepatuhan independen (Compliant / Partial / Non-Compliant) atas requirement non-teknis seperti NDA, Commercial dan Clarification; RKS/KAK/RFP/RFQ/Technical direview Presales dan Vendor Quote oleh Finance',
          'Inspeksi keputusan Bid / No-Bid beserta alasan pengesahan dari Approver',
        ],
      },
    ],
  },
  {
    groupCode: '10 · Document Center & Governance',
    groupTitle: 'Arsip Dokumen Terenkripsi, Legal Hold & Jejak Audit Akses',
    menus: [
      {
        label: 'Secure Document Vault',
        href: '/sales/documents',
        preserveOpportunity: true,
        badge: 'Legal Hold & Audit Trail',
        functions: 'Pusat tata kelola bukti dokumen asli terenkripsi AES-GCM, kontrol pembekuan dokumen (Legal Hold), dan audit akses.',
        features: [
          'Unggah NDA atau dokumen supporting hukum asli dengan verifikasi isi file (PDF, DOCX, PNG, JPEG atau EML; maksimal 8 MB). Setelah Closed Won hanya dokumen supporting',
          'Kewenangan Legal/Admin memasang Legal Hold dengan alasan minimal 15 karakter; dokumen ber-hold tetap dapat dibuka walau masa retensinya terlampaui',
          'Pelepasan Legal Hold khusus role Legal dengan alasan minimal 15 karakter; hold atau retensi dokumen yang Anda unggah sendiri diubah oleh orang lain',
          'Inspeksi riwayat revisi per dokumen serta Audit Trail lengkap (siapa yang mengunggah, mengunduh, menahan, atau melepas hold beserta waktu tepat)',
        ],
      },
    ],
  },
];

export function LegalWorkspaceGuide({
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
  const [open, setOpen] = useState(defaultOpen || role === 'legal');
  if (role !== 'legal' && role !== 'admin') return null;

  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;

  return (
    <section
      aria-label="Detail Fitur, Fungsi dan Menu Role Legal"
      className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 via-white to-slate-50 p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-900 text-white shadow-sm">
            <Scale className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-indigo-900">
                Legal Governance & Contract Desk
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                7 Kelompok · 14 Menu Aktif
              </span>
              {currentStation && (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                  Modul Aktif: {currentStation}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">
              Pusat Kendali Fitur, Fungsi & Menu Role Legal (`legal@rticore.local`)
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Role <b>Legal</b> memegang fungsi <i>Gatekeeper Hukum & Kepatuhan</i>: menjalankan verifikasi ganda (<i>Dual Verification</i>) PO/SPK/Kontrak sebelum <i>Closed Won</i>, mengelola <i>Legal Hold</i> pada Document Vault, mengesahkan <i>Partnership Agreement</i> mitra/OEM, serta memeriksa klausul administratif/NDA tender dengan prinsip <i>Maker-Checker</i>.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-bold text-indigo-900 shadow-sm transition hover:bg-indigo-50"
        >
          {open ? 'Ringkas Detail Fitur Legal' : 'Tampilkan Semua Fitur & Menu Legal'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {/* Ringkasan 4 Kewenangan Utama Legal */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
            <FileCheck2 className="h-4 w-4 text-indigo-700" aria-hidden="true" />
            1. Dual Verification PO / SPK
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Pengesahan independen (<b>Legal Check</b>) atas dokumen PO, SPK, Kontrak, dan Award Letter di <Link href={buildHref('/sales/award', true)} className="font-bold text-indigo-700 underline">PO / SPK Verification</Link>. Wajib berpasangan dengan Finance Check sebelum tahap <i>Closed Won</i>.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
            <Lock className="h-4 w-4 text-rose-700" aria-hidden="true" />
            2. Legal Hold & Audit Vault
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Unggah NDA/supporting hukum asli, kunci dokumen dengan <b>Legal Hold</b>, lepas hold dengan alasan audit wajib (≥15 karakter), dan periksa jejak unduhan di <Link href={buildHref('/sales/documents', true)} className="font-bold text-indigo-700 underline">Secure Document Vault</Link>.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
            <Handshake className="h-4 w-4 text-teal-700" aria-hidden="true" />
            3. Partnership Agreement OEM
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Registrasi draft dan pengesahan independen (<i>Maker-Checker</i>) atas <b>Partnership Agreement</b> mitra/vendor berbasis bukti Vault di <Link href="/partners" className="font-bold text-indigo-700 underline">Vendor & Partner Records</Link> tanpa eksposur harga beli.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
            <ClipboardCheck className="h-4 w-4 text-amber-700" aria-hidden="true" />
            4. Kepatuhan Klausul & NDA Tender
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            Review dokumen NDA/RKS di <Link href={buildHref('/sales/procurement', true)} className="font-bold text-indigo-700 underline">Procurement</Link>, pengesahan klausul administratif di <Link href={buildHref('/sales/compliance', true)} className="font-bold text-indigo-700 underline">Tender Compliance</Link>, dan verifikasi checklist di <Link href={buildHref('/sales/bid-readiness', true)} className="font-bold text-indigo-700 underline">Bid Readiness</Link>.
          </p>
        </div>
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-indigo-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-indigo-950">
              Katalog Lengkap 14 Menu, Fitur & Fungsi Operasional Role Legal
            </h3>
            <span className="text-[11px] text-slate-500">
              Klik nama menu untuk membuka modul secara langsung
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {LEGAL_ROLE_CATALOG.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={buildHref(menu.href, menu.preserveOpportunity)}
                          className="inline-flex items-center gap-1 text-xs font-extrabold text-indigo-900 hover:text-indigo-700 hover:underline"
                        >
                          {menu.label}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-indigo-100/80 px-2 py-0.5 text-[10px] font-bold text-indigo-900">
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
              Aturan Tata Kelola, Segregasi Maker-Checker & Proteksi Data pada Role Legal
            </div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li>
                <b>Segregasi Maker-Checker Ketat:</b> Pengguna Legal tidak dapat mengesahkan dokumen PO/SPK, klausul tender, dokumen NDA, maupun <i>Partnership Agreement</i> yang diunggah atau dibuat oleh emailnya sendiri (`created_by != email`).
              </li>
              <li>
                <b>Verifikasi Keaslian Kriptografis (SHA-256):</b> Review PO/SPK, persetujuan perjanjian kemitraan, dan review requirement tender wajib merujuk pada dokumen asli di <i>Secure Document Vault</i> dengan kecocokan hash SHA-256 64 karakter. Untuk kontrak layanan, cocokkan sendiri konfigurasi kontrak dengan dokumen asli sebelum menyetujui.
              </li>
              <li>
                <b>Redaksi Rahasia Komersial & HPP (Least Privilege):</b> Harga beli supplier, daftar transaksi pembelian vendor, skor evaluasi vendor, tarif harian engineer (`daily_cost_idr`), serta HPP/margin internal pada BoQ dan Feasibility otomatis disensor oleh API untuk role Legal.
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
