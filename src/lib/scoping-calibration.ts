/**
 * Scoping price-model calibration.
 *
 * Learns how far the ICOP scoping indication (uncalibrated "base" Standard price) sits
 * from the final negotiated deal value (PO before VAT on Closed Won opportunities),
 * per BoQ product type. The result is a bounded multiplicative factor per product that
 * scoping applies on top of the ICOP Standard price.
 *
 * Guardrails:
 *  - Only aggregates leave the database for the AI provider (no customer names / ids).
 *  - Statistical factor is always computed locally; an AI proposal may only adjust it
 *    within ±AI_MAX_DELTA and the global bounds, and is never auto-activated.
 *  - Small samples are shrunk toward 1.0 so one deal cannot swing the model.
 */
import { SCOPING_SERVICE_TYPES, type ScopingService } from './scoping-service-options';

export const FACTOR_MIN = 0.6;
export const FACTOR_MAX = 1.4;
export const AI_MAX_DELTA = 0.15;
export const SHRINKAGE_K = 5;
export const MIN_PRODUCT_SAMPLES = 3;
export const RECALIBRATION_DAYS = 30;

export type CalibrationSample = {
  product: ScopingService;
  /** ICOP Standard indication before calibration (whole contract, IDR). */
  base: number;
  /** Final negotiated value (PO before VAT, IDR). */
  deal: number;
  tier?: string;
  closedAt?: string;
};

export type ProductStats = {
  n: number;
  medianRatio: number;
  p25Ratio: number;
  p75Ratio: number;
  /** Mean absolute % error of the uncalibrated indication vs deal. */
  mapeBefore: number;
  /** Same error after applying the statistical factor. */
  mapeAfter: number;
  statFactor: number;
};

export type CalibrationStats = {
  totalSamples: number;
  discarded: number;
  global: ProductStats | null;
  products: Partial<Record<ScopingService, ProductStats>>;
};

export type ModelFactors = Partial<Record<ScopingService, number>>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 1;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statsFor(samples: CalibrationSample[]): ProductStats | null {
  if (!samples.length) return null;
  const ratios = samples.map(s => s.deal / s.base).sort((a, b) => a - b);
  const median = quantile(ratios, 0.5);
  const n = samples.length;
  const statFactor = round3(clamp(1 + (median - 1) * n / (n + SHRINKAGE_K), FACTOR_MIN, FACTOR_MAX));
  const mape = (factor: number) =>
    round1(samples.reduce((sum, s) => sum + Math.abs(s.deal - s.base * factor) / s.deal, 0) / n * 100);
  return {
    n, medianRatio: round3(median), p25Ratio: round3(quantile(ratios, 0.25)), p75Ratio: round3(quantile(ratios, 0.75)),
    mapeBefore: mape(1), mapeAfter: mape(statFactor), statFactor,
  };
}

/** Accepts only plausible pairs; ratios outside 0.2x–5x are treated as data-entry errors. */
export function validSample(s: Partial<CalibrationSample>): s is CalibrationSample {
  return !!s.product && SCOPING_SERVICE_TYPES.includes(s.product) &&
    typeof s.base === 'number' && Number.isFinite(s.base) && s.base > 0 &&
    typeof s.deal === 'number' && Number.isFinite(s.deal) && s.deal > 0 &&
    s.deal / s.base >= 0.2 && s.deal / s.base <= 5;
}

export function computeCalibration(input: ReadonlyArray<Partial<CalibrationSample>>): CalibrationStats {
  const samples = input.filter(validSample);
  const products: CalibrationStats['products'] = {};
  for (const product of SCOPING_SERVICE_TYPES) {
    const stats = statsFor(samples.filter(s => s.product === product));
    if (stats) products[product] = stats;
  }
  return { totalSamples: samples.length, discarded: input.length - samples.length, global: statsFor(samples), products };
}

/** Statistical factors: per product with enough data, else global, else 1.0. */
export function statisticalFactors(stats: CalibrationStats): ModelFactors {
  const factors: ModelFactors = {};
  const globalFactor = stats.global && stats.global.n >= MIN_PRODUCT_SAMPLES ? stats.global.statFactor : 1;
  for (const product of SCOPING_SERVICE_TYPES) {
    const p = stats.products[product];
    factors[product] = p && p.n >= MIN_PRODUCT_SAMPLES ? p.statFactor : globalFactor;
  }
  return factors;
}

export function calibrationFactor(factors: ModelFactors | null | undefined, product: ScopingService): number {
  const f = factors?.[product];
  return typeof f === 'number' && Number.isFinite(f) ? clamp(f, FACTOR_MIN, FACTOR_MAX) : 1;
}

