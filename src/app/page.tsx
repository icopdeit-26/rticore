import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authorizeBoQ} from '@/lib/boq-auth';
import {firstAccessibleHref} from '@/lib/enterprise-navigation';
import {readSessionCookie} from '@/lib/business-iam-crypto';
import {LegacyHomeEntry} from '@/components/auth/LegacyHomeEntry';
export const dynamic='force-dynamic';
export const runtime='nodejs';

// Native entry is server-side. A cookie alone never establishes a role.
export default async function RTICoreHome(){
 if(process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_AUTH_MODE==='business'){
  const incoming=await headers();const cookie=incoming.get('cookie');
  if(!readSessionCookie(cookie))redirect('/login');
  const origin=process.env.RTICORE_PUBLIC_ORIGIN;
  if(!origin)redirect('/login');
  const auth=await authorizeBoQ(new Request(new URL('/api/sales/identity',origin),{headers:{cookie:cookie||''}}));
  if(!auth.ok)redirect('/login');
  const target=firstAccessibleHref(auth.identity.role);
  if(target)redirect(target);
  return <section className="mx-auto max-w-xl rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">Akses workspace belum tersedia</h1><p className="mt-2">Akun terverifikasi, tetapi belum memiliki menu. Hubungi administrator.</p><a className="mt-4 block underline" href="/login">Kembali ke login</a></section>;
 }
 return <LegacyHomeEntry/>;
}
