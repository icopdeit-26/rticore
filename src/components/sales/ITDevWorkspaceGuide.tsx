'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {
  Code2, ShieldCheck, KeyRound, Wrench, LifeBuoy, Activity, Clock3, Users, FolderLock, ChevronDown, ArrowUpRight,
} from 'lucide-react';

type ITDevRole = 'itdev_leader' | 'itdev_member';
type ITDevMenu = {
  label: string;
  href: string;
  preserveOpportunity?: boolean;
  badge: string;
  /** Which IT Developer role sees the menu. */
  roles: readonly ITDevRole[];
  functions: string;
  leader: string[];
  member: string[];
  limits: string;
};
export interface ITDevMenuSection { groupCode: string; groupTitle: string; menus: ITDevMenu[] }

const BOTH = ['itdev_leader', 'itdev_member'] as const;

/**
 * Menu, function and feature catalog for roles `itdev_leader` and `itdev_member` (migration 0051).
 * Mirrors the API rules in src/lib/itdev-team.ts and the handlers sales/service-operations,
 * psa/timesheets, sales/document-vault, sales/feasibility, /api/sales and platform/diagnostics.
 * Delivery scope = Technology & Implementation projects with an active resource allocation.
 */
export const ITDEV_ROLE_CATALOG: ITDevMenuSection[] = [
  {
    groupCode: '06 · Project Delivery & Operations',
    groupTitle: 'Implementasi Solusi & Timesheet Tim',
    menus: [
      {
        label: 'Service Delivery & Projects',
        href: '/sales/delivery',
        preserveOpportunity: true,
        badge: 'Lisensi · Implementasi · Support',
        roles: BOTH,
        functions: 'Mengerjakan tahapan implementasi Technology & Implementation (Cybersecurity Technology, SIEM / SOAR, IAM / PAM, Network / Endpoint, Cloud Security, Data Security / DLP, DevSecOps / Secure Code Review, OT / ICS, Security Hardening) pada proyek tempat Anda dialokasikan.',
        leader: [
          'Melihat seluruh proyek Technology tempat Anda dialokasikan beserta baseline scope teknis approved (scope, spesifikasi, SKU/lisensi, deliverable, lokasi, PIC, timeline, SLA)',
          'Menyimpan progres dan MENANDAI SELESAI task SKU, lisensi & entitlement → Implementasi & acceptance test → Support, warranty & eskalasi (atau Deliverable layanan untuk family lain) dengan dokumen supporting Vault',
          'Urutan wajib: Implementasi memerlukan Lisensi selesai; Support memerlukan Implementasi selesai',
          'Mengisi parameter per tahap: SKU/entitlement/jumlah lisensi, masa berlaku, konfigurasi & versi solusi, hasil UAT/acceptance test, periode support/warranty, SLA support dan kontak eskalasi',
        ],
        member: [
          'Melihat proyek Technology tempat Anda dialokasikan dan baseline scope teknis approved',
          'Menyimpan progres task implementasi: catatan pelaksanaan ≥12 karakter, parameter layanan dan target selesai',
          'Penyelesaian task (dengan evidence) dilakukan IT Developer Leader',
        ],
        limits: 'Implementasi dimulai setelah PM mengaktifkan proyek (kickoff lengkap). Kickoff, aktivasi, penutupan proyek, milestone/BAST, invoice, kontrak, nilai PO dan budget/HPP tidak tersedia.',
      },
      {
        label: 'Project Timesheets',
        href: '/psa/timesheets',
        badge: 'Jam Kerja Tim',
        roles: BOTH,
        functions: 'Mencatat jam kerja implementasi; Leader mereview jam kerja anggota tim.',
        leader: [
          'Mengajukan jam kerja sendiri pada alokasi aktif (menit kelipatan 15, 15–480 per entri, billable, keterangan ≥12 karakter, tanggal tidak di masa depan)',
          'Melihat seluruh entri tim pada proyek Technology yang dialokasikan kepada Anda',
          'Setujui / Tolak entri submitted anggota tim dengan catatan review ≥12 karakter',
        ],
        member: [
          'Mengajukan jam kerja sendiri pada alokasi aktif proyek Technology',
          'Melihat status review entri milik sendiri',
        ],
        limits: 'Entri milik sendiri tidak dapat direview sendiri (maker-checker). Snapshot biaya/tarif harian tidak ditampilkan. Jam hanya dapat dicatat pada proyek aktif dalam bulan alokasi.',
      },
    ],
  },
  {
    groupCode: '04 · Presales, Tender & Solution',
    groupTitle: 'Perencanaan Resource Implementasi',
    menus: [
      {
        label: 'Resource & Solution Feasibility',
        href: '/sales/feasibility',
        preserveOpportunity: true,
        badge: 'Read-only · Leader',
        roles: ['itdev_leader'],
        functions: 'Membaca rencana Feasibility Opportunity Technology & Implementation yang masih terbuka untuk menyiapkan komposisi tim, kapasitas dan kebutuhan lisensi/perangkat.',
        leader: [
          'Melihat plan, alokasi engineer per bulan (person-days), kapasitas dan gap readiness Opportunity Technology terbuka',
          'Melihat struktur kebutuhan SKU/lisensi dan cakupan penawaran vendor (tanpa harga)',
          'Memberi masukan kepada Presales tentang kebutuhan engineer, sizing dan jadwal implementasi',
        ],
        member: [],
        limits: 'Hanya baca. Plan dan alokasi dikelola Presales/Admin; costing dan review Finance/Approver. HPP, tarif, harga vendor, revenue dan margin disembunyikan.',
      },
    ],
  },
  {
    groupCode: '10 · Document Center & Governance',
    groupTitle: 'Evidence Implementasi & Handover',
    menus: [
      {
        label: 'Secure Document Vault',
        href: '/sales/documents',
        preserveOpportunity: true,
        badge: 'Supporting Implementasi',
        roles: BOTH,
        functions: 'Menyimpan bukti implementasi terenkripsi: bukti lisensi/entitlement, dokumen desain & konfigurasi, hasil UAT, as-built, laporan secure code review dan berita handover support.',
        leader: [
          'Unggah dokumen jenis supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maks. 8 MB); versi dan SHA-256 tercatat',
          'Baca/unduh library proyek (RKS/KAK, NDA, supporting) sebagai referensi scope',
          'Dokumen yang diunggah menjadi pilihan evidence saat menandai task selesai',
        ],
        member: [
          'Unggah evidence implementasi (jenis supporting) setelah Closed Won',
          'Baca/unduh library proyek sebagai referensi scope',
        ],
        limits: 'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dokumen dikelola Admin/Legal.',
      },
    ],
  },
  {
    groupCode: '13 · Platform & Developer Tools',
    groupTitle: 'Diagnostik Platform RTICORE (Read-only)',
    menus: [
      {
        label: 'Platform Diagnostics',
        href: '/platform/diagnostics',
        badge: 'Health · Audit Teknis',
        roles: BOTH,
        functions: 'Memantau kesehatan platform RTICORE untuk troubleshooting dan persiapan rilis tanpa menyentuh data bisnis.',
        leader: [
          'Health: status & latensi database, ledger migrasi dan rekonsiliasi manifest skema, transaction guard tertunda, jumlah user aktif per role, kesiapan AI provider (tanpa API key) dan status release gate',
          'Audit trail teknis: metadata event delivery, timesheet, registrasi user, opsi admin dan laporan (area, entitas, aksi, aktor, waktu) dengan paging 100 baris',
          'Ekspor audit trail teknis ke CSV untuk investigasi insiden atau bukti UAT',
        ],
        member: [
          'Health: status & latensi database, ledger migrasi dan rekonsiliasi manifest skema, transaction guard tertunda, jumlah user aktif per role, kesiapan AI provider dan status release gate',
        ],
        limits: 'Read-only. Tidak ada akses Parameter, Opsi, API Key, Registrasi User, nilai pengaturan, harga atau Sales audit. Perubahan konfigurasi tetap melalui workflow Admin maker-checker; status production gate HOLD tidak dapat diubah.',
      },
    ],
  },
];

