'use client';

import React, { useCallback, useEffect, useState } from 'react';

type CtiCase = { id: string; case_code: string; title: string; request_type: string; tlp_classification: string; severity: string; status: string };
type GrcEng = { id: string; engagement_code: string; framework: string; title: string; compliant_controls: number; total_controls: number; audit_readiness_bps: number; status: string };
type RiskRow = { id: string; risk_code: string; risk_domain: string; title: string; residual_likelihood: number; residual_impact: number; status: string };
type CtrlRow = { id: string; control_code: string; regulatory_ref: string; title: string; control_type: string; assessment_status: string };

export default function CyberGrcCtiWorkspacePage() {
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [ctiCases, setCtiCases] = useState<CtiCase[]>([]);
  const [grc, setGrc] = useState<GrcEng[]>([]);
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [controls, setControls] = useState<CtrlRow[]>([]);
  const [tab, setTab] = useState<'cti' | 'grc' | 'risk'>('cti');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (selected?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = selected ? `?legal_entity_id=${encodeURIComponent(selected)}` : '';
      const res = await fetch(`/api/erp/cyber-grc-cti${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memuat modul CTI/GRC/Risk');
      setEntityId(data.legal_entity_id || '');
      setEntities(data.authorized_entities || []);
      setCtiCases(data.cti_cases || []);
      setGrc(data.grc_engagements || []);
      setRisks(data.enterprise_risks || []);
      setControls(data.enterprise_controls || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data');
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
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M14 · M15 · M27 Cybersecurity Intelligence, GRC &amp; Enterprise Risk</p>
            <h1 className="mt-1 text-2xl font-bold">CTI, GRC Consulting &amp; Enterprise Risk Register</h1>
            <p className="mt-1 text-sm text-white/80">Threat intelligence cases &amp; IOCs, ISO 27001/UU PDP compliance engagements, RCSA risk register &amp; independent control testing (SoD).</p>
          </div>
          {entities.length > 0 && (
            <select value={entityId} onChange={e => { setEntityId(e.target.value); void load(e.target.value); }} className="rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-sm text-white">
              {entities.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex gap-2 border-b pb-2">
        {(['cti', 'grc', 'risk'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t === 'cti' ? `CTI Cases (${ctiCases.length})` : t === 'grc' ? `GRC Engagements (${grc.length})` : `Risk & Controls (${risks.length} / ${controls.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Memuat data CTI, GRC &amp; Enterprise Risk...</div>
      ) : tab === 'cti' ? (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Case</th><th className="p-2">Title</th><th className="p-2">Type</th><th className="p-2">TLP</th><th className="p-2">Severity</th><th className="p-2">Status</th></tr></thead>
            <tbody className="divide-y">
              {ctiCases.map(c => <tr key={c.id}><td className="p-2 font-mono font-semibold">{c.case_code}</td><td className="p-2">{c.title}</td><td className="p-2">{c.request_type}</td><td className="p-2 font-mono">{c.tlp_classification}</td><td className="p-2 uppercase">{c.severity}</td><td className="p-2 uppercase">{c.status}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : tab === 'grc' ? (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Framework</th><th className="p-2">Title</th><th className="p-2">Controls</th><th className="p-2">Readiness</th><th className="p-2">Status</th></tr></thead>
            <tbody className="divide-y">
              {grc.map(g => <tr key={g.id}><td className="p-2 font-mono font-semibold">{g.engagement_code}</td><td className="p-2">{g.framework}</td><td className="p-2">{g.title}</td><td className="p-2 font-mono">{g.compliant_controls}/{g.total_controls}</td><td className="p-2 font-mono font-bold text-[#2B124C]">{(g.audit_readiness_bps / 100).toFixed(1)}%</td><td className="p-2 uppercase">{g.status}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold">Enterprise Risk Register</h2>
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Domain</th><th className="p-2">Title</th><th className="p-2">Score</th><th className="p-2">Status</th></tr></thead>
              <tbody className="divide-y">
                {risks.map(r => <tr key={r.id}><td className="p-2 font-mono font-semibold">{r.risk_code}</td><td className="p-2">{r.risk_domain}</td><td className="p-2">{r.title}</td><td className="p-2 font-mono font-bold">{r.residual_likelihood * r.residual_impact}/25</td><td className="p-2 uppercase">{r.status}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold">Internal Control Register (SoD Tested)</h2>
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Reg Ref</th><th className="p-2">Control</th><th className="p-2">Assessment</th></tr></thead>
              <tbody className="divide-y">
                {controls.map(c => <tr key={c.id}><td className="p-2 font-mono font-semibold">{c.control_code}</td><td className="p-2">{c.regulatory_ref}</td><td className="p-2">{c.title}</td><td className="p-2 uppercase font-semibold">{c.assessment_status}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
