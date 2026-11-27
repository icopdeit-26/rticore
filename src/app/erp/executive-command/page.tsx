'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type ExecData = {
  legal_entity_id: string;
  authorized_entities: string[];
  generated_at: string;
  commercial_performance: { total_opportunities: number; won_opportunities: number; win_rate_bps: number; open_pipeline_idr: number; won_backlog_idr: number };
  service_profitability: { total_pricing_scenarios: number; approved_revenue_cents: number; approved_direct_cost_cents: number; approved_fully_loaded_cost_cents: number; estimated_ebitda_contribution_cents: number; avg_fully_loaded_margin_bps: number };
  resource_performance: { approved_timesheet_entries: number; approved_billable_hours: number; actual_labor_cost_cents: number };
  flexguard_performance: { credits_allocated: number; credits_reserved: number; credits_consumed: number; credits_available: number; credits_expired: number; utilization_bps: number; total_service_requests: number; emergency_requests: number };
  financial_and_risk: { budget_allocated_cents: number; budget_actual_cents: number; budget_variance_cents: number; open_enterprise_risks: number; high_critical_risks: number; active_cti_cases: number; active_grc_engagements: number; avg_grc_readiness_bps: number; queued_background_jobs: number; dead_letter_jobs: number };
};

const fmtIDR = (idr: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(idr);
const fmtCents = (cents: number) => fmtIDR(cents / 100);

export default function ExecutiveCommandCenterPage() {
  const [entityId, setEntityId] = useState('');
  const [data, setData] = useState<ExecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selected?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = selected ? `?legal_entity_id=${encodeURIComponent(selected)}` : '';
      const res = await fetch(`/api/erp/executive-command${q}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'Gagal memuat Executive Command Center');
      setData(j);
      setEntityId(j.legal_entity_id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data eksekutif');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#2B124C] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M01 · Executive Management Analytics</p>
            <h1 className="mt-1 text-2xl font-bold">RTICore Executive Command Center</h1>
            <p className="mt-1 text-sm text-white/80">Real-time database-backed visibility across Commercial Pipeline, Service Profitability, Resource Utilization, FlexGuard, Financial Budget &amp; Operational Risk.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data?.authorized_entities && data.authorized_entities.length > 0 && (
              <select value={entityId} onChange={e => { setEntityId(e.target.value); void load(e.target.value); }} className="rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-sm text-white">
                {data.authorized_entities.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
            <Link href="/finance" className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#2B124C] hover:bg-[#C0C0C0]">RTI Finance Suite →</Link>
            <Link href="/erp/pricing-simulator" className="rounded-lg border border-white/30 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">Pricing Simulator</Link>
            <Link href="/erp/flexguard-enterprise" className="rounded-lg border border-white/30 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">FlexGuard Console</Link>
          </div>
        </div>
      </div>

      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Memuat agregasi live dari database...</div>}
      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {data && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">1. Commercial Performance</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Open Pipeline</dt><dd className="font-mono font-bold">{fmtIDR(data.commercial_performance.open_pipeline_idr)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Won Backlog</dt><dd className="font-mono font-bold text-emerald-700">{fmtIDR(data.commercial_performance.won_backlog_idr)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Win Rate</dt><dd className="font-mono font-semibold">{(data.commercial_performance.win_rate_bps / 100).toFixed(1)}% ({data.commercial_performance.won_opportunities}/{data.commercial_performance.total_opportunities})</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">2. Service Profitability</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Approved Revenue</dt><dd className="font-mono font-bold">{fmtCents(data.service_profitability.approved_revenue_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">EBITDA Management View</dt><dd className="font-mono font-bold text-emerald-700">{fmtCents(data.service_profitability.estimated_ebitda_contribution_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Avg Fully Loaded Margin</dt><dd className="font-mono font-semibold">{(data.service_profitability.avg_fully_loaded_margin_bps / 100).toFixed(1)}%</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">3. FlexGuard Performance</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Allocated / Available</dt><dd className="font-mono font-bold">{data.flexguard_performance.credits_allocated} / {data.flexguard_performance.credits_available} cr</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Reserved / Consumed</dt><dd className="font-mono">{data.flexguard_performance.credits_reserved} / {data.flexguard_performance.credits_consumed} cr</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Utilization Rate</dt><dd className="font-mono font-semibold text-[#2B124C]">{(data.flexguard_performance.utilization_bps / 100).toFixed(1)}%</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">4. Resource Performance</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Approved Billable Hours</dt><dd className="font-mono font-bold">{data.resource_performance.approved_billable_hours} h</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Actual Labor Cost</dt><dd className="font-mono">{fmtCents(data.resource_performance.actual_labor_cost_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Timesheet Entries</dt><dd className="font-mono">{data.resource_performance.approved_timesheet_entries}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">5. Budget &amp; Financial Control</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Budget Allocated</dt><dd className="font-mono font-bold">{fmtCents(data.financial_and_risk.budget_allocated_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Actual Spent</dt><dd className="font-mono">{fmtCents(data.financial_and_risk.budget_actual_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Budget Variance</dt><dd className="font-mono font-semibold text-emerald-700">{fmtCents(data.financial_and_risk.budget_variance_cents)}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#2B124C]">6. Cyber Ops, GRC &amp; System Risk</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Open / High Risks</dt><dd className="font-mono font-bold">{data.financial_and_risk.open_enterprise_risks} / <span className="text-red-600">{data.financial_and_risk.high_critical_risks}</span></dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Active CTI / GRC</dt><dd className="font-mono">{data.financial_and_risk.active_cti_cases} CTI · {data.financial_and_risk.active_grc_engagements} GRC</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Jobs Queued / DLQ</dt><dd className="font-mono">{data.financial_and_risk.queued_background_jobs} / {data.financial_and_risk.dead_letter_jobs}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
