import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
const params={N:32768,r:8,p:3,maxmem:64*1024*1024};
const derive=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,params,(err,key)=>err?reject(err):resolve(key)));
export const validPassword=(p:unknown):p is string=>typeof p==='string'&&Buffer.byteLength(p)>=14&&Buffer.byteLength(p)<=128;
export const validEmail=(e:unknown):e is string=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export async function hashPassword(p:string){if(!validPassword(p))throw Error('Invalid password length');const salt=randomBytes(16);return salt.toString('hex')+':'+(await derive(p,salt)).toString('hex');}
export async function verifyPassword(p:string,stored:string|null){
 if(!validPassword(p))return false;
 const valid=typeof stored==='string'&&/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored);
 const [salt,expected]=(valid?stored!:'0'.repeat(32)+':'+'0'.repeat(64)).split(':');
 const match=timingSafeEqual(await derive(p,Buffer.from(salt,'hex')),Buffer.from(expected,'hex'));
 return valid&&match;
}
export const newToken=()=>randomBytes(32).toString('base64url');
export const tokenHash=(t:string)=>createHash('sha256').update(t).digest('hex');
export const validToken=(t:unknown):t is string=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t);
export function iamKey(value=process.env.RTICORE_IAM_ENCRYPTION_KEY){if(!value||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error('IAM key unavailable');const key=Buffer.from(value,'base64');if(key.length!==32)throw Error('IAM key unavailable');return key;}
export function encryptSeed(seed:Buffer,email:string,key=iamKey()){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('RTICORE-IAM-v1:'+email));return Buffer.concat([iv,c.update(seed),c.final(),c.getAuthTag()]).toString('base64');
}
export function decryptSeed(cipher:string,email:string,key=iamKey()){
 const raw=Buffer.from(cipher,'base64');if(raw.length!==48)throw Error('Invalid seed');const d=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));d.setAAD(Buffer.from('RTICORE-IAM-v1:'+email));d.setAuthTag(raw.subarray(32));return Buffer.concat([d.update(raw.subarray(12,32)),d.final()]);
}
export function base32(seed:Buffer){let bits=0,v=0,s='';for(const b of seed){v=(v<<8)|b;bits+=8;while(bits>=5){s+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(v>>>(bits-=5))&31];}}if(bits)s+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(v<<(5-bits))&31];return s;}
export function totpCode(seed:Buffer,step:number){const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',seed).update(b).digest();const i=h[h.length-1]&15;return String((h.readUInt32BE(i)&0x7fffffff)%1000000).padStart(6,'0');}
export function totpStep(seed:Buffer,code:unknown,now=Date.now()):number|null{
 if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
 const step=Math.floor(now/30000);let match:number|null=null;
 for(const s of [step-1,step,step+1])if(s>=0&&timingSafeEqual(Buffer.from(code),Buffer.from(totpCode(seed,s))))match=s;
 return match;
}
export const SESSION_COOKIE='__Host-rticore_session';
export function readSessionCookie(header:string|null):string|null{const entries=(header||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(SESSION_COOKIE+'='));if(entries.length!==1)return null;const t=entries[0].slice(SESSION_COOKIE.length+1);return validToken(t)?t:null;}