export function ITDevWorkspaceGuide({
  role, opportunityId, currentStation, defaultOpen = false,
}: {role: string; opportunityId?: string; currentStation?: string; defaultOpen?: boolean}) {
  const [open, setOpen] = useState(defaultOpen);
  if (role !== 'itdev_leader' && role !== 'itdev_member' && role !== 'admin') return null;
  const leader = role !== 'itdev_member';
  const label = role === 'itdev_member' ? 'IT Developer Member' : 'IT Developer Leader';
  const sections = ITDEV_ROLE_CATALOG
    .map(s => ({...s, menus: s.menus.filter(m => role === 'admin' || m.roles.includes(role as ITDevRole))}))
    .filter(s => s.menus.length);
  const menuCount = sections.reduce((n, s) => n + s.menus.length, 0);
  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;

  const cards = [
    {icon: <KeyRound className="h-4 w-4 text-sky-700" aria-hidden="true" />, title: '1. Lisensi & Entitlement', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Verifikasi SKU, jumlah lisensi dan masa berlaku sesuai baseline approved.'},
    {icon: <Wrench className="h-4 w-4 text-indigo-700" aria-hidden="true" />, title: '2. Implementasi & UAT', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Catat konfigurasi, versi solusi dan hasil acceptance test bersama customer.'},
    {icon: <LifeBuoy className="h-4 w-4 text-teal-700" aria-hidden="true" />, title: '3. Support Handover', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Serahkan periode support/warranty, SLA dan kontak eskalasi.'},
    leader
      ? {icon: <Users className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: '4. QA, Review & Platform', href: '/platform/diagnostics', link: 'Platform Diagnostics', body: 'Tandai task selesai dengan evidence, review timesheet tim dan pantau audit teknis.'}
      : {icon: <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: '4. Timesheet & Health', href: '/psa/timesheets', link: 'Project Timesheets', body: 'Catat jam kerja pada alokasi aktif; cek health platform saat troubleshooting.'},
  ];

  return (
    <section aria-label={`Detail Fitur, Fungsi dan Menu Role ${label}`}
      className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/90 via-white to-slate-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-900 text-white shadow-sm">
            <Code2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-sky-900">IT Developer & Implementation Desk</span>
              <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-sky-800">{sections.length} Kelompok · {menuCount} Menu Aktif</span>
              {currentStation && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">Modul Aktif: {currentStation}</span>}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">Fitur, Fungsi & Menu Role {role === 'admin' ? 'IT Developer Team (Leader & Member)' : label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              IT Developer Team mengimplementasikan solusi Technology &amp; Implementation setelah <i>Closed Won</i> dan aktivasi proyek oleh PM,
              serta memantau kesehatan platform RTICORE secara read-only. Akses proyek dibatasi pada proyek Technology tempat akun Anda memiliki
              alokasi resource aktif (ditetapkan Presales di Feasibility). {leader
                ? <>Leader menyelesaikan task dengan evidence, mereview timesheet tim, membaca Feasibility Technology dan audit trail teknis.</>
                : <>Member menyimpan progres dan evidence; penyelesaian task dilakukan Leader.</>}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3.5 py-2 text-xs font-bold text-sky-900 shadow-sm transition hover:bg-sky-50">
          {open ? 'Ringkas Detail Fitur' : 'Tampilkan Semua Fitur & Menu'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => (
          <div key={card.title} className="rounded-xl border border-sky-100 bg-white p-3.5">
            <div className="flex items-center gap-2 text-xs font-extrabold text-sky-950">{card.icon}{card.title}</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{card.body} <Link href={card.href} className="font-bold text-sky-800 underline">{card.link}</Link></p>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-sky-100 pt-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-950">Katalog {menuCount} Menu, Fungsi & Fitur</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {sections.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={buildHref(menu.href, menu.preserveOpportunity)} className="inline-flex items-center gap-1 text-xs font-extrabold text-sky-900 hover:underline">
                          {menu.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-sky-100/80 px-2 py-0.5 text-[10px] font-bold text-sky-900">{menu.badge}</span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{menu.functions}</p>
                      {role !== 'itdev_member' && menu.leader.length > 0 && <>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-800">Leader</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-600">{menu.leader.map(f => <li key={f}>{f}</li>)}</ul>
                      </>}
                      {role !== 'itdev_leader' && menu.member.length > 0 && <>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-800">Member</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-600">{menu.member.map(f => <li key={f}>{f}</li>)}</ul>
                      </>}
                      <p className="mt-2 text-[11px] text-slate-500"><b>Batas:</b> {menu.limits}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />Aturan Tata Kelola IT Developer Team</div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li><b>Cakupan proyek:</b> API menolak proyek, dokumen dan timesheet di luar proyek Technology &amp; Implementation yang dialokasikan kepada Anda (HTTP 403).</li>
              <li><b>Allow-list API:</b> hanya Identity, daftar proyek, Service Delivery, Timesheets, Document Vault dan Platform Diagnostics (Leader: + Feasibility read-only). API lain ditolak sebelum handler.</li>
              <li><b>Maker-checker:</b> Member menyimpan progres, Leader menyelesaikan task dengan evidence; timesheet tidak dapat direview oleh pembuatnya.</li>
              <li><b>Kunci versi:</b> setiap perubahan memakai versi proyek; bila konflik (HTTP 409), muat ulang lalu ulangi.</li>
              <li className="flex items-start gap-1"><Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><b>Platform read-only:</b> diagnostik tidak memiliki jalur tulis; Parameter, Opsi, API Key dan Registrasi User tetap Khusus Admin.</span></li>
              <li className="flex items-start gap-1"><FolderLock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><b>Least privilege:</b> CRM, BoQ, harga, HPP, nilai PO, invoice, kontrak, paket komersial dan menu ERP tidak tersedia; IT Developer Team tidak dapat ditunjuk sebagai PM.</span></li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
