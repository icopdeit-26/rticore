'use client';
/**
 * ICOP scoping estimator embedded in "02 · Technical Scoping & Delivery".
 * The parameter set follows the chosen BoQ product type; effort (MD), HPP A–E and the
 * Floor/Standard/Premium indication come from the ICOP Pricing Engine, and the
 * Standard price is adjusted by the Admin-activated calibration model.
 */
import React, { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, Sparkles } from 'lucide-react';
import VaptMultiAssetScope from '@/components/VaptMultiAssetScope';
import IcopPricingPanel from '@/components/scoping/IcopPricingPanel';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { formatIDR } from '@/lib/formatters';
import { calculateSocSizing } from '@/lib/scoping-calculator';
import { SCOPING_DEFINITIONS, validateServiceScope, summarizeServiceScope, type ScopingService } from '@/lib/scoping-service-options';
import { createVaptAsset, calculateVaptPortfolio, validateVaptAssets, describeVaptAsset, type VaptAsset } from '@/lib/vapt-multi-asset';
import {
  defaultCommercialContext, estimateScopingPrice, contractTotals, validateCommercialContext,
  ROLE_LABELS, type CommercialContext,
} from '@/lib/scoping-pricing';
import { calibrationFactor, type ModelFactors } from '@/lib/scoping-calibration';
import { tierFromSegment } from '@/lib/product-delivery-profile';
import type { SalesFields } from '@/lib/sales-workflow';

type Soc = { servers: number; network: number; endpoints: number; cloud: number; webApps: number; ad: boolean;
  traffic: 'low' | 'medium' | 'high'; sla: '8x5' | '12x5' | '24x7'; hunting: boolean; ir: boolean; months: number };
const defaultSoc = (): Soc => ({ servers: 25, network: 10, endpoints: 150, cloud: 2, webApps: 0, ad: true, traffic: 'medium', sla: '24x7', hunting: false, ir: false, months: 12 });
type Persisted = { v: 1; product: ScopingService; values?: Record<string, string>; vapt?: VaptAsset[]; soc?: Soc; ctx?: Omit<CommercialContext, 'costs'> };

function restore(raw: string | undefined, product: ScopingService): Persisted | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Persisted;
    if (!p || p.v !== 1 || p.product !== product) return null;
    return p;
  } catch { return null; }
}
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1000000 ? v : fallback);
const input = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs';

