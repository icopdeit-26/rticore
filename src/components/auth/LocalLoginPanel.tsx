'use client';

import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {HardDrive, LogIn} from 'lucide-react';
import {firstAccessibleHref} from '@/lib/enterprise-navigation';

type Member={email:string;role:string};
type State=
  | {status:'hidden'}
  | {status:'error';message:string}
  | {status:'ready';members:Member[]};

/**
 * Shown only when the server reports RTICORE_LOCAL_MODE=1 (no Cloudflare).
 * The server re-validates the member and signs the session; the browser only
 * chooses WHICH registered account to sign in as on this computer.
 */
export function LocalLoginPanel(){
  const router=useRouter();
  const [state,setState]=useState<State>({status:'hidden'});
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/local-auth',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const body=await response.json().catch(()=>null);
        if(!body?.localMode)return;
        if(!response.ok||!Array.isArray(body.members)){
          setState({status:'error',message:String(body?.message||'Mode lokal belum siap.')});return;
        }
        setState({status:'ready',members:body.members});
        if(body.members[0])setEmail(body.members[0].email);
      })
      .catch(()=>{/* cloud mode or offline: keep hidden */});
    return ()=>controller.abort();
  },[]);

  if(state.status==='hidden')return null;

  async function signIn(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/local-auth',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      const body=await response.json().catch(()=>null);
      if(!response.ok||body?.success!==true){setMessage(String(body?.message||'Login lokal gagal.'));return;}
      router.push(firstAccessibleHref(body.role)||'/');
      router.refresh();
    }catch{setMessage('Login lokal gagal terhubung. Silakan coba lagi.');}finally{setBusy(false);}
  }

  return (
    <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-800">
        <HardDrive className="h-4 w-4" aria-hidden="true" /> Mode lokal · tanpa cloud
      </p>
      {state.status==='error'&&<p role="alert" className="mt-2 text-sm text-amber-800">{state.message}</p>}
      {state.status==='ready'&&state.members.length===0&&
        <p role="alert" className="mt-2 text-sm text-amber-800">Belum ada akun aktif. Jalankan <code>npm run local:setup -- --admin email@anda</code>.</p>}
      {state.status==='ready'&&state.members.length>0&&<>
        <label htmlFor="local-login-email" className="mt-3 block text-xs font-semibold text-slate-700">Masuk sebagai akun terdaftar</label>
        <select id="local-login-email" value={email} onChange={e=>setEmail(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900">
          {state.members.map(m=><option key={m.email} value={m.email}>{m.email} · {m.role}</option>)}
        </select>
        <button type="button" onClick={()=>void signIn()} disabled={busy||!email}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:opacity-60">
          <LogIn className="h-4 w-4" aria-hidden="true" /> {busy?'Memproses…':'Masuk (mode lokal)'}
        </button>
        {message&&<p role="alert" className="mt-2 text-sm text-red-700">{message}</p>}
        <p className="mt-2 text-xs leading-5 text-slate-600">Data tersimpan di database PostgreSQL lokal pada komputer ini. Login hanya dapat dilakukan dari localhost.</p>
      </>}
    </div>
  );
}
