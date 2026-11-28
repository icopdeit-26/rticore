'use client';
import {useEffect,useState} from 'react';
const keys=['queued','running','succeeded','dead_letter','pending_recovery'] as const;
export default function ExecutiveSummary({entity}:{entity:string}){
 const [metrics,setMetrics]=useState<Record<string,number>|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const c=new AbortController();setMetrics(null);setError('');
  void (async()=>{try{
   const r=await fetch('/api/erp/executive-command?'+new URLSearchParams({legal_entity_id:entity}),{credentials:'same-origin',cache:'no-store',signal:c.signal});
   const b=await r.json();
   if(!r.ok||b.success!==true||b.legal_entity_id!==entity||b.scope!=='native_operations_only'||b.read_only!==true||b.automatic_posting!==false||!b.metrics||!keys.every(k=>Number.isSafeInteger(b.metrics[k])&&b.metrics[k]>=0))throw Error('Ringkasan eksekutif tidak tersedia.');
   if(!c.signal.aborted)setMetrics(b.metrics);
  }catch{if(!c.signal.aborted)setError('Ringkasan eksekutif tidak tersedia. Jangan menganggap jumlah nol.');}})();
  return()=>c.abort();
 },[entity]);
 return <section className="space-y-2 rounded-lg border p-4"><h2 className="font-semibold">Executive Command — Native Operations</h2>
 <p className="text-sm">Jumlah keseluruhan pada legal entity ini; bukan jumlah baris daftar yang dibatasi. Tidak termasuk pendapatan, risiko proyek atau sertifikasi produksi.</p>
 {error?<p role="alert" className="text-sm">{error}</p>:metrics?<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{keys.map(k=><div key={k} className="rounded border p-2"><p className="text-xs">{k}</p><p className="text-xl font-bold">{metrics[k].toLocaleString('id-ID')}</p></div>)}</div>:<p role="status" className="text-sm">Memuat ringkasan…</p>}
 </section>;
}
