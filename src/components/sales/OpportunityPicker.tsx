'use client';
import React,{useEffect,useState} from 'react';
import {errorText,readApiJSON} from '@/lib/client-api';

type Deal={id:string;title:string;company_name:string;stage:string};

/**
 * Lets a page opened from the menu (without ?opportunity_id=) choose an
 * Opportunity the API already allows this user to read. The selection is
 * mirrored to the URL so links back to the Pipeline keep their context.
 */
export function OpportunityPicker({value,onChange,disabled,className}:{
  value:string;onChange:(id:string)=>void;disabled?:boolean;className?:string;
}){
  const [deals,setDeals]=useState<Deal[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        const response=await fetch('/api/sales?entity=deals',{cache:'no-store',credentials:'same-origin'});
        const body=await readApiJSON(response);
        if(!response.ok||!body.success)throw Error(body.message||'Daftar Opportunity gagal dimuat.');
        if(active)setDeals((body.deals as Deal[])||[]);
      }catch(e){if(active)setError(errorText(e));}
    })();
    return()=>{active=false;};
  },[]);
  const choose=(id:string)=>{
    const url=new URL(window.location.href);
    if(id)url.searchParams.set('opportunity_id',id);else url.searchParams.delete('opportunity_id');
    window.history.replaceState(null,'',url.pathname+url.search);
    onChange(id);
  };
  return <label className="mt-3 block text-xs font-semibold">Opportunity
    <select aria-label="Opportunity" className={className||'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs'}
      value={value} disabled={disabled} onChange={e=>choose(e.target.value)}>
      <option value="">Pilih Opportunity</option>
      {value&&!deals.some(d=>d.id===value)&&<option value={value}>Opportunity {value.slice(0,8)}…</option>}
      {deals.map(d=><option key={d.id} value={d.id}>{d.company_name} · {d.title}</option>)}
    </select>
    {error&&<span role="alert" className="mt-1 block text-[11px] font-normal text-red-700">{error}</span>}
    {!error&&deals.length===0&&<span className="mt-1 block text-[11px] font-normal text-slate-500">Belum ada Opportunity yang dapat diakses.</span>}
  </label>;
}
