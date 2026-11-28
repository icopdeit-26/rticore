import {NextResponse} from 'next/server';
import {getRuntimeEnv} from '@/lib/runtime-env';
import type {D1DB} from '@/lib/boq-auth';
import {nativeRequestOriginAllowed} from '@/lib/native-session';
import {readBoundedJSON,RequestBodyError} from '@/lib/bounded-json';
import {portalEnabled,portalKey,portalEnrollmentDetails,portalEnroll,portalLogin,portalLogout,PORTAL_COOKIE} from '@/lib/flexguard-portal-auth';
export const dynamic='force-dynamic';
const json=(b:unknown,status=200)=>NextResponse.json(b,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function POST(req:Request){
 if(!portalEnabled())return json({success:false},404);
 if(!nativeRequestOriginAllowed(req,process.env.RTICORE_PUBLIC_ORIGIN||''))return json({success:false},403);
 try{
  portalKey();const {RTICORE_DB:db}=await getRuntimeEnv<{RTICORE_DB:D1DB}>();const b=await readBoundedJSON(req,2048);
  if(b.action==='enrollment_details'){const d=await portalEnrollmentDetails(db,b.invite);return d?json({success:true,...d}):json({success:false},401);}
  if(b.action==='enroll')return await portalEnroll(db,b.invite,b.password,b.otp)?json({success:true}):json({success:false},401);
  if(b.action==='logout'){await portalLogout(db,req);const r=json({success:true});r.cookies.set(PORTAL_COOKIE,'',{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:0});return r;}
  if(b.action!=='login')return json({success:false},400);
  const token=await portalLogin(db,b.email,b.password,b.otp);if(!token)return json({success:false},401);
  const r=json({success:true});r.cookies.set(PORTAL_COOKIE,token,{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:28800});return r;
 }catch(e){return json({success:false},e instanceof RequestBodyError?e.status:503);}
}
