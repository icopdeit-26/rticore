'use client';
import React, {useState} from 'react';
import Link from 'next/link';
import {Crosshair, ShieldCheck, ListChecks, Clock3, FolderLock, ChevronDown, ArrowUpRight, Gauge} from 'lucide-react';

type Menu = {
  label: string;
  href: string;
  preserveOpportunity?: boolean;
  badge: string;
  functions: string;
  features: string[];
  limits: string;
};
export interface OffenseTeamMenuSection {
  groupCode: string;
  groupTitle: string;
  menus: Menu[];
}
type OffenseRole = 'offense_lead' | 'offense_member';

const DELIVERY_COMMON = [
  'Pemilih proyek hanya berisi engagement Offensive Security (VAPT, Red Team / Adversary Simulation, Attack Surface Management) tempat akun Anda memiliki alokasi resource aktif',
  'Baca Scope baseline approved: scope teknis, spesifikasi, kuantitas aset, deliverable, model delivery, lokasi, PIC, timeline dan service level',
  'Pantau tabel task kickoff dan engagement: status, target selesai dan siapa yang menyelesaikan',
];
const DELIVERY_LIMITS = 'Kickoff, aktivasi, milestone/BAST dan penutupan proyek dikelola PM/Presales. Nilai PO, termin pembayaran, invoice, kontrak, revenue dan budget HPP tidak ditampilkan. Engagement lain ditolak (HTTP 403).';
const VAULT: Menu = {
  label: 'Secure Document Vault',
  href: '/sales/documents',
  preserveOpportunity: true,
  badge: 'Evidence Engagement',
  functions: 'Menyimpan dan membuka evidence engagement asli (hasil scan, bukti eksploitasi terotorisasi, laporan VAPT, hasil retest) terenkripsi.',
  features: [
    'Unggah dokumen jenis supporting setelah Opportunity Closed Won (PDF, DOCX, PNG, JPEG atau EML, maksimal 8 MB); versi dan SHA-256 tercatat otomatis',
    'Baca dan unduh dokumen library engagement (RKS/KAK, NDA, rules of engagement, supporting) sebagai acuan otorisasi dan scope',
    'Dokumen supporting yang diunggah menjadi pilihan evidence saat task engagement diselesaikan',
  ],
  limits: 'Paket komersial (proposal, negosiasi, PO/SPK) tidak tersedia. Retensi, legal hold dan audit log dikelola Admin/Legal.',
};

/**
 * Menu, function and feature catalog per Offense Team role. Mirrors the API rules in
 * src/lib/offense-team.ts, api/sales/service-operations, psa/timesheets, sales/document-vault
 * and sales/feasibility (Leader only).
 */
