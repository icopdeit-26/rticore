'use client';

import {useEffect,useState} from 'react';
import {LogOut} from 'lucide-react';

type Mode='checking'|'local'|'cloud'|'unavailable';
export function LogoutButton({className,label='Logout / Ganti akun'}:{className?:string;label?:string}){
 const [mode,setMode]=useState<Mode>('checking');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/local-auth',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{const body=await response.json().catch(()=>null);if(!response.ok)throw Error('Status login belum dapat diperiksa.');setMode(body?.localMode?'local':'cloud');})
   .catch(()=>{if(!controller.signal.aborted)setMode('unavailable');});
  return()=>controller.abort();
 },[]);
 async function logout(){
  if(mode==='checking'||mode==='unavailable'||busy)return;
  setBusy(true);setError('');
  if(mode==='cloud'){window.location.assign('/cdn-cgi/access/logout');return;}
  try{
   const response=await fetch('/api/local-auth',{method:'DELETE',credentials:'same-origin'});
   if(!response.ok)throw Error('Logout gagal. Coba lagi.');
   window.location.assign('/login');
  }catch(e){setError(e instanceof Error?e.message:'Logout gagal. Coba lagi.');setBusy(false);}
 }
 const content=<><LogOut className="h-4 w-4" aria-hidden="true"/>{busy?'Memproses…':label}</>;
 return <>{mode==='cloud'?<a href="/cdn-cgi/access/logout" className={className}>{content}</a>:<button type="button" className={className} disabled={mode!=='local'||busy} onClick={()=>void logout()}>{content}</button>}{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</>;
}
