'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {
  Scale, ShieldCheck, ClipboardCheck, SearchCheck, Wrench, Clock3, FolderLock, ChevronDown, ArrowUpRight, Users,
} from 'lucide-react';

type GovernanceMenu = {
  label: string;
  href: string;
  preserveOpportunity?: boolean;
  badge: string;
  /** Which Governance role sees the menu. */
  roles: readonly ('governance_leader'|'governance_member')[];
  functions: string;
  leader: string[];
  member: string[];
  limits: string;
};
export interface GovernanceMenuSection { groupCode: string; groupTitle: string; menus: GovernanceMenu[] }

const BOTH = ['governance_leader','governance_member'] as const;

/**
 * Menu, function and feature catalog for roles `governance_leader` and `governance_member`
 * (migration 0050). Mirrors the API rules in src/lib/governance-team.ts and the handlers
 * sales/service-operations, psa/timesheets, sales/document-vault, sales/feasibility and /api/sales.
 * Scope = Governance, Risk & Compliance delivery projects with an active resource allocation.
 */
export const GOVERNANCE_ROLE_CATALOG: GovernanceMenuSection[] = [
  {
    groupCode: '06 · Project Delivery & Operations',
    groupTitle: 'Eksekusi Engagement GRC & Timesheet Tim',
    menus: [
      {
        label: 'Service Delivery & Projects',
        href: '/sales/delivery',
        preserveOpportunity: true,
        badge: 'Assessment · Gap · Remediation',
        roles: BOTH,
        functions: 'Mengerjakan tahapan engagement GRC (Cybersecurity Governance, GRC / Risk, ISO 27001 / 27701, PDP, DPO, IT Audit, IT Governance, ICOFR, BCM / BCP / DRP, Third Party Risk) pada proyek tempat Anda dialokasikan.',
        leader: [
          'Melihat seluruh proyek GRC tempat Anda dialokasikan beserta baseline scope teknis approved (scope, deliverable, lokasi, PIC, timeline, SLA)',
          'Menyimpan progres dan MENANDAI SELESAI task Assessment & evidence → Gap analysis → Remediation & action plan (atau Deliverable & acceptance layanan untuk ISO/PDP/IT Audit/BCM) dengan dokumen supporting Vault',
          'Urutan wajib: Gap analysis memerlukan Assessment selesai; Remediation memerlukan Gap analysis selesai',
          'Mengisi parameter layanan per tahap: standar/regulasi acuan, domain/unit, gap & referensi kontrol, prioritas risiko, action plan, pemilik dan target penyelesaian',
        ],
        member: [
          'Melihat proyek GRC tempat Anda dialokasikan dan baseline scope teknis approved',
          'Menyimpan progres task GRC: catatan pelaksanaan ≥12 karakter, parameter layanan dan target selesai',
          'Penyelesaian task (dengan evidence) dilakukan Governance Team Leader',
        ],
        limits: 'Engagement dimulai setelah PM mengaktifkan proyek (kickoff lengkap). Kickoff, aktivasi, penutupan proyek, milestone/BAST, invoice, kontrak, nilai PO dan budget/HPP tidak tersedia.',
      },
      {
        label: 'Project Timesheets',
        href: '/psa/timesheets',
        badge: 'Jam Kerja Tim',
        roles: BOTH,
        functions: 'Mencatat jam kerja engagement GRC; Leader mereview jam kerja anggota tim.',
        leader: [
          'Mengajukan jam kerja sendiri pada alokasi aktif (menit kelipatan 15, 15–480 per entri, billable, keterangan ≥12 karakter, tanggal tidak di masa depan)',
          'Melihat seluruh entri tim pada proyek GRC yang dialokasikan kepada Anda',
          'Setujui / Tolak entri submitted anggota tim dengan catatan review ≥12 karakter',
        ],
        member: [
          'Mengajukan jam kerja sendiri pada alokasi aktif proyek GRC',
          'Melihat status review entri milik sendiri',
        ],
        limits: 'Entri milik sendiri tidak dapat direview sendiri (maker-checker). Snapshot biaya/tarif harian tidak ditampilkan. Jam hanya dapat dicatat pada proyek aktif dalam bulan alokasi.',
      },
    ],
  },
  {
    groupCode: '04 · Presales, Tender & Solution',
    groupTitle: 'Perencanaan Resource Engagement GRC',
    menus: [
      {
        label: 'Resource & Solution Feasibility',
        href: '/sales/feasibility',
        preserveOpportunity: true,
        badge: 'Read-only · Leader',
        roles: ['governance_leader'],
        functions: 'Membaca rencana Feasibility Opportunity GRC yang masih terbuka untuk menyiapkan komposisi tim dan kapasitas.',
        leader: [
          'Melihat plan, alokasi engineer per bulan (person-days), kapasitas dan gap readiness Opportunity GRC terbuka',
          'Memberi masukan kepada Presales tentang kebutuhan auditor/konsultan dan jadwal',
        ],
        member: [],
        limits: 'Hanya baca. Plan dan alokasi dikelola Presales/Admin; costing dan review Finance/Approver. HPP, tarif, revenue dan margin disembunyikan.',
      },
    ],
  },
  {
    groupCode: '10 · Document Center & Governance',
    groupTitle: 'Evidence Assessment & Laporan',
    menus: [
      {
        label: 'Secure Document Vault',
        href: '/sales/documents',
        preserveOpportunity: true,
        badge: 'Supporting Engagement',
        roles: BOTH,
        functions: 'Menyimpan bukti engagement GRC terenkripsi: evidence assessment, kertas kerja, gap report, risk register, remediation plan dan laporan akhir.',
        leader: [
          'Unggah dokumen jenis supporting setelah Closed Won (PDF, DOCX, PNG, JPEG atau EML, maks. 8 MB); versi dan SHA-256 tercatat',
          'Baca/unduh library proyek (RKS/KAK, NDA, supporting) sebagai referensi scope',
          'Dokumen yang diunggah menjadi pilihan evidence saat menandai task selesai',
        ],
        member: [
          'Unggah evidence dan kertas kerja (jenis supporting) setelah Closed Won',
          'Baca/unduh library proyek sebagai referensi scope',
        ],
        limits: 'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.',
      },
    ],
  },
];

