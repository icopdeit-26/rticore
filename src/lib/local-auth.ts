/**
 * Local-mode session (RTICORE_LOCAL_MODE=1 only). Replaces the Cloudflare
 * Access JWT when the app runs entirely on this computer.
 *
 * The cookie only carries an email + expiry signed with HMAC-SHA256 using
 * RTICORE_LOCAL_SESSION_SECRET. Role and active status are ALWAYS re-read
 * from rticore_members on every request by authorizeBoQ, exactly as in cloud
 * mode, so a cookie can never grant a role by itself.
 */
export const LOCAL_SESSION_COOKIE='rticore_local_session';
export const LOCAL_SESSION_TTL_SECONDS=12*3600;
const utf8=new TextEncoder();

const b64url=(bytes:Uint8Array)=>btoa(Array.from(bytes,x=>String.fromCharCode(x)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64url=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));

export function validSessionSecret(secret:string|undefined):secret is string{
  return typeof secret==='string'&&secret.length>=32;
}
async function hmac(secret:string,data:string):Promise<Uint8Array>{
  const key=await crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8.encode('RTICORE-LOCAL-SESSION-v1:'+data)));
}
function equal(a:Uint8Array,b:Uint8Array){
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}

export async function createLocalSession(secret:string,email:string,now=Date.now()):Promise<string>{
  const payload=b64url(utf8.encode(email.trim().toLowerCase()))+'.'+String(now+LOCAL_SESSION_TTL_SECONDS*1000);
  return payload+'.'+b64url(await hmac(secret,payload));
}

export async function emailFromLocalSession(cookieHeader:string|null,secret:string|undefined,now=Date.now()):Promise<string|null>{
  if(!cookieHeader||!validSessionSecret(secret))return null;
  const raw=cookieHeader.split(';').map(s=>s.trim()).find(s=>s.startsWith(LOCAL_SESSION_COOKIE+'='));
  if(!raw)return null;
  const parts=raw.slice(LOCAL_SESSION_COOKIE.length+1).split('.');
  if(parts.length!==3)return null;
  const [mail,until,sig]=parts;
  const expiry=Number(until);
  if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+LOCAL_SESSION_TTL_SECONDS*1000)return null;
  try{
    if(!equal(fromB64url(sig),await hmac(secret,mail+'.'+until)))return null;
    const email=new TextDecoder().decode(fromB64url(mail));
    return email.includes('@')?email:null;
  }catch{return null;}
}

/** Local login/logout endpoints only accept requests addressed to this computer. */
export function isLoopbackRequest(request:Request):boolean{
  const host=new URL(request.url).hostname.replace(/^\[|\]$/g,'');
  return host==='localhost'||host==='127.0.0.1'||host==='::1'||host.endsWith('.localhost');
}