export default function ProductScopingEstimator({ product, fields, clientSegment, factors, modelVersion, disabled, onApply, onUseAsPipelineValue }: {
  product: ScopingService;
  fields: SalesFields;
  clientSegment?: string;
  factors: ModelFactors | null;
  modelVersion: number | null;
  disabled?: boolean;
  onApply: (patch: SalesFields) => void;
  onUseAsPipelineValue?: (value: number) => void;
}) {
  const saved = useMemo(() => restore(fields.scoping_params, product), [fields.scoping_params, product]);
  const [values, setValues] = useState<Record<string, string>>(saved?.values || {});
  const [vapt, setVapt] = useState<VaptAsset[]>(saved?.vapt?.length ? saved.vapt : [createVaptAsset('opp-vapt-1')]);
  const [soc, setSoc] = useState<Soc>(() => { const s = saved?.soc; const d = defaultSoc();
    return s ? { ...d, ...s, servers: num(s.servers, d.servers), network: num(s.network, d.network), endpoints: num(s.endpoints, d.endpoints),
      cloud: num(s.cloud, d.cloud), webApps: num(s.webApps, 0), months: Math.min(60, Math.max(1, num(s.months, 12))) } : d; });
  const [ctx, setCtx] = useState<CommercialContext>(() => ({ ...defaultCommercialContext(),
    client_tier: tierFromSegment(clientSegment), ...(saved?.ctx || {}), costs: {} }));
  const [notice, setNotice] = useState('');

  const def = SCOPING_DEFINITIONS[product];
  const missing = product === 'VAPT' || product === 'SOC' ? [] : validateServiceScope(product, values);
  const vaptIssues = product === 'VAPT' ? validateVaptAssets(vapt) : [];
  const portfolio = calculateVaptPortfolio(vapt);
  const socResult = calculateSocSizing({ n_servers: soc.servers, n_network_devices: soc.network, n_endpoints: soc.endpoints,
    n_cloud_services: soc.cloud, n_web_apps: soc.webApps, has_active_directory: soc.ad, traffic_intensity: soc.traffic,
    service_level: soc.sla, has_threat_hunting: soc.hunting, has_ir_retainer: soc.ir });
  const factor = calibrationFactor(factors, product);
  const estimate = estimateScopingPrice({ service: product, ctx, vaptTotalMd: portfolio.total_md,
    socBaseMrc: socResult.recommended_mrc, socMonths: soc.months, serviceValues: values, calibrationFactor: factor });
  const totals = contractTotals(estimate);
  const ctxIssues = validateCommercialContext(ctx);
  const blocked = disabled || !estimate.ready || missing.length > 0 || vaptIssues.length > 0 || ctxIssues.length > 0;

  const apply = () => {
    if (blocked) return;
    const team = estimate.staffing.filter(s => s.mandays > 0).map(s => ROLE_LABELS[s.role] + ' ' + s.mandays + ' MD').join(', ');
    let quantity = '', profile = '', duration = '';
    if (product === 'VAPT') {
      quantity = vapt.reduce((n, a) => n + a.asset_count, 0) + ' aset dalam ' + vapt.length + ' baris scope · ' + portfolio.total_md + ' MD';
      profile = vapt.map(describeVaptAsset).join('\n').slice(0, 3400);
    } else if (product === 'SOC') {
      quantity = socResult.calculated_eps + ' EPS (' + socResult.eps_tier + ') · SLA ' + soc.sla;
      profile = 'Servers ' + soc.servers + ', network ' + soc.network + ', endpoints ' + soc.endpoints + ', cloud ' + soc.cloud +
        ', web apps ' + soc.webApps + ', AD ' + (soc.ad ? 'ya' : 'tidak') + ', threat hunting ' + (soc.hunting ? 'ya' : 'tidak') + ', IR retainer ' + (soc.ir ? 'ya' : 'tidak');
      duration = soc.months + ' bulan';
    } else {
      quantity = def.fields.filter(f => f.kind === 'number' && values[f.key]).map(f => values[f.key] + ' ' + (f.unit || '')).join(' · ') +
        (estimate.totalMd ? ' · ' + estimate.totalMd + ' MD' : '');
      profile = summarizeServiceScope(product, values) + (estimate.cti ? ' | footprint ' + estimate.cti.score + ' (' + estimate.cti.tierLabel + ')' : '');
      if (product === 'CTI' && values.cti_months) duration = values.cti_months + ' bulan';
    }
    // HPP (ctx.costs) is intentionally NOT persisted on the opportunity: costing stays in BoQ/Finance.
    const { costs, ...ctxNoCost } = ctx; void costs;
    const persisted: Persisted = { v: 1, product, ctx: ctxNoCost,
      ...(product === 'VAPT' ? { vapt } : product === 'SOC' ? { soc } : { values }) };
    const params = JSON.stringify(persisted);
    if (params.length > 12000) { setNotice('Parameter terlalu banyak untuk disimpan (maks 12.000 karakter). Kurangi baris aset.'); return; }
    const overwrite = ['scope_quantity', 'team_composition', 'asset_profile'].filter(k => fields[k]?.trim());
    if (overwrite.length && !window.confirm('Isi ulang otomatis kolom: ' + overwrite.join(', ') + ' dari estimator?')) return;
    onApply({
      scoping_product: product, scoping_params: params,
      scoping_estimate_md: estimate.model === 'md' ? String(estimate.totalMd) : '',
      scoping_estimate_base: String(totals.base), scoping_estimate_price: String(totals.calibrated),
      scoping_client_tier: ctx.client_tier, scoping_model_version: modelVersion ? String(modelVersion) : '0',
      scope_quantity: quantity.slice(0, 3400), asset_profile: profile.slice(0, 3400),
      ...(team ? { team_composition: team.slice(0, 3400) } : {}),
      ...(duration && !fields.contract_duration?.trim() ? { contract_duration: duration } : {}),
    });
    setNotice('Estimasi diterapkan ke form. Klik simpan untuk menyimpan ke database.');
  };

  const socNumber = (key: keyof Soc, label: string, max = 1000000) => (
    <label className="block min-w-0 text-xs font-semibold text-slate-700">{label}
      <input type="number" min={key === 'months' ? 1 : 0} max={max} disabled={disabled} className={input} value={soc[key] as number}
        onChange={e => setSoc(s => ({ ...s, [key]: Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))) }))} />
    </label>
  );

  return (
    <section aria-label="Estimator scoping ICOP" className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Calculator className="h-4 w-4 text-blue-700" />Estimator Scoping {def.label}</h4>
          <p className="mt-1 text-xs text-slate-500">Parameter mengikuti jenis produk; MD, HPP A–E dan harga dari ICOP Pricing Engine{factors ? ', dikalibrasi model v' + modelVersion : ''}.</p>
        </div>
        {fields.scoping_estimate_price && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">Tersimpan: {formatIDR(Number(fields.scoping_estimate_price))}</span>}
      </div>

      {product === 'VAPT' ? (
        <VaptMultiAssetScope assets={vapt}
          onAdd={() => setVapt(c => c.length >= 30 ? c : [...c, createVaptAsset('opp-vapt-' + Date.now())])}
          onDuplicate={id => setVapt(c => { const o = c.find(a => a.id === id); return o && c.length < 30 ? [...c, { ...o, id: 'opp-vapt-' + Date.now(), name: o.name.slice(0, 108) + ' (salinan)' }] : c; })}
          onRemove={id => setVapt(c => c.length <= 1 ? c : c.filter(a => a.id !== id))}
          onChange={(id, patch) => setVapt(c => c.map(a => a.id === id ? { ...a, ...patch } : a))} />
      ) : product === 'SOC' ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
          {socNumber('servers', 'Servers (35 EPS)')}{socNumber('network', 'Network devices (25 EPS)')}{socNumber('endpoints', 'Endpoints (2 EPS)')}
          {socNumber('cloud', 'Cloud accounts (20 EPS)')}{socNumber('webApps', 'Web apps (15 EPS)')}{socNumber('months', 'Durasi kontrak (bulan)', 60)}
          <label className="block text-xs font-semibold text-slate-700">Intensitas trafik
            <select disabled={disabled} className={input} value={soc.traffic} onChange={e => setSoc(s => ({ ...s, traffic: e.target.value as Soc['traffic'] }))}>
              <option value="low">Low (0,7×)</option><option value="medium">Medium (1,0×)</option><option value="high">High (1,5×)</option></select></label>
          <label className="block text-xs font-semibold text-slate-700">SLA
            <select disabled={disabled} className={input} value={soc.sla} onChange={e => setSoc(s => ({ ...s, sla: e.target.value as Soc['sla'] }))}>
              <option value="8x5">8x5</option><option value="12x5">12x5</option><option value="24x7">24x7 (1,5×)</option></select></label>
          <div className="space-y-1 pt-5 text-xs">
            {([['ad', 'Active Directory'], ['hunting', 'Threat hunting'], ['ir', 'IR retainer']] as const).map(([k, l]) =>
              <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={disabled} checked={soc[k]} onChange={e => setSoc(s => ({ ...s, [k]: e.target.checked }))} />{l}</label>)}
          </div>
          <p className="text-xs text-slate-600 sm:col-span-3">EPS: <b>{socResult.calculated_eps.toLocaleString('id-ID')}</b> · tier {socResult.eps_tier}</p>
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          {def.fields.map(field => <label key={field.key} className="block min-w-0 text-xs font-semibold text-slate-700">
            {field.label}{field.required ? ' *' : ''}
            {field.kind === 'select'
              ? <CompactSelect label={field.label} className="mt-1" disabled={disabled} value={values[field.key] || ''}
                  onChange={v => setValues(p => ({ ...p, [field.key]: v }))}
                  options={[{ value: '', label: 'Pilih ' + field.label }, ...(field.options || []).map(o => ({ value: o, label: o }))]} />
              : <input disabled={disabled} type={field.kind === 'number' ? 'number' : 'text'} min={field.kind === 'number' ? (field.min ?? 1) : undefined}
                  className={input} placeholder={field.unit ? 'Jumlah (' + field.unit + ')' : ''} value={values[field.key] || ''}
                  onChange={e => setValues(p => ({ ...p, [field.key]: e.target.value }))} />}
          </label>)}
          {estimate.cti && <p className="text-xs text-slate-600 sm:col-span-2">Footprint score <b>{estimate.cti.score}</b> · Tier CTI {estimate.cti.tierLabel}</p>}
        </div>
      )}

      <IcopPricingPanel service={product} ctx={ctx} onChange={setCtx} estimate={estimate} />

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs sm:grid-cols-4">
        <div><p className="text-slate-500">Effort</p><p className="text-base font-bold tabular-nums">{estimate.model === 'md' ? estimate.totalMd + ' MD' : 'MRC'}</p></div>
        <div><p className="text-slate-500">Indikasi ICOP (dasar)</p><p className="text-base font-bold tabular-nums">{estimate.ready ? formatIDR(totals.base) : '—'}</p></div>
        <div><p className="flex items-center gap-1 text-slate-500"><Sparkles className="h-3 w-3" />Terkalibrasi (×{factor.toFixed(3)})</p>
          <p className="text-base font-bold tabular-nums text-emerald-700">{estimate.ready ? formatIDR(totals.calibrated) : '—'}</p>
          {estimate.heldAtFloor && <p className="text-[11px] text-amber-700">Ditahan di Floor (margin 20%).</p>}</div>
        <div><p className="text-slate-500">Client tier</p><p className="text-base font-bold">{ctx.client_tier}{clientSegment ? <span className="ml-1 text-[11px] font-normal text-slate-500">({clientSegment})</span> : null}</p></div>
      </div>

      {[...missing.map(m => 'Lengkapi: ' + m), ...vaptIssues, ...ctxIssues, ...(!estimate.ready && estimate.reason ? [estimate.reason] : [])].length > 0 &&
        <div role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          {[...missing.map(m => 'Lengkapi: ' + m), ...vaptIssues, ...ctxIssues, ...(!estimate.ready && estimate.reason ? [estimate.reason] : [])].slice(0, 8).map(x => <p key={x}>{x}</p>)}
        </div>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={blocked} onClick={apply} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">
          <CheckCircle2 className="h-4 w-4" />Terapkan ke Form Opportunity</button>
        {onUseAsPipelineValue && <button type="button" disabled={!estimate.ready || disabled} onClick={() => onUseAsPipelineValue(totals.calibrated)}
          className="min-h-11 rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-xs font-bold text-blue-800 disabled:opacity-40">Pakai sebagai nilai pipeline</button>}
        {notice && <span role="status" className="text-xs font-medium text-blue-900">{notice}</span>}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">Indikasi internal, bukan harga quotation. Harga final tetap melalui BoQ approval. HPP A–E tidak disimpan di Opportunity. Setelah Closed Won, nilai PO dibandingkan dengan indikasi dasar untuk kalibrasi bulanan oleh Admin.</p>
    </section>
  );
}
