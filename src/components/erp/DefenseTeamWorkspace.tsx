'use client';
/**
 * SOC Defense Team (Blue Team) workspace: role guide (features, functions, menus) plus the live
 * SOC board. Leader = defense_leader, Member = defense_member. UI hint only: every action is
 * authorized again by /api/erp/cyber-operations (cyber_ops grant, maker-checker, versions).
 */
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {ArrowUpRight,ChevronDown,ShieldCheck,Siren,UserCheck,FileSearch,Radio,Clock3,FolderLock} from 'lucide-react';

type Menu={label:string;href:string;badge:string;functions:string;leader:string[];member:string[];limits:string};
type Section={groupCode:string;groupTitle:string;menus:Menu[]};
export const DEFENSE_ROLE_CATALOG:Section[]=[
 {groupCode:'12 · ERP Cybersecurity',groupTitle:'Operasi SOC / MDR / DFIR',menus:[
  {label:'Cybersecurity Operations',href:'/erp/cyber-operations',badge:'Desk utama',
   functions:'Board SOC Defense, register case insiden SOC/DFIR, penugasan investigasi, QA evidence dan penutupan case.',
   leader:['Melihat antrean tim pada semua proyek SOC/DFIR dalam grant cyber_ops, diurutkan severity (critical → informational).','Membuka case soc_incident / dfir_incident (referensi unik, severity, klasifikasi restricted/confidential).','Menugaskan atau menugaskan ulang case open ke analis Defense aktif yang juga memiliki grant cyber_ops pada legal entity proyek.','Mengembalikan investigasi yang disubmit untuk diperbaiki, dengan alasan tertulis (≥ 12 karakter).','Review QA independen: setujui (reviewed) atau tolak (rejected) dengan catatan dan dokumen bukti asli Vault; bukti dari analis dapat dipakai ulang.','Menutup case reviewed yang direview orang lain.'],
   member:['Melihat "Antrean Saya": case open yang ditugaskan kepada akun Anda.','Membuka case soc_incident / dfir_incident pada proyek SOC/DFIR aktif dalam grant.','Mengirim hasil investigasi: temuan, timeline, IOC dan tindakan containment (12–2.000 karakter) + ID dokumen supporting asli di Vault.','Memperbaiki dan mengirim ulang investigasi yang dikembalikan Leader.'],
   limits:'Hanya kind soc_incident/dfir_incident; vapt_finding milik tim Offense/Presales. Proyek harus aktif dengan family SOC/MDR, DFIR, Incident Response atau Managed Security dan scope legal entity yang disetujui.'},
  {label:'SIEM / EDR Integrations',href:'/erp/security-integrations',badge:'Eskalasi',
   functions:'Konektor SIEM/EDR per legal entity dan riwayat dispatch case (status, attempt, HTTP code).',
   leader:['Membaca konektor dan dispatch pada legal entity dalam grant.','Mengantrekan case ke konektor yang sudah di-approve, lalu mengirim outbound (HTTPS allowlist, Idempotency-Key, maks. 5 percobaan).'],
   member:['Membaca konektor dan status dispatch (read-only) untuk memantau eskalasi.'],
   limits:'Registrasi konektor oleh Admin dan aktivasi oleh Approver independen. Token SIEM/EDR tersimpan di Secrets, tidak pernah tampil di UI atau payload.'},
 ]},
 {groupCode:'06 · Project Delivery',groupTitle:'Waktu kerja analis',menus:[
  {label:'Project Timesheets',href:'/psa/timesheets',badge:'Jam kerja',
   functions:'Catat jam monitoring, triage, investigasi dan reporting pada alokasi resource aktif.',
   leader:['Mencatat jam kerja sendiri pada proyek tempat Anda dialokasikan.'],
   member:['Mencatat jam kerja sendiri (tanggal, menit, billable, uraian) pada proyek tempat Anda dialokasikan.'],
   limits:'Hanya entri milik sendiri; review oleh PM proyek, Finance atau Approver. Biaya (cost snapshot) tidak ditampilkan.'},
 ]},
 {groupCode:'10 · Document Center',groupTitle:'Evidence asli',menus:[
  {label:'Secure Document Vault',href:'/sales/documents',badge:'Evidence',
   functions:'Unggah dan unduh dokumen supporting (log export, timeline, laporan insiden, screenshot) pada Opportunity proyek SOC/DFIR.',
   leader:['Unggah supporting setelah Closed Won; unduh dokumen library proyek dalam grant.'],
   member:['Unggah supporting setelah Closed Won sebagai bukti investigasi; salin ID dokumen ke form submit.'],
   limits:'Hanya jenis supporting; paket komersial (proposal, negosiasi, PO/SPK), retensi dan audit log tidak tersedia. File PDF, DOCX, PNG, JPEG atau EML terenkripsi.'},
 ]},
];

