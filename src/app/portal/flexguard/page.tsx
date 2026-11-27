'use client';

import React, { useCallback, useEffect, useState } from 'react';

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
  credit_lots: Array<{ id: string; wallet_id: string; contract_id: string; lot_code: string; credits_total: number; expires_at: string; status: string }>;
  history: Array<{ id: string; transaction_type: string; credit_amount: number; reference_code: string; created_at: string }>;
  service_requests: Array<{ id: string; request_number: string; title: string; status: string; estimated_credits: number; reserved_credits: number; consumed_credits: number }>;
  monthly_statement: Record<string, unknown>;
};

export default function FlexGuardCustomerPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reqForm, setReqForm] = useState({ title: '', service_category: 'web_app_pentest', scope_description: '', emergency_flag: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/flexguard', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'Akses Customer Portal memerlukan grant pelanggan aktif.');
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat Customer Portal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.credit_lots[0]) { setError('Belum ada kontrak/wallet aktif untuk mengajukan permintaan.'); return; }
    setNotice(null); setError(null);
    const lot = data.credit_lots[0];
    const res = await fetch('/api/portal/flexguard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit_service_request', contract_id: lot.contract_id, wallet_id: lot.wallet_id, ...reqForm }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal mengajukan permintaan layanan');
    else { setNotice(`Permintaan ${j.request_number} berhasil diajukan.`); setReqForm({ title: '', service_category: 'web_app_pentest', scope_description: '', emergency_flag: false }); await load(); }
  }

  async function portalDecision(requestId: string, action: 'approve_scope' | 'accept_delivery') {
    setNotice(null); setError(null);
    const res = await fetch('/api/portal/flexguard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, request_id: requestId }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal memproses keputusan');
    else { setNotice(`Status diperbarui menjadi ${j.status}.`); await load(); }
  }

  function downloadStatement() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.monthly_statement, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flexguard-statement-${data.customer_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#050505] p-6 text-white shadow-sm border-b-4 border-[#2B124C]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">FlexGuard Customer Portal</p>
            <h1 className="mt-1 text-2xl font-bold">Service Credit Wallet &amp; Engagement Tracker</h1>
            <p className="mt-1 text-sm text-[#C0C0C0]">Pantau saldo kredit aktif, reservasi, status permintaan layanan, deliverables, dan unduh monthly utilization statement secara aman.</p>
          </div>
          {data && (
            <button type="button" onClick={downloadStatement} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-[#2B124C] hover:bg-[#C0C0C0]">
              Download Utilization Statement
            </button>
          )}
        </div>
      </div>

      {loading && <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">Memverifikasi sesi Customer Portal...</div>}
      {error && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Available Credits</p><p className="mt-1 text-2xl font-bold text-[#2B124C]">{data.balance.availableCredits}</p></div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Reserved Credits</p><p className="mt-1 text-2xl font-bold text-amber-700">{data.balance.reservedCredits}</p></div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Consumed Credits</p><p className="mt-1 text-2xl font-bold text-[#050505]">{data.balance.consumedCredits}</p></div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Utilization</p><p className="mt-1 text-2xl font-bold text-emerald-700">{(data.balance.utilizationBps / 100).toFixed(1)}%</p></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <form onSubmit={submitRequest} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-[#050505]">Ajukan Service Request Baru</h2>
              <input required placeholder="Judul Permintaan Layanan" value={reqForm.title} onChange={e => setReqForm(f => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <select value={reqForm.service_category} onChange={e => setReqForm(f => ({ ...f, service_category: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="web_app_pentest">Web Application Pentest</option>
                <option value="api_pentest">API Penetration Testing</option>
                <option value="incident_response">Emergency Incident Response</option>
                <option value="grc_consulting">GRC / ISO 27001 / PDP Advisory</option>
              </select>
              <textarea required placeholder="Deskripsi scope target & ekspektasi deliverable (min 12 karakter)" rows={3} value={reqForm.scope_description} onChange={e => setReqForm(f => ({ ...f, scope_description: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={reqForm.emergency_flag} onChange={e => setReqForm(f => ({ ...f, emergency_flag: e.target.checked }))} />
                Permintaan Darurat (Emergency SLA &amp; Multiplier)
              </label>
              <button type="submit" className="w-full rounded-lg bg-[#2B124C] px-4 py-2 text-sm font-semibold text-white">Kirim Permintaan</button>
            </form>

            <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-3 text-base font-bold text-[#050505]">Active Service Requests &amp; Customer Actions</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50"><tr><th className="p-2">Request #</th><th className="p-2">Title</th><th className="p-2">Est/Res/Cons</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead>
                <tbody className="divide-y">
                  {data.service_requests.map(r => (
                    <tr key={r.id}>
                      <td className="p-2 font-mono">{r.request_number}</td>
                      <td className="p-2 font-medium">{r.title}</td>
                      <td className="p-2 font-mono">{r.estimated_credits}/{r.reserved_credits}/{r.consumed_credits}</td>
                      <td className="p-2 uppercase font-semibold text-[#2B124C]">{r.status}</td>
                      <td className="p-2">
                        {r.status === 'credit_quoted' && <button type="button" onClick={() => void portalDecision(r.id, 'approve_scope')} className="rounded bg-[#2B124C] px-2 py-1 text-[11px] font-semibold text-white">Approve Scope</button>}
                        {r.status === 'qa_passed' && <button type="button" onClick={() => void portalDecision(r.id, 'accept_delivery')} className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white">Accept Delivery</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
