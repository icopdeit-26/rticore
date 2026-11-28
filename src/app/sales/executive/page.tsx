'use client';

import React,{useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Activity,ArrowUpRight,BarChart3,CalendarDays,Download,RefreshCcw,Target,TrendingUp} from 'lucide-react';
import {FinanceWorkspaceGuide} from '@/components/sales/FinanceWorkspaceGuide';

type Owner={owner:string;target_idr:number|null;target_version:number;target_rationale:string;booked_idr:number;attainment_pct:number|null;pipeline_idr:number;weighted_idr:number;revenue_idr:number;won:number;lost:number;win_rate_pct:number|null;completed_tasks:number;calls:number;meetings:number;visits:number;follow_ups:number};
type Series={label:string;count:number;pipeline:number;weighted:number};
type Dashboard={
 success:true;role:string;identityEmail:string;period:string;generated_at:string;
 totals:{target_idr:number|null;target_defined:number;target_required:number;booked_idr:number;attainment_pct:number|null;target_gap_idr:number|null;open_pipeline_idr:number;weighted_pipeline_idr:number;recognized_revenue_idr:number;open_deals_period:number;open_all:number;won:number;lost:number;win_rate_pct:number|null;proposals_verified_period:number;proposal_decisions:number;proposal_won:number;proposal_conversion_pct:number|null;completed_activities:number;data_gaps:number};
 by_owner:Owner[];by_service:{service:string;revenue_idr:number;booked_idr:number;won_count:number}[];
 aging:{label:string;count:number;value_idr:number}[];
 oldest_open:{id:string;title:string;owner:string;stage:string;age_days:number;estimated_value_idr:number}[];
 loss_reasons:{reason:string;count:number}[];by_stage:Series[];
 issues:{id:string;title:string;reason:string}[];notes:Record<string,string>;
};
const money=(v:number|null)=>v===null?'Belum ditetapkan':'Rp '+v.toLocaleString('id-ID',{maximumFractionDigits:2});
const pct=(v:number|null)=>v===null?'—':v.toLocaleString('id-ID',{maximumFractionDigits:2})+'%';
const input='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100';
async function api(url:string,options?:RequestInit):Promise<Dashboard|{success:boolean;version?:number}>{
 const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
 const j=await r.json();if(!r.ok||!j.success)throw Error(j.message||'Gagal memuat transaksi database');
 return j;
}
function Metric({label,value,help}:{label:string;value:string;help:string}){
 return <article className="group min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-amber-200 hover:shadow-md motion-reduce:transition-none"><div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-500">{label}</p><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><BarChart3 className="h-4 w-4" aria-hidden="true"/></span></div><p className={'break-words font-semibold tracking-tight text-slate-900 '+(value==='Belum ditetapkan'?'text-xl':'text-xl sm:text-2xl')}>{value}</p><p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">{help}</p></article>;
}
export default function ExecutiveSalesPage(){
 const [period,setPeriod]=useState(()=>new Date(Date.now()+7*3600000).toISOString().slice(0,7));
 const [owner,setOwner]=useState('');
 const [data,setData]=useState<Dashboard|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const [targetOwner,setTargetOwner]=useState(''),[targetAmount,setTargetAmount]=useState(''),[targetReason,setTargetReason]=useState('');
 const query='?period='+encodeURIComponent(period)+(owner?'&owner='+encodeURIComponent(owner):'');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const result=await api('/api/sales/executive'+query) as Dashboard;
   setData(result);
   setTargetOwner(current=>result.by_owner.some(o=>o.owner===current)?current:result.by_owner[0]?.owner||'');
  }catch(e){setError(e instanceof Error?e.message:String(e));setData(null);}
  finally{setLoading(false);}
 },[query,refresh]);
 useEffect(()=>{void load();},[load]);
 const chooseTarget=(value:string)=>{
  setTargetOwner(value);const existing=data?.by_owner.find(x=>x.owner===value);
  setTargetAmount(existing?.target_idr===null||existing?.target_idr===undefined?'':String(existing.target_idr));
  setTargetReason('');
 };
 const saveTarget=async(e:React.FormEvent)=>{
  e.preventDefault();if(!data||busy)return;
  const current=data.by_owner.find(o=>o.owner===targetOwner);
  setBusy(true);setNotice('');setError('');
  try{
   await api('/api/sales/executive',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({owner_email:targetOwner,period,amount_idr:Number(targetAmount),version:current?.target_version||0,rationale:targetReason})});
   setNotice('Target Sales tersimpan di database dan tercatat pada immutable change history.');setTargetReason('');setRefresh(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const t=data?.totals;
 const maxRevenue=Math.max(1,...(data?.by_service||[]).map(x=>Math.abs(x.revenue_idr)));
 return <main className="mx-auto max-w-[1800px] min-w-0 space-y-4 pb-24">
  <header className="relative isolate overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-7">
   <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-36 -z-10 h-96 w-96 rotate-[-20deg] rounded-full border-[48px] border-amber-100/70"/>
   <div className="flex flex-wrap items-start justify-between gap-4">
    <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-800">RTICORE / Executive overview</p>
     <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Executive Sales Dashboard</h1>
     <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Gambaran bisnis yang lebih jelas. Pantau target, pipeline, dan realisasi penjualan dalam satu tempat.</p></div>
    <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"><Activity className="h-3.5 w-3.5" aria-hidden="true"/>Data transaksi · {data?.role||'—'}</div>
   </div>
   <nav aria-label="Analisis terkait" className="relative mt-4 flex flex-wrap gap-2 pt-2">
    {[['/sales/forecast','Forecast Detail'],['/sales/pipeline','Opportunity'],['/sales/revenue','Revenue Register'],['/sales/activities','Sales Activities']].map(([url,label])=>
     <Link key={url} href={url} className="flex min-h-9 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-300">{label} <ArrowUpRight className="h-3.5 w-3.5 text-amber-800" aria-hidden="true"/></Link>)}
   </nav>
  </header>
  <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/80 bg-white p-5">
   <label className="min-w-0 w-full sm:min-w-36 sm:flex-1 text-xs font-bold text-slate-700 sm:max-w-48">Periode (WIB)<input aria-label="Periode pelaporan WIB" type="month" className={input+' mt-1'} value={period} onChange={e=>setPeriod(e.target.value)}/></label>
   {data&&data.role!=='sales'&&<label className="min-w-0 w-full sm:min-w-44 sm:flex-1 text-xs font-bold text-slate-700 sm:max-w-64">Sales owner<select aria-label="Filter Sales" className={input+' mt-1'} value={owner} onChange={e=>setOwner(e.target.value)}>
    <option value="">Seluruh Sales</option>{data.by_owner.map(x=><option key={x.owner} value={x.owner}>{x.owner}</option>)}</select></label>}
   <button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={loading||busy} className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold disabled:opacity-50"><RefreshCcw className="h-4 w-4"/>Refresh</button>
   {data&&<a href={'/api/sales/executive'+query+'&format=csv'} className="flex items-center gap-2 rounded-xl bg-amber-800 px-4 py-2.5 text-xs font-bold text-white"><Download className="h-4 w-4"/>Export CSV</a>}
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
  
  {loading&&<p role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-600">Mengambil laporan dari database…</p>}
  {data&&t&&!loading&&<>
   <section aria-label="Ringkasan eksekutif">
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900"><Target className="h-5 w-5 text-amber-700"/>Target vs Realisasi</h2>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <Metric label="Target Bulanan" value={money(t.target_idr)} help={t.target_defined+' dari '+t.target_required+' Sales memiliki target terdaftar'}/>
     <Metric label="Booked Sales" value={money(t.booked_idr)} help="PO terverifikasi · Closed Won bulan pelaporan · sebelum PPN"/>
     <Metric label="Pencapaian Target" value={pct(t.attainment_pct)} help={t.target_idr===null?'Tidak dihitung sebelum seluruh target Sales diatur':'Selisih target − realisasi: '+money(t.target_gap_idr)}/>
     <Metric label="Revenue Diakui" value={money(t.recognized_revenue_idr)} help="Register transaksi approved · GL/Invoice/BAST"/>
    </div>
    {t.attainment_pct!==null&&<div className="mt-3 rounded-xl border bg-white p-4"><div className="mb-2 flex justify-between text-xs font-semibold"><span>Progress target bulan ini</span><span>{pct(t.attainment_pct)}</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-600" style={{width:Math.min(100,Math.max(0,t.attainment_pct))+'%'}}/></div></div>}
   </section>
   <section aria-label="Akses cepat" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold">Akses Cepat</h2><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[['/sales/pipeline','Opportunity'],['/sales/revenue','Revenue Register'],['/sales/activities','Sales Activities'],['/sales/forecast','Lihat Forecast']].map(([href,label])=><Link key={href} href={href} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs font-semibold text-amber-900 hover:bg-amber-100">{label}<ArrowUpRight className="h-4 w-4" aria-hidden="true"/></Link>)}</div></section>
   {data&&<FinanceWorkspaceGuide role={data.role} currentStation="Executive Dashboard" defaultOpen={data.role==='finance'}/>}
   <section><h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><TrendingUp className="h-5 w-5 text-amber-700"/>Pipeline & Conversion</h2>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <Metric label="Open Pipeline" value={money(t.open_pipeline_idr)} help={t.open_deals_period+' peluang dengan target close periode ini'}/>
     <Metric label="Weighted Pipeline" value={money(t.weighted_pipeline_idr)} help="Probabilitas tahap Sales pada modul Forecast"/>
     <Metric label="Win Rate" value={pct(t.win_rate_pct)} help={t.won+' Won / '+t.lost+' Lost pada periode keputusan'}/>
     <Metric label="Proposal Conversion" value={pct(t.proposal_conversion_pct)} help={t.proposal_won+' Won dari '+t.proposal_decisions+' keputusan dengan proposal · '+t.proposals_verified_period+' submission terverifikasi di periode ini'}/>
    </div>
   </section>
   <div className="grid gap-4 lg:grid-cols-2">
    <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><BarChart3 className="h-4 w-4 text-amber-700"/>Pipeline per Stage</h2>
     {data.by_stage.filter(s=>s.pipeline>0).map(x=><div key={x.label}><div className="mb-1 flex flex-wrap justify-between gap-2 text-xs"><span>{x.label} · {x.count} deal</span><b>{money(x.pipeline)}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-600" style={{width:Math.min(100,x.pipeline/Math.max(t.open_pipeline_idr,1)*100)+'%'}}/></div></div>)}
     {!data.by_stage.some(s=>s.pipeline>0)&&<p className="text-sm text-slate-500">Belum ada forecast untuk periode ini.</p>}
    </section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-amber-700"/>Deal Aging (Semua Open)</h2>
     <p className="text-xs text-slate-500">Snapshot saat dashboard dibuka · {t.open_all} deal aktif</p>
     {data.aging.map(b=><div key={b.label} className="flex items-center justify-between gap-2 border-b pb-2 text-xs"><span className="font-semibold">{b.label} · {b.count} deal</span><span className="tabular-nums">{money(b.value_idr)}</span></div>)}
     {data.oldest_open.length>0&&<details><summary className="cursor-pointer text-xs font-bold text-blue-800">Lihat deal paling lama</summary><div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{data.oldest_open.map(x=><p key={x.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-xs"><Link href={'/sales/pipeline?opportunity_id='+encodeURIComponent(x.id)} className="text-blue-800 underline">{x.title}</Link><span>{x.age_days} hari</span></p>)}</div></details>}
    </section>
   </div>
   <div className="grid gap-4 lg:grid-cols-2">
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Revenue per Service</h2>
     {data.by_service.map(x=><div key={x.service} className="space-y-1"><div className="flex justify-between gap-2 text-xs"><span className="font-semibold">{x.service}</span><b className="tabular-nums">{money(x.revenue_idr)}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-700" style={{width:Math.abs(x.revenue_idr)/maxRevenue*100+'%'}}/></div><p className="text-[11px] text-slate-500">Booked {money(x.booked_idr)} · {x.won_count} Won</p></div>)}
     {!data.by_service.length&&<p className="text-sm text-slate-500">Belum ada data Revenue di database.</p>}
    </section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Win / Loss & Aktivitas</h2>
     <div className="grid grid-cols-3 gap-2"><Metric label="Won" value={String(t.won)} help="Closed Won"/><Metric label="Lost" value={String(t.lost)} help="Closed Lost"/><Metric label="Aktivitas" value={String(t.completed_activities)} help="Task selesai"/></div>
     {data.loss_reasons.map(x=><div className="flex justify-between border-b py-2 text-xs" key={x.reason}><span>{x.reason}</span><b>{x.count}</b></div>)}
     {!data.loss_reasons.length&&<p className="text-xs text-slate-500">Belum ada keputusan Lost pada bulan ini.</p>}
    </section>
   </div>
   <section className="rounded-2xl border bg-white p-4 sm:p-5"><h2 className="mb-3 text-base font-semibold">Produktivitas & Target per Sales</h2>
    <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="border-b bg-slate-50 text-slate-600"><tr>{['Sales','Target','Booked','Attainment','Weighted','Revenue','Won/Lost','Aktivitas Completed'].map(x=><th key={x} className="p-3 font-bold">{x}</th>)}</tr></thead>
     <tbody>{data.by_owner.map(x=><tr key={x.owner} className="border-b align-top"><td className="break-all p-3 font-semibold">{x.owner}</td><td className="p-3">{money(x.target_idr)}</td><td className="p-3">{money(x.booked_idr)}</td><td className="p-3">{pct(x.attainment_pct)}</td><td className="p-3">{money(x.weighted_idr)}</td><td className="p-3">{money(x.revenue_idr)}</td><td className="p-3">{x.won}/{x.lost}</td><td className="p-3">{x.completed_tasks} (Call {x.calls}, Meeting {x.meetings}, Visit {x.visits}, Follow-up {x.follow_ups})</td></tr>)}</tbody>
    </table></div>
    {!data.by_owner.length&&<p className="p-4 text-sm text-slate-500">Belum terdapat akun Sales aktif.</p>}
   </section>
   {data.role==='admin'&&<form onSubmit={saveTarget} className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-base font-semibold">Manajemen Target Bulanan · Admin</h2>
    <p className="text-xs text-slate-500">Mengubah target akan menaikkan versi dan menyimpan audit permanen. Hanya user Sales aktif di database.</p>
    <div className="grid gap-3 sm:grid-cols-2">
     <label className="text-xs font-bold">Sales<select aria-label="Sales target" required className={input+' mt-1'} value={targetOwner} onChange={e=>chooseTarget(e.target.value)}><option value="">Pilih Sales</option>{data.by_owner.map(x=><option key={x.owner} value={x.owner}>{x.owner}</option>)}</select></label>
     <label className="text-xs font-bold">Target (IDR sebelum PPN)<input aria-label="Nominal target Sales" className={input+' mt-1'} type="number" min="1" max="99999999999999" step="1" required value={targetAmount} onChange={e=>setTargetAmount(e.target.value)}/></label>
     <label className="text-xs font-bold sm:col-span-2">Alasan target/revisi (minimal 12 karakter)<textarea aria-label="Alasan perubahan target" className={input+' mt-1'} minLength={12} maxLength={1000} rows={2} required value={targetReason} onChange={e=>setTargetReason(e.target.value)}/></label>
    </div>
    <button type="submit" disabled={busy||!targetOwner} className="rounded-xl bg-amber-800 px-4 py-3 text-xs font-bold text-white disabled:opacity-50">{busy?'Menyimpan…':'Simpan Target ke Database'}</button>
   </form>}
   {!!data.issues.length&&<section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="mb-3 font-semibold text-amber-950">Data Quality Gaps · {t.data_gaps}</h2><div className="max-h-72 space-y-2 overflow-y-auto">{data.issues.map((x,i)=><p key={x.id+'-'+i} className="text-xs text-amber-950">{x.title}: {x.reason}</p>)}</div></section>}
   <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer text-sm font-bold">Definisi KPI & sumber data database</summary><div className="mt-3 space-y-2">{Object.entries(data.notes).map(([k,v])=><p key={k} className="text-xs leading-relaxed text-slate-600"><b className="capitalize">{k}:</b> {v}</p>)}</div></details>
   <p className="text-xs text-slate-500">Sumber: Database PostgreSQL transaksi aktual · pembaruan {new Date(data.generated_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB. Data hanya terlihat sesuai peran yang telah diotorisasi.</p>
  </>}
 </main>;
}

