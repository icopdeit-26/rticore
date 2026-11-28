import type {D1DB} from './boq-auth';
import {base32,decryptSeed,hashPassword,newToken,readSessionCookie,tokenHash,totpStep,validEmail,validPassword,validToken,verifyPassword} from './business-iam-crypto';
type Credential={email:string;password_hash:string|null;totp_cipher:string};
export async function rateAllowed(db:D1DB,kind:string,identity:string){
 // Bounded bucket count. Use PostgreSQL time across instances; delayed requests cannot reset a newer window.
 const bucket=kind+':'+tokenHash(identity).slice(0,3);
 const sql='INSERT INTO rticore_iam_rate(bucket,window_id,attempts) VALUES(?,floor(extract(epoch from statement_timestamp())/CAST(? AS bigint))::bigint,1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN rticore_iam_rate.window_id=excluded.window_id THEN rticore_iam_rate.attempts+1 ELSE 1 END,window_id=excluded.window_id WHERE rticore_iam_rate.window_id<excluded.window_id OR (rticore_iam_rate.window_id=excluded.window_id AND rticore_iam_rate.attempts<?) RETURNING attempts';
 const global=await db.prepare(sql).bind('global',60,120).first();
 if(!global)return false;
 return !!await db.prepare(sql).bind(bucket,900,5).first();
}
const credentialSQL='SELECT c.email,c.password_hash,c.totp_cipher FROM rticore_iam_credentials c JOIN rticore_members m ON m.email=c.email AND m.active=1 ';
export async function enrollmentDetails(db:D1DB,token:unknown){
 if(!validToken(token))return null;
 if(!await rateAllowed(db,'invite',token))return null;
 const row=await db.prepare(credentialSQL+'WHERE c.invite_hash=? AND c.invite_expires>now() AND c.enrolled_at IS NULL').bind(tokenHash(token)).first<Credential>();
 if(!row)return null;
 return {email:row.email,seed:base32(decryptSeed(row.totp_cipher,row.email))};
}
export async function enroll(db:D1DB,token:unknown,password:unknown,otp:unknown){
 if(!validToken(token)||!validPassword(password)||!await rateAllowed(db,'enroll',token))return false;
 const row=await db.prepare(credentialSQL+'WHERE c.invite_hash=? AND c.invite_expires>now() AND c.enrolled_at IS NULL').bind(tokenHash(token)).first<Credential>();
 if(!row)return false;
 const step=totpStep(decryptSeed(row.totp_cipher,row.email),otp);if(step===null)return false;
 const hash=await hashPassword(password);
 return !!await db.prepare("WITH changed AS (UPDATE rticore_iam_credentials SET password_hash=?,last_totp_step=?,invite_hash=NULL,invite_expires=NULL,enrolled_at=now() WHERE email=? AND invite_hash=? AND invite_expires>now() AND enrolled_at IS NULL AND EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=rticore_iam_credentials.email AND m.active=1) RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'enrolled' FROM changed RETURNING email").bind(hash,step,row.email,tokenHash(token)).first();
}
export async function loginBusiness(db:D1DB,emailInput:unknown,password:unknown,otp:unknown){
 if(typeof emailInput!=='string'||!validPassword(password))return null;
 const email=emailInput.trim().toLowerCase();if(!validEmail(email)||!await rateAllowed(db,'login',email))return null;
 const row=await db.prepare(credentialSQL+'WHERE c.email=? AND c.enrolled_at IS NOT NULL').bind(email).first<Credential>();
 const verified=await verifyPassword(password,row?.password_hash||null);
 if(!row||!verified)return null;
 const step=totpStep(decryptSeed(row.totp_cipher,email),otp);if(step===null)return null;
 const token=newToken();
 const result=await db.prepare("WITH changed AS (UPDATE rticore_iam_credentials SET last_totp_step=? WHERE email=? AND last_totp_step<? AND password_hash=? AND totp_cipher=? AND enrolled_at IS NOT NULL AND EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=rticore_iam_credentials.email AND m.active=1) RETURNING email), inserted AS (INSERT INTO rticore_iam_sessions(token_hash,email,expires_at) SELECT ?,email,now()+interval '8 hours' FROM changed RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'login' FROM inserted RETURNING email").bind(step,email,step,row.password_hash,row.totp_cipher,tokenHash(token)).first();
 return result?token:null;
}
export async function verifyBusinessSession(db:D1DB,request:Request){
 const t=readSessionCookie(request.headers.get('cookie'));if(!t)return null;
 const row=await db.prepare("UPDATE rticore_iam_sessions s SET last_seen=now() FROM rticore_members m WHERE s.token_hash=? AND m.email=s.email AND m.active=1 AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' RETURNING s.email").bind(tokenHash(t)).first<{email:string}>();
 return row?.email||null;
}
export async function logoutBusiness(db:D1DB,request:Request){
 const t=readSessionCookie(request.headers.get('cookie'));if(!t)return;
 await db.prepare("WITH deleted AS (DELETE FROM rticore_iam_sessions WHERE token_hash=? RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'logout' FROM deleted").bind(tokenHash(t)).run();
}
