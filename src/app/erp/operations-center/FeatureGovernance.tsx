'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
type RequestRow={id:string;flag_key:string;requested_enabled:boolean;reason:string;requested_by:string;requested_at:string;status:'pending'|'approved'|'rejected';reviewed_by:string|null;review_notes:string|null};
const endpoint='/api/admin/feature-flags';
const flags=['service_catalog','flexguard_enterprise','flexguard_product'] as const;
export default function FeatureGovernance({entity,role}:{entity:string;role:string}){
 const [rows,setRows]=useState<RequestRow[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [flag,setFlag]=useState<string>(flags[0]),[enabled,setEnabled]=useState(false),[reason,setReason]=useState(''),[notes,setNotes]=useState('');
 const controller=useRef<AbortController|null>(null),mutation=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  controller.current?.abort();const c=new AbortController();controller.current=c;setRows(null);setError('');
  try{const r=await fetch(endpoint+'?'+new URLSearchParams({legal_entity_id:entity}),{credentials:'same-origin',cache:'no-store',signal:c.signal});const b=await r.json();
   if(!r.ok||b.success!==true||b.activation!==false||!Array.isArray(b.requests))throw Error('Register feature governance tidak tersedia atau akses ditolak.');
   if(!c.signal.aborted)setRows(b.requests);
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Gagal memuat register.');}
 },[entity]);
 useEffect(()=>{void load();return()=>{controller.current?.abort();mutation.current?.abort();}},[load]);
 async function submit(body:Record<string,unknown>){
  if(mutation.current)return;const c=new AbortController();mutation.current=c;setBusy(true);setError('');
  try{const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,legal_entity_id:entity}),signal:c.signal});
   const b=await r.json();if(!r.ok||b.success!==true||b.activation!==false)throw Error('Permintaan ditolak: periksa legal entity, peran, duplikasi dan independensi review.');
   if(!c.signal.aborted){setReason('');setNotes('');await load();}
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Transaksi tidak berhasil.');}
  finally{if(!c.signal.aborted)setBusy(false);if(mutation.current===c)mutation.current=null;}
 }
 function request(e:FormEvent<HTMLFormElement>){e.preventDefault();if(role==='admin'&&reason.trim().length>=12)void submit({action:'request',flag_key:flag,enabled,reason:reason.trim()});}
 return <section className="space-y-3 rounded-lg border p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Feature governance</h2><button type="button" disabled={busy} onClick={()=>void load()} className="rounded border px-3 py-1 text-sm">Refresh</button></div>
  <p className="text-sm">Persetujuan hanya mencatat keputusan independen. Tidak mengubah environment variable, tidak mengaktifkan fitur, dan tidak menggantikan production release gate.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {role==='admin'&&<form onSubmit={request} className="grid gap-2 sm:grid-cols-2">
   <label className="flex flex-col text-sm">Feature<select value={flag} onChange={e=>setFlag(e.target.value)} disabled={busy} className="rounded border bg-transparent p-2">{flags.map(x=><option key={x}>{x}</option>)}</select></label>
   <label className="flex flex-col text-sm">Usulan<select value={String(enabled)} onChange={e=>setEnabled(e.target.value==='true')} disabled={busy} className="rounded border bg-transparent p-2"><option value="false">Nonaktifkan</option><option value="true">Aktifkan (usulan)</option></select></label>
   <label className="flex flex-col text-sm sm:col-span-2">Alasan<textarea required minLength={12} maxLength={800} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className="rounded border bg-transparent p-2"/></label>
   <button disabled={busy||rows===null||reason.trim().length<12} className="rounded border px-3 py-2 disabled:opacity-50">Ajukan perubahan</button>
  </form>}
  {role==='approver'&&<label className="block text-sm">Catatan review independen<textarea value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy} maxLength={800} className="block w-full rounded border bg-transparent p-2"/></label>}
  {rows===null&&!error&&<p role="status" className="text-sm">Memuat register…</p>}
  {rows?.length===0&&<p className="text-sm">Belum ada permintaan.</p>}
  {rows?.map(x=><div key={x.id} className="space-y-1 border-t py-2 text-sm"><p>{x.flag_key} · {x.requested_enabled?'Usulan aktif':'Usulan nonaktif'} · {x.status}</p><p>{x.reason} — {x.requested_by}</p>{x.reviewed_by&&<p>{x.reviewed_by}: {x.review_notes}</p>}
   {role==='approver'&&x.status==='pending'&&<div className="flex gap-2">{[true,false].map(approve=><button key={String(approve)} type="button" disabled={busy||notes.trim().length<12} onClick={()=>void submit({action:'review',id:x.id,approve,notes:notes.trim()})} className="rounded border px-3 py-1 disabled:opacity-50">{approve?'Setujui usulan':'Tolak'}</button>)}</div>}
  </div>)}
 </section>;
}
