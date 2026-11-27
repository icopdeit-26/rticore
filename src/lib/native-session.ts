import {createHash} from 'node:crypto';
import type {D1DB} from './boq-auth';

export const NATIVE_SESSION_COOKIE='__Host-rticore_session';
export const sessionDigest=(token:string)=>createHash('sha256').update(token).digest('hex');

export async function nativeSessionEmail(request:Request,db:D1DB):Promise<string|null>{
 const cookies=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(NATIVE_SESSION_COOKIE+'='));
 if(cookies.length!==1)return null;
 const token=cookies[0].slice(NATIVE_SESSION_COOKIE.length+1);
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const now=Date.now();
 const row=await db.prepare('UPDATE rticore_native_sessions SET last_seen=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND last_seen>? AND mfa_verified=1 AND EXISTS (SELECT 1 FROM rticore_members m WHERE m.email=rticore_native_sessions.email AND m.active=1) RETURNING email').bind(now,sessionDigest(token),now,now-30*60*1000).first<{email:string}>();
 return row?.email||null;
}
