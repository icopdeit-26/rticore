/**
 * Section "02 · Technical Scoping & Delivery" adapts to the BoQ product type.
 * Only optional fields may be hidden: everything required by stage gates
 * (REQUIRED_BY_STAGE) or by the Post-PO project checklist stays visible.
 */
import type { ScopingService } from './scoping-service-options';
import { SCOPING_SERVICE_TYPES } from './scoping-service-options';
import { serviceDefinition } from './sales-workflow';
import type { ClientTier } from './types';

type Hint = { label?: string; placeholder?: string };
export type DeliveryProfile = { hints: Partial<Record<string, Hint>>; notApplicable: readonly string[] };

/** Never hide these — stage gates / Post-PO checklist depend on them. */
export const ALWAYS_VISIBLE = new Set([
  'technical_scope', 'technical_specifications', 'scope_quantity', 'deliverables', 'delivery_model',
  'project_site', 'project_province', 'project_postal', 'project_pic_name', 'project_pic_phone', 'project_pic_email',
  'implementation_timeline', 'contract_duration',
]);

/** Fields written by the ICOP estimator; rendered by the estimator, not as plain inputs. */
export const SCOPING_ESTIMATE_KEYS = [
  'scoping_product', 'scoping_params', 'scoping_estimate_md', 'scoping_estimate_base',
  'scoping_estimate_price', 'scoping_client_tier', 'scoping_model_version',
] as const;

