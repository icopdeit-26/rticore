'use client';
import {useRef,useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
type Item={id:string;kind:string;title:string;href:string};
type Queue={items:Item[];included_kinds:string[];excluded_kinds:string[];truncated:boolean};
const labels:Record<string,string>={backup_drill:'Backup drill',job_recovery:'Job recovery',feature_governance:'Feature governance',service_catalog:'Service master',rate_card:'Rate card',activity_profile:'Activity profile',complexity_matrix:'Complexity matrix',pricing_snapshot:'Pricing snapshot',boq_binding:'BoQ binding'};
const destinations=new Set(['/erp/operations-center','/erp/service-catalog']);
export default function NativeApprovalInbox(){
 const [entity,setEntity]=useState(''),[loaded,setLoaded]=useState(''),[data,setData]=useState<Queue|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const req=useRef<AbortController|null>(null);
 useEffect(()=>()=>req.current?.abort(),[]);
 async function load(e:FormEvent<HTMLFormElement>){
  e.preventDefault();req.current?.abort();setData(null);setLoaded('');setError('');
  const id=entity.trim();if(!id)return;
  const c=new AbortController();req.current=c;setBusy(true);
  try{
   const r=await fetch('/api/erp/enterprise-approvals?'+new URLSearchParams({legal_entity_id:id}),{credentials:'same-origin',cache:'no-store',signal:c.signal});
   const b=await r.json();
   if(!r.ok||b.success!==true||b.read_only!==true||b.automatic_posting!==false||b.activation!==false||b.legal_entity_id!==id||!Array.isArray(b.items)||!Array.isArray(b.included_kinds)||!Array.isArray(b.excluded_kinds))throw Error('Antrean native tidak tersedia atau akses ditolak.');
   if(!c.signal.aborted){setData(b);setLoaded(id);}
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Antrian tidak dapat dibaca.');}
  finally{if(!c.signal.aborted)setBusy(false);}
 }
 return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Native enterprise approval inbox">
  <h2 className="font-semibold">Native enterprise approval inbox</h2>
  <p className="text-sm text-slate-600">Katalog/pricing, governance dan operations dalam satu legal entity. Daftar ini bukan seluruh approval enterprise; keputusan tetap melalui modul sumber.</p>
  <form onSubmit={load} className="flex flex-wrap items-end gap-2"><label className="flex flex-col text-sm">Legal Entity ID<input required maxLength={128} value={entity} onChange={e=>{req.current?.abort();setEntity(e.target.value);setData(null);setLoaded('');setError('');setBusy(false);}} className="rounded border p-2"/></label><button disabled={busy||!entity.trim()} className="rounded bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Memuat…':'Muat / Refresh'}</button></form>
  {error&&<p role="alert" className="text-sm text-red-700">{error} Bukan berarti tidak ada pekerjaan.</p>}
  {data&&<div className="space-y-2 text-sm">
   <p>Legal entity: {loaded} · {data.truncated?'Sedikitnya ':''}{data.items.length} item.</p>
   <p>Dicakup: {data.included_kinds.map(k=>labels[k]||k).join(', ')||'Tidak ada kategori berizin'}.</p>
   {data.excluded_kinds.length>0&&<p>Di luar cakupan (izin / release flag): {data.excluded_kinds.map(k=>labels[k]||k).join(', ')}.</p>}
   {data.items.length===0&&<p>Tidak ada item menunggu review pada kategori yang tercakup.</p>}
   {data.items.map(x=><article key={x.kind+':'+x.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2"><div><p className="font-medium">{labels[x.kind]||x.kind} · {x.title}</p><p className="break-all text-xs text-slate-600">{x.id}</p></div>{destinations.has(x.href)&&<Link href={x.href} className="rounded border px-3 py-1">Periksa di sumber</Link>}</article>)}
  </div>}
 </section>;
}
