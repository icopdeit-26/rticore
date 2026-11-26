'use client';

import React, { useEffect, useState } from 'react';

type OpsData = {
  background_jobs: Array<{ id: string; job_type: string; status: string; attempts: number; max_attempts: number; idempotency_key: string; created_at: string }>;
  backup_drills: Array<{ id: string; environment_name: string; backup_kind: string; rpo_minutes: number; rto_minutes: number; restore_verified: number; reconciliation_passed: number; created_at: string }>;
  feature_flags: Array<{ id: string; flag_key: string; enabled: number; rollout_scope: string; status: string }>;
  unified_audit_events: Array<{ id: string; area: string; entity_id: string; action: string; actor_email: string; created_at: string }>;
};

export default function EnterpriseOperationsCenterPage() {
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'jobs' | 'drills' | 'flags' | 'audit'>('jobs');

  useEffect(() => {
    fetch('/api/erp/operations-jobs', { cache: 'no-store' })
      .then(async res => {
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.message || 'Gagal memuat Operations Center');
        setData(j);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat Operations Center'));
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#050505] p-6 text-white shadow-sm border-b-4 border-[#2B124C]">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M30 · System Operations, Reliability &amp; Governance</p>
        <h1 className="mt-1 text-2xl font-bold">Operations Center, Durable Jobs, Backup/DR &amp; Unified Audit Explorer</h1>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {(['jobs', 'drills', 'flags', 'audit'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t === 'jobs' ? `Background Jobs (${data?.background_jobs.length ?? 0})` : t === 'drills' ? `Backup/DR Drills (${data?.backup_drills.length ?? 0})` : t === 'flags' ? `Feature Flags (${data?.feature_flags.length ?? 0})` : `Unified Audit (${data?.unified_audit_events.length ?? 0})`}
          </button>
        ))}
      </div>

      {data && tab === 'jobs' && (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Job Type</th><th className="p-2">Idempotency Key</th><th className="p-2">Attempts</th><th className="p-2">Status</th><th className="p-2">Created</th></tr></thead>
            <tbody className="divide-y">
              {data.background_jobs.map(j => <tr key={j.id}><td className="p-2 font-semibold">{j.job_type}</td><td className="p-2 font-mono">{j.idempotency_key}</td><td className="p-2">{j.attempts}/{j.max_attempts}</td><td className="p-2 uppercase font-bold">{j.status}</td><td className="p-2">{j.created_at}</td></tr>)}
            </tbody>
          </table>
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
