'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FLEXGUARD_DEFAULT_PACKAGES, FLEXGUARD_CONVERSION_TIERS } from '@/lib/flexguard-enterprise';

type PackageRow = {
  id: string;
  package_code: string;
  package_name: string;
  billing_model: string;
  credits_included: number;
  unit_credit_price_cents: number;
  validity_days: number;
  status: string;
};

type ServiceReqRow = {
  id: string;
  request_number: string;
  title: string;
  service_category: string;
  service_tier: string;
  priority: string;
  status: string;
  estimated_credits: number;
  reserved_credits: number;
  consumed_credits: number;
};

type LedgerRow = {
  id: string;
  wallet_id: string;
  transaction_type: string;
  credit_amount: number;
  approval_status: string;
  reference_code: string;
  actor_email: string;
  created_at: string;
};

const fmtIDR = (cents: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(cents / 100);

export default function FlexGuardEnterpriseConsolePage() {
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [requests, setRequests] = useState<ServiceReqRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'requests' | 'ledger' | 'packages'>('requests');

  const load = useCallback(async (selected?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = selected ? `?legal_entity_id=${encodeURIComponent(selected)}` : '';
      const res = await fetch(`/api/erp/flexguard-enterprise${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memuat FlexGuard Enterprise');
      setEntityId(data.legal_entity_id || '');
      setEntities(data.authorized_entities || []);
      setPackages(data.packages || []);
      setRequests(data.service_requests || []);
      setLedger(data.ledger || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat FlexGuard Enterprise');
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
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M09 · FlexGuard Service Credit Management</p>
            <h1 className="mt-1 text-2xl font-bold">FlexGuard Enterprise Console</h1>
            <p className="mt-1 text-sm text-white/80">Package builder, conversion matrix berversi, immutable 12-type credit ledger, 14-step service request workflow, SLA &amp; PSAK 115 Finance bridge.</p>
          </div>
          <div className="flex items-center gap-3">
            {entities.length > 0 && (
              <select value={entityId} onChange={e => { setEntityId(e.target.value); void load(e.target.value); }} className="rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-sm text-white">
                {entities.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
            <Link href="/portal/flexguard" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#2B124C] hover:bg-[#C0C0C0]">
              Customer Portal View →
            </Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex gap-2 border-b pb-2">
        {(['requests', 'ledger', 'packages'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t === 'requests' ? `Service Requests (${requests.length})` : t === 'ledger' ? `Immutable Credit Ledger (${ledger.length})` : `Package Templates (${packages.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Memuat FlexGuard Enterprise ledger...</div>
      ) : tab === 'requests' ? (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[#050505]">14-Step FlexGuard Service Requests</h2>
          {requests.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada service request FlexGuard pada legal entity ini.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr><th className="p-2">Request #</th><th className="p-2">Title</th><th className="p-2">Tier</th><th className="p-2">Priority</th><th className="p-2">Est / Res / Consumed</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody className="divide-y">
                {requests.map(r => (
                  <tr key={r.id}>
                    <td className="p-2 font-mono font-semibold">{r.request_number}</td>
                    <td className="p-2 font-medium">{r.title}</td>
                    <td className="p-2">{r.service_tier}</td>
                    <td className="p-2 uppercase">{r.priority}</td>
                    <td className="p-2 font-mono">{r.estimated_credits} / {r.reserved_credits} / {r.consumed_credits} cr</td>
                    <td className="p-2 uppercase font-semibold text-[#2B124C]">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === 'ledger' ? (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[#050505]">Immutable Enterprise Credit Ledger</h2>
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50 text-slate-600">
              <tr><th className="p-2">Ref</th><th className="p-2">Type</th><th className="p-2">Credits</th><th className="p-2">Status</th><th className="p-2">Actor</th><th className="p-2">Timestamp</th></tr>
            </thead>
            <tbody className="divide-y">
              {ledger.map(tx => (
                <tr key={tx.id}>
                  <td className="p-2 font-mono">{tx.reference_code}</td>
                  <td className="p-2 font-semibold uppercase">{tx.transaction_type}</td>
                  <td className="p-2 font-mono font-bold">{tx.credit_amount}</td>
                  <td className="p-2 uppercase">{tx.approval_status}</td>
                  <td className="p-2">{tx.actor_email}</td>
                  <td className="p-2">{tx.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-[#050505]">Configurable Package Templates</h2>
            <ul className="space-y-2 text-xs">
              {FLEXGUARD_DEFAULT_PACKAGES.map(p => (
                <li key={p.code} className="flex justify-between rounded-lg border p-2.5">
                  <span className="font-semibold">{p.code} — {p.name}</span>
                  <span className="font-mono text-[#2B124C]">{p.credits} credits</span>
                </li>
              ))}
            </ul>
            {packages.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-bold uppercase text-slate-500">Approved / Active Custom Packages</h3>
                {packages.map(p => (
                  <div key={p.id} className="mt-1 flex justify-between text-xs">
                    <span>{p.package_code} ({p.status})</span>
                    <span className="font-mono">{p.credits_included} cr · {fmtIDR(p.unit_credit_price_cents)}/cr</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-[#050505]">Default Service Credit Conversion Matrix</h2>
            <ul className="space-y-2 text-xs">
              {Object.entries(FLEXGUARD_CONVERSION_TIERS).map(([k, v]) => (
                <li key={k} className="flex justify-between rounded-lg border p-2.5">
                  <span className="font-semibold">{v.label}</span>
                  <span className="font-mono font-bold text-[#2B124C]">{(v.defaultMultiplierBps / 10000).toFixed(2)}x credit/MD</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
