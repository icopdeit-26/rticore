import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
const N=131072,r=8,p=1,maxmem=160*1024*1024;
function derive(password:string,salt:Buffer):Promise<Buffer>{
 return new Promise((resolve,reject)=>scrypt(password,salt,32,{N,r,p,maxmem},(error,key)=>error?reject(error):resolve(key)));
}
export async function hashNativePassword(password:string):Promise<string>{
 if(password.length<15||Buffer.byteLength(password,'utf8')>512)throw new Error('Password must be 15 characters or longer and at most 512 bytes.');
 const salt=randomBytes(16);
 return 'scrypt-v1:'+salt.toString('hex')+':'+(await derive(password,salt)).toString('hex');
}
export async function verifyNativePassword(password:string,encoded:string):Promise<boolean>{
 if(Buffer.byteLength(password,'utf8')>512)return false;
 const match=/^scrypt-v1:([0-9a-f]{32}):([0-9a-f]{64})$/.exec(encoded);
 if(!match)return false;
 const derived=await derive(password,Buffer.from(match[1],'hex'));
 return timingSafeEqual(derived,Buffer.from(match[2],'hex'));
}
