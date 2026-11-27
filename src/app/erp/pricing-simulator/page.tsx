'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  COMPLEXITY_TIER_BPS,
  ENTERPRISE_RESOURCE_ROLES,
  PRICING_METHODS,
  calculateActivityBasedMandays,
  calculateEnterpriseServicePricing,
  type ComplexityTier,
  type EnterprisePricingMethod,
  type EnterpriseResourceRole,
} from '@/lib/enterprise-pricing-engine';

const fmtIDR = (cents: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(cents / 100);

export default function EnterprisePricingSimulatorPage() {
  const [pricingMethod, setPricingMethod] = useState<EnterprisePricingMethod>('target_margin');
  const [role, setRole] = useState<EnterpriseResourceRole>('lead_pentester');
  const [complexity, setComplexity] = useState<ComplexityTier>('standard');
  const [quantity, setQuantity] = useState(2);
  const [hoursPerUnit, setHoursPerUnit] = useState(16);
  const [resourceCount, setResourceCount] = useState(2);
  const [costRateIdr, setCostRateIdr] = useState(2_000_000);
  const [toolsIdr, setToolsIdr] = useState(5_000_000);
  const [travelIdr, setTravelIdr] = useState(2_500_000);
  const [overheadPct, setOverheadPct] = useState(12);
  const [contingencyPct, setContingencyPct] = useState(5);
  const [targetMarginPct, setTargetMarginPct] = useState(35);
  const [discountPct, setDiscountPct] = useState(5);

  const simulation = useMemo(() => {
    const effort = calculateActivityBasedMandays(
      [
        {
          phaseCode: 'scope_validation',
          activityName: 'Scope Validation & Kickoff',
          resourceRole: 'project_manager',
          resourceCount: 1,
          quantity: 1,
          standardHoursPerUnitHundredths: 800,
          complexityFactorBps: COMPLEXITY_TIER_BPS[complexity],
          billable: true,
          internalCostRateCents: 1_500_000_00,
          creditMultiplierBps: 12500,
        },
        {
          phaseCode: 'technical_execution',
          activityName: 'Technical Execution & Analysis',
          resourceRole: role,
          resourceCount,
          quantity,
          standardHoursPerUnitHundredths: Math.max(100, Math.round(hoursPerUnit * 100)),
          complexityFactorBps: COMPLEXITY_TIER_BPS[complexity],
          billable: true,
          internalCostRateCents: Math.max(100_000, Math.round(costRateIdr)) * 100,
          creditMultiplierBps: ENTERPRISE_RESOURCE_ROLES.find(r => r.code === role)?.defaultCreditMultiplierBps ?? 12500,
        },
        {
          phaseCode: 'reporting',
          activityName: 'QA, Reporting & Retest',
          resourceRole: role,
          resourceCount: 1,
          quantity: 1,
          standardHoursPerUnitHundredths: 1600,
          complexityFactorBps: COMPLEXITY_TIER_BPS[complexity],
          billable: true,
          internalCostRateCents: Math.max(100_000, Math.round(costRateIdr)) * 100,
          creditMultiplierBps: ENTERPRISE_RESOURCE_ROLES.find(r => r.code === role)?.defaultCreditMultiplierBps ?? 12500,
        },
      ],
      { workingHoursPerManday: 8, emergencyMode: pricingMethod === 'emergency_service' },
    );

    const pricing = calculateEnterpriseServicePricing({
      pricingMethod,
      directLaborCostCents: effort.totalDirectLaborCostCents,
      toolsCostCents: Math.max(0, Math.round(toolsIdr)) * 100,
      travelCostCents: Math.max(0, Math.round(travelIdr)) * 100,
      overheadAllocationBps: Math.round(overheadPct * 100),
      riskContingencyBps: Math.round(contingencyPct * 100),
      targetMarginBps: Math.round(targetMarginPct * 100),
      minAcceptableMarginBps: 2000,
      discountBps: Math.round(discountPct * 100),
      taxRateBps: 1100,
      flexguardCreditsEquivalent: effort.totalFlexGuardCredits,
    });

    return { effort, pricing };
  }, [pricingMethod, role, complexity, quantity, hoursPerUnit, resourceCount, costRateIdr, toolsIdr, travelIdr, overheadPct, contingencyPct, targetMarginPct, discountPct]);

  const { effort, pricing } = simulation;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#2B124C] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M06 · Enterprise Service Pricing Intelligence</p>
            <h1 className="mt-1 text-2xl font-bold">Interactive Pricing &amp; Profitability Simulator</h1>
            <p className="mt-1 text-sm text-white/80">Simulasi biaya berbasis aktivitas, perbandingan Fixed Price vs FlexGuard, break-even, margin langsung vs fully loaded, dan approval matrix otomatis.</p>
          </div>
          <Link href="/erp/service-catalog" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
            ← Service Catalog &amp; Rate Cards
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
          <h2 className="text-base font-bold text-[#050505]">Parameter Simulasi</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-700">
              Pricing Method
              <select value={pricingMethod} onChange={e => setPricingMethod(e.target.value as EnterprisePricingMethod)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
                {PRICING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Complexity Tier
              <select value={complexity} onChange={e => setComplexity(e.target.value as ComplexityTier)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
                {Object.entries(COMPLEXITY_TIER_BPS).map(([k, v]) => <option key={k} value={k}>{k} ({(v / 10000).toFixed(2)}x)</option>)}
              </select>
            </label>
            <label className="col-span-2 text-xs font-medium text-slate-700">
              Lead Resource Role
              <select value={role} onChange={e => setRole(e.target.value as EnterpriseResourceRole)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
                {ENTERPRISE_RESOURCE_ROLES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Scope Units<input type="number" min={1} max={100} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Hours / Unit<input type="number" min={4} max={200} value={hoursPerUnit} onChange={e => setHoursPerUnit(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Parallel Resources<input type="number" min={1} max={20} value={resourceCount} onChange={e => setResourceCount(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Internal Cost/MD (IDR)<input type="number" min={500000} step={250000} value={costRateIdr} onChange={e => setCostRateIdr(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Tools &amp; License (IDR)<input type="number" min={0} step={500000} value={toolsIdr} onChange={e => setToolsIdr(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Travel &amp; Onsite (IDR)<input type="number" min={0} step={500000} value={travelIdr} onChange={e => setTravelIdr(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Overhead (%)<input type="number" min={0} max={50} value={overheadPct} onChange={e => setOverheadPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Risk Contingency (%)<input type="number" min={0} max={40} value={contingencyPct} onChange={e => setContingencyPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Target Margin (%)<input type="number" min={5} max={80} value={targetMarginPct} onChange={e => setTargetMarginPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Discount (%)<input type="number" min={0} max={50} value={discountPct} onChange={e => setDiscountPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-7">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Total Effort (Person-Days)</p>
              <p className="mt-1 text-2xl font-bold text-[#2B124C]">{(effort.totalPersonDaysTenths / 10).toFixed(1)} MD</p>
              <p className="text-xs text-slate-500">Est. Calendar: {(effort.estimatedCalendarDaysTenths / 10).toFixed(1)} days</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Net Selling Price (excl. PPN)</p>
              <p className="mt-1 text-xl font-bold text-[#050505]">{fmtIDR(pricing.netSellingPriceCents)}</p>
              <p className="text-xs text-slate-500">Break-Even: {fmtIDR(pricing.breakEvenPriceCents)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Fully Loaded / Direct Margin</p>
              <p className={`mt-1 text-2xl font-bold ${pricing.negativeMarginBlocked ? 'text-red-600' : pricing.belowMinimumPrice ? 'text-amber-600' : 'text-emerald-700'}`}>
                {(pricing.fullyLoadedMarginBps / 100).toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500">Direct Gross: {(pricing.directGrossMarginBps / 100).toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[#050505]">Costing Breakdown &amp; FlexGuard Comparison</h3>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between border-b py-1"><span>Direct Labor Cost</span><span className="font-mono">{fmtIDR(pricing.directLaborCostCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>Total Direct Cost</span><span className="font-mono">{fmtIDR(pricing.totalDirectCostCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>Overhead + Contingency</span><span className="font-mono">{fmtIDR(pricing.overheadCents + pricing.riskContingencyCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>Fully Loaded Cost</span><span className="font-mono font-semibold">{fmtIDR(pricing.fullyLoadedCostCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>Minimum Selling Price</span><span className="font-mono">{fmtIDR(pricing.minSellingPriceCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>Total incl. PPN 11%</span><span className="font-mono font-bold text-[#2B124C]">{fmtIDR(pricing.totalWithTaxCents)}</span></div>
              <div className="flex justify-between border-b py-1"><span>FlexGuard Equivalent</span><span className="font-mono font-semibold text-[#2B124C]">{pricing.flexguardComparison.creditsRequired} Credits</span></div>
              <div className="flex justify-between border-b py-1"><span>Est. FlexGuard Value</span><span className="font-mono">{fmtIDR(pricing.flexguardComparison.flexguardPriceCents)}</span></div>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
              <p className="font-semibold text-[#050505]">Approval Level Required: <span className="uppercase text-[#2B124C]">{pricing.approvalRequiredLevel}</span></p>
              {pricing.approvalReasons.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-slate-600">
                  {pricing.approvalReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
