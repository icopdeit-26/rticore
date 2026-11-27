'use client';
import {useEffect,useRef,useState} from 'react';
type Action='approve'|'post';
type Row={receiptId:string;sourceKey:string;period:string;legalEntityId:string;journalId:string|null;journalStatus:string|null;journalVersion:number|null;allowedActions:Action[];mappedLines:unknown;sourceJournal:unknown};
export function CamsFinanceInbox({entity}:{entity:string}){
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[enabled,setEnabled]=useState(false),[scope,setScope]=useState('');
 const lock=useRef(false),mutation=useRef<AbortController|null>(null);
 useEffect(()=>()=>mutation.current?.abort(),[]);
 useEffect(()=>{
  const c=new AbortController();setLoading(true);setRows([]);setEnabled(false);setScope('');setError('');
  const q=entity?'?legalEntityId='+encodeURIComponent(entity):'';
  fetch('/api/finance/cams-inbox'+q,{signal:c.signal,cache:'no-store',credentials:'same-origin'}).then(async r=>{
   const j=await r.json();if(c.signal.aborted)return;
   if(!r.ok||!j.ok||!Array.isArray(j.receipts)||typeof j.legalEntityId!=='string'||(entity&&j.legalEntityId!==entity)||j.receipts.some((row:Row)=>row.legalEntityId!==j.legalEntityId))throw Error(j.code||'INBOX_SCOPE_INVALID');
   setRows(j.receipts);setScope(j.legalEntityId);setEnabled(j.reviewEnabled===true);
  }).catch(e=>{if(!c.signal.aborted){setRows([]);setError(String(e.message));}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[entity,revision]);
 async function submit(row:Row,action:Action,notes:FormDataEntryValue|null){
  if(lock.current||loading||!enabled||!scope||row.legalEntityId!==scope||!row.allowedActions?.includes(action)||!Number.isSafeInteger(row.journalVersion)||typeof notes!=='string'||notes.trim().length<12||notes.length>500)return;
  if(action==='post'&&!window.confirm('Posting jurnal ke General Ledger? Pastikan review dan bukti transaksi telah diverifikasi.'))return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  const c=new AbortController();mutation.current=c;
  try{
   const r=await fetch('/api/finance/cams-inbox',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({receiptId:row.receiptId,legalEntityId:scope,action,expectedVersion:row.journalVersion,notes:notes.trim()})});
   const j=await r.json();if(c.signal.aborted)return;
   if(!r.ok||!j.ok||j.journalId!==row.journalId||j.status!==(action==='approve'?'approved':'posted'))throw Error(j.code||'REVIEW_RESULT_INVALID');
   setNotice(action==='approve'?'Jurnal disetujui; belum diposting.':'Jurnal berhasil diposting.');
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'REVIEW_FAILED');}
  finally{if(!c.signal.aborted){lock.current=false;setBusy(false);setLoading(true);setRevision(v=>v+1);}}
 }
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3" aria-busy={loading||busy}>
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">CAMSRTI Finance Inbox</h3><button type="button" disabled={busy||loading} className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>{setNotice('');setRevision(v=>v+1);}}>Refresh</button></div>
  <p className="text-sm text-slate-600">Persetujuan dan posting dilakukan oleh pengguna independen. Scope: {scope||'Belum terverifikasi'}.</p>
  {!loading&&!error&&!enabled&&<p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">Mode baca saja. Approval dan posting belum diaktifkan untuk lingkungan ini.</p>}
  {loading&&<p role="status">Memuat receipt sesuai hak akses…</p>}
  {notice&&<p role="status" className="text-sm text-emerald-800">{notice}</p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {!loading&&!error&&!rows.length&&<p>Tidak ada receipt pada scope yang diizinkan.</p>}
  {rows.map(r=><details key={r.receiptId+':'+r.journalVersion} className="rounded-lg border p-3">
   <summary className="cursor-pointer break-all text-sm font-semibold">{r.sourceKey} · {r.period} · {r.journalStatus??'received'}</summary>
   <p className="mt-2 break-all text-xs">Receipt {r.receiptId} · Journal {r.journalId??'Belum dibuat'} · Versi {r.journalVersion??'—'}</p>
   <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Account ID','Cost center','Debit (sen)','Credit (sen)'].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{(Array.isArray(r.mappedLines)?r.mappedLines:[]).map((l,i)=><tr key={i} className="border-t"><td className="p-2">{String(l.accountId)}</td><td>{String(l.costCenterId??'—')}</td><td>{String(l.debit)}</td><td>{String(l.credit)}</td></tr>)}</tbody></table></div>
   <details className="my-2"><summary className="text-sm">Source evidence</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(r.sourceJournal,null,2)}</pre></details>
   {enabled&&Array.isArray(r.allowedActions)&&r.allowedActions.map(action=><form key={action} className="space-y-2" onSubmit={e=>{e.preventDefault();void submit(r,action,new FormData(e.currentTarget).get('notes'));}}>
    <label className="block text-sm">{action==='approve'?'Catatan approval independen':'Catatan posting independen'}<textarea name="notes" minLength={12} maxLength={500} required disabled={busy||loading} className="block w-full rounded border p-2"/></label>
    <button type="submit" disabled={busy||loading} className="rounded bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50">{action==='approve'?'Approve journal — tanpa posting':'Post approved journal'}</button>
   </form>)}
  </details>)}
 </section>;
}