export const OFFENSE_TEAM_ROLE_CATALOG: Record<OffenseRole, OffenseTeamMenuSection[]> = {
  offense_lead: [
    {
      groupCode: '04 · Presales, Tender & Solution',
      groupTitle: 'Perencanaan Kapasitas Tim Offense',
      menus: [{
        label: 'Resource & Solution Feasibility',
        href: '/sales/feasibility',
        preserveOpportunity: true,
        badge: 'Baca Saja',
        functions: 'Membaca rencana feasibility Opportunity Offensive Security yang masih terbuka untuk menyiapkan kapasitas dan komposisi tim.',
        features: [
          'Lihat estimasi person-days (aset × PD/aset × (1 + retest%) + PM/QA), tanggal delivery, status plan dan reviewer',
          'Lihat alokasi engineer per bulan beserta pemakaian kapasitas lintas proyek (PD terpakai / kapasitas)',
          'Lihat daftar engineer aktif, skills dan kapasitas PD/bulan untuk usulan penugasan kepada Presales',
          'Baca gap kesiapan feasibility yang harus ditutup sebelum delivery commitment',
        ],
        limits: 'Tidak dapat membuat plan, alokasi, resource atau cost line, dan tidak mereview plan. HPP, tarif engineer, cost line, penawaran supplier dan margin tidak ditampilkan.',
      }],
    },
    {
      groupCode: '06 · Project Delivery & Operations',
      groupTitle: 'Eksekusi Engagement & Review Timesheet Tim',
      menus: [
        {
          label: 'Service Delivery & Projects',
          href: '/sales/delivery',
          preserveOpportunity: true,
          badge: 'QA & Penyelesaian Task',
          functions: 'Memimpin pelaksanaan teknis engagement: scope, pengujian, laporan dan retest, serta mengesahkan penyelesaian task dengan evidence.',
          features: [
            ...DELIVERY_COMMON,
            'Perbarui task VAPT (scope, testing, report, retest): catatan ≥12 karakter, parameter layanan (aset, testing window, metodologi/RoE, temuan, versi laporan, hasil retest) dan target selesai',
            'Tandai task selesai dengan dokumen supporting asli dari Vault; urutan prasyarat scope → testing → report → retest ditegakkan sistem',
            'Task engagement dapat diperbarui setelah PM mengaktifkan proyek (checklist kickoff lengkap)',
          ],
          limits: DELIVERY_LIMITS,
        },
        {
          label: 'Project Timesheets',
          href: '/psa/timesheets',
          badge: 'Review Tim',
          functions: 'Mencatat jam kerja sendiri dan mereview timesheet anggota tim pada engagement yang Anda pimpin.',
          features: [
            'Ajukan jam kerja sendiri pada alokasi aktif: tanggal (tidak di masa depan), menit kelipatan 15 (15–480), billable, keterangan ≥12 karakter',
            'Lihat seluruh entri tim pada engagement Offensive Security yang dialokasikan kepada Anda',
            'Setujui atau Tolak entri submitted milik anggota tim dengan catatan review ≥12 karakter',
          ],
          limits: 'Entri milik sendiri direview Finance/Approver atau PM proyek. Snapshot biaya (tarif harian) tidak ditampilkan. Timesheet tidak otomatis diposting ke GL atau payroll.',
        },
      ],
    },
    {groupCode: '10 · Document Center & Governance', groupTitle: 'Evidence Engagement', menus: [VAULT]},
  ],
  offense_member: [
    {
      groupCode: '06 · Project Delivery & Operations',
      groupTitle: 'Pelaksanaan Pengujian & Pencatatan Jam Kerja',
      menus: [
        {
          label: 'Service Delivery & Projects',
          href: '/sales/delivery',
          preserveOpportunity: true,
          badge: 'Progres Task',
          functions: 'Melaksanakan pengujian sesuai scope dan rules of engagement, lalu mencatat progres pada task engagement.',
          features: [
            ...DELIVERY_COMMON,
            'Simpan progres task VAPT (scope, testing, report, retest): catatan ≥12 karakter, parameter layanan (aset diuji, temuan dan tingkat risiko, hasil retest) dan target selesai',
            'Task engagement dapat diperbarui setelah PM mengaktifkan proyek (checklist kickoff lengkap)',
          ],
          limits: 'Penyelesaian task dengan evidence dilakukan Offense Team Leader. ' + DELIVERY_LIMITS,
        },
        {
          label: 'Project Timesheets',
          href: '/psa/timesheets',
          badge: 'Jam Kerja Sendiri',
          functions: 'Mencatat jam kerja pengujian pada alokasi engagement Anda.',
          features: [
            'Ajukan jam kerja pada alokasi aktif: tanggal (tidak di masa depan, di dalam jadwal proyek), menit kelipatan 15 (15–480), billable, keterangan ≥12 karakter',
            'Lihat riwayat dan status entri milik sendiri (submitted, approved, rejected) beserta reviewer',
          ],
          limits: 'Hanya entri milik sendiri yang terlihat. Review oleh Offense Team Leader, PM proyek, Finance atau Approver. Snapshot biaya tidak ditampilkan.',
        },
      ],
    },
    {groupCode: '10 · Document Center & Governance', groupTitle: 'Evidence Engagement', menus: [VAULT]},
  ],
};

const ROLE_NAME: Record<OffenseRole, string> = {offense_lead: 'Offense Team Leader', offense_member: 'Offense Team Member'};

