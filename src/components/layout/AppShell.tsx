'use client';

import React,{useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {Navbar} from './Navbar';
import {Sidebar} from './Sidebar';
import {MobileNav} from './MobileNav';
const AIWorkbench=dynamic(()=>import('@/components/ai/AIWorkbench').then(module=>module.AIWorkbench));

interface AppShellProps { children:React.ReactNode; nativeBusiness?:boolean; }
type Identity={email:string;role:string;assignedRole:string;rolePreview:boolean};
type Session={status:'checking'|'ready'|'denied';identity:Identity|null};
// Mirrors the role check in /api/sales/approval-queue.
const APPROVAL_QUEUE_ROLES=['admin','sales','presales','finance','approver','legal'];

/** Server-verified native IAM or explicit OIDC decides the assigned role. Optional Admin-only
 * simulation is downscoped on the server for every API, never only in the UI.
 */
export const AppShell:React.FC<AppShellProps> = ({children,nativeBusiness=false})=>{
  const pathname=usePathname();
  const isLoginPage=pathname==='/login';
  const [session,setSession]=useState<Session>({status:'checking',identity:null});
  const [pendingApprovalsCount,setPendingApprovalsCount]=useState<number|null>(null);
  const [desktopMenuOpen,setDesktopMenuOpen]=useState(true);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [menuPreferenceLoaded,setMenuPreferenceLoaded]=useState(false);

  useEffect(()=>{
    try {
      const saved=window.localStorage.getItem('rticore:left-navigation-open') ?? window.localStorage.getItem('rticore:right-navigation-open');
      if(saved==='true'||saved==='false')setDesktopMenuOpen(saved==='true');
    } catch {/* Local storage is optional, including in privacy mode. */}
    setMenuPreferenceLoaded(true);
  },[]);
  useEffect(()=>{
    if(!menuPreferenceLoaded)return;
    try {window.localStorage.setItem('rticore:left-navigation-open',String(desktopMenuOpen));}
    catch {/* Keep the menu usable when storage is unavailable. */}
  },[desktopMenuOpen,menuPreferenceLoaded]);

  const onToggleMenu=useCallback(()=>{
    if(window.matchMedia('(min-width: 1024px)').matches)setDesktopMenuOpen(value=>!value);
    else setMobileMenuOpen(value=>!value);
  },[]);
  const onCloseMenu=useCallback(()=>{
    if(window.matchMedia('(min-width: 1024px)').matches)setDesktopMenuOpen(false);
    else setMobileMenuOpen(false);
  },[]);
  useEffect(()=>{
    if(isLoginPage||(nativeBusiness&&pathname==='/'))return; // Login and server-side native entry have no shell identity request.
    const controller=new AbortController();
    fetch('/api/sales/identity',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async res=>{
        if(nativeBusiness&&(res.status===401||res.status===403)){if(!controller.signal.aborted){setSession({status:'denied',identity:null});window.location.replace('/login');}return;}
        if(!res.ok)throw Error('Sesi autentikasi / database belum dapat diverifikasi.');
        const data=await res.json();
        if(data.success!==true||typeof data.identity?.role!=='string'||typeof data.identity?.email!=='string')
          throw Error('Identitas tidak valid');
        if(!controller.signal.aborted)setSession({status:'ready',identity:data.identity});
      })
      .catch(()=>{if(!controller.signal.aborted)setSession({status:'denied',identity:null});});
    return ()=>controller.abort();
  },[isLoginPage,nativeBusiness,pathname]);
  // The bell count is real, role-scoped D1 data, or null when not verified. Never assume zero on failure.
  // Only roles the approval-queue API serves ask for it; others would get a 403 on every page.
  const queueRole=session.status==='ready'&&APPROVAL_QUEUE_ROLES.includes(session.identity?.role??'');
  useEffect(()=>{
    if(!queueRole){setPendingApprovalsCount(null);return;}
    const controller=new AbortController();
    const refresh=async()=>{
      try{
        const response=await fetch('/api/sales/approval-queue',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
        const data=await response.json();
        if(!response.ok||data.success!==true||!Array.isArray(data.items))throw Error('Approval queue unavailable');
        if(!controller.signal.aborted)setPendingApprovalsCount(data.items.length);
      }catch{if(!controller.signal.aborted)setPendingApprovalsCount(null);}
    };
    void refresh();
    const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{controller.abort();document.removeEventListener('visibilitychange',onVisible);};
  },[queueRole]);
  const role=session.status==='ready'?session.identity?.role??null:null;
  // The sign-in page has its own minimal layout (no authenticated header or navigation).
  if(isLoginPage||(nativeBusiness&&pathname==='/'))return <>{children}</>;
  if(nativeBusiness&&session.status!=='ready')return <main className="mx-auto max-w-md p-8"><p role="status">{session.status==='checking'?'Memverifikasi sesi…':'Layanan identitas belum tersedia.'}</p><Link href="/login" className="mt-3 block underline">Buka login RTICORE</Link></main>;
  return (
    <div className="flex min-h-screen min-w-0 max-w-full flex-col bg-[#f5f7fa] text-slate-900">
      <Navbar role={role} assignedRole={session.identity?.assignedRole??null} rolePreview={session.identity?.rolePreview===true} email={session.identity?.email??null} pendingApprovalsCount={pendingApprovalsCount} onToggleMenu={onToggleMenu} desktopMenuOpen={desktopMenuOpen} mobileMenuOpen={mobileMenuOpen}/>
      {session.status!=='ready' ? <div role="status" className="no-print border-b border-teal-100/60 bg-teal-50/70 px-4 py-1.5 text-center text-[10px] font-medium tracking-wide text-teal-800">
        {session.status==='checking'?'Memverifikasi sesi pengguna…':
         'Sesi belum terverifikasi. Silakan login terlebih dahulu untuk mengakses fitur transaksi.'}
      </div> : null}
      {session.status==='denied'&&<div className="no-print border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-center text-xs">
        <Link href="/login" className="font-semibold text-indigo-800 underline">Buka halaman login RTICORE</Link>
      </div>}
      <div className="flex min-w-0 flex-1 overflow-hidden print:block print:overflow-visible">
        {role&&<Sidebar role={role} desktopOpen={desktopMenuOpen} mobileOpen={mobileMenuOpen} onClose={onCloseMenu}/>}
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 overflow-x-clip overflow-y-auto px-3 pb-28 pt-0 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8 print:max-w-none print:overflow-visible print:p-0">
          {role&&<AIWorkbench/>}
          {children}
        </main>
      </div>
      {role&&<MobileNav role={role}/>}
    </div>
  );
};