const P: Record<ScopingService, DeliveryProfile> = {
  VAPT: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Scope pengujian (objek & batas)', placeholder: 'Contoh: Pentest web internet banking & API mobile, production read-only, tanpa DoS' },
    technical_specifications: { label: 'Spesifikasi target & lingkungan', placeholder: 'URL/IP, environment (prod/UAT), akun uji per role, whitelist IP penguji' },
    scope_quantity: { label: 'Jumlah aset (web/mobile/API/IP)', placeholder: 'Terisi otomatis dari estimator VAPT' },
    service_level: { label: 'Testing window', placeholder: 'Contoh: Senin–Jumat 19.00–05.00 WIB' },
    deliverables: { label: 'Laporan & retest', placeholder: 'Executive & technical report, 1x retest dalam 30 hari' },
    methodology: { label: 'Metodologi & Rules of Engagement', placeholder: 'Grey box · OWASP WSTG/MASVS · PTES · surat otorisasi' },
    contract_duration: { label: 'Durasi pekerjaan', placeholder: 'Contoh: 4 minggu termasuk retest' },
    asset_profile: { placeholder: 'Terisi otomatis dari estimator VAPT' },
  } },
  SOC: { notApplicable: [], hints: {
    technical_scope: { label: 'Scope monitoring', placeholder: 'Log source, use case, eskalasi, jam layanan' },
    scope_quantity: { label: 'Log source & EPS', placeholder: 'Terisi otomatis dari EPS sizing' },
    service_level: { label: 'SLA & jam layanan', placeholder: '24x7 · MTTA 15 menit untuk Critical' },
    license_or_sku: { label: 'Lisensi SIEM / SOAR / retensi', placeholder: 'Platform, EPS lisensi, retensi 90 hari hot / 1 tahun archive' },
    methodology: { label: 'Use case & playbook', placeholder: 'MITRE ATT&CK coverage, playbook triage & eskalasi' },
    deliverables: { label: 'Laporan layanan', placeholder: 'Laporan harian/bulanan, review SLA, threat hunting report' },
    contract_duration: { label: 'Periode kontrak (bulan)' },
  } },
  CTI: { notApplicable: [], hints: {
    technical_scope: { label: 'Aset & cakupan intelijen', placeholder: 'Domain, brand, VIP, mobile app yang dimonitor' },
    scope_quantity: { label: 'Digital footprint', placeholder: 'Terisi otomatis dari footprint score' },
    service_level: { label: 'Frekuensi laporan & SLA alert', placeholder: 'Alert kritikal ≤ 4 jam, laporan bulanan' },
    license_or_sku: { label: 'Feed / platform CTI' },
    methodology: { label: 'Sumber intelijen & metodologi' },
    contract_duration: { label: 'Periode langganan (bulan)' },
  } },
  ISO: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Scope ISMS / standar', placeholder: 'Standar, entitas, lokasi, proses dalam lingkup sertifikasi' },
    scope_quantity: { label: 'Site, unit kerja & proses' },
    service_level: { label: 'Jadwal workshop / audit' },
    deliverables: { label: 'Dokumen & pendampingan', placeholder: 'Gap report, SoA, kebijakan/SOP, audit internal, pendampingan audit sertifikasi' },
    methodology: { label: 'Pendekatan implementasi', placeholder: 'PDCA, risk assessment ISO 27005' },
  } },
  PDP: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Scope pemrosesan data pribadi' },
    scope_quantity: { label: 'Proses, sistem & pihak ketiga' },
    service_level: { label: 'Jadwal workshop / interview' },
    deliverables: { label: 'ROPA, DPIA, kebijakan & SOP' },
    methodology: { label: 'Kerangka (UU PDP, ISO 27701)' },
  } },
  Hardening: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Objek hardening & baseline' },
    scope_quantity: { label: 'Jumlah aset per platform' },
    service_level: { label: 'Change window', placeholder: 'Contoh: Sabtu 22.00–04.00, CAB approval' },
    deliverables: { label: 'Laporan, baseline & validasi', placeholder: 'Before/after compliance score, rollback plan' },
    methodology: { label: 'Standar acuan', placeholder: 'CIS Benchmark Level 1, vendor hardening guide' },
  } },
  IR: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Cakupan insiden & otorisasi' },
    scope_quantity: { label: 'Aset terdampak / jam retainer' },
    service_level: { label: 'SLA respons insiden', placeholder: 'Remote 4 jam, onsite 24 jam' },
    deliverables: { label: 'Laporan insiden & rekomendasi' },
    methodology: { label: 'Kerangka respons', placeholder: 'NIST SP 800-61, containment → eradication → recovery' },
    contract_duration: { label: 'Periode retainer / penugasan' },
  } },
  GRC: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Domain GRC & framework' },
    scope_quantity: { label: 'Unit, proses & kontrol' },
    service_level: { label: 'Jadwal workshop / fieldwork' },
    deliverables: { label: 'Laporan, register & roadmap' },
    methodology: { label: 'Framework & pendekatan', placeholder: 'POJK, COBIT, ISO 31000, NIST CSF' },
  } },
  DFIR: { notApplicable: ['license_or_sku'], hints: {
    technical_scope: { label: 'Sumber bukti & batas otorisasi' },
    scope_quantity: { label: 'Perangkat / evidence & volume data' },
    service_level: { label: 'Prioritas & SLA aktivasi' },
    deliverables: { label: 'Laporan forensik & chain of custody' },
    methodology: { label: 'Metodologi forensik', placeholder: 'ISO 27037, write-blocker, hash verifikasi' },
  } },
  TECHNOLOGY: { notApplicable: [], hints: {
    technical_scope: { label: 'Solusi, integrasi & serah terima' },
    scope_quantity: { label: 'Device / user / lisensi' },
    service_level: { label: 'Support & SLA vendor' },
    license_or_sku: { label: 'OEM / SKU / lisensi / perangkat', placeholder: 'SKU, jumlah, masa subscription, support level' },
    methodology: { label: 'Tahapan implementasi', placeholder: 'Design → install → integrasi → UAT → handover' },
    contract_duration: { label: 'Masa lisensi / layanan' },
  } },
  TRAINING: { notApplicable: ['license_or_sku', 'service_level', 'resourcing_model'], hints: {
    technical_scope: { label: 'Topik & tujuan pelatihan' },
    technical_specifications: { label: 'Profil peserta & prasyarat', placeholder: 'Level peserta, lab/perangkat yang dibutuhkan' },
    scope_quantity: { label: 'Peserta × batch × hari' },
    deliverables: { label: 'Materi, sertifikat & evaluasi' },
    methodology: { label: 'Metode pelatihan', placeholder: 'Kelas, hands-on lab, tabletop, pre/post test' },
    team_composition: { label: 'Trainer & asisten' },
    contract_duration: { label: 'Periode pelaksanaan' },
  } },
  Lainnya: { notApplicable: [], hints: {} },
};

export function deliveryProfile(product: string | undefined): DeliveryProfile {
  return P[(product && SCOPING_SERVICE_TYPES.includes(product as ScopingService) ? product : 'Lainnya') as ScopingService];
}

/** Products allowed for a service family (from SERVICE_CATALOG.boq), restricted to scoping types. */
export function productsForFamily(family: string | undefined): ScopingService[] {
  const list = family ? (serviceDefinition(family).boq as readonly string[]) : SCOPING_SERVICE_TYPES;
  const out = [...new Set(list)].filter((x): x is ScopingService => SCOPING_SERVICE_TYPES.includes(x as ScopingService));
  return out.length ? out : ['Lainnya'];
}

/** Suggest an ICOP client tier from the CRM customer segment (editable by Presales). */
export function tierFromSegment(segment: string | undefined): ClientTier {
  switch (segment) {
    case 'BUMN': return 'S';
    case 'Pemerintah Pusat': case 'Pemerintah Daerah': case 'BUMD': case 'Pendidikan': return 'D';
    case 'UMKM / SME': case 'Startup': case 'Organisasi Nirlaba': case 'Perorangan': return 'B';
    default: return 'A';
  }
}
