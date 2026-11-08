'use client';

import React from 'react';
import { Calculator, AlertTriangle } from 'lucide-react';
import { formatIDR } from '@/lib/formatters';
import type { ScopingService } from '@/lib/scoping-service-options';
import {
  CLIENT_TIERS, CLIENT_TIER_MULTIPLIERS, LOCATION_OPTIONS, URGENCY_OPTIONS, ROLE_LABELS, COST_LABELS,
  PRODUCT_PRICING, type CommercialContext, type CostCode, type ScopingPriceEstimate,
} from '@/lib/scoping-pricing';
import type { ClientTier, LocationType, RoleLevel } from '@/lib/types';

const input = 'mt-1.5 w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-xs';

/** Commercial context + BoQ internal (A–E) per ICOP pricing_sessions / boq_internal. */
export default function IcopPricingPanel({ service, ctx, onChange, estimate }: {
  service: ScopingService;
  ctx: CommercialContext;
  onChange: (next: CommercialContext) => void;
  estimate: ScopingPriceEstimate;
}) {
  const profile = PRODUCT_PRICING[service];
  const isMd = profile.model === 'md';
  const period = isMd ? '' : ' / bulan';
  const set = (patch: Partial<CommercialContext>) => onChange({ ...ctx, ...patch });
  const setCost = (code: CostCode, value: string) => set({ costs: { ...ctx.costs, [code]: value } });
  const setRole = (role: RoleLevel, value: string) => set({ role_md: { ...ctx.role_md, [role]: value } });
  const editableCosts: CostCode[] = isMd ? ['B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D', 'E'];

  return (
    <section aria-label="Parameter komersial ICOP" className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
          <Calculator className="h-4 w-4 text-blue-700" />
          <span>Parameter Komersial & BoQ Internal</span>
          <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">ICOP Pricing Engine</span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Basis: {profile.basis}. Effective rate = rate card × DAI × client tier; HPP mengikuti komponen A–E BoQ internal.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block min-w-0 text-xs font-semibold text-slate-700">Client Tier
          <select className={input} value={ctx.client_tier} onChange={e => set({ client_tier: e.target.value as ClientTier })}>
            {CLIENT_TIERS.map(t => <option key={t} value={t}>{CLIENT_TIER_MULTIPLIERS[t].label} (×{CLIENT_TIER_MULTIPLIERS[t].default.toFixed(2)})</option>)}
          </select>
        </label>
        <label className="block min-w-0 text-xs font-semibold text-slate-700">Lokasi Pelaksanaan
          <select className={input} value={ctx.location_type} onChange={e => set({ location_type: e.target.value as LocationType })}>
            {LOCATION_OPTIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0 text-xs font-semibold text-slate-700">Urgensi Timeline
          <select className={input} value={ctx.urgency} onChange={e => set({ urgency: e.target.value as CommercialContext['urgency'] })}>
            {URGENCY_OPTIONS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </label>
      </div>

      {isMd && (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          {service !== 'VAPT' && (
            <label className="block max-w-xs text-xs font-semibold text-slate-700">Estimasi Total Effort Presales (MD)
              <input className={input} type="number" min={0.5} step={0.5} max={100000} placeholder="contoh: 20"
                value={ctx.total_md} onChange={e => set({ total_md: e.target.value })} />
              <span className="mt-1 block font-normal text-slate-500">Dibagi otomatis ke role sesuai profil {service}; isi MD per role untuk override.</span>
            </label>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead><tr className="border-b text-left text-slate-500">
                <th className="py-2 pr-2 font-semibold">Role (rate card ICOP)</th>
                <th className="py-2 pr-2 font-semibold">MD</th>
                <th className="py-2 pr-2 text-right font-semibold">Rate/MD</th>
                <th className="py-2 text-right font-semibold">Subtotal</th>
              </tr></thead>
              <tbody>
                {profile.roles.map(({ role, share }) => {
                  const row = estimate.staffing.find(s => s.role === role);
                  return (
                    <tr key={role} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-slate-700">{ROLE_LABELS[role]} <span className="text-slate-400">({Math.round(share * 100)}%)</span></td>
                      <td className="py-2 pr-2">
                        <input aria-label={'MD ' + ROLE_LABELS[role]} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs"
                          type="number" min={0} step={0.5} placeholder={row ? String(row.mandays) : 'auto'}
                          value={ctx.role_md[role] || ''} onChange={e => setRole(role, e.target.value)} />
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{row ? formatIDR(row.rate) : '-'}</td>
                      <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{row ? formatIDR(row.subtotal) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        {editableCosts.map(code => (
          <label key={code} className="block min-w-0 text-xs font-semibold text-slate-700">{COST_LABELS[code]}{period}
            <input className={input} type="number" min={0} step={100000}
              placeholder={code === 'C' && isMd ? 'Default ' + formatIDR(profile.defaultDocumentCost) : 'Rp 0'}
              value={ctx.costs[code] || ''} onChange={e => setCost(code, e.target.value)} />
            {(profile.hints[code] || (code === 'E' && ctx.location_type !== 'remote')) && (
              <span className="mt-1 block font-normal text-slate-500">
                {profile.hints[code] || ''}{code === 'E' && ctx.location_type !== 'remote' ? ' · Lokasi onsite: isi tiket, hotel, transport, per diem.' : ''}
              </span>
            )}
          </label>
        ))}
      </div>
      {estimate.model !== 'md' && estimate.totalInternalCost === 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Isi HPP bulanan (A–E) agar Floor price dan cek margin 25% dapat dihitung.
        </p>
      )}
    </section>
  );
}
