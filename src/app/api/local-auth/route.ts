import {NextResponse} from 'next/server';
import type {D1DB} from '@/lib/boq-auth';
import {getRuntimeEnv, isLocalMode} from '@/lib/runtime-env';
import {LOCAL_SESSION_COOKIE, LOCAL_SESSION_TTL_SECONDS, createLocalSession, isLoopbackRequest, isSameLocalOrigin, validSessionSecret} from '@/lib/local-auth';
import {ROLE_PREVIEW_COOKIE} from '@/lib/role-preview';

/**
 * Local-mode login (RTICORE_LOCAL_MODE=1 only). In cloud mode this endpoint
 * reports localMode:false and refuses every write, so Cloudflare Access stays
 * the only authentication path in deployed environments.
 */
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} as const;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
type LocalEnv={RTICORE_DB?:D1DB;RTICORE_LOCAL_SESSION_SECRET?:string};

async function localContext(request:Request){
  if(!isLocalMode())return {error:json({success:false,localMode:false,message:'Login lokal hanya tersedia pada mode lokal.'},404)};
  if(!isLoopbackRequest(request))return {error:json({success:false,localMode:true,message:'Login lokal hanya dapat diakses dari komputer ini (localhost).'},403)};
  const env=await getRuntimeEnv<LocalEnv>();
  if(!env.RTICORE_DB||!validSessionSecret(env.RTICORE_LOCAL_SESSION_SECRET))
    return {error:json({success:false,localMode:true,message:'Mode lokal belum dikonfigurasi. Jalankan: npm run local:setup'},503)};
  return {db:env.RTICORE_DB,secret:env.RTICORE_LOCAL_SESSION_SECRET};
}

export async function GET(request:Request){
  if(!isLocalMode())return json({success:true,localMode:false});
  const ctx=await localContext(request);
  if('error' in ctx)return ctx.error;
  try{
    const members=await ctx.db.prepare('SELECT email,role FROM rticore_members WHERE active=1 ORDER BY role,email')
      .all<{email:string;role:string}>();
    return json({success:true,localMode:true,members:members.results});
  }catch{
    return json({success:false,localMode:true,message:'Database lokal belum dimigrasi. Jalankan: npm run local:setup'},503);
  }
}

export async function POST(request:Request){
  const ctx=await localContext(request);
  if('error' in ctx)return ctx.error;
  if(!isSameLocalOrigin(request))return json({success:false,message:'Origin tidak diizinkan.'},403);
  let email='';
  try{email=String((await request.json())?.email||'').trim().toLowerCase();}catch{/* invalid body */}
  if(!email.includes('@')||email.length>254)return json({success:false,message:'Email tidak valid.'},400);
  const member=await ctx.db.prepare('SELECT role,active FROM rticore_members WHERE email=?').bind(email).first<{role:string;active:number}>();
  if(!member||member.active!==1)return json({success:false,message:'Akun tidak terdaftar atau nonaktif.'},403);
  const response=json({success:true,email,role:member.role});
  response.cookies.set(LOCAL_SESSION_COOKIE,await createLocalSession(ctx.secret,email),
    {httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:LOCAL_SESSION_TTL_SECONDS});
  response.cookies.delete(ROLE_PREVIEW_COOKIE);
  return response;
}

export async function DELETE(request:Request){
  if(!isLocalMode())return json({success:false,localMode:false},404);
  if(!isSameLocalOrigin(request))return json({success:false,message:'Origin tidak diizinkan.'},403);
  const response=json({success:true});
  response.cookies.delete(LOCAL_SESSION_COOKIE);
  response.cookies.delete(ROLE_PREVIEW_COOKIE);
  return response;
}
