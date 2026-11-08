'use client';

import {useState} from 'react';
import {LogOut} from 'lucide-react';

export function LogoutButton({className,label='Logout / Ganti akun',href='/cdn-cgi/access/logout'}:{className?:string;label?:string;href?:string}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 async function logout(){
  setBusy(true);setError('');
  try{
   const mode=await fetch('/api/local-auth',{credentials:'same-origin',cache:'no-store'});
   if(!mode.ok)throw Error('Status login belum dapat diperiksa. Coba lagi.');
   const body=await mode.json();
   if(!body.localMode){window.location.assign(href);return;}
   const response=await fetch('/api/local-auth',{method:'DELETE',credentials:'same-origin'});
   if(!response.ok)throw Error('Logout gagal. Coba lagi.');
   window.location.assign('/login');
  }catch(e){setError(e instanceof Error?e.message:'Logout gagal. Coba lagi.');setBusy(false);}
 }
 return <><a href={href} className={className} aria-disabled={busy} onClick={e=>{e.preventDefault();if(!busy)void logout();}}><LogOut className="h-4 w-4" aria-hidden="true"/>{busy?'Memproses…':label}</a>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</>;
}
