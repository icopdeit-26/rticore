'use client';

import React, { useCallback, useEffect, useState } from 'react';

type VaptEng = { id: string; engagement_code: string; title: string; test_type: string; window_start: string; window_end: string; status: string; lead_pentester_email: string };
type VaptFinding = { id: string; engagement_id: string; finding_code: string; title: string; severity: string; cvss_score_tenths: number; affected_asset: string; retest_status: string };
type DfirInc = { id: string; incident_code: string; title: string; severity: string; status: string; incident_commander_email: string; emergency_mandays_tenths: number };
type CocRow = { id: string; incident_id: string; evidence_tag: string; sha256_hash: string; custody_action: string; actor_email: string; storage_location: string; recorded_at: string };
type SocRow = { id: string; period_code: string; monitored_assets: number; active_use_cases: number; alerts_triaged: number; mttd_minutes: number; mttr_minutes: number; sla_compliance_bps: number; soc_gross_profit_cents?: number };

export default function CyberDeliveryOperationsPage() {
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [vaptEngs, setVaptEngs] = useState<VaptEng[]>([]);
  const [findings, setFindings] = useState<VaptFinding[]>([]);
  const [dfir, setDfir] = useState<DfirInc[]>([]);
  const [coc, setCoc] = useState<CocRow[]>([]);
  const [soc, setSoc] = useState<SocRow[]>([]);
  const [tab, setTab] = useState<'vapt' | 'dfir' | 'soc'>('vapt');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [vaptForm, setVaptForm] = useState({ engagement_code: '', title: '', test_type: 'web_app', window_start: new Date().toISOString().slice(0, 10), window_end: new Date().toISOString().slice(0, 10) });
  const [dfirForm, setDfirForm] = useState({ incident_code: '', title: '', severity: 'sev1_critical', emergency_mandays_tenths: 20 });

  const load = useCallback(async (selected?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = selected ? `?legal_entity_id=${encodeURIComponent(selected)}` : '';
      const res = await fetch(`/api/erp/cyber-delivery${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memuat Cyber Delivery');
      setEntityId(data.legal_entity_id || '');
      setEntities(data.authorized_entities || []);
      setVaptEngs(data.vapt_engagements || []);
      setFindings(data.vapt_findings || []);
      setDfir(data.dfir_incidents || []);
      setCoc(data.dfir_chain_of_custody || []);
      setSoc(data.soc_sla_metrics || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function registerVapt(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null); setError(null);
    const res = await fetch('/api/erp/cyber-delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register_vapt_engagement', legal_entity_id: entityId, ...vaptForm }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal mendaftarkan VAPT');
    else { setNotice(`VAPT Engagement ${vaptForm.engagement_code} terdaftar — menunggu otorisasi RoE independen.`); await load(entityId); }
  }

  async function createDfir(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null); setError(null);
    const res = await fetch('/api/erp/cyber-delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_dfir_incident', legal_entity_id: entityId, ...dfirForm }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) setError(j.message || 'Gagal aktivasi insiden DFIR');
    else { setNotice(`Insiden DFIR ${dfirForm.incident_code} aktif.`); await load(entityId); }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-2xl bg-[#2B124C] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C0C0C0]">M11 · M12 · M13 Cybersecurity Delivery Operations</p>
            <h1 className="mt-1 text-2xl font-bold">VAPT Lifecycle, DFIR Chain of Custody &amp; SOC/MDR SLA</h1>
            <p className="mt-1 text-sm text-white/80">Registrasi &amp; otorisasi RoE VAPT, temuan CVSS/QA/retest, aktivasi insiden DFIR dengan Chain of Custody immutable, serta metrik SLA &amp; profitabilitas SOC/MDR.</p>
          </div>
          {entities.length > 0 && (
            <select value={entityId} onChange={e => { setEntityId(e.target.value); void load(e.target.value); }} className="rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-sm text-white">
              {entities.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex gap-2 border-b pb-2">
        {(['vapt', 'dfir', 'soc'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-[#2B124C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t === 'vapt' ? `VAPT (${vaptEngs.length} Eng / ${findings.length} Findings)` : t === 'dfir' ? `DFIR & Chain of Custody (${dfir.length} / ${coc.length})` : `SOC/MDR SLA (${soc.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Memuat data Cyber Delivery...</div>
      ) : tab === 'vapt' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={registerVapt} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">Registrasi Engagement VAPT</h2>
            <input required placeholder="Kode (mis. VAPT-2026-01)" value={vaptForm.engagement_code} onChange={e => setVaptForm(f => ({ ...f, engagement_code: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input required placeholder="Judul Engagement" value={vaptForm.title} onChange={e => setVaptForm(f => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <select value={vaptForm.test_type} onChange={e => setVaptForm(f => ({ ...f, test_type: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm">
              {['web_app', 'mobile_app', 'api', 'network', 'cloud', 'active_directory', 'wireless', 'red_team', 'purple_team', 'source_code'].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={vaptForm.window_start} onChange={e => setVaptForm(f => ({ ...f, window_start: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
              <input type="date" value={vaptForm.window_end} onChange={e => setVaptForm(f => ({ ...f, window_end: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#2B124C] px-4 py-2 text-sm font-semibold text-white">Daftar Engagement</button>
          </form>
          <div className="space-y-4 lg:col-span-2">
            <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-bold">VAPT Engagements</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Title</th><th className="p-2">Type</th><th className="p-2">Window</th><th className="p-2">Status</th></tr></thead>
                <tbody className="divide-y">
                  {vaptEngs.map(e => <tr key={e.id}><td className="p-2 font-mono font-semibold">{e.engagement_code}</td><td className="p-2">{e.title}</td><td className="p-2">{e.test_type}</td><td className="p-2">{e.window_start} → {e.window_end}</td><td className="p-2 uppercase font-bold text-[#2B124C]">{e.status}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-bold">VAPT Findings (CVSS &amp; Retest)</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Finding</th><th className="p-2">CVSS</th><th className="p-2">Severity</th><th className="p-2">Retest Status</th></tr></thead>
                <tbody className="divide-y">
                  {findings.map(f => <tr key={f.id}><td className="p-2 font-mono">{f.finding_code}</td><td className="p-2">{f.title}</td><td className="p-2 font-mono font-bold">{(f.cvss_score_tenths / 10).toFixed(1)}</td><td className="p-2 uppercase">{f.severity}</td><td className="p-2 uppercase font-semibold">{f.retest_status}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'dfir' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={createDfir} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">Aktivasi Insiden DFIR</h2>
            <input required placeholder="Kode (mis. DFIR-2026-01)" value={dfirForm.incident_code} onChange={e => setDfirForm(f => ({ ...f, incident_code: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input required placeholder="Judul Insiden" value={dfirForm.title} onChange={e => setDfirForm(f => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <select value={dfirForm.severity} onChange={e => setDfirForm(f => ({ ...f, severity: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm">
              <option value="sev1_critical">SEV1 — Critical</option>
              <option value="sev2_high">SEV2 — High</option>
              <option value="sev3_medium">SEV3 — Medium</option>
              <option value="sev4_low">SEV4 — Low</option>
            </select>
            <button type="submit" className="w-full rounded-lg bg-[#2B124C] px-4 py-2 text-sm font-semibold text-white">Aktifkan Respons DFIR</button>
          </form>
          <div className="space-y-4 lg:col-span-2">
            <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-bold">Insiden DFIR Aktif</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50"><tr><th className="p-2">Code</th><th className="p-2">Title</th><th className="p-2">Severity</th><th className="p-2">Emergency MD</th><th className="p-2">Status</th></tr></thead>
                <tbody className="divide-y">
                  {dfir.map(d => <tr key={d.id}><td className="p-2 font-mono font-semibold">{d.incident_code}</td><td className="p-2">{d.title}</td><td className="p-2 uppercase">{d.severity}</td><td className="p-2 font-mono">{(d.emergency_mandays_tenths / 10).toFixed(1)} MD</td><td className="p-2 uppercase font-bold">{d.status}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-bold">Immutable Forensic Chain of Custody</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50"><tr><th className="p-2">Tag</th><th className="p-2">Action</th><th className="p-2">SHA-256</th><th className="p-2">Storage</th><th className="p-2">Actor</th></tr></thead>
                <tbody className="divide-y">
                  {coc.map(c => <tr key={c.id}><td className="p-2 font-mono font-semibold">{c.evidence_tag}</td><td className="p-2 uppercase">{c.custody_action}</td><td className="p-2 font-mono">{c.sha256_hash.slice(0, 16)}…</td><td className="p-2">{c.storage_location}</td><td className="p-2">{c.actor_email}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold">SOC / MDR Monthly SLA &amp; Profitability</h2>
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50"><tr><th className="p-2">Period</th><th className="p-2">Assets</th><th className="p-2">Use Cases</th><th className="p-2">Alerts</th><th className="p-2">MTTD / MTTR</th><th className="p-2">SLA %</th></tr></thead>
            <tbody className="divide-y">
              {soc.map(s => <tr key={s.id}><td className="p-2 font-mono font-semibold">{s.period_code}</td><td className="p-2">{s.monitored_assets}</td><td className="p-2">{s.active_use_cases}</td><td className="p-2">{s.alerts_triaged}</td><td className="p-2 font-mono">{s.mttd_minutes}m / {s.mttr_minutes}m</td><td className="p-2 font-mono font-bold text-emerald-700">{(s.sla_compliance_bps / 100).toFixed(2)}%</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
