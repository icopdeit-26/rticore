/**
 * Product-type pricing profile for Smart Scoping.
 *
 * Source artifacts (ICOP DefendIT360):
 *  - icop_pricing_proposal_schema.sql: pricing_sessions (client_tier, location_type,
 *    floor/standard/premium), pricing_vapt/soc/cti_inputs, boq_internal (A+B+C+D+E,
 *    margin_warning < 25%), boq_hr_details + rate_card (role_level x location).
 *  - ICOP_PreDev_Decisions_v1.0 §01: Effective Rate = Base x DAI x Client Tier,
 *    Urgency_idx (>=2 minggu 1.00, <2 minggu 1.25, <1 minggu 1.40), PM 15-20% MD,
 *    Premium = Standard x 1.25, CTI MRC band (BRD Appendix A.3).
 *
 * Everything here is an INTERNAL indication for Presales. It never becomes a
 * quotation price: BoQ keeps unit_price = 0 and Finance/approval rules stay in D1.
 */
import {
  RATE_CARD_COST,
  CLIENT_TIER_MULTIPLIERS,
  calculateDAI,
  calculateHRCost,
  calculateBoQ,
  calculate3Ranges,
} from './pricing-engine';
import type { ClientTier, LocationType, RoleLevel } from './types';
import type { ScopingService } from './scoping-service-options';

export type PricingModel = 'md' | 'soc_mrc' | 'cti_mrc';
export type UrgencyLevel = 'normal' | 'rush' | 'emergency';
export type CostCode = 'A' | 'B' | 'C' | 'D' | 'E';

export const CLIENT_TIERS: readonly ClientTier[] = ['S', 'A', 'B', 'C', 'D', 'E'];
export const LOCATION_OPTIONS: ReadonlyArray<{ id: LocationType; label: string }> = [
  { id: 'remote', label: 'Remote' },
  { id: 'jabotabek', label: 'Onsite Jabotabek' },
  { id: 'luar_jabotabek', label: 'Onsite Luar Jabotabek' },
  { id: 'overseas', label: 'Overseas' },
];
export const URGENCY_OPTIONS: ReadonlyArray<{ id: UrgencyLevel; label: string; index: number }> = [
  { id: 'normal', label: 'Kickoff ≥ 2 minggu (1,00)', index: 1.0 },
  { id: 'rush', label: 'Kickoff < 2 minggu — rush (1,25)', index: 1.25 },
  { id: 'emergency', label: 'Kickoff < 1 minggu — emergency (1,40)', index: 1.4 },
];
export const ROLE_LABELS: Record<RoleLevel, string> = {
  project_manager: 'Project Manager',
  lead: 'Lead / Senior Consultant',
  senior: 'Senior Analyst',
  junior: 'Junior Analyst',
  forensic: 'Forensic Specialist',
  sme_external: 'SME Eksternal',
  soc_analyst_l1: 'SOC Analyst L1',
  soc_analyst_l2: 'SOC Analyst L2',
  cti_analyst: 'CTI Analyst',
  technical_writer: 'Technical Writer',
};
export const COST_LABELS: Record<CostCode, string> = {
  A: 'A · HR / Personil',
  B: 'B · Komisi Sales & Partner',
  C: 'C · Dokumen / Deliverables',
  D: 'D · Tools / Vendor / Subcon',
  E: 'E · Akomodasi & Travel',
};

export type ProductPricingProfile = {
  model: PricingModel;
  /** Default allocation of total MD to ICOP role_level (shares sum to 1). */
  roles: ReadonlyArray<{ role: RoleLevel; share: number }>;
  hints: Partial<Record<CostCode, string>>;
  basis: string;
};

const standardTeam = [
  { role: 'project_manager', share: 0.15 }, { role: 'lead', share: 0.25 },
  { role: 'senior', share: 0.4 }, { role: 'junior', share: 0.2 },
] as const;

