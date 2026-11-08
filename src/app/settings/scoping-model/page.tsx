'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminNavigation from '@/components/admin/AdminNavigation';
import { SCOPING_DEFINITIONS, SCOPING_SERVICE_TYPES } from '@/lib/scoping-service-options';
import type { CalibrationStats, ModelFactors } from '@/lib/scoping-calibration';

type Model = {
  id: string; version: number; status: 'draft' | 'active' | 'archived'; method: string;
  provider_id: string | null; model: string | null; ai_rationale: string | null; sample_count: number;
  created_by: string; created_at: string; activated_by: string | null; activated_at: string | null;
  factors: ModelFactors; stats: CalibrationStats | null;
};
type Provider = { id: string; name: string; model: string; models: readonly string[] };
type State = {
  active: Model | null; history: Model[]; providers: Provider[];
  settings: { provider_id: string | null; model: string | null } | null;
  dataset: { stats: CalibrationStats; statisticalFactors: ModelFactors };
  due: boolean; recalibrationDays: number;
};

const date = (v: string | null | undefined) => v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const f3 = (v: number | undefined | null) => typeof v === 'number' ? v.toFixed(3) : '—';
const btn = 'min-h-11 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50';

export default function ScopingModelPage() {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/scoping-model', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.success) throw Error(j.message || 'Gagal memuat model.');
      setState(j);
      const pid = j.settings?.provider_id || j.providers[0]?.id || '';
      setProvider(pid);
      setModel(j.settings?.model || j.providers.find((p: Provider) => p.id === pid)?.model || '');
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/admin/scoping-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      setMessage(j.message || (j.success ? 'Berhasil.' : 'Gagal.'));
      if (j.success) await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const chosen = state?.providers.find(p => p.id === provider);
  const stats = state?.dataset.stats;
  const draft = state?.history.find(m => m.status === 'draft');

  return (
    <main className="mx-auto min-w-0 max-w-6xl space-y-5 pb-24">
      <AdminNavigation />
      <header>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-indigo-700">Administrasi · Khusus Admin</p>
        <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">Model Scoping, Mandays & Harga</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
          Membandingkan indikasi harga scoping awal (ICOP Pricing Engine) dengan nilai deal akhir hasil negosiasi (PO sebelum PPN, Closed Won)
          untuk menghitung faktor kalibrasi per produk. Perbarui minimal setiap {state?.recalibrationDays ?? 30} hari. Model baru selalu berstatus draft dan baru dipakai setelah Admin mengaktifkannya.
        </p>
      </header>

      {message && <p role="status" className="whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">{message}</p>}

      {state && (
        <section className={'rounded-xl border p-4 text-xs ' + (state.due ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
          <p className="text-sm font-bold">{state.due ? 'Pembaruan model jatuh tempo' : 'Model masih dalam periode berlaku'}</p>
          <p className="mt-1">Model aktif: {state.active ? 'v' + state.active.version + ' · ' + (state.active.method === 'ai_assisted' ? 'AI (' + state.active.provider_id + ' / ' + state.active.model + ')' : 'statistik') + ' · aktif sejak ' + date(state.active.activated_at) : 'belum ada (faktor 1,000 untuk semua produk)'}.</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h2 className="text-sm font-bold">1 · AI untuk pembaruan model</h2>
          <p className="text-xs text-slate-500">Hanya provider yang aktif dan lulus uji di <Link href="/settings/ai" className="font-semibold text-blue-700 underline">API Key</Link>. Yang dikirim hanya statistik agregat per produk — tanpa nama pelanggan, opportunity, atau data pribadi.</p>
          {state && state.providers.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Belum ada AI aktif. Mode statistik tetap dapat dipakai.</p> : <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold">Provider AI
                <select className="mt-1.5 w-full rounded-lg border px-3 py-2 text-xs" value={provider} onChange={e => { setProvider(e.target.value); setModel(state?.providers.find(p => p.id === e.target.value)?.model || ''); }}>
                  {state?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label className="text-xs font-semibold">Model
                <select className="mt-1.5 w-full rounded-lg border px-3 py-2 text-xs" value={model} onChange={e => setModel(e.target.value)}>
                  {[...new Set([chosen?.model, ...(chosen?.models || [])].filter(Boolean) as string[])].map(m => <option key={m} value={m}>{m}</option>)}
                </select></label>
            </div>
            <button disabled={busy || !provider || !model} onClick={() => post({ action: 'settings', provider_id: provider, model })} className={btn + ' border border-slate-300 bg-white'}>Simpan sebagai AI default</button>
          </>}
        </section>

        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h2 className="text-sm font-bold">2 · Buat usulan model baru</h2>
          <p className="text-xs text-slate-500">Dataset: {stats?.totalSamples ?? 0} deal Closed Won dengan estimasi scoping & nilai PO{stats?.discarded ? ' · ' + stats.discarded + ' dibuang (rasio di luar 0,2–5×)' : ''}. AI hanya boleh menggeser faktor statistik maksimal ±0,15 (batas 0,6–1,4).</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !provider || !stats?.totalSamples} onClick={() => post({ action: 'propose', mode: 'ai', provider_id: provider, model })} className={btn + ' bg-indigo-700 text-white'}>{busy ? 'Memproses…' : 'Usulkan dengan AI'}</button>
            <button disabled={busy} onClick={() => post({ action: 'propose', mode: 'statistical' })} className={btn + ' border border-indigo-300 bg-white text-indigo-800'}>Usulkan statistik (tanpa AI)</button>
          </div>
          {!stats?.totalSamples && <p className="text-xs text-amber-800">Belum ada data pembanding. Data terkumpul otomatis saat Presales menerapkan estimasi scoping di Opportunity, lalu deal ditutup Closed Won dengan nilai PO.</p>}
        </section>
      </div>

      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-bold">3 · Perbandingan per produk</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead><tr className="border-b text-left text-slate-500">
              <th className="py-2 pr-2">Produk</th><th className="py-2 pr-2 text-right">n</th><th className="py-2 pr-2 text-right">Median deal/indikasi</th>
              <th className="py-2 pr-2 text-right">P25–P75</th><th className="py-2 pr-2 text-right">Error sebelum</th><th className="py-2 pr-2 text-right">Error setelah</th>
              <th className="py-2 pr-2 text-right">Faktor statistik</th><th className="py-2 pr-2 text-right">Aktif</th>{draft && <th className="py-2 text-right">Draft v{draft.version}</th>}
            </tr></thead>
            <tbody>{SCOPING_SERVICE_TYPES.map(p => {
              const s = stats?.products[p];
              return <tr key={p} className="border-b border-slate-100">
                <td className="py-2 pr-2 font-semibold">{SCOPING_DEFINITIONS[p].label}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{s?.n ?? 0}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{f3(s?.medianRatio)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{s ? f3(s.p25Ratio) + '–' + f3(s.p75Ratio) : '—'}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{s ? s.mapeBefore + '%' : '—'}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{s ? s.mapeAfter + '%' : '—'}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{f3(state?.dataset.statisticalFactors[p])}</td>
                <td className="py-2 pr-2 text-right font-bold tabular-nums">{f3(state?.active?.factors[p] ?? 1)}</td>
                {draft && <td className="py-2 text-right font-bold tabular-nums text-indigo-800">{f3(draft.factors[p])}</td>}
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">Faktor &gt; 1 berarti deal akhir cenderung di atas indikasi; &lt; 1 berarti diskon negosiasi. Produk dengan n &lt; 3 memakai faktor global.</p>
      </section>

      {draft && <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs">
        <h2 className="text-sm font-bold text-indigo-950">Draft v{draft.version} · {draft.method === 'ai_assisted' ? 'AI ' + draft.provider_id + ' / ' + draft.model : 'statistik'}</h2>
        <p className="text-slate-600">Dibuat {date(draft.created_at)} oleh {draft.created_by} · {draft.sample_count} sampel</p>
        {draft.ai_rationale && <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-slate-800">{draft.ai_rationale}</p>}
        <button disabled={busy} onClick={() => { if (window.confirm('Aktifkan draft v' + draft.version + '? Model aktif sebelumnya akan diarsipkan.')) void post({ action: 'activate', id: draft.id }); }} className={btn + ' bg-emerald-700 text-white'}>Aktifkan Model v{draft.version}</button>
      </section>}

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-bold">Riwayat model</h2>
        {!state?.history.length ? <p className="text-xs text-slate-500">Belum ada model.</p> :
          <ul className="space-y-1 text-xs">{state.history.map(m => <li key={m.id} className="flex flex-wrap justify-between gap-2 border-t pt-2">
            <span><b>v{m.version}</b> · {m.status} · {m.method === 'ai_assisted' ? 'AI ' + m.provider_id : 'statistik'} · {m.sample_count} sampel</span>
            <span className="text-slate-500">dibuat {date(m.created_at)}{m.activated_at ? ' · aktif ' + date(m.activated_at) : ''}</span>
          </li>)}</ul>}
      </section>
    </main>
  );
}
