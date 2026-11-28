'use client';
import {useEffect,useState} from 'react';
import VAPTEngagement from '@/components/erp/VAPTEngagement';
import VAPTFinding from '@/components/erp/VAPTFinding';
import CTIGRC from '@/components/erp/CTIGRC';
const endpoint='/api/erp/technical-registers';
export default function TechnicalRegisters(){
 const [role,setRole]=useState('');const [error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();fetch('/api/sales/identity',{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error('Identity unavailable');const b=await r.json();if(!c.signal.aborted)setRole(b.identity?.role||'');}).catch(()=>{if(!c.signal.aborted)setError('Identity unavailable');});return()=>c.abort();},[]);
 return <main className="space-y-5 p-4"><h1 className="text-2xl font-bold">Technical project registers</h1><p>Only actively allocated projects within approved legal-entity affiliation. No commercial data or independent approval rights.</p>{error&&<p role="alert">{error}</p>}{['offense_lead','offense_member'].includes(role)&&<><VAPTEngagement endpoint={endpoint}/><VAPTFinding endpoint={endpoint}/></>}{['governance_leader','governance_member'].includes(role)&&<CTIGRC endpoint={endpoint}/>}</main>;
}