export const PRODUCT_PRICING: Record<ScopingService, ProductPricingProfile> = {
  VAPT: { model: 'md', roles: standardTeam,
    basis: 'MD dari kalkulator VAPT multi-aset (pricing_vapt_inputs)',
    hints: { D: 'Nessus, Burp Suite Pro, tools mobile / cloud', E: 'Wajib jika onsite' } },
  SOC: { model: 'soc_mrc', roles: [{ role: 'soc_analyst_l1', share: 0.7 }, { role: 'soc_analyst_l2', share: 0.3 }], basis: 'MRC dari EPS sizing (pricing_soc_inputs) × tier × DAI',
    hints: { A: 'Biaya analis L1/L2 per bulan', D: 'Lisensi SIEM / SOAR per bulan' } },
  CTI: { model: 'cti_mrc', roles: [{ role: 'cti_analyst', share: 1 }],
    basis: 'MRC dari footprint score (pricing_cti_inputs) × tier × DAI',
    hints: { A: 'CTI analyst per bulan', D: 'Feed / platform CTI (OpenCTI, Cybersixgill, dll) per bulan' } },
  ISO: { model: 'md', roles: [{ role: 'project_manager', share: 0.15 }, { role: 'lead', share: 0.35 },
    { role: 'senior', share: 0.35 }, { role: 'junior', share: 0.15 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'Badan sertifikasi / auditor eksternal' } },
  PDP: { model: 'md', roles: [{ role: 'project_manager', share: 0.15 }, { role: 'lead', share: 0.3 },
    { role: 'senior', share: 0.4 }, { role: 'junior', share: 0.15 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'Legal reviewer / tools data discovery' } },
  Hardening: { model: 'md', roles: [{ role: 'project_manager', share: 0.1 }, { role: 'lead', share: 0.2 },
    { role: 'senior', share: 0.4 }, { role: 'junior', share: 0.3 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'Tools CIS-CAT / scanner konfigurasi' } },
  IR: { model: 'md', roles: [{ role: 'project_manager', share: 0.1 }, { role: 'lead', share: 0.3 },
    { role: 'forensic', share: 0.4 }, { role: 'senior', share: 0.2 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'EDR sementara / tools triage', E: 'Respons onsite' } },
  GRC: { model: 'md', roles: [{ role: 'project_manager', share: 0.15 }, { role: 'lead', share: 0.35 },
    { role: 'senior', share: 0.35 }, { role: 'junior', share: 0.15 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'SME regulasi eksternal' } },
  DFIR: { model: 'md', roles: [{ role: 'project_manager', share: 0.1 }, { role: 'forensic', share: 0.6 },
    { role: 'lead', share: 0.15 }, { role: 'senior', share: 0.15 }],
    basis: 'Estimasi MD Presales × rate card ICOP', hints: { D: 'Lisensi forensik, write blocker, media evidence' } },
  TECHNOLOGY: { model: 'md', roles: standardTeam,
    basis: 'MD implementasi × rate card ICOP + lisensi vendor (komponen D)',
    hints: { D: 'Harga beli lisensi / perangkat dari vendor (pass-through)' } },
  TRAINING: { model: 'md', roles: [{ role: 'project_manager', share: 0.1 }, { role: 'lead', share: 0.6 },
    { role: 'senior', share: 0.3 }],
    basis: 'MD trainer (hari × batch) × rate card ICOP', hints: { C: 'Modul, sertifikat & kit peserta', E: 'Venue / travel trainer' } },
  Lainnya: { model: 'md', roles: standardTeam,
    basis: 'Estimasi MD Presales × rate card ICOP', hints: {} },
};

// ---------------------------------------------------------------------------
// CTI footprint (pricing_cti_inputs.footprint_score / cti_tier) — BRD A.3 bands
// ---------------------------------------------------------------------------
export const CTI_TIERS = [
  { id: 'basic', label: 'Basic', maxScore: 15, mrcMin: 10000000, mrcMax: 20000000 },
  { id: 'standard', label: 'Standard', maxScore: 40, mrcMin: 25000000, mrcMax: 45000000 },
  { id: 'advanced', label: 'Advanced', maxScore: 80, mrcMin: 50000000, mrcMax: 80000000 },
  { id: 'elite', label: 'Enterprise / Elite', maxScore: 150, mrcMin: 90000000, mrcMax: 150000000 },
] as const;
const THREAT_FACTOR: Record<string, number> = { Low: 0.8, Medium: 1.0, High: 1.2, Critical: 1.5 };

const int = (v: string | undefined) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

/** Initial ICOP footprint weighting; Head Services calibrates bands semi-annually. */
export function calculateCtiFootprint(values: Record<string, string>) {
  const raw = int(values.cti_domains) * 2 + int(values.cti_subsidiaries) * 3 +
    int(values.cti_executives) + int(values.cti_mobile_apps) * 2 +
    (values.cti_brand_monitoring === 'Ya' ? 5 : 0);
  const score = Math.round(raw * (THREAT_FACTOR[values.cti_threat_level] ?? 1));
  let lower = 0;
  for (const tier of CTI_TIERS) {
    if (score <= tier.maxScore || tier.id === 'elite') {
      const position = Math.min(1, Math.max(0, (score - lower) / (tier.maxScore - lower)));
      const base = Math.round((tier.mrcMin + (tier.mrcMax - tier.mrcMin) * position) / 100000) * 100000;
      return { score, tier: tier.id, tierLabel: tier.label, baseMrc: base };
    }
    lower = tier.maxScore;
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------------
// Commercial context shared by all product types
// ---------------------------------------------------------------------------
export type CommercialContext = {
  client_tier: ClientTier;
  location_type: LocationType;
  urgency: UrgencyLevel;
  /** Total effort in MD for non-VAPT md products (Presales estimate). */
  total_md: string;
  /** Optional manual MD per role; empty = auto allocation. */
  role_md: Partial<Record<RoleLevel, string>>;
  /** Nominal Rp for B-E (and A for MRC products), as typed. */
  costs: Partial<Record<CostCode, string>>;
};

export const defaultCommercialContext = (): CommercialContext => ({
  client_tier: 'A', location_type: 'remote', urgency: 'normal', total_md: '', role_md: {}, costs: {},
});

const money = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e13 ? Math.round(n) : NaN;
};

export function validateCommercialContext(ctx: CommercialContext): string[] {
  const issues: string[] = [];
  if (!CLIENT_TIERS.includes(ctx.client_tier)) issues.push('Client tier tidak valid');
  if (!LOCATION_OPTIONS.some(l => l.id === ctx.location_type)) issues.push('Lokasi tidak valid');
  if (!URGENCY_OPTIONS.some(u => u.id === ctx.urgency)) issues.push('Urgensi tidak valid');
  if (ctx.total_md.trim() && !(Number(ctx.total_md) > 0 && Number(ctx.total_md) <= 100000)) issues.push('Estimasi MD harus 0–100.000');
  for (const [role, v] of Object.entries(ctx.role_md)) {
    if (v && v.trim() && !(Number(v) >= 0 && Number(v) <= 100000)) issues.push('MD ' + (ROLE_LABELS[role as RoleLevel] || role) + ' tidak valid');
  }
  for (const [code, v] of Object.entries(ctx.costs)) {
    if (Number.isNaN(money(v))) issues.push('Komponen ' + code + ' harus angka ≥ 0');
  }
  return issues;
}

export type ScopingPriceEstimate = {
  model: PricingModel;
  ready: boolean;
  reason?: string;
  periodLabel: '' | '/bulan';
  tierMultiplier: number;
  dai: number;
  totalMd: number;
  staffing: Array<{ role: RoleLevel; mandays: number; rate: number; subtotal: number; manual: boolean }>;
  costs: Record<CostCode, number>;
  totalInternalCost: number;
  floor: number | null;
  standard: number;
  premium: number;
  marginAtStandard: number | null;
  marginWarning: boolean;
  contractMonths?: number;
  contractValueStandard?: number;
  cti?: ReturnType<typeof calculateCtiFootprint>;
  /** Calibration factor applied (1 = uncalibrated). */
  calibrationFactor: number;
  /** Uncalibrated ICOP Standard (per period) — the base used to learn calibration. */
  baseStandard: number;
  /** True when calibration would have gone below Floor and was held at Floor. */
  heldAtFloor: boolean;
};

/** Whole-contract value for comparison with the final PO (MRC x months, or project price). */
export function contractTotals(e: ScopingPriceEstimate): { base: number; calibrated: number } {
  const months = e.model === 'md' ? 1 : (e.contractMonths || 1);
  return { base: Math.round(e.baseStandard * months), calibrated: Math.round(e.standard * months) };
}

function applyCalibration(base: number, floor: number | null, factor: number) {
  const calibrated = Math.round(base * factor);
  const held = floor !== null && calibrated < floor;
  return { standard: held ? floor! : calibrated, heldAtFloor: held };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Produces the ICOP 3-range indication for the active product type.
 * md products: Component A = role MD x rate_card(location); ranges via calculate3Ranges.
 * MRC products: Standard = base MRC x tier x DAI; Floor = monthly HPP / (1 - 20%) if HPP given.
 */
export function estimateScopingPrice(input: {
  service: ScopingService;
  ctx: CommercialContext;
  vaptTotalMd?: number;
  socBaseMrc?: number;
  socMonths?: number;
  serviceValues?: Record<string, string>;
  /** Active calibration factor for this product (from Admin model). */
  calibrationFactor?: number;
  /** Sales-facing indication uses selling baselines without internal cost inputs or floors. */
  sellingOnly?: boolean;
}): ScopingPriceEstimate {
  const factor = typeof input.calibrationFactor === 'number' && Number.isFinite(input.calibrationFactor)
    ? Math.min(1.4, Math.max(0.6, input.calibrationFactor)) : 1;
  const profile = PRODUCT_PRICING[input.service];
  const { ctx } = input;
  const tierMultiplier = CLIENT_TIER_MULTIPLIERS[ctx.client_tier]?.default ?? 1;
  const urgencyIndex = URGENCY_OPTIONS.find(u => u.id === ctx.urgency)?.index ?? 1;
  // CPI/FX/Market indices are maintained by Head Services; scoping only controls urgency.
  const dai = calculateDAI({ cpi_index: 1, fx_index: 1, market_index: 1, urgency_index: urgencyIndex });
  const typed = (code: CostCode) => { const m = money(ctx.costs[code]); return m === null || Number.isNaN(m) ? null : m; };
  const base: Omit<ScopingPriceEstimate, 'ready' | 'floor' | 'standard' | 'premium' | 'marginAtStandard' | 'marginWarning' | 'totalInternalCost' | 'costs' | 'baseStandard' | 'heldAtFloor'> = {
    model: profile.model, periodLabel: profile.model === 'md' ? '' : '/bulan',
    tierMultiplier, dai, totalMd: 0, staffing: [], calibrationFactor: factor,
  };
  const notReady = { baseStandard: 0, heldAtFloor: false };

  if (profile.model === 'md') {
    const totalMd = input.service === 'VAPT' ? (input.vaptTotalMd || 0) : Number(ctx.total_md) || 0;
    const staffing = profile.roles.map(({ role, share }) => {
      const manualRaw = ctx.role_md[role];
      const manual = !!manualRaw && manualRaw.trim() !== '' && Number(manualRaw) >= 0;
      const mandays = manual ? r1(Number(manualRaw)) : r1(totalMd * share);
      return { role, mandays, manual };
    });
    const hr = calculateHRCost(staffing.map(s => ({ role_level: s.role, mandays: s.mandays })), ctx.location_type);
    const costs: Record<CostCode, number> = {
      A: hr.totalHRCost,
      B: typed('B') ?? 0,
      C: typed('C') ?? 2000000,
      D: typed('D') ?? 0,
      E: typed('E') ?? 0,
    };
    const totalInternalCost = costs.A + costs.B + costs.C + costs.D + costs.E;
    const effortMd = r1(staffing.reduce((s, x) => s + x.mandays, 0));
    if (effortMd <= 0) {
      return { ...base, ...notReady, totalMd: 0, staffing: [], costs, totalInternalCost, ready: false,
        reason: input.service === 'VAPT' ? 'Lengkapi aset VAPT untuk menghitung MD.' : 'Isi estimasi total MD untuk melihat indikasi harga.',
        floor: null, standard: 0, premium: 0, marginAtStandard: null, marginWarning: false };
    }
    // Pass-through components (D tools/vendor, E travel) are added on top of the selling baseline.
    const ranges = calculate3Ranges({ totalInternalCost, totalSellingBaseline: hr.totalSellingBaseline, dai, tierMultiplier });
    const sellingBaseline = Math.round(hr.totalSellingBaseline * dai * tierMultiplier);
    const baseStandard = input.sellingOnly?sellingBaseline:Math.max(ranges.standard_price,sellingBaseline+costs.D+costs.E);
    const { standard, heldAtFloor } = applyCalibration(baseStandard,input.sellingOnly?null:ranges.floor_price,factor);
    const boq = calculateBoQ({ component_a_total: costs.A, component_b_total: costs.B, component_c_total: costs.C,
      component_d_total: costs.D, component_e_total: costs.E, quoted_price: standard });
    return { ...base, baseStandard, heldAtFloor, totalMd: effortMd,
      staffing: staffing.map((s, i) => ({ role: s.role, mandays: s.mandays, manual: s.manual,
        rate: hr.details[i].daily_cost_rate, subtotal: hr.details[i].subtotal })),
      costs, totalInternalCost, ready: true, floor: ranges.floor_price, standard,
      premium: Math.round(standard * 1.25), marginAtStandard: boq.gross_margin_pct, marginWarning: boq.margin_warning };
  }

  // MRC products (SOC / CTI): HPP is entered per month by Presales/Finance.
  const costs: Record<CostCode, number> = { A: typed('A') ?? 0, B: typed('B') ?? 0, C: typed('C') ?? 0, D: typed('D') ?? 0, E: typed('E') ?? 0 };
  const totalInternalCost = costs.A + costs.B + costs.C + costs.D + costs.E;
  const cti = profile.model === 'cti_mrc' ? calculateCtiFootprint(input.serviceValues || {}) : undefined;
  const baseMrc = profile.model === 'soc_mrc' ? (input.socBaseMrc || 0) : (cti?.baseMrc || 0);
  const months = profile.model === 'soc_mrc' ? (input.socMonths || 0) : int(input.serviceValues?.cti_months);
  const ctiIncomplete = profile.model === 'cti_mrc' && int(input.serviceValues?.cti_domains) < 1;
  if (baseMrc <= 0 || ctiIncomplete) {
    return { ...base, ...notReady, costs, totalInternalCost, cti: ctiIncomplete ? undefined : cti, ready: false,
      reason: ctiIncomplete ? 'Isi jumlah domain dan footprint CTI untuk menghitung MRC.' : 'Lengkapi parameter layanan untuk menghitung MRC.',
      floor: null, standard: 0, premium: 0, marginAtStandard: null, marginWarning: false };
  }
  const floor = totalInternalCost > 0 ? Math.round(totalInternalCost / (1 - 0.2)) : null;
  const baseStandard = Math.max(Math.round(baseMrc * dai * tierMultiplier), floor ?? 0);
  const { standard, heldAtFloor } = applyCalibration(baseStandard, floor, factor);
  const boq = totalInternalCost > 0 ? calculateBoQ({ component_a_total: costs.A, component_b_total: costs.B,
    component_c_total: costs.C, component_d_total: costs.D, component_e_total: costs.E, quoted_price: standard }) : null;
  return { ...base, baseStandard, heldAtFloor, costs, totalInternalCost, cti, ready: true, floor, standard, premium: Math.round(standard * 1.25),
    marginAtStandard: boq ? boq.gross_margin_pct : null, marginWarning: !!boq?.margin_warning,
    contractMonths: months || undefined, contractValueStandard: months ? standard * months : undefined };
}

/** HPP suggestion handed to BoQ. Only Finance/Admin can persist it there. */
export function hppSuggestion(estimate: ScopingPriceEstimate): Array<{ code: CostCode; amount: number }> {
  if (!estimate.ready) return [];
  const months = estimate.model === 'md' ? 1 : (estimate.contractMonths || 1);
  return (['A', 'B', 'C', 'D', 'E'] as CostCode[])
    .map(code => ({ code, amount: Math.round(estimate.costs[code] * months) }))
    .filter(x => x.amount > 0);
}

export { RATE_CARD_COST, CLIENT_TIER_MULTIPLIERS };
