import {NextResponse} from 'next/server';
import {getRuntimeEnv} from '@/lib/runtime-env';
import type {D1DB} from '@/lib/boq-auth';
import {readBoundedJSON,RequestBodyError} from '@/lib/bounded-json';
import {nativeRequestOriginAllowed} from '@/lib/native-session';
import {enroll,enrollmentDetails,loginBusiness,logoutBusiness} from '@/lib/business-iam';
import {SESSION_COOKIE} from '@/lib/business-iam-crypto';
import {ROLE_PREVIEW_COOKIE} from '@/lib/role-preview';
export const dynamic='force-dynamic';
const json=(b:unknown,status=200)=>NextResponse.json(b,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function POST(req:Request){
 if(process.env.RTICORE_RUNTIME!=='hostinger'||process.env.RTICORE_AUTH_MODE!=='business')return json({success:false},404);
 if(!nativeRequestOriginAllowed(req,process.env.RTICORE_PUBLIC_ORIGIN||''))return json({success:false},403);
 try{
 const {RTICORE_DB:db}=await getRuntimeEnv<{RTICORE_DB:D1DB}>();
 const body=await readBoundedJSON(req,2048);
 if(body.action==='enrollment_details'){const details=await enrollmentDetails(db,body.invite);return details?json({success:true,...details}):json({success:false,message:'Undangan tidak valid atau batas percobaan tercapai.'},401);}
 if(body.action==='enroll'){const ok=await enroll(db,body.invite,body.password,body.otp);return ok?json({success:true}):json({success:false,message:'Aktivasi gagal atau batas percobaan tercapai.'},401);}
 if(body.action==='logout'){await logoutBusiness(db,req);const res=json({success:true});res.cookies.set(SESSION_COOKIE,'',{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:0});res.cookies.delete(ROLE_PREVIEW_COOKIE);return res;}
 if(body.action!=='login')return json({success:false},400);
 const token=await loginBusiness(db,body.email,body.password,body.otp);
 if(!token)return json({success:false,message:'Login gagal atau batas percobaan tercapai.'},401);
 const res=json({success:true});res.cookies.set(SESSION_COOKIE,token,{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:28800});res.cookies.delete(ROLE_PREVIEW_COOKIE);return res;
 }catch(e){return json({success:false,message:'Layanan identitas belum siap.'},e instanceof RequestBodyError?e.status:503);}
}