export function OffenseTeamWorkspaceGuide({
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
  if (role !== 'offense_lead' && role !== 'offense_member') return null;
  const catalog = OFFENSE_TEAM_ROLE_CATALOG[role];
  const name = ROLE_NAME[role];
  const lead = role === 'offense_lead';
  const menuCount = catalog.reduce((n, s) => n + s.menus.length, 0);
  const buildHref = (href: string, preserve?: boolean) =>
    preserve && opportunityId ? `${href}?opportunity_id=${encodeURIComponent(opportunityId)}` : href;
  const cards = [
    {icon: <ListChecks className="h-4 w-4 text-rose-700" aria-hidden="true" />, title: lead ? '1. QA & Selesaikan Task' : '1. Kerjakan Pengujian', href: buildHref('/sales/delivery', true), link: 'Service Delivery', body: lead ? 'Periksa hasil pengujian tim dan tandai task VAPT selesai dengan evidence Vault.' : 'Catat progres scope, testing, report dan retest sesuai rules of engagement.'},
    {icon: <FolderLock className="h-4 w-4 text-indigo-700" aria-hidden="true" />, title: '2. Evidence Asli', href: buildHref('/sales/documents', true), link: 'Document Vault', body: 'Unggah laporan, bukti temuan dan hasil retest sebagai dokumen supporting terenkripsi.'},
    {icon: <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />, title: lead ? '3. Review Timesheet Tim' : '3. Catat Jam Kerja', href: '/psa/timesheets', link: 'Project Timesheets', body: lead ? 'Setujui atau tolak jam kerja anggota tim; entri Anda direview pihak lain.' : 'Ajukan jam kerja harian pada alokasi engagement Anda.'},
    ...(lead ? [{icon: <Gauge className="h-4 w-4 text-teal-700" aria-hidden="true" />, title: '4. Kapasitas Tim', href: buildHref('/sales/feasibility', true), link: 'Feasibility', body: 'Baca estimasi PD dan alokasi engineer Opportunity Offensive yang masih terbuka.'}] : []),
  ];

  return (
    <section
      aria-label={`Detail Fitur, Fungsi dan Menu Role ${name}`}
      className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50/90 via-white to-slate-50 p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-900 text-white shadow-sm">
            <Crosshair className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-rose-900">
                Offensive Security Desk
              </span>
              <span className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-rose-800">
                {catalog.length} Kelompok · {menuCount} Menu Aktif
              </span>
              {currentStation && (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                  Modul Aktif: {currentStation}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-extrabold text-slate-900">Fitur, Fungsi & Menu Role {name}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {lead
                ? <>Role <b>Offense Team Leader</b> memimpin pelaksanaan teknis engagement VAPT/Red Team, mengesahkan penyelesaian task dengan evidence, mereview timesheet tim dan membaca Feasibility untuk perencanaan kapasitas.</>
                : <>Role <b>Offense Team Member</b> melaksanakan pengujian sesuai scope dan rules of engagement, mencatat progres task, menyimpan evidence dan mengajukan jam kerja.</>}
              {' '}Akses dibatasi pada engagement Offensive Security tempat Anda dialokasikan; CRM, BoQ, harga, HPP dan ERP tidak tersedia.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-xs font-bold text-rose-900 shadow-sm transition hover:bg-rose-50"
        >
          {open ? 'Ringkas Detail Fitur' : 'Tampilkan Semua Fitur & Menu'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${lead ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
        {cards.map(card => (
          <div key={card.title} className="rounded-xl border border-rose-100 bg-white p-3.5">
            <div className="flex items-center gap-2 text-xs font-extrabold text-rose-950">{card.icon}{card.title}</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
              {card.body} <Link href={card.href} className="font-bold text-rose-800 underline">{card.link}</Link>
            </p>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-5 space-y-4 border-t border-rose-100 pt-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-rose-950">Katalog {menuCount} Menu, Fungsi & Fitur Role {name}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {catalog.map(section => (
              <div key={section.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">{section.groupCode}</p>
                <p className="text-xs font-bold text-slate-800">{section.groupTitle}</p>
                <div className="mt-3 space-y-3">
                  {section.menus.map(menu => (
                    <div key={menu.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={buildHref(menu.href, menu.preserveOpportunity)} className="inline-flex items-center gap-1 text-xs font-extrabold text-rose-900 hover:underline">
                          {menu.label}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                        <span className="rounded-md bg-rose-100/80 px-2 py-0.5 text-[10px] font-bold text-rose-900">{menu.badge}</span>
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
              Aturan Tata Kelola Role {name}
            </div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed">
              <li><b>Otorisasi pengujian:</b> lakukan pengujian hanya pada aset, testing window dan rules of engagement yang tercatat di scope baseline dan dokumen Vault.</li>
              <li><b>Cakupan engagement:</b> API menolak proyek, dokumen dan timesheet di luar engagement Offensive Security yang dialokasikan kepada Anda (HTTP 403).</li>
              <li><b>Maker-checker:</b> {lead ? 'timesheet Anda direview Finance/Approver atau PM proyek; Anda tidak mereview entri sendiri.' : 'penyelesaian task oleh Offense Team Leader; timesheet Anda direview Leader, PM, Finance atau Approver.'}</li>
              <li><b>Kunci versi:</b> perubahan task memakai versi proyek; bila muncul konflik versi (HTTP 409), muat ulang lalu ulangi.</li>
              <li><b>Least privilege:</b> BoQ, HPP, tarif engineer, nilai PO, paket komersial, CRM, FlexGuard dan menu ERP tidak tersedia bagi Offense Team.</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
