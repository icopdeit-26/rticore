'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Search,X} from 'lucide-react';
import {searchRoleNavigation} from '@/lib/command-palette';
export function EnterpriseCommandPalette({role}:{role:string|null}){
 const router=useRouter();
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [query,setQuery]=useState(''),[active,setActive]=useState(0);
 const results=useMemo(()=>searchRoleNavigation(role,query),[role,query]);
 const open=()=>{if(dialog.current&&!dialog.current.open){setQuery('');setActive(0);dialog.current.showModal();input.current?.focus();}};
 const close=()=>dialog.current?.close();
 useEffect(()=>{
  if(!role)return;
  const onKey=(e:KeyboardEvent)=>{
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.repeat&&!e.defaultPrevented){
    e.preventDefault();
    if(dialog.current?.open)dialog.current.close();else{setQuery('');setActive(0);dialog.current?.showModal();input.current?.focus();}
   }
  };
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[role]);
 if(!role)return null;
 const navigate=(href:string)=>{if(!results.some(item=>item.href===href))return;close();router.push(href);};
 return <>
  <button ref={trigger} type="button" onClick={open} aria-label="Cari modul RTICORE (Ctrl+K)" title="Cari modul (Ctrl+K)" className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 text-slate-700 hover:bg-teal-50"><Search className="h-4 w-4" aria-hidden="true"/><span className="hidden xl:inline text-xs">Cari modul</span></button>
  <dialog ref={dialog} aria-label="Pencarian modul RTICORE" onClose={()=>trigger.current?.focus()} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/50">
   <div className="flex items-center gap-2"><input ref={input} aria-label="Cari modul sesuai role" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} onKeyDown={e=>{
    if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.max(0,Math.min(results.length-1,i+1)));}
    if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}
    if(e.key==='Enter'&&results[active]){e.preventDefault();navigate(results[active].href);}
   }} placeholder="Cari modul…" className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-sm"/><button type="button" aria-label="Tutup pencarian" onClick={close}><X className="h-5 w-5"/></button></div>
   <p role="status" className="mt-2 text-xs text-slate-500">{results.length} hasil</p>
   <div className="mt-2 max-h-[55dvh] overflow-y-auto">{results.map((item,i)=><button key={item.href} type="button" onClick={()=>navigate(item.href)} className={'block w-full rounded-lg px-3 py-2 text-left text-sm '+(active===i?'bg-teal-50 text-teal-900':'hover:bg-slate-50')}><span className="block font-medium">{item.label}</span><span className="text-xs text-slate-500">{item.group}</span></button>)}</div>
  </dialog>
 </>;
}
