import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getRuntimeEnv } from './runtime-env';
import { emailFromLocalSession, validSessionSecret } from './local-auth';
import {accessRestricted} from './system-settings';
import type { BoQRole } from './boq-domain';
import {rolePreviewFromCookie} from './role-preview';
import {offenseRouteAllowed} from './offense-team';
import {governanceRouteAllowed} from './governance-team';
import {defenseRouteAllowed} from './defense-routes';
import {itdevRouteAllowed} from './itdev-team';

export interface D1Prepared {
 bind(...args:(string|number|null)[]):D1Prepared;
 all<T=Record<string,unknown>>():Promise<{results:T[];success:boolean}>;
 first<T=Record<string,unknown>>():Promise<T|null>;
 run():Promise<{success:boolean}>;
}
export interface D1DB {
 prepare(query:string):D1Prepared;
 batch(statements:D1Prepared[]):Promise<unknown[]>;
}
type CloudEnv={RTICORE_RUNTIME?:string;RTICORE_OIDC_ISSUER?:string;RTICORE_OIDC_CLIENT_ID?:string;RTICORE_OIDC_AUDIENCE?:string;RTICORE_DB?:D1DB;RTICORE_ACCESS_AUD?:string;RTICORE_ACCESS_TEAM_DOMAIN?:string;RTICORE_LOCAL_MODE?:string;RTICORE_LOCAL_SESSION_SECRET?:string};
export type BoQIdentity={email:string;role:BoQRole;assignedRole:BoQRole;rolePreview:boolean;db:D1DB};
type Result={ok:true;identity:BoQIdentity}|{ok:false;response:NextResponse};
const deny=(status:number,message:string):Result=>({ok:false,response:NextResponse.json({success:false,message},{status,headers:{'Cache-Control':'no-store'}})});
const cache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
/** Cloud: verified Cloudflare Access JWT. Local: HMAC-signed local session cookie. */
async function verifiedEmail(request:Request,env:CloudEnv):Promise<{email:string}|{error:Result}>{
 if(env.RTICORE_RUNTIME==='hostinger'){
   const issuer=env.RTICORE_OIDC_ISSUER, audience=env.RTICORE_OIDC_AUDIENCE, client=env.RTICORE_OIDC_CLIENT_ID;
   if(!issuer||!audience||!client)return {error:deny(503,'OIDC production belum dikonfigurasi.')};
   // Proxy forwards the signed Keycloak access token. Never trust email/role headers.
   const token=request.headers.get('x-rticore-oidc-token');
   if(!token)return {error:deny(401,'Login SSO diperlukan.')};
   try{
     let keys=cache.get(issuer);
     if(!keys){keys=createRemoteJWKSet(new URL(issuer+'/protocol/openid-connect/certs'));cache.set(issuer,keys);}
     const verified=await jwtVerify(token,keys,{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email','email_verified','azp'],clockTolerance:5,maxTokenAge:'15m'});
     const payload=verified.payload;
     if(payload.email_verified!==true||payload.azp!==client||typeof payload.email!=='string'||typeof payload.sub!=='string'||!payload.sub)
       return {error:deny(403,'Identitas OIDC tidak memenuhi kebijakan akses.')};
     return {email:payload.email.trim().toLowerCase()};
   }catch{return {error:deny(401,'Token SSO tidak valid atau kedaluwarsa.')};}
 }
 if(env.RTICORE_LOCAL_MODE==='1'){
   if(!validSessionSecret(env.RTICORE_LOCAL_SESSION_SECRET))
    return {error:deny(503,'Mode lokal belum dikonfigurasi. Jalankan: npm run local:setup')};
   const email=await emailFromLocalSession(request.headers.get('cookie'),env.RTICORE_LOCAL_SESSION_SECRET);
   return email?{email}:{error:deny(401,'Login lokal diperlukan. Buka /login.')};
 }
 const domain=env.RTICORE_ACCESS_TEAM_DOMAIN, aud=env.RTICORE_ACCESS_AUD;
 if(!domain||!aud||!domain.endsWith('.cloudflareaccess.com')||aud.length<30)
  return {error:deny(503,'Database atau autentikasi RTICORE belum dikonfigurasi.')};
 const token=request.headers.get('cf-access-jwt-assertion');
 if(!token)return {error:deny(401,'Login Cloudflare Access diperlukan.')};
 try{
   let keys=cache.get(domain);
   if(!keys){keys=createRemoteJWKSet(new URL('https://'+domain+'/cdn-cgi/access/certs'));cache.set(domain,keys);}
   const verified=await jwtVerify(token,keys,{issuer:'https://'+domain,audience:aud,algorithms:['RS256'],clockTolerance:30});
   return {email:String(verified.payload.email||'').trim().toLowerCase()};
 }catch{return {error:deny(401,'Token login Access tidak valid atau kedaluwarsa.')};}
}
export async function authorizeBoQ(request:Request,options:{ignoreRolePreview?:boolean}={}):Promise<Result>{
 let env:CloudEnv;
 try {env=await getRuntimeEnv<CloudEnv>();}catch{return deny(503,'D1 runtime tidak tersedia');}
 const db=env.RTICORE_DB;
 if(!db)return deny(503,'Database atau autentikasi RTICORE belum dikonfigurasi.');
 const identity=await verifiedEmail(request,env);
 if('error' in identity)return identity.error;
 try{
   const email=identity.email;
   if(!email.includes('@'))return deny(403,'Identitas email tidak valid.');
   const member=await db.prepare('SELECT role,active FROM rticore_members WHERE email=?').bind(email).first<{role:BoQRole;active:number}>();
   if(!member||member.active!==1||!['admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer'].includes(member.role))
    return deny(403,'Akun belum diberi akses sesuai peran.');
   // Only a verified active Admin may voluntarily downscope to a different role.
   // Untrusted cookies from non-Admins are always ignored (no role elevation).
   const role=options.ignoreRolePreview?member.role:
     rolePreviewFromCookie(request.headers.get('cookie'),email,member.role)||member.role;
   // Identity must remain readable to an authenticated member even when an
   // institution policy denies the preview role access to other Sales APIs.
   const path=new URL(request.url).pathname;
   // Offense Team roles are allow-listed per API, so handlers written as deny-lists
   // (e.g. "everyone except project_manager") never widen their access.
   if(!offenseRouteAllowed(path,role))return deny(403,'API ini tidak tersedia untuk role Offense Team.');
   // Governance Team roles use the same allow-list model (governance-team.ts).
   if(!governanceRouteAllowed(path,role))return deny(403,'API ini tidak tersedia untuk role Governance Team.');
   // SOC Defense Team roles are allow-listed per API the same way (src/lib/defense-routes.ts).
   if(!defenseRouteAllowed(path,role))return deny(403,'API ini tidak tersedia untuk role Defense Team (SOC).');
   // IT Developer Team roles: same allow-list model plus read-only platform diagnostics (itdev-team.ts).
   if(!itdevRouteAllowed(path,role))return deny(403,'API ini tidak tersedia untuk role IT Developer Team.');
   try{if(path!=='/api/sales/identity'&&await accessRestricted(db,path,role))return deny(403,'Resource dibatasi oleh Access Policy institusi.');}catch{return deny(503,'Access Policy belum siap; verifikasi migrasi administrasi.');}
   return {ok:true,identity:{email,role,assignedRole:member.role,rolePreview:role!==member.role,db}};
 }catch{return deny(503,'Database RTICORE tidak dapat dibaca.');}
}
export const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'} as const;
