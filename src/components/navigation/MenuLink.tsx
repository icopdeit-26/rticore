'use client';
import React,{useEffect,useState} from 'react';
import Link from 'next/link';
import {canOpenRoute} from '@/lib/enterprise-navigation';

// One identity read per page load, shared by every MenuLink on the page.
let rolePromise:Promise<string|null>|null=null;
function sessionRole():Promise<string|null>{
  rolePromise??=fetch('/api/sales/identity',{credentials:'same-origin',cache:'no-store'})
    .then(r=>r.ok?r.json():null)
    .then(j=>typeof j?.identity?.role==='string'?j.identity.role as string:null)
    .catch(()=>null)
    .then(role=>{if(!role)rolePromise=null;return role;});
  return rolePromise;
}

/** Role of the verified session, or null while unknown. UI hint only; APIs authorize. */
export function useSessionRole(known?:string|null){
  const [role,setRole]=useState<string|null>(known??null);
  useEffect(()=>{
    if(known){setRole(known);return;}
    let active=true;void sessionRole().then(r=>{if(active)setRole(r);});
    return()=>{active=false;};
  },[known]);
  return role;
}

/**
 * In-page shortcut to a menu route: rendered only when the viewer's role menu
 * includes that route (canOpenRoute), so no role is sent to a page it cannot use.
 * Contextual non-menu routes are always rendered.
 */
export function MenuLink({href,role,className,children,title}:{href:string;role?:string|null;className?:string;children:React.ReactNode;title?:string}){
  const viewer=useSessionRole(role);
  if(!viewer||!canOpenRoute(viewer,href))return null;
  return <Link href={href} className={className} title={title}>{children}</Link>;
}
