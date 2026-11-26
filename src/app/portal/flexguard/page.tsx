'use client';

import React, { useEffect, useState } from 'react';

type PortalData = {
  customer_id: string;
  portal_role: string;
  balance: {
    purchasedCredits: number;
    reservedCredits: number;
    consumedCredits: number;
    availableCredits: number;
    expiredCredits: number;
    utilizationBps: number;
  };
  history: Array<{ id: string; transaction_type: string; credit_amount: number; reference_code: string; created_at: string }>;
  service_requests: Array<{ id: string; request_number: string; title: string; status: string; estimated_credits: number; reserved_credits: number; consumed_credits: number }>;
};

export default function FlexGuardCustomerPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal/flexguard', { cache: 'no-store' })
      .then(async res => {
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.message || 'Akses Customer Portal memerlukan grant pelanggan aktif.');
        setData(j);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat Customer Portal'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#050505] p-6 text-white shadow-sm border-b-4 border-[#2B124C]">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">FlexGuard Customer Portal</p>
        <h1 className="mt-1 text-2xl font-bold">Service Credit Wallet &amp; Engagement Tracker</h1>
        <p className="mt-1 text-sm text-[#C0C0C0]">Pantau saldo kredit aktif, reservasi, status permintaan layanan, deliverables, dan laporan utilisasi bulanan secara aman.</p>
      </div>

      {loading && <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">Memverifikasi sesi Customer Portal...</div>}
      {error && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Available Credits</p>
              <p className="mt-1 text-2xl font-bold text-[#2B124C]">{data.balance.availableCredits}</p>
            </div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Reserved Credits</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{data.balance.reservedCredits}</p>
            </div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Consumed Credits</p>
              <p className="mt-1 text-2xl font-bold text-[#050505]">{data.balance.consumedCredits}</p>
            </div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Utilization</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{(data.balance.utilizationBps / 100).toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-[#050505]">Active Service Requests</h2>
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50">
                <tr><th className="p-2">Request #</th><th className="p-2">Title</th><th className="p-2">Est / Res / Consumed</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody className="divide-y">
                {data.service_requests.map(r => (
                  <tr key={r.id}>
                    <td className="p-2 font-mono">{r.request_number}</td>
                    <td className="p-2 font-medium">{r.title}</td>
                    <td className="p-2 font-mono">{r.estimated_credits} / {r.reserved_credits} / {r.consumed_credits}</td>
                    <td className="p-2 uppercase font-semibold text-[#2B124C]">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