type Project={id:string;opportunity_id:string;title:string;service_family:string;status:string;company_name:string|null};
type Case={id:string;project_id:string;kind:string;external_ref:string;title:string;severity:string;status:string;version:number;created_by:string;reviewer_email:string|null;assignee_email:string|null;assignment_status:string|null;assignment_version:number|null;investigation_notes:string|null;assignment_evidence_id:string|null;leader_notes:string|null};
type Board={role:string;projects:Project[];my_queue:Case[];team_queue:Case[];analysts:{email:string;role:string}[]};
const input='min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs';
const sevTone:Record<string,string>={critical:'bg-rose-700 text-white',high:'bg-orange-600 text-white',medium:'bg-amber-200 text-amber-950',low:'bg-sky-100 text-sky-900',informational:'bg-slate-100 text-slate-700'};

export function DefenseTeamGuide({role,currentStation,defaultOpen=false}:{role:string;currentStation?:string;defaultOpen?:boolean}){
 const [open,setOpen]=useState(defaultOpen);
 if(!['defense_leader','defense_member','admin'].includes(role))return null;
 const leader=role!=='defense_member';
 const menuCount=DEFENSE_ROLE_CATALOG.reduce((n,s)=>n+s.menus.length,0);
 return <section aria-label="Detail Fitur, Fungsi dan Menu Defense Team" className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/90 via-white to-slate-50 p-5 shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="flex items-start gap-3">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-900 text-white"><ShieldCheck className="h-5 w-5" aria-hidden="true"/></span>
    <div>
     <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-sky-900">SOC Defense Desk</span>
      <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-sky-800">{leader?'Defense Team Leader':'Defense Team Member'} · {menuCount} Menu</span>
      {currentStation&&<span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">Modul Aktif: {currentStation}</span>}
     </div>
     <h2 className="mt-1.5 text-base font-extrabold text-slate-900">Fitur, Fungsi & Menu Defense Team (SOC / Blue Team)</h2>
     <p className="mt-1 text-xs leading-relaxed text-slate-600">{leader
      ?<>Sebagai <b>Leader</b>, Anda melakukan triage, menugaskan investigasi ke analis, me-review QA secara independen, menutup case dan mengeskalasi ke SIEM/EDR.</>
      :<>Sebagai <b>Member (SOC Analyst)</b>, Anda membuka case insiden, menyelidiki case yang ditugaskan dan mengirim temuan beserta bukti asli Vault untuk di-review Leader.</>}
      {' '}Akses berlaku hanya pada proyek SOC/DFIR yang legal entity-nya memberi Anda grant <b>cyber_ops</b> yang disetujui secara independen.</p>
    </div>
   </div>
   <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3.5 py-2 text-xs font-bold text-sky-900 hover:bg-sky-50">
    {open?'Ringkas Detail Fitur':'Tampilkan Semua Fitur & Menu'}<ChevronDown className={`h-4 w-4 transition-transform ${open?'rotate-180':''}`} aria-hidden="true"/>
   </button>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   {(leader?[
    {icon:<Siren className="h-4 w-4 text-rose-700"/>,title:'1. Triage & Penugasan',href:'/erp/cyber-operations',body:'Prioritaskan case open per severity dan tugaskan ke analis yang memiliki grant.'},
    {icon:<FileSearch className="h-4 w-4 text-indigo-700"/>,title:'2. QA Investigasi',href:'/erp/cyber-operations',body:'Kembalikan atau review hasil analis; reviewer bukan pembuat case maupun analis.'},
    {icon:<Radio className="h-4 w-4 text-teal-700"/>,title:'3. Eskalasi SIEM/EDR',href:'/erp/security-integrations',body:'Antrekan dan kirim case ke konektor yang sudah di-approve.'},
    {icon:<UserCheck className="h-4 w-4 text-emerald-700"/>,title:'4. Tutup Case',href:'/erp/cyber-operations',body:'Tutup case reviewed yang direview orang lain, dengan evidence asli tervalidasi.'},
   ]:[
    {icon:<Siren className="h-4 w-4 text-rose-700"/>,title:'1. Buka Case Insiden',href:'/erp/cyber-operations',body:'Catat soc_incident atau dfir_incident dari alert/ticket dengan referensi unik.'},
    {icon:<FileSearch className="h-4 w-4 text-indigo-700"/>,title:'2. Investigasi',href:'/erp/cyber-operations',body:'Kerjakan case di Antrean Saya; susun temuan, timeline dan IOC.'},
    {icon:<FolderLock className="h-4 w-4 text-teal-700"/>,title:'3. Evidence Vault',href:'/sales/documents',body:'Unggah bukti supporting asli lalu salin ID dokumennya.'},
    {icon:<Clock3 className="h-4 w-4 text-amber-700"/>,title:'4. Timesheet',href:'/psa/timesheets',body:'Catat jam kerja pada alokasi aktif proyek SOC.'},
   ]).map(c=><div key={c.title} className="rounded-xl border border-sky-100 bg-white p-3.5"><div className="flex items-center gap-2 text-xs font-extrabold text-sky-950">{c.icon}{c.title}</div><p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{c.body} <Link href={c.href} className="font-bold text-sky-800 underline">Buka</Link></p></div>)}
  </div>
  {open&&<div className="mt-5 space-y-4 border-t border-sky-100 pt-4">
   <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-950">Katalog {menuCount} Menu, Fungsi & Fitur — {leader?'Leader':'Member'}</h3>
   <div className="grid gap-4 lg:grid-cols-2">{DEFENSE_ROLE_CATALOG.map(s=><div key={s.groupCode} className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">{s.groupCode}</p><p className="text-xs font-bold text-slate-800">{s.groupTitle}</p>
    <div className="mt-3 space-y-3">{s.menus.map(m=><div key={m.href} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><Link href={m.href} className="inline-flex items-center gap-1 text-xs font-extrabold text-sky-900 hover:underline">{m.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true"/></Link><span className="rounded-md bg-sky-100/80 px-2 py-0.5 text-[10px] font-bold text-sky-900">{m.badge}</span></div>
     <p className="mt-1 text-[11px] font-medium text-slate-700">{m.functions}</p>
     <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-slate-600">{(leader?m.leader:m.member).map(x=><li key={x}>{x}</li>)}</ul>
     <p className="mt-2 text-[11px] text-slate-500"><b>Batas:</b> {m.limits}</p>
    </div>)}</div></div>)}</div>
   <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-[11px] text-amber-950">
    <p className="flex items-center gap-2 text-xs font-bold"><ShieldCheck className="h-4 w-4 text-amber-800" aria-hidden="true"/>Aturan Tata Kelola Defense Team</p>
    <ul className="mt-1.5 list-disc space-y-1 pl-5 leading-relaxed">
     <li><b>Grant cyber_ops:</b> tanpa penempatan staff dan grant legal-unit yang disetujui pihak lain, semua API menolak (HTTP 403).</li>
     <li><b>Alur case:</b> open → ditugaskan → disubmit analis → (dikembalikan) → reviewed/rejected → closed. Case yang ditugaskan tidak dapat di-review sebelum disubmit.</li>
     <li><b>Maker-checker:</b> reviewer ≠ pembuat case ≠ analis yang menyelidiki; penutup ≠ reviewer. Case dan penugasan tidak dapat dihapus.</li>
     <li><b>Kunci versi:</b> case dan penugasan memakai nomor versi; konflik (HTTP 409) berarti data berubah — muat ulang lalu ulangi.</li>
     <li><b>Least privilege:</b> CRM, BoQ, harga, billing, Approval Center, laporan enterprise dan desk ERP lain tidak tersedia.</li>
    </ul>
   </div>
  </div>}
 </section>;
}

/** Live SOC board on Cybersecurity Operations. Renders only for Defense roles (or Admin). */
export default function DefenseTeamWorkspace({station='Cybersecurity Operations',guideOnly=false}:{station?:string;guideOnly?:boolean}){
 const [board,setBoard]=useState<Board|null>(null),[hidden,setHidden]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{
  const r=await fetch('/api/erp/cyber-operations?board=1',{cache:'no-store',credentials:'same-origin'});
  if(r.status===403||r.status===401){setHidden(true);return;}
  const j=await r.json();if(!r.ok)throw Error(j.message||'Board SOC gagal dimuat');setBoard(j as Board);
 },[]);
 useEffect(()=>{void load().catch(e=>setMessage(String(e instanceof Error?e.message:e)));},[load]);
 if(hidden)return null;
 if(!board)return message?<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{message}</p>:<p role="status" className="text-sm text-slate-500">Memuat board SOC Defense…</p>;
 const leader=board.role!=='defense_member';
 const guide=<DefenseTeamGuide role={board.role} currentStation={station}/>;
 if(guideOnly)return guide;
 const opp=(c:Case)=>board.projects.find(p=>p.id===c.project_id)?.opportunity_id||'';
 const field=(c:Case,k:string)=>form[c.id+':'+k]||'';
 const set=(c:Case,k:string,v:string)=>setForm(f=>({...f,[c.id+':'+k]:v}));
 async function act(c:Case,action:string,extra:Record<string,unknown>){
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/erp/cyber-operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:c.id,version:c.version,assignment_version:c.assignment_version??undefined,...extra})});
   const j=await r.json();if(!r.ok)throw Error(j.message||'Transaksi ditolak');
   setMessage('Tersimpan dan tercatat pada audit.');setForm({});await load();
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const row=(c:Case,mode:'mine'|'team')=><li key={c.id+mode} className="rounded-xl border border-slate-200 bg-white p-3">
  <div className="flex flex-wrap items-center gap-2 text-xs">
   <span className={'rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase '+(sevTone[c.severity]||'')}>{c.severity}</span>
   <span className="font-bold text-slate-900">{c.title}</span><span className="text-slate-500">{c.kind} · {c.external_ref}</span>
   <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{c.status}{c.assignment_status?' · '+c.assignment_status:' · belum ditugaskan'}</span>
  </div>
  <p className="mt-1 text-[11px] text-slate-500">Case {c.id} · v{c.version}{c.assignee_email?' · Analis: '+c.assignee_email:''} · Pembuat: {c.created_by}</p>
  {c.leader_notes&&c.assignment_status==='returned'&&<p className="mt-1 text-[11px] text-amber-800">Catatan Leader: {c.leader_notes}</p>}
  {c.investigation_notes&&<p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700">Investigasi: {c.investigation_notes}</p>}
  <div className="mt-2 grid gap-2 sm:grid-cols-2">
   {mode==='mine'&&c.status==='open'&&c.assignment_status!=='submitted'&&<>
    <textarea aria-label="Catatan investigasi" className={input+' sm:col-span-2 min-h-16 py-2'} placeholder="Temuan, timeline, IOC dan tindakan containment (min. 12 karakter)" value={field(c,'notes')} onChange={e=>set(c,'notes',e.target.value)}/>
    <input aria-label="ID dokumen Vault" className={input} placeholder="ID dokumen supporting Vault" value={field(c,'doc')} onChange={e=>set(c,'doc',e.target.value)}/>
    <div className="flex gap-2"><button disabled={busy} onClick={()=>void act(c,'submit',{notes:field(c,'notes'),document_id:field(c,'doc')})} className="rounded-lg bg-sky-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Kirim Investigasi</button>
    {opp(c)&&<Link className="self-center text-xs font-semibold text-sky-800 underline" href={'/sales/documents?opportunity_id='+encodeURIComponent(opp(c))}>Unggah bukti</Link>}</div>
   </>}
   {mode==='team'&&leader&&c.status==='open'&&c.kind!=='vapt_finding'&&c.assignment_status!=='submitted'&&<>
    <select aria-label="Analis" className={input} value={field(c,'assignee')} onChange={e=>set(c,'assignee',e.target.value)}><option value="">Pilih analis</option>{board.analysts.map(a=><option key={a.email} value={a.email}>{a.email} · {a.role==='defense_leader'?'Leader':'Member'}</option>)}</select>
    <button disabled={busy||!field(c,'assignee')} onClick={()=>void act(c,'assign',{assignee_email:field(c,'assignee')})} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{c.assignee_email?'Tugaskan Ulang':'Tugaskan'}</button>
   </>}
   {mode==='team'&&leader&&c.status==='open'&&(c.assignment_status==='submitted'||!c.assignment_status)&&<>
    <input aria-label="Catatan QA" className={input} placeholder="Catatan QA / alasan (min. 12 karakter)" value={field(c,'qa')} onChange={e=>set(c,'qa',e.target.value)}/>
    {!c.assignment_status&&<input aria-label="ID dokumen bukti" className={input} placeholder="ID dokumen supporting Vault" value={field(c,'doc')} onChange={e=>set(c,'doc',e.target.value)}/>}
    <div className="flex flex-wrap gap-2 sm:col-span-2">
     <button disabled={busy} onClick={()=>void act(c,'review',{approve:true,notes:field(c,'qa'),document_id:field(c,'doc')||undefined})} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Setujui (Reviewed)</button>
     <button disabled={busy} onClick={()=>void act(c,'review',{approve:false,notes:field(c,'qa'),document_id:field(c,'doc')||undefined})} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Tolak</button>
     {c.assignment_status==='submitted'&&<button disabled={busy} onClick={()=>void act(c,'return',{notes:field(c,'qa')})} className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-40">Kembalikan ke Analis</button>}
    </div>
   </>}
   {mode==='team'&&leader&&c.status==='reviewed'&&<button disabled={busy} onClick={()=>void act(c,'close',{})} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Tutup Case</button>}
  </div>
 </li>;
 return <>{guide}<section aria-label="Board SOC Defense" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-slate-900">Board SOC Defense · {leader?'Leader':'Member'}</h2><button disabled={busy} onClick={()=>void load().catch(e=>setMessage(String(e)))} className="rounded-lg border px-3 py-2 text-xs font-semibold">Muat ulang</button></div>
  {message&&<p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">{message}</p>}
  {board.projects.length===0?<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Belum ada proyek SOC/DFIR dalam grant cyber_ops Anda. Minta Admin mengajukan penempatan staff dan capability <b>cyber_ops</b> pada legal entity proyek, lalu Approver menyetujuinya di Organization & ERP Access.</p>
  :<div className="overflow-x-auto rounded-lg border"><table className="min-w-full text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Proyek (Project ID)</th><th className="p-2">Customer</th><th className="p-2">Layanan</th><th className="p-2">Status</th></tr></thead><tbody>{board.projects.map(p=><tr key={p.id} className="border-t"><td className="p-2"><b>{p.title}</b><br/><span className="text-slate-500">{p.id}</span></td><td className="p-2">{p.company_name||'—'}</td><td className="p-2">{p.service_family}</td><td className="p-2">{p.status}</td></tr>)}</tbody></table></div>}
  <div><h3 className="mb-2 text-sm font-bold">Antrean Saya ({board.my_queue.length})</h3>{board.my_queue.length?<ul className="space-y-2">{board.my_queue.map(c=>row(c,'mine'))}</ul>:<p className="text-xs text-slate-500">Tidak ada case yang ditugaskan kepada Anda.</p>}</div>
  {leader&&<div><h3 className="mb-2 text-sm font-bold">Antrean Tim — triage, QA & penutupan ({board.team_queue.length})</h3>{board.team_queue.length?<ul className="space-y-2">{board.team_queue.map(c=>row(c,'team'))}</ul>:<p className="text-xs text-slate-500">Tidak ada case open atau reviewed.</p>}</div>}
  <p className="text-[11px] text-slate-500">Membuka case baru: gunakan aksi <b>Buka Case</b> pada form di bawah dengan Project ID dari tabel proyek.</p>
 </section></>;
}
