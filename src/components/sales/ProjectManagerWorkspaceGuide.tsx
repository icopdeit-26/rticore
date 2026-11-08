'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {
  Briefcase, ShieldCheck, ListChecks, Clock3, Coins, FolderLock, ChevronDown, ArrowUpRight, Flag,
} from 'lucide-react';

export interface ProjectManagerMenuSection {
  groupCode: string;
  groupTitle: string;
  menus: {
    label: string;
    href: string;
    preserveOpportunity?: boolean;
    badge: string;
    functions: string;
    features: string[];
    limits: string;
  }[];
}

/**
 * Menu, function and feature catalog for role `project_manager`.
 * Mirrors the API rules: src/app/api/sales/service-operations, psa/timesheets,
 * sales/flexguard and sales/document-vault. Scope = projects where pm_email is the user.
 */
export const PROJECT_MANAGER_ROLE_CATALOG: ProjectManagerMenuSection[] = [
  {
    groupCode: '06 · Project Delivery & Operations',
    groupTitle: 'Eksekusi Proyek, Kickoff, Milestone & Timesheet Tim',
    menus: [
      {
        label: 'Service Delivery & Projects',
        href: '/sales/delivery',
        preserveOpportunity: true,
        badge: 'Eksekusi Delivery',
        functions: 'Menjalankan proyek hasil Closed Won yang menugaskan Anda sebagai PM: kickoff, tahapan layanan, laporan bulanan SOC, aktivasi, penyelesaian dan milestone penagihan.',
        features: [
          'Daftar proyek hanya berisi proyek dengan PM = akun Anda; buka baseline scope approved (scope teknis, deliverable, lokasi, PIC, timeline, SLA, termin)',
          'Perbarui task kickoff & service deliverable: catatan pelaksanaan ≥12 karakter, parameter layanan, target selesai; tandai selesai dengan dokumen supporting Vault dan prasyarat tahap sebelumnya',
          'Tambah laporan bulanan untuk proyek SOC/MDR (periode YYYY-MM di dalam jadwal proyek)',
          'Aktifkan proyek setelah assignment, jadwal dan seluruh checklist kickoff selesai; selesaikan proyek bila seluruh task (dan semua laporan SOC bulanan) selesai',
          'Usulkan dan ubah milestone draft: nama, trigger pembayaran, nilai sebelum PPN dan target; total milestone tidak boleh melebihi nilai PO',
          'Terima BAST milestone buatan pengguna lain dengan dokumen BAST asli dari Vault',
        ],
        limits: 'Assignment PM & jadwal serta handover Won lama dilakukan Presales/Admin. Invoice, pembayaran, review keuangan, kontrak dan revenue milik Finance/Approver/Legal/Sales. Budget HPP tidak ditampilkan.',
      },
      {
        label: 'Project Timesheets',
        href: '/psa/timesheets',
        badge: 'Review Tim',
        functions: 'Mencatat jam kerja sendiri dan mereview timesheet anggota tim pada proyek yang Anda pimpin.',
        features: [
          'Ajukan jam kerja sendiri pada alokasi aktif: tanggal (tidak di masa depan), menit kelipatan 15 (15–480), billable, keterangan ≥12 karakter',
          'Pada proyek Anda sebagai PM: lihat seluruh entri tim lalu Setujui atau Tolak entri submitted dengan catatan review ≥12 karakter',
          'Pada proyek lain tempat Anda dialokasikan: hanya entri milik sendiri yang terlihat',
        ],
        limits: 'Entri milik sendiri direview Finance/Approver atau PM lain. Snapshot biaya (tarif harian) tidak ditampilkan. Timesheet tidak otomatis diposting ke GL atau payroll.',
      },
    ],
  },
  {
    groupCode: '07 · Contract-to-Cash & Renewal',
    groupTitle: 'Konsumsi Token Layanan FlexGuard',
    menus: [
      {
        label: 'FlexGuard Token Wallet',
        href: '/flexguard',
        badge: 'Reserve · Release · Debit',
        functions: 'Mengelola pemakaian token layanan pada wallet FlexGuard milik kontrak proyek yang Anda pimpin.',
        features: [
          'Lihat saldo (issued, available, reserved, consumed, expired) dan riwayat event wallet proyek Anda',
          'RESERVE dan RELEASE token untuk Opportunity Won milik customer wallet',
          'DEBIT token setelah layanan diberikan, wajib dengan dokumen supporting asli dari Vault',
          'Setiap posting memakai request key unik (≥16 karakter) dan alasan ≥12 karakter',
        ],
        limits: 'Wallet aktif setelah dibuat Finance dan disetujui Approver/Admin. ISSUE, TOPUP, REFUND dan EXPIRY oleh Finance/Admin. Ledger immutable; koreksi dengan event baru.',
      },
    ],
  },
  {
    groupCode: '10 · Document Center & Governance',
    groupTitle: 'Evidence Delivery & BAST',
    menus: [
      {
        label: 'Secure Document Vault',
        href: '/sales/documents',
        preserveOpportunity: true,
        badge: 'Supporting Delivery',
        functions: 'Menyimpan dan membuka bukti delivery asli (evidence, laporan, BAST) terenkripsi untuk proyek Anda.',
        features: [
          'Unggah dokumen jenis supporting setelah Opportunity Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat otomatis',
          'Baca dan unduh dokumen library proyek (RKS/KAK, NDA, supporting) sebagai referensi scope',
          'Dokumen supporting yang diunggah menjadi pilihan evidence task dan BAST milestone',
        ],
        limits: 'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia untuk PM. Retensi, legal hold dan audit log dikelola Admin/Legal.',
      },
    ],
  },
];