export function isCalibrationDue(activatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!activatedAt) return true;
  const t = Date.parse(activatedAt);
  return !Number.isFinite(t) || now - t >= RECALIBRATION_DAYS * 86400000;
}

/** Aggregate-only prompt. No customer, opportunity or person data is included. */
export function buildCalibrationPrompt(stats: CalibrationStats, current: ModelFactors | null): string {
  const rows = SCOPING_SERVICE_TYPES.map(product => {
    const p = stats.products[product];
    return { product, n: p?.n ?? 0, median_ratio: p?.medianRatio ?? null, p25: p?.p25Ratio ?? null, p75: p?.p75Ratio ?? null,
      mape_before_pct: p?.mapeBefore ?? null, statistical_factor: statisticalFactors(stats)[product],
      current_active_factor: current?.[product] ?? 1 };
  });
  return [
    'Anda membantu kalibrasi model harga scoping layanan keamanan siber RTI (ICOP Pricing Engine).',
    'Data agregat di bawah membandingkan indikasi harga Standard ICOP (sebelum kalibrasi) dengan nilai deal akhir hasil negosiasi (PO sebelum PPN) pada opportunity Closed Won.',
    'ratio = deal / indikasi. Faktor kalibrasi dikalikan ke indikasi berikutnya.',
    'Tugas: usulkan faktor kalibrasi per produk. Batas keras: ' + FACTOR_MIN + '–' + FACTOR_MAX +
      ' dan maksimal ±' + AI_MAX_DELTA + ' dari statistical_factor. Produk dengan n < ' + MIN_PRODUCT_SAMPLES +
      ' sebaiknya mengikuti statistical_factor.',
    'Balas HANYA JSON valid tanpa teks lain dengan format:',
    '{"factors":{"VAPT":1.0,...},"rationale":"maksimal 6 kalimat Bahasa Indonesia tentang pola diskon/negosiasi dan risiko data"}',
    'DATA:',
    JSON.stringify({ total_samples: stats.totalSamples, global: stats.global, products: rows }),
  ].join('\n');
}

export type AiProposal = { factors: ModelFactors; rationale: string; adjusted: ScopingService[] };

/** Parse and bound an AI answer. Invalid/missing products fall back to statistical factors. */
export function parseAiProposal(raw: string, stats: CalibrationStats): AiProposal {
  const statistical = statisticalFactors(stats);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Respons AI tidak berisi JSON.');
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { throw new Error('JSON dari AI tidak valid.'); }
  const obj = parsed as { factors?: Record<string, unknown>; rationale?: unknown };
  if (!obj || typeof obj !== 'object' || !obj.factors || typeof obj.factors !== 'object') throw new Error('Format faktor AI tidak valid.');
  const factors: ModelFactors = {};
  const adjusted: ScopingService[] = [];
  for (const product of SCOPING_SERVICE_TYPES) {
    const stat = statistical[product] ?? 1;
    const ai = obj.factors[product];
    if (typeof ai === 'number' && Number.isFinite(ai)) {
      const bounded = round3(clamp(clamp(ai, stat - AI_MAX_DELTA, stat + AI_MAX_DELTA), FACTOR_MIN, FACTOR_MAX));
      factors[product] = bounded;
      if (bounded !== round3(ai)) adjusted.push(product);
    } else factors[product] = stat;
  }
  const rationale = typeof obj.rationale === 'string'
    ? obj.rationale.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  return { factors, rationale, adjusted };
}

/** Reads a stored factors JSON safely. */
export function parseFactors(json: unknown): ModelFactors {
  if (typeof json !== 'string') return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: ModelFactors = {};
    for (const product of SCOPING_SERVICE_TYPES) {
      const f = raw?.[product];
      if (typeof f === 'number' && Number.isFinite(f)) out[product] = clamp(f, FACTOR_MIN, FACTOR_MAX);
    }
    return out;
  } catch { return {}; }
}

/** Extracts a calibration sample from a Closed Won opportunity's field JSON. */
export function sampleFromDealFields(fields: Record<string, unknown>): Partial<CalibrationSample> {
  // Sales stores amounts as plain numbers (validated with Number()) — no locale parsing.
  const num = (v: unknown) => { const n = typeof v === 'string' && v.trim() ? Number(v.trim()) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : NaN; };
  return {
    product: fields.scoping_product as ScopingService,
    base: num(fields.scoping_estimate_base),
    deal: num(fields.po_amount_before_vat),
    tier: typeof fields.scoping_client_tier === 'string' ? fields.scoping_client_tier : undefined,
  };
}
