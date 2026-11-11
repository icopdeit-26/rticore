'use client';
import React,{useCallback,useEffect,useState} from 'react';
import {ITDevWorkspaceGuide} from '@/components/sales/ITDevWorkspaceGuide';

type Schema={status:string;latest_applied_version:number|null;[k:string]:unknown};
type Health={role:string;checked_at:string;can_read_audit:boolean;database:{ok:boolean;latency_ms:number};schema:Schema;migrations:{version:number|string;applied_at:string}[];
 active_users_by_role:{role:string;active_users:number}[];transaction_guards_pending:number;
 ai_readiness:{configured:number;enabled:number;enabled_with_key:number;enabled_tested_successfully:number};
 release:{production_gate:string;master_gates:unknown;note:string}};
type AuditRow={id:string;area:string;entity_id:string;action:string;actor_email:string;created_at:string};
const api=async(url:string)=>{const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});const j=await r.json();if(!r.ok||!j.success)throw Error(j.message||'Gagal memuat diagnostik');return j;};

/** Read-only platform diagnostics for the IT Developer Team (0051) and Admin. */
export default function PlatformDiagnosticsPage(){
 const [health,setHealth]=useState<Health|null>(null),[audit,setAudit]=useState<AuditRow[]>([]),[page,setPage]=useState(0),[next,setNext]=useState<number|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 const loadHealth=useCallback(async()=>{setLoading(true);setError('');try{setHealth(await api('/api/platform/diagnostics?section=health'));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}},[]);
 useEffect(()=>{void loadHealth();},[loadHealth]);
 useEffect(()=>{if(!health?.can_read_audit)return;let active=true;
  void api('/api/platform/diagnostics?section=audit&page='+page).then(j=>{if(active){setAudit(j.items||[]);setNext(j.next_page??null);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));});
  return()=>{active=false;};},[health?.can_read_audit,page]);
 const tile=(label:string,value:React.ReactNode,ok?:boolean)=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className={'mt-2 text-lg font-bold '+(ok===undefined?'':ok?'text-emerald-700':'text-rose-700')}>{value}</p></div>;
 return <main className="mx-auto max-w-6xl space-y-5 pb-20">
  <header className="rounded-2xl bg-gradient-to-r from-slate-950 to-sky-900 p-6 text-white"><p className="text-xs font-bold uppercase tracking-widest text-cyan-200">Platform & Developer Tools</p><h1 className="mt-2 text-2xl font-bold">Platform Diagnostics</h1><p className="mt-2 text-sm text-slate-200">Kesehatan database, migrasi skema, release gate dan audit trail teknis RTICORE. Halaman ini read-only; perubahan konfigurasi tetap melalui workflow Admin maker-checker.</p></header>
  {health&&<ITDevWorkspaceGuide role={health.role} currentStation="Platform Diagnostics"/>}
  {loading&&<p role="status">Memeriksa platform…</p>}
  {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
  {health&&<>
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Diperiksa {new Date(health.checked_at).toLocaleString('id-ID')}</p><button type="button" onClick={()=>void loadHealth()} className="min-h-11 rounded-xl border bg-white px-4 text-xs font-bold text-sky-900">Periksa ulang</button></div>
   <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {tile('Database',health.database.ok?'OK · '+health.database.latency_ms+' ms':'Gagal',health.database.ok)}
    {tile('Skema migrasi',health.schema.status==='reconciled'?'Reconciled':'Incomplete',health.schema.status==='reconciled')}
    {tile('Migrasi terakhir',health.schema.latest_applied_version??'—')}
    {tile('Transaction guard tertunda',health.transaction_guards_pending,health.transaction_guards_pending===0)}
    {tile('AI provider aktif',health.ai_readiness.enabled+' / '+health.ai_readiness.configured)}
    {tile('AI provider teruji',health.ai_readiness.enabled_tested_successfully+' / '+health.ai_readiness.enabled,health.ai_readiness.enabled_tested_successfully===health.ai_readiness.enabled)}
    {tile('Production gate',health.release.production_gate,false)}
    {tile('Role dengan user aktif',health.active_users_by_role.length)}
   </section>
   <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">{health.release.note}</p>
   <section className="grid gap-4 lg:grid-cols-2">
    <div className="min-w-0 rounded-2xl border bg-white p-4"><h2 className="font-bold">User aktif per role</h2><table className="mt-3 w-full text-left text-xs"><thead><tr><th className="border-b p-2 text-slate-500">Role</th><th className="border-b p-2 text-slate-500">User aktif</th></tr></thead><tbody>{health.active_users_by_role.map(r=><tr key={r.role}><td className="border-b p-2">{r.role}</td><td className="border-b p-2">{r.active_users}</td></tr>)}</tbody></table></div>
    <div className="min-w-0 rounded-2xl border bg-white p-4"><h2 className="font-bold">Ledger migrasi</h2><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="border-b p-2 text-slate-500">Versi</th><th className="border-b p-2 text-slate-500">Diterapkan</th></tr></thead><tbody>{[...health.migrations].reverse().map(m=><tr key={String(m.version)}><td className="border-b p-2">{String(m.version)}</td><td className="border-b p-2">{m.applied_at||'—'}</td></tr>)}</tbody></table></div></div>
   </section>
   {health.can_read_audit&&<section className="min-w-0 space-y-3 rounded-2xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Audit trail teknis</h2><a className="min-h-11 rounded-xl border px-4 py-3 text-xs font-bold text-sky-900" href={'/api/platform/diagnostics?section=audit&format=csv&page='+page}>Ekspor CSV</a></div>
    <p className="text-xs text-slate-500">Metadata event delivery, timesheet, registrasi user, opsi admin dan laporan. Isi event, nilai pengaturan, harga dan Sales audit tidak ditampilkan.</p>
    {!audit.length?<p className="text-sm text-slate-500">Belum ada event.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Waktu','Area','Aksi','Entitas','Aktor'].map(h=><th key={h} className="whitespace-nowrap border-b p-2 text-slate-500">{h}</th>)}</tr></thead><tbody>{audit.map(r=><tr key={r.id}><td className="whitespace-nowrap border-b p-2">{r.created_at}</td><td className="border-b p-2">{r.area}</td><td className="border-b p-2">{r.action}</td><td className="max-w-[12rem] break-all border-b p-2">{r.entity_id}</td><td className="break-all border-b p-2">{r.actor_email}</td></tr>)}</tbody></table></div>}
    <div className="flex gap-2"><button type="button" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} className="min-h-11 rounded-xl border px-4 text-xs font-bold disabled:opacity-40">Sebelumnya</button><button type="button" disabled={next===null} onClick={()=>next!==null&&setPage(next)} className="min-h-11 rounded-xl border px-4 text-xs font-bold disabled:opacity-40">Berikutnya</button></div>
   </section>}
  </>}
 </main>;
}