export function ProjectManagerWorkspaceGuide({
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
  const [open, setOpen] = useState(defaultOpen);
  if (role !== 'project_manager' && role !== 'admin') return null;
  const menuCount = PROJECT_MANAGER_ROLE_CATALOG.reduce((n, s) => n + s.menus.length, 0);
  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;

  return (
    <section
      aria-label="Detail Fitur, Fungsi dan Menu Role Project Manager"
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-slate-50 p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-900 text-white shadow-sm">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-900">
                Project Delivery Desk
              </span>
              <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                {PROJECT_MANAGER_ROLE_CATALOG.length} Kelompok · {menuCount} Menu Aktif
              </span>
              {currentStation && (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                  Modul Aktif: {currentStation}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">
              Fitur, Fungsi & Menu Role Project Manager
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Role <b>Project Manager</b> menjalankan delivery proyek setelah <i>Closed Won</i>. Seluruh akses dibatasi pada proyek yang
              menetapkan akun Anda sebagai PM oleh Presales/Admin. PM tidak membuka CRM, BoQ, harga atau HPP.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50"
        >
          {open ? 'Ringkas Detail Fitur PM' : 'Tampilkan Semua Fitur & Menu PM'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {icon: <ListChecks className="h-4 w-4 text-emerald-700" aria-hidden="true" />, title: '1. Kickoff & Deliverable', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Selesaikan checklist kickoff dan task layanan dengan evidence Vault, lalu aktifkan dan tutup proyek.'},
          {icon: <Flag className="h-4 w-4 text-indigo-700" aria-hidden="true" />, title: '2. Milestone & BAST', href: buildHref('/sales/delivery', true), link: 'Milestone & BAST', body: 'Usulkan milestone (≤ nilai PO) dan terima BAST milestone buatan orang lain sebagai dasar invoice Finance.'},
          {icon: <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: '3. Timesheet Tim', href: '/psa/timesheets', link: 'Project Timesheets', body: 'Review jam kerja anggota tim pada proyek Anda; entri sendiri direview pihak lain.'},
          {icon: <Coins className="h-4 w-4 text-teal-700" aria-hidden="true" />, title: '4. Token FlexGuard', href: '/flexguard', link: 'FlexGuard Wallet', body: 'Reserve, release dan debit token layanan pada wallet kontrak proyek Anda, dengan bukti asli.'},
        ].map(card => (
          <div key={card.title} className="rounded-xl border border-emerald-100 bg-white p-3.5">
            <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">{card.icon}{card.title}</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
              {card.body} <Link href={card.href} className="font-bold text-emerald-800 underline">{card.link}</Link>
            </p>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-emerald-100 pt-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-950">
            Katalog {menuCount} Menu, Fungsi & Fitur Role Project Manager
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {PROJECT_MANAGER_ROLE_CATALOG.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={buildHref(menu.href, menu.preserveOpportunity)} className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-900 hover:underline">
                          {menu.label}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-emerald-900">{menu.badge}</span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{menu.functions}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-slate-600">
                        {menu.features.map(feat => <li key={feat}>{feat}</li>)}
                      </ul>
                      <p className="mt-2 text-[11px] text-slate-500"><b>Batas:</b> {menu.limits}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
              Aturan Tata Kelola Role Project Manager
            </div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li><b>Cakupan proyek:</b> API menolak proyek, dokumen, timesheet dan wallet yang tidak menetapkan Anda sebagai PM (HTTP 403).</li>
              <li><b>Maker-checker:</b> BAST tidak dapat diterima oleh pembuat milestone; timesheet tidak dapat direview oleh pembuatnya.</li>
              <li><b>Kunci versi:</b> setiap perubahan proyek memakai versi proyek; bila muncul konflik versi (HTTP 409), muat ulang lalu ulangi.</li>
              <li className="flex items-start gap-1"><FolderLock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><b>Least privilege:</b> BoQ, HPP, budget, tarif engineer, paket komersial, CRM dan menu ERP tidak tersedia bagi PM.</span></li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
