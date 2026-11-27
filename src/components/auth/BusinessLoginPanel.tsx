'use client';
import {useState,type FormEvent} from 'react';
export function BusinessLoginPanel(){
 const [mode,setMode]=useState<'login'|'invite'|'enroll'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[otp,setOtp]=useState(''),[invite,setInvite]=useState(''),[seed,setSeed]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setNotice('');
 try{
 const action=mode==='login'?'login':mode==='invite'?'enrollment_details':'enroll';
 const payload=action==='login'?{action,email,password,otp}:action==='enroll'?{action,invite,password,otp}:{action,invite};
 const res=await fetch('/api/business-auth',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const b=await res.json();if(!res.ok||!b.success)throw Error(b.message||'Permintaan tidak berhasil.');
 if(mode==='invite'){setSeed(b.seed);setEmail(b.email);setMode('enroll');}
 else if(mode==='enroll'){setMode('login');setInvite('');setSeed('');setPassword('');setOtp('');setNotice('Aktivasi berhasil. Tunggu kode autentikator berikutnya, lalu masuk.');}
 else{setPassword('');setOtp('');window.location.assign('/login');}
 }catch(e){setNotice(e instanceof Error?e.message:'Layanan belum tersedia.');}finally{setBusy(false);}
 }
 const input='mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm';
 return <form onSubmit={submit} className="mt-5 space-y-3">
 {mode==='login'?<label className="block text-xs font-semibold">Email perusahaan<input className={input} type="email" autoComplete="username" required value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/></label>:mode==='invite'?<label className="block text-xs font-semibold">Token undangan administrator<input className={input} type="password" autoComplete="off" required value={invite} onChange={e=>setInvite(e.target.value)}/></label>:<div className="rounded-lg bg-amber-50 p-3 text-xs"><p className="font-semibold">Aktivasi autentikator untuk {email}</p><p>Tambahkan akun berbasis waktu (TOTP), 6 digit, 30 detik, SHA-1 di aplikasi autentikator. Masukkan kunci berikut secara manual. Jangan bagikan kunci ini.</p><code className="break-all select-all">{seed}</code></div>}
 {mode!=='invite'&&<><label className="block text-xs font-semibold">Password<input className={input} type="password" autoComplete={mode==='enroll'?'new-password':'current-password'} required minLength={14} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="block text-xs font-semibold">Kode autentikator (6 digit)<input className={input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={otp} onChange={e=>setOtp(e.target.value)}/></label></>}
 <button disabled={busy} className="min-h-12 w-full rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{busy?'Memproses…':mode==='login'?'Masuk dengan MFA':mode==='invite'?'Verifikasi undangan':'Aktifkan MFA'}</button>
 <button type="button" disabled={busy} className="text-xs font-semibold text-teal-700" onClick={()=>{setMode(mode==='login'?'invite':'login');setInvite('');setSeed('');setPassword('');setOtp('');setNotice('');}}>{mode==='login'?'Aktivasi akun pertama kali':'Kembali ke login'}</button>
 {notice&&<p role="alert" className="text-xs text-slate-700">{notice}</p>}
 </form>;
}
