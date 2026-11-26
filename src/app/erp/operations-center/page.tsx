'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type OpsData = {
  background_jobs: Array<{ id: string; job_type: string; status: string; attempts: number; max_attempts: number; idempotency_key: string; created_at: string }>;
  backup_drills: Array<{ id: string; environment_name: string; backup_kind: string; rpo_minutes: number; rto_minutes: number; restore_verified: number; reconciliation_passed: number; created_at: string }>;
  feature_flags: Array<{ id: string; flag_key: string; enabled: number; rollout_scope: string; status: string }>;
  unified_audit_events: Array<{ id: string; area: string; entity_id: string; action: string; actor_email: string; created_at: string }>;
};

type ApprovalItem = { id: string; module: string; ref: string; title: string; maker: string; action_route: string; created_at: string };

export default function EnterpriseOperationsCenterPage() {
  const [data, setData] = useState<OpsData | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'approvals' | 'jobs' | 'drills' | 'flags' | 'audit'>('approvals');
  const [jobType, setJobType] = useState('finance_outbox_dispatch');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [opsRes, appRes] = await Promise.all([
        fetch('/api/erp/operations-jobs', { cache: 'no-store' }),
        fetch('/api/erp/enterprise-approvals', { cache: 'no-store' }),
      ]);
      const opsJson = await opsRes.json();
      if (!opsRes.ok || !opsJson.success) throw new Error(opsJson.message || 'Gagal memuat Operations Center');
      setData(opsJson);
      if (appRes.ok) {
        const appJson = await appRes.json();
        if (appJson.success) setApprovals(appJson.queue || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat Operations Center');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function enqueueJob() {
    setNotice(null); setError(null);
    const res = await fetch('/api/erp/operations-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enqueue_job', job_type: jobType, idempotency_key: `manual-${jobType}-${Date.now()}` }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal menjadwalkan job');
    else { setNotice(`Background job '${jobType}' masuk antrian (${j.id.slice(0, 8)}).`); await load(); }
  }

  async function retryJob(jobId: string) {
    setNotice(null); setError(null);
    const res = await fetch('/api/erp/operations-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry_dead_letter', job_id: jobId }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal retry job');
    else { setNotice('Job dikembalikan ke status queued.'); await load(); }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#050505] p-6 text-white shadow-sm border-b-4 border-[#2B124C]">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M30 · System Operations, Governance &amp; Enterprise SoD Approvals</p>
        <h1 className="mt-1 text-2xl font-bold">Operations Center, Enterprise Approval Inbox, Durable Jobs, DR Drills &amp; Audit Explorer</h1>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {(['approvals', 'jobs', 'drills', 'flags', 'audit'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t === 'approvals' ? `SoD Approval Inbox (${approvals.length})` : t === 'jobs' ? `Background Jobs (${data?.background_jobs.length ?? 0})` : t === 'drills' ? `Backup/DR Drills (${data?.backup_drills.length ?? 0})` : t === 'flags' ? `Feature Flags (${data?.feature_flags.length ?? 0})` : `Unified Audit (${data?.unified_audit_events.length ?? 0})`}
          </button>
        ))}
      </div>

      {tab === 'approvals' && (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold">Unified Enterprise SoD Approval Inbox (Excluding Own Submissions)</h2>
          {approvals.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada item approval lintas modul yang menunggu keputusan independen Anda saat ini.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50"><tr><th className="p-2">Module</th><th className="p-2">Ref</th><th className="p-2">Title</th><th className="p-2">Maker</th><th className="p-2">Open</th></tr></thead>
              <tbody className="divide-y">
                {approvals.map(a => (
                  <tr key={`${a.module}-${a.id}`}>
                    <td className="p-2 uppercase font-bold text-[#2B124C]">{a.module}</td>
                    <td className="p-2 font-mono">{a.ref}</td>
                    <td className="p-2">{a.title}</td>
                    <td className="p-2">{a.maker}</td>
                    <td className="p-2"><Link href={a.action_route} className="font-semibold text-[#2B124C] underline">Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === 'jobs' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
            <select value={jobType} onChange={e => setJobType(e.target.value)} className="rounded-lg border px-3 py-2 text-xs font-semibold">
              {['finance_outbox_dispatch', 'flexguard_expiry_scan', 'sla_breach_monitor', 'sales_activity_sla', 'backup_verification', 'report_generation', 'renewal_signal_scan'].map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <button type="button" onClick={() => void enqueueJob()} className="rounded-lg bg-[#2B124C] px-4 py-2 text-xs font-bold text-white">Enqueue Durable Job</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50"><tr><th className="p-2">Job Type</th><th className="p-2">Idempotency Key</th><th className="p-2">Attempts</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead>
              <tbody className="divide-y">
                {data.background_jobs.map(j => (
                  <tr key={j.id}>
                    <td className="p-2 font-semibold">{j.job_type}</td>
                    <td className="p-2 font-mono">{j.idempotency_key}</td>
                    <td className="p-2">{j.attempts}/{j.max_attempts}</td>
                    <td className="p-2 uppercase font-bold">{j.status}</td>
                    <td className="p-2">{(j.status === 'dead_letter' || j.status === 'failed') && <button type="button" onClick={() => void retryJob(j.id)} className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white">Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && tab === 'drills' && (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Environment</th><th className="p-2">Kind</th><th className="p-2">RPO / RTO</th><th className="p-2">Verified</th><th className="p-2">Reconciled</th></tr></thead>
            <tbody className="divide-y">
              {data.backup_drills.map(d => <tr key={d.id}><td className="p-2 font-semibold">{d.environment_name}</td><td className="p-2">{d.backup_kind}</td><td className="p-2 font-mono">{d.rpo_minutes}m / {d.rto_minutes}m</td><td className="p-2">{d.restore_verified ? 'YES' : 'PENDING'}</td><td className="p-2">{d.reconciliation_passed ? 'PASS' : 'PENDING'}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === 'flags' && (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Flag Key</th><th className="p-2">Scope</th><th className="p-2">Enabled</th><th className="p-2">Status</th></tr></thead>
            <tbody className="divide-y">
              {data.feature_flags.map(f => <tr key={f.id}><td className="p-2 font-mono font-semibold">{f.flag_key}</td><td className="p-2">{f.rollout_scope}</td><td className="p-2 font-bold">{f.enabled ? 'ON' : 'OFF'}</td><td className="p-2 uppercase">{f.status}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === 'audit' && (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Area</th><th className="p-2">Action</th><th className="p-2">Entity ID</th><th className="p-2">Actor</th><th className="p-2">Timestamp</th></tr></thead>
            <tbody className="divide-y">
              {data.unified_audit_events.map(ev => <tr key={ev.id}><td className="p-2 font-semibold">{ev.area}</td><td className="p-2 font-mono">{ev.action}</td><td className="p-2 font-mono">{ev.entity_id.slice(0, 12)}</td><td className="p-2">{ev.actor_email}</td><td className="p-2">{ev.created_at}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
