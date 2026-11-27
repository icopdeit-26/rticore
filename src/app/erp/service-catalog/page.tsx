'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ENTERPRISE_SERVICE_CATEGORIES,
  ENTERPRISE_RESOURCE_ROLES,
  STANDARD_ACTIVITY_PHASES,
} from '@/lib/enterprise-pricing-engine';

type ServiceRow = {
  id: string;
  service_code: string;
  service_name: string;
  service_category: string;
  complexity_level: string;
  min_mandays_tenths: number;
  standard_mandays_tenths: number;
  max_mandays_tenths: number;
  target_gross_margin_bps: number;
  min_acceptable_margin_bps: number;
  flexguard_eligible: number;
  service_version: number;
  lifecycle_status: string;
  created_by: string;
  approved_by: string | null;
};

type RateCardRow = {
  id: string;
  role_code: string;
  role_label: string;
  internal_cost_rate_cents?: number;
  standard_selling_rate_cents: number;
  min_selling_rate_cents: number;
  effective_date: string;
  version: number;
  status: string;
};

const fmtIDR = (cents?: number) =>
  typeof cents === 'number'
    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(cents / 100)
    : 'Restricted';

export default function EnterpriseServiceCatalogPage() {
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [rateCards, setRateCards] = useState<RateCardRow[]>([]);
  const [costVisible, setCostVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'services' | 'rate_cards' | 'phases'>('services');

  const [svcForm, setSvcForm] = useState({
    service_code: '',
    service_name: '',
    service_category: 'web_app_pentest',
    description: '',
    scope_summary: '',
    min_mandays_tenths: 40,
    standard_mandays_tenths: 80,
    max_mandays_tenths: 200,
    target_gross_margin_bps: 3500,
    min_acceptable_margin_bps: 2000,
  });

  const [rateForm, setRateForm] = useState({
    role_code: 'senior_analyst',
    monthly_compensation_cents: 18_000_000_00,
    benefit_allocation_cents: 3_000_000_00,
    employer_contrib_cents: 1_500_000_00,
    allocated_expense_cents: 1_500_000_00,
    available_working_days: 240,
    target_utilization_bps: 7500,
  });

  const load = useCallback(async (selectedEntity?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = selectedEntity ? `?legal_entity_id=${encodeURIComponent(selectedEntity)}` : '';
      const res = await fetch(`/api/erp/service-catalog${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memuat Service Catalog');
      setEntityId(data.legal_entity_id || '');
      setEntities(data.authorized_entities || []);
      setServices(data.services || []);
      setRateCards(data.rate_cards || []);
      setCostVisible(Boolean(data.cost_basis_visible));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat Service Catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitService(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setError(null);
    const res = await fetch('/api/erp/service-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_service', legal_entity_id: entityId, ...svcForm }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) setError(data.message || 'Gagal membuat layanan');
    else {
      setNotice(`Service ${svcForm.service_code} tersimpan (draft) — menunggu approval independen.`);
      await load(entityId);
    }
  }

  async function submitRateCard(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setError(null);
    const res = await fetch('/api/erp/service-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_rate_card', legal_entity_id: entityId, ...rateForm }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) setError(data.message || 'Gagal membuat rate card');
    else {
      setNotice(`Rate card ${rateForm.role_code} dibuat (draft). Internal cost/MD: ${fmtIDR(data.computed?.internalCostPerMandayCents)}.`);
      await load(entityId);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#2B124C] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M05 · Service Catalog & Mandays Modeling Engine</p>
            <h1 className="mt-1 text-2xl font-bold">Enterprise Service Catalog & 19-Role Rate Cards</h1>
            <p className="mt-1 text-sm text-white/80">Single source of truth untuk 29 kategori layanan cybersecurity/GRC, 12 fase aktivitas, complexity matrix &amp; rate card berversi.</p>
          </div>
          <div className="flex items-center gap-3">
            {entities.length > 0 && (
              <select
                value={entityId}
                onChange={(ev) => { setEntityId(ev.target.value); void load(ev.target.value); }}
                className="rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-sm text-white"
              >
                {entities.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
            <Link href="/erp/pricing-simulator" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#2B124C] hover:bg-[#C0C0C0]">
              Buka Pricing Simulator →
            </Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {(['services', 'rate_cards', 'phases'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {t === 'services' ? `Service Master (${services.length})` : t === 'rate_cards' ? `19-Role Rate Cards (${rateCards.length})` : '12 Standard Activity Phases'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Memuat data Service Catalog dari database...</div>
      ) : tab === 'services' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={submitService} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#050505]">Registrasi Layanan Baru (Draft)</h2>
            <input required placeholder="Service Code (mis. VAPT-WEB-01)" value={svcForm.service_code} onChange={e => setSvcForm(s => ({ ...s, service_code: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input required placeholder="Service Name" value={svcForm.service_name} onChange={e => setSvcForm(s => ({ ...s, service_name: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <select value={svcForm.service_category} onChange={e => setSvcForm(s => ({ ...s, service_category: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm">
              {ENTERPRISE_SERVICE_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.family} — {c.label}</option>)}
            </select>
            <textarea required placeholder="Deskripsi layanan (min 8 karakter)" value={svcForm.description} onChange={e => setSvcForm(s => ({ ...s, description: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
            <textarea required placeholder="Ringkasan scope & deliverables (min 8 karakter)" value={svcForm.scope_summary} onChange={e => setSvcForm(s => ({ ...s, scope_summary: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-slate-600">Min MD (x0.1)<input type="number" value={svcForm.min_mandays_tenths} onChange={e => setSvcForm(s => ({ ...s, min_mandays_tenths: Number(e.target.value) }))} className="mt-1 w-full rounded border px-2 py-1 text-sm" /></label>
              <label className="text-xs text-slate-600">Std MD (x0.1)<input type="number" value={svcForm.standard_mandays_tenths} onChange={e => setSvcForm(s => ({ ...s, standard_mandays_tenths: Number(e.target.value) }))} className="mt-1 w-full rounded border px-2 py-1 text-sm" /></label>
              <label className="text-xs text-slate-600">Max MD (x0.1)<input type="number" value={svcForm.max_mandays_tenths} onChange={e => setSvcForm(s => ({ ...s, max_mandays_tenths: Number(e.target.value) }))} className="mt-1 w-full rounded border px-2 py-1 text-sm" /></label>
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#2B124C] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Simpan Service Draft</button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-3 text-base font-bold text-[#050505]">Master Layanan Terdaftar</h2>
            {services.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada service catalog terdaftar untuk legal entity ini. Gunakan form di kiri untuk mendaftarkan layanan.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2">Code</th>
                    <th className="p-2">Service Name</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Mandays (Min/Std/Max)</th>
                    <th className="p-2">Margin (Min/Tgt)</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {services.map(s => (
                    <tr key={s.id}>
                      <td className="p-2 font-mono font-semibold">{s.service_code} v{s.service_version}</td>
                      <td className="p-2 font-medium text-slate-900">{s.service_name}</td>
                      <td className="p-2 text-slate-600">{s.service_category}</td>
                      <td className="p-2">{(s.min_mandays_tenths / 10).toFixed(1)} / {(s.standard_mandays_tenths / 10).toFixed(1)} / {(s.max_mandays_tenths / 10).toFixed(1)} MD</td>
                      <td className="p-2">{(s.min_acceptable_margin_bps / 100).toFixed(1)}% / {(s.target_gross_margin_bps / 100).toFixed(1)}%</td>
                      <td className="p-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase">{s.lifecycle_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : tab === 'rate_cards' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={submitRateCard} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#050505]">Konfigurasi Rate Card (Finance/Admin)</h2>
            <select value={rateForm.role_code} onChange={e => setRateForm(r => ({ ...r, role_code: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm">
              {ENTERPRISE_RESOURCE_ROLES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <label className="block text-xs text-slate-600">Monthly Comp (cents IDR)<input type="number" value={rateForm.monthly_compensation_cents} onChange={e => setRateForm(r => ({ ...r, monthly_compensation_cents: Number(e.target.value) }))} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" /></label>
            <label className="block text-xs text-slate-600">Benefits / Month (cents)<input type="number" value={rateForm.benefit_allocation_cents} onChange={e => setRateForm(r => ({ ...r, benefit_allocation_cents: Number(e.target.value) }))} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" /></label>
            <label className="block text-xs text-slate-600">Available Days/Year<input type="number" value={rateForm.available_working_days} onChange={e => setRateForm(r => ({ ...r, available_working_days: Number(e.target.value) }))} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" /></label>
            <label className="block text-xs text-slate-600">Target Utilization (bps, 7500 = 75%)<input type="number" value={rateForm.target_utilization_bps} onChange={e => setRateForm(r => ({ ...r, target_utilization_bps: Number(e.target.value) }))} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" /></label>
            <button type="submit" className="w-full rounded-lg bg-[#2B124C] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Hitung &amp; Simpan Draft Rate Card</button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-3 text-base font-bold text-[#050505]">Unified 19-Role Resource Rate Card</h2>
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2">Role</th>
                  {costVisible && <th className="p-2">Internal Cost / MD</th>}
                  <th className="p-2">Min Selling / MD</th>
                  <th className="p-2">Std Selling / MD</th>
                  <th className="p-2">Effective</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rateCards.map(rc => (
                  <tr key={rc.id}>
                    <td className="p-2 font-semibold">{rc.role_label} (v{rc.version})</td>
                    {costVisible && <td className="p-2 font-mono">{fmtIDR(rc.internal_cost_rate_cents)}</td>}
                    <td className="p-2 font-mono">{fmtIDR(rc.min_selling_rate_cents)}</td>
                    <td className="p-2 font-mono font-semibold text-[#2B124C]">{fmtIDR(rc.standard_selling_rate_cents)}</td>
                    <td className="p-2">{rc.effective_date}</td>
                    <td className="p-2 uppercase">{rc.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[#050505]">12 Standard Activity-Based Mandays Phases</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {STANDARD_ACTIVITY_PHASES.map(p => (
              <div key={p.code} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Phase {String(p.order).padStart(2, '0')}</span>
                  <span className={p.defaultBillable ? 'font-semibold text-emerald-700' : 'text-amber-700'}>
                    {p.defaultBillable ? 'Billable' : 'Non-Billable'}
                  </span>
                </div>
                <p className="mt-1 font-semibold text-[#050505]">{p.label}</p>
                <p className="font-mono text-xs text-slate-500">{p.code}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
