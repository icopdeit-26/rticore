import type {D1DB} from './boq-auth';
import {base32,decryptSeed,hashPassword,iamKey,newToken,tokenHash,totpStep,validEmail,validPassword,validToken,verifyPassword} from './business-iam-crypto';
export const PORTAL_COOKIE='__Host-rticore_fg_portal';
export function portalEnabled(){return process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_AUTH_MODE==='business'&&process.env.RTICORE_FLEXGUARD_ENTERPRISE_ENABLED==='1'&&process.env.RTICORE_FLEXGUARD_PORTAL_ENABLED==='1';}
export function portalKey(){const key=process.env.RTICORE_PORTAL_IAM_KEY;if(!key||key===process.env.RTICORE_IAM_ENCRYPTION_KEY)throw Error('Separate portal key required');return iamKey(key);}
function cookieToken(header:string|null){const rows=(header||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(PORTAL_COOKIE+'='));if(rows.length!==1)return null;const t=rows[0].slice(PORTAL_COOKIE.length+1);return validToken(t)?t:null;}
async function rate(db:D1DB,kind:string,identity:string){
 const sql='INSERT INTO rticore_native_fg_portal_rate(bucket,window_id,attempts) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN rticore_native_fg_portal_rate.window_id=excluded.window_id THEN rticore_native_fg_portal_rate.attempts+1 ELSE 1 END,window_id=excluded.window_id WHERE rticore_native_fg_portal_rate.window_id<>excluded.window_id OR rticore_native_fg_portal_rate.attempts<? RETURNING attempts';
 return !!await db.prepare(sql).bind('global',Math.floor(Date.now()/60000),60).first()&&!!await db.prepare(sql).bind(kind+':'+tokenHash(identity).slice(0,3),Math.floor(Date.now()/900000),5).first();
}
const eligibility="a.active AND NOT EXISTS(SELECT 1 FROM rticore_members m WHERE lower(m.email)=a.email) AND EXISTS(SELECT 1 FROM rticore_native_fg_portal_grant g WHERE g.email=a.email AND rticore_native_fg_portal_allowed(g.tenant_id,g.legal_entity_id,g.wallet_id,a.email))";
const credential="SELECT c.email,c.password_hash,c.totp_cipher FROM rticore_native_fg_portal_credential c JOIN rticore_native_fg_portal_account a ON a.email=c.email WHERE "+eligibility+" AND ";
type Credential={email:string;password_hash:string|null;totp_cipher:string};
export async function portalEnrollmentDetails(db:D1DB,invite:unknown){
 if(!validToken(invite)||!await rate(db,'invite',invite))return null;
 const row=await db.prepare(credential+'c.invite_hash=? AND c.invite_expires>now() AND c.enrolled_at IS NULL').bind(tokenHash(invite)).first<Credential>();
 return row?{email:row.email,seed:base32(decryptSeed(row.totp_cipher,'portal:'+row.email,portalKey()))}:null;
}
export async function portalEnroll(db:D1DB,invite:unknown,password:unknown,otp:unknown){
 if(!validToken(invite)||!validPassword(password)||!await rate(db,'enroll',invite))return false;
 const row=await db.prepare(credential+'c.invite_hash=? AND c.invite_expires>now() AND c.enrolled_at IS NULL').bind(tokenHash(invite)).first<Credential>();
 if(!row)return false;const step=totpStep(decryptSeed(row.totp_cipher,'portal:'+row.email,portalKey()),otp);if(step===null)return false;
 const hash=await hashPassword(password);
 return !!await db.prepare("WITH changed AS (UPDATE rticore_native_fg_portal_credential c SET password_hash=?,last_totp_step=?,invite_hash=NULL,invite_expires=NULL,enrolled_at=now() FROM rticore_native_fg_portal_account a WHERE c.email=? AND c.invite_hash=? AND c.invite_expires>now() AND c.enrolled_at IS NULL AND a.email=c.email AND "+eligibility+" RETURNING c.email) INSERT INTO rticore_native_fg_portal_audit(email,action) SELECT email,'enrolled' FROM changed RETURNING email").bind(hash,step,row.email,tokenHash(invite)).first();
}
export async function portalLogin(db:D1DB,emailInput:unknown,password:unknown,otp:unknown){
 if(typeof emailInput!=='string'||!validPassword(password))return null;const email=emailInput.trim().toLowerCase();if(!validEmail(email)||!await rate(db,'login',email))return null;
 const row=await db.prepare(credential+'c.email=? AND c.enrolled_at IS NOT NULL').bind(email).first<Credential>();
 const verified=await verifyPassword(password,row?.password_hash||null);if(!row||!verified)return null;
 const step=totpStep(decryptSeed(row.totp_cipher,'portal:'+email,portalKey()),otp);if(step===null)return null;
 const token=newToken();
 const result=await db.prepare("WITH changed AS (UPDATE rticore_native_fg_portal_credential c SET last_totp_step=? FROM rticore_native_fg_portal_account a WHERE c.email=? AND c.last_totp_step<? AND c.password_hash=? AND c.totp_cipher=? AND c.enrolled_at IS NOT NULL AND a.email=c.email AND "+eligibility+" RETURNING c.email), inserted AS (INSERT INTO rticore_native_fg_portal_session(token_hash,email,expires_at) SELECT ?,email,now()+interval '8 hours' FROM changed RETURNING email) INSERT INTO rticore_native_fg_portal_audit(email,action) SELECT email,'login' FROM inserted RETURNING email").bind(step,email,step,row.password_hash,row.totp_cipher,tokenHash(token)).first();
 return result?token:null;
}
export async function portalSession(db:D1DB,req:Request){
 const token=cookieToken(req.headers.get('cookie'));if(!token)return null;
 const row=await db.prepare("UPDATE rticore_native_fg_portal_session s SET last_seen=now() FROM rticore_native_fg_portal_account a WHERE s.token_hash=? AND a.email=s.email AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND "+eligibility+" RETURNING s.email").bind(tokenHash(token)).first<{email:string}>();
 return row?.email||null;
}
export async function portalLogout(db:D1DB,req:Request){
 const token=cookieToken(req.headers.get('cookie'));if(token)await db.prepare("WITH deleted AS (DELETE FROM rticore_native_fg_portal_session WHERE token_hash=? RETURNING email) INSERT INTO rticore_native_fg_portal_audit(email,action) SELECT email,'logout' FROM deleted").bind(tokenHash(token)).run();
}
