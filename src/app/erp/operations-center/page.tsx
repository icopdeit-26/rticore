'use client';
import BackupDrills from './BackupDrills';
import FeatureGovernance from './FeatureGovernance';
import ExecutiveSummary from './ExecutiveSummary';
import FinanceDocking from './FinanceDocking';
import {useEffect,useRef,useState,type FormEvent} from 'react';

type Job={id:string;kind:string;status:string;attempts:number;max_attempts:number;due_at:string;last_reason:string|null;created_at:string};
type Attempt={event_id:string;attempt_no:number;outcome:string;reason_code:string|null;attempted_at:string};
type Recovery={id:string;job_id:string;requested_by:string;reason:string;prior_attempts:number|null;status:string;reviewed_by:string|null;review_notes:string|null};
type Result={success:true;role:string;jobs:Job[];attempts:Attempt[];recoveries:Recovery[];truncated:boolean;automatic_posting:false};
const show=(v:unknown)=>v===null||v===undefined?'—':String(v);
export default function OperationsCenter(){
 const [entity,setEntity]=useState('');
 const [result,setResult]=useState<Result|null>(null);
 const [loadedEntity,setLoadedEntity]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [notes,setNotes]=useState('');
 const [mutation,setMutation]=useState(false);
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(e?:FormEvent<HTMLFormElement>){
  e?.preventDefault();request.current?.abort();
  const id=entity.trim();setResult(null);setLoadedEntity('');setError('');
  if(!id){setError('Legal Entity ID wajib diisi.');setBusy(false);return;}
  const controller=new AbortController();request.current=controller;setBusy(true);
  try{
   const response=await fetch('/api/erp/operations-jobs?'+new URLSearchParams({legal_entity_id:id}),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new Error(response.status===401||response.status===403?'Akses ditolak atau sesi berakhir.':response.status===503?'Native runtime belum tersedia.':'Gagal mengambil data operations.');
   const body=await response.json();
   if(body.success!==true||!Array.isArray(body.jobs)||!Array.isArray(body.attempts)||!Array.isArray(body.recoveries)||body.automatic_posting!==false)throw new Error('Respons operations tidak valid.');
   if(!controller.signal.aborted){setResult(body);setLoadedEntity(id);}
  }catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Gagal mengambil data.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 async function recovery(action:'request'|'approve'|'reject',job_id:string,request_id?:string){
  if(mutation||busy||!loadedEntity||notes.trim().length<12)return;
  setMutation(true);setError('');
  try{
   const response=await fetch('/api/erp/operations-jobs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,job_id,request_id,legal_entity_id:loadedEntity,notes:notes.trim()})});
   const body=await response.json();
   if(!response.ok||body.success!==true||body.automatic_posting!==false)throw new Error('Recovery ditolak; periksa scope, status, dan kewenangan.');
   setNotes('');await load();
  }catch(err){setError(err instanceof Error?err.message:'Recovery gagal.');}
  finally{setMutation(false);}
 }
 return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
  <header><h1 className="text-2xl font-bold">Operations Center</h1><p className="mt-2 text-sm">Monitor antrean maintenance FlexGuard dan percobaan integrasi Finance berdasarkan legal entity yang disetujui. Recovery dead-letter memerlukan permintaan Finance dan keputusan Approver yang independen; tidak mengaktifkan posting jurnal otomatis.</p></header>
  <form onSubmit={load} className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
   <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">Legal Entity ID<input required disabled={mutation} maxLength={128} value={entity} onChange={e=>{request.current?.abort();setEntity(e.target.value);setResult(null);setLoadedEntity('');setError('');setBusy(false);}} className="rounded border bg-transparent p-2"/></label>
   <button type="submit" disabled={busy||mutation||!entity.trim()} className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">{busy?'Memuat…':'Muat / Refresh'}</button>
  </form>
  {error&&<p role="alert" className="rounded border border-red-500 p-3 text-sm">{error}</p>}
  {result&&<section aria-live="polite" className="space-y-4">
   <ExecutiveSummary key={loadedEntity} entity={loadedEntity}/>
   {['finance','approver'].includes(result.role)&&<FinanceDocking key={loadedEntity} entity={loadedEntity}/>}
   <BackupDrills key={loadedEntity} entity={loadedEntity} role={result.role}/>
   {['admin','approver'].includes(result.role)&&<FeatureGovernance key={loadedEntity} entity={loadedEntity} role={result.role}/>}
   <p className="text-sm">Scope: {loadedEntity}{result.truncated?' — hasil dibatasi 200 baris per register.':''}</p>
   <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{['queued','running','succeeded','dead_letter'].map(status=><div key={status} className="rounded-lg border p-3"><p className="text-sm">{status} (daftar dimuat)</p><p className="text-xl font-bold">{result.jobs.filter(j=>j.status===status).length}</p></div>)}</div>
   <section className="overflow-x-auto rounded-lg border p-3"><h2 className="mb-3 font-semibold">Native job queue (hasil dimuat)</h2>
   {result.jobs.length===0?<p className="text-sm">Tidak ada job pada scope ini.</p>:<table className="w-full text-left text-sm"><thead><tr>{['ID','Jenis','Status','Attempts','Due','Reason'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{result.jobs.map(j=><tr key={j.id} className="border-t">{[j.id,j.kind,j.status,`${j.attempts}/${j.max_attempts}`,j.due_at,j.last_reason].map((v,i)=><td key={i} className="p-2">{show(v)}</td>)}</tr>)}</tbody></table>}</section>
   <section className="overflow-x-auto rounded-lg border p-3"><h2 className="mb-3 font-semibold">Latest finance integration retry attempts</h2>
   {result.attempts.length===0?<p className="text-sm">Tidak ada percobaan tercatat pada scope ini.</p>:<table className="w-full text-left text-sm"><thead><tr>{['Event','Attempt','Outcome','Reason','Time'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{result.attempts.map(a=><tr key={a.event_id+':'+a.attempt_no} className="border-t">{[a.event_id,a.attempt_no,a.outcome,a.reason_code,a.attempted_at].map((v,i)=><td key={i} className="p-2">{show(v)}</td>)}</tr>)}</tbody></table>}</section>
   <section className="space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">Dead-letter recovery</h2>
    <p className="text-sm">Satu recovery independen per job; alasan dan riwayat keputusan dipertahankan.</p>
    {['finance','approver'].includes(result.role)&&<label className="block text-sm">Alasan permintaan / catatan review<textarea maxLength={800} disabled={mutation} value={notes} onChange={e=>setNotes(e.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>}
    {result.role==='finance'&&result.jobs.filter(j=>j.status==='dead_letter'&&!result.recoveries.some(x=>x.job_id===j.id&&['pending','approved'].includes(x.status))).map(j=><div key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2"><span className="text-sm">{j.id}</span><button type="button" disabled={mutation||notes.trim().length<12} onClick={()=>recovery('request',j.id)} className="rounded border px-3 py-1 disabled:opacity-50">Ajukan recovery</button></div>)}
    {result.recoveries.length===0&&<p className="text-sm">Belum ada permintaan recovery.</p>}
    {result.recoveries.map(x=><div key={x.id} className="space-y-1 border-t py-2 text-sm"><p>{x.job_id} · {x.status} · percobaan awal: {show(x.prior_attempts)}</p><p>{x.reason} — {x.requested_by}</p>{x.reviewed_by&&<p>{x.reviewed_by}: {show(x.review_notes)}</p>}{result.role==='approver'&&x.status==='pending'&&<div className="flex gap-2"><button type="button" disabled={mutation||notes.trim().length<12} onClick={()=>recovery('approve',x.job_id,x.id)} className="rounded border px-3 py-1 disabled:opacity-50">Setujui requeue</button><button type="button" disabled={mutation||notes.trim().length<12} onClick={()=>recovery('reject',x.job_id,x.id)} className="rounded border px-3 py-1 disabled:opacity-50">Tolak</button></div>}</div>)}
   </section>
  </section>}
 </main>;
}
