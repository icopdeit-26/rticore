'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import NativeApprovalInbox from './NativeApprovalInbox';
import {
 Calculator,ClipboardCheck,FileCheck2,Receipt,ShieldCheck,RefreshCw,
 ArrowRight,CheckCircle2,Clock,AlertTriangle,Layers,Sparkles
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {LegalWorkspaceGuide} from '@/components/sales/LegalWorkspaceGuide';
import {FinanceWorkspaceGuide} from '@/components/sales/FinanceWorkspaceGuide';
type Station={
 href:string;
 name:string;
 description:string;
 badge:string;
 icon:LucideIcon;
 iconBg:string;
 badgeTone:string;
 roles:readonly string[];
};
type Task={id:string;kind:string;title:string;opportunity_id:string|null;created_at:string;href:string};
type Queue={items:Task[];truncated:boolean;generated_at:string;included_kinds:string[]};
const STATIONS:readonly Station[]=[
 {
  href:'/boq',
  name:'BoQ & Pricing Approval',
  description:'Review BoQ dan keputusan maker-checker pada dokumen database.',
  badge:'Commercial & Margin',
  icon:Calculator,
  iconBg:'bg-indigo-50 text-indigo-700 ring-indigo-200/70',
  badgeTone:'bg-indigo-50 text-indigo-800 border-indigo-200/80',
  roles:['admin','sales','presales','finance','approver','legal']
 },
 {
  href:'/sales/bid-readiness',
  name:'Tender Bid/No-Bid & Compliance',
  description:'Kelengkapan RKS/KAK, bukti asli dan keputusan reviewer independen.',
  badge:'Presales & Tender Gate',
  icon:ClipboardCheck,
  iconBg:'bg-amber-50 text-amber-700 ring-amber-200/70',
  badgeTone:'bg-amber-50 text-amber-800 border-amber-200/80',
  roles:['admin','presales','approver','finance','legal']
 },
 {
  href:'/sales/award',
  name:'PO/SPK Finance & Legal',
  description:'Verifikasi dokumen asli dan review ganda sebelum Closed Won.',
  badge:'Dual Gate Verification',
  icon:FileCheck2,
  iconBg:'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  badgeTone:'bg-emerald-50 text-emerald-800 border-emerald-200/80',
  roles:['admin','sales','finance','approver','legal']
 },
 {
  href:'/sales/billing',
  name:'BAST, Invoice & Collection',
  description:'Approval Finance, alokasi pembayaran dan rekonsiliasi.',
  badge:'Billing & Treasury',
  icon:Receipt,
  iconBg:'bg-sky-50 text-sky-700 ring-sky-200/70',
  badgeTone:'bg-sky-50 text-sky-800 border-sky-200/80',
  roles:['admin','finance','approver']
 },
 {
  href:'/flexguard',
  name:'FlexGuard Entitlement',
  description:'Approval token wallet pada database oleh checker independen.',
  badge:'Token & Entitlement',
  icon:ShieldCheck,
  iconBg:'bg-purple-50 text-purple-700 ring-purple-200/70',
  badgeTone:'bg-purple-50 text-purple-800 border-purple-200/80',
  roles:['admin','approver']
 },
 {
  href:'/sales/renewals',
  name:'Contract & Renewal',
  description:'Persetujuan kontrak dan perubahan masa layanan.',
  badge:'Lifecycle & SLA',
  icon:RefreshCw,
  iconBg:'bg-teal-50 text-teal-700 ring-teal-200/70',
  badgeTone:'bg-teal-50 text-teal-800 border-teal-200/80',
  roles:['admin','sales','presales','finance','approver','legal']
 }
];
const LABELS:Record<string,string>={boq:'BoQ',tender_deadline:'Tender deadline',tender_checklist:'Tender checklist',award_finance:'PO Finance',award_legal:'PO Legal',feasibility:'Technical feasibility',invoice:'Invoice',payment:'Collection',contract:'Contract',flexguard_wallet:'FlexGuard entitlement'};
export default function CanonicalApprovalLinks(){
 const [role,setRole]=useState<string|null>(null);
 const [state,setState]=useState<'checking'|'ready'|'denied'>('checking');
 const [queue,setQueue]=useState<Queue|null>(null);
 const [queueState,setQueueState]=useState<'loading'|'ready'|'error'>('loading');
 const [queueError,setQueueError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/sales/identity',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    if(!response.ok)throw Error('Tidak terautentikasi');
    const payload=await response.json();
    if(payload.success!==true||typeof payload.identity?.role!=='string')throw Error('Akses tidak tersedia');
    if(!controller.signal.aborted){setRole(payload.identity.role);setState('ready');}
   })
   .catch(()=>{if(!controller.signal.aborted)setState('denied');});
  return ()=>controller.abort();
 },[]);
 useEffect(()=>{
  if(state!=='ready')return;
  const controller=new AbortController();
  void fetch('/api/sales/approval-queue',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const body=await response.json();
    if(!response.ok||body.success!==true||!Array.isArray(body.items))throw Error(body.message||'Antrian database tidak dapat diverifikasi');
    if(!controller.signal.aborted){setQueue(body as Queue);setQueueState('ready');setQueueError('');}
   })
   .catch(e=>{if(!controller.signal.aborted){setQueue(null);setQueueState('error');setQueueError(e instanceof Error?e.message:'Antrian database belum tersedia');}});
  return ()=>controller.abort();
 },[state,refresh]);
 const available=STATIONS.filter(s=>role&&s.roles.includes(role));
 return <main className="mx-auto max-w-5xl space-y-6 pb-24">
  <header className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-white to-indigo-50/40 p-6 shadow-xs">
   <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="max-w-3xl">
     <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-800">
      <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true"/>
      Maker-Checker Governance Hub
     </div>
     <h1 className="mt-2.5 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">Approval Center · Canonical Workflows</h1>
     <p className="mt-2 text-sm leading-relaxed text-slate-600">Antrian bersumber langsung dari transaksi database dan kewenangan reviewer. Setiap keputusan tetap harus diproses di modul asal dengan pengujian maker-checker, persyaratan bukti dan versi transaksi. Antrian ini belum mencakup seluruh jenis persetujuan enterprise.</p>
    </div>
    {role&&<div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3.5 py-2 shadow-2xs">
     <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true"/>
     <span className="text-xs font-medium text-slate-500">Role Aktif:</span>
     <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">{role}</span>
    </div>}
   </div>
  </header>
  {state==='checking'&&<p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-2xs">Memverifikasi sesi identitas pengguna…</p>}
  {state==='denied'&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-sm font-medium text-rose-800">Sesi autentikasi/database belum terverifikasi; tidak ada tindakan approval yang diizinkan.</p>}
  {state==='ready'&&<>
   {role&&<LegalWorkspaceGuide role={role} currentStation="Approval Center · Lintas Modul" defaultOpen={role==='legal'}/>}
   {role&&<FinanceWorkspaceGuide role={role} currentStation="Approval Center · Lintas Modul" defaultOpen={role==='finance'}/>}
   <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6" aria-label="Antrian persetujuan nyata">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
     <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60">
       <Clock className="h-4 w-4" aria-hidden="true"/>
      </span>
      <div>
       <h2 className="text-sm font-bold text-slate-900">Menunggu review dari transaksi database</h2>
       <p className="text-[11px] text-slate-500">Daftar item aktif yang memenuhi syarat segregasi tugas (Maker ≠ Checker)</p>
      </div>
     </div>
     <button type="button" onClick={()=>{setQueue(null);setQueueState('loading');setRefresh(v=>v+1);}} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 active:scale-[0.99]">
      <RefreshCw className={`h-3.5 w-3.5 ${queueState==='loading'?'animate-spin text-indigo-600':''}`} aria-hidden="true"/>
      Refresh
     </button>
    </div>
    {queueState==='loading'&&<p role="status" className="text-sm text-slate-600">Memuat status review dari database…</p>}
    {queueState==='error'&&<div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-sm text-amber-950">
     <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true"/>
     <p>Antrian tidak dapat dibaca; bukan berarti tidak ada pekerjaan. {queueError}</p>
    </div>}
    {queueState==='ready'&&queue&&<>
     <p className="text-xs text-slate-500">{queue.truncated?'Sedikitnya ':'Jumlah dalam cakupan antrian: '}<strong className="font-semibold text-slate-800">{queue.items.length} item</strong>{queue.truncated?' (hasil dibatasi; bukan total keseluruhan)':''}. Data ditarik {queue.generated_at}.</p>
     {queue.items.length===0?<div role="status" className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-sm text-slate-600">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true"/>
      <span>Tidak ada transaksi menunggu review pada kategori dan role yang sudah tercakup. Periksa modul asal untuk jenis approval lain.</span>
     </div>:
      <div className="space-y-2.5">{queue.items.map(t=><article key={t.kind+':'+t.id} className="group flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-slate-50/40 p-3.5 transition hover:border-indigo-200 hover:bg-white hover:shadow-2xs">
       <div className="min-w-0">
        <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200/60">{LABELS[t.kind]||t.kind}</span>
        <p className="mt-1 break-words text-sm font-semibold text-slate-900">{t.title}</p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">Referensi: {t.id}</p>
       </div>
       <Link href={t.href} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        <span>Periksa di sumber</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true"/>
       </Link>
      </article>)}</div>}
    </>}
   </section>
   {role&&['approver','finance'].includes(role)&&<NativeApprovalInbox/>}
   <section className="space-y-3.5" aria-label="Modul approval berizin">
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
     <div className="flex items-center gap-2">
      <Layers className="h-4 w-4 text-indigo-600" aria-hidden="true"/>
      <h2 className="text-sm font-bold text-slate-900">Modul Approval Berizin</h2>
     </div>
     <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 shadow-2xs">
      {available.length} Modul Tersedia
     </span>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
     {available.map(s=>{
      const Icon=s.icon;
      return <Link key={s.href} href={s.href} className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-indigo-500">
       <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
         <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${s.iconBg} transition-transform duration-200 group-hover:scale-105`}>
          <Icon className="h-5 w-5" aria-hidden="true"/>
         </span>
         <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${s.badgeTone}`}>
          {s.badge}
         </span>
        </div>
        <div>
         <h3 className="text-base font-bold text-slate-900 transition-colors group-hover:text-indigo-950">{s.name}</h3>
         <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{s.description}</p>
        </div>
       </div>
       <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-slate-400 group-hover:text-slate-600">
         <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true"/>
         {s.href}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all duration-150 group-hover:bg-indigo-700 group-hover:shadow-sm">
         <span>Buka transaksi</span>
         <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true"/>
        </span>
       </div>
      </Link>;
     })}
     {available.length===0&&<p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 md:col-span-2">Tidak ada workflow approval untuk role ini.</p>}
    </div>
   </section>
  </>}
 </main>;
}