export function GovernanceWorkspaceGuide({
  role, opportunityId, currentStation, defaultOpen = false,
}: {role: string; opportunityId?: string; currentStation?: string; defaultOpen?: boolean}) {
  const [open, setOpen] = useState(defaultOpen);
  if (role !== 'governance_leader' && role !== 'governance_member' && role !== 'admin') return null;
  const leader = role !== 'governance_member';
  const label = role === 'governance_member' ? 'Governance Team Member' : 'Governance Team Leader';
  const sections = GOVERNANCE_ROLE_CATALOG
    .map(s => ({...s, menus: s.menus.filter(m => role === 'admin' || m.roles.includes(role as 'governance_leader'))}))
    .filter(s => s.menus.length);
  const menuCount = sections.reduce((n, s) => n + s.menus.length, 0);
  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;

  const cards = [
    {icon: <ClipboardCheck className="h-4 w-4 text-violet-700" aria-hidden="true" />, title: '1. Assessment & Evidence', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Kumpulkan evidence sesuai standar/regulasi acuan dan domain/unit yang dikontrak.'},
    {icon: <SearchCheck className="h-4 w-4 text-indigo-700" aria-hidden="true" />, title: '2. Gap Analysis', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Petakan gap terhadap referensi kontrol beserta prioritas/tingkat risiko.'},
    {icon: <Wrench className="h-4 w-4 text-teal-700" aria-hidden="true" />, title: '3. Remediation Plan', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: 'Susun action plan, pemilik dan target penyelesaian bersama customer.'},
    leader
      ? {icon: <Users className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: '4. QA & Review Tim', href: '/psa/timesheets', link: 'Project Timesheets', body: 'Tandai task selesai dengan evidence dan review timesheet anggota tim.'}
      : {icon: <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: '4. Timesheet', href: '/psa/timesheets', link: 'Project Timesheets', body: 'Catat jam kerja pada alokasi aktif; Leader mereview entri Anda.'},
  ];

  return (
    <section aria-label={`Detail Fitur, Fungsi dan Menu Role ${label}`}
      className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/90 via-white to-slate-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-900 text-white shadow-sm">
            <Scale className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-violet-900">Governance, Risk & Compliance Desk</span>
              <span className="rounded-full border border-violet-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-violet-800">{sections.length} Kelompok · {menuCount} Menu Aktif</span>
              {currentStation && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">Modul Aktif: {currentStation}</span>}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">Fitur, Fungsi & Menu Role {role === 'admin' ? 'Governance Team (Leader & Member)' : label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Governance Team mengerjakan engagement GRC setelah <i>Closed Won</i> dan aktivasi proyek oleh PM. Akses dibatasi pada proyek GRC
              tempat akun Anda memiliki alokasi resource aktif (ditetapkan Presales di Feasibility). {leader
                ? <>Leader menyelesaikan task dengan evidence, mereview timesheet tim dan membaca Feasibility GRC.</>
                : <>Member menyimpan progres dan evidence; penyelesaian task dilakukan Leader.</>}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3.5 py-2 text-xs font-bold text-violet-900 shadow-sm transition hover:bg-violet-50">
          {open ? 'Ringkas Detail Fitur' : 'Tampilkan Semua Fitur & Menu'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => (
          <div key={card.title} className="rounded-xl border border-violet-100 bg-white p-3.5">
            <div className="flex items-center gap-2 text-xs font-extrabold text-violet-950">{card.icon}{card.title}</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{card.body} <Link href={card.href} className="font-bold text-violet-800 underline">{card.link}</Link></p>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-violet-100 pt-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-violet-950">Katalog {menuCount} Menu, Fungsi & Fitur</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {sections.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={buildHref(menu.href, menu.preserveOpportunity)} className="inline-flex items-center gap-1 text-xs font-extrabold text-violet-900 hover:underline">
                          {menu.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-violet-100/80 px-2 py-0.5 text-[10px] font-bold text-violet-900">{menu.badge}</span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{menu.functions}</p>
                      {(role !== 'governance_member') && menu.leader.length > 0 && <>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-violet-800">Leader</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-600">{menu.leader.map(f => <li key={f}>{f}</li>)}</ul>
                      </>}
                      {(role !== 'governance_leader') && menu.member.length > 0 && <>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-violet-800">Member</p>
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
            <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />Aturan Tata Kelola Governance Team</div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li><b>Cakupan proyek:</b> API menolak proyek, dokumen dan timesheet di luar engagement GRC yang dialokasikan kepada Anda (HTTP 403).</li>
              <li><b>Allow-list API:</b> hanya Identity, daftar engagement, Service Delivery, Timesheets dan Document Vault (Leader: + Feasibility read-only). API lain ditolak sebelum handler.</li>
              <li><b>Maker-checker:</b> Member menyimpan progres, Leader menyelesaikan task dengan evidence; timesheet tidak dapat direview oleh pembuatnya.</li>
              <li><b>Kunci versi:</b> setiap perubahan memakai versi proyek; bila konflik (HTTP 409), muat ulang lalu ulangi.</li>
              <li className="flex items-start gap-1"><FolderLock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><b>Least privilege:</b> CRM, BoQ, harga, HPP, nilai PO, invoice, kontrak, paket komersial dan menu ERP tidak tersedia; Governance Team tidak dapat ditunjuk sebagai PM.</span></li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
