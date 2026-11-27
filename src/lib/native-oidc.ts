import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export type NativeOIDCConfig = { issuer:string; audience:string; clientId:string };
const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyNativeOIDCToken(token:string, config:NativeOIDCConfig, keys?:JWTVerifyGetKey) {
 if (!token || token.length > 16384) throw new Error('Invalid access token');
 let resolver=keys ?? remoteKeys.get(config.issuer);
 if(!resolver){
   const remote=createRemoteJWKSet(new URL(config.issuer+'/protocol/openid-connect/certs'),{timeoutDuration:5000});
   remoteKeys.set(config.issuer,remote);
   resolver=remote;
 }
 const {payload}=await jwtVerify(token,resolver,{
   issuer:config.issuer,audience:config.audience,algorithms:['RS256'],
   requiredClaims:['exp','iat','sub','email','email_verified','azp','typ','sid'],
   clockTolerance:5,maxTokenAge:'15m'
 });
 if(payload.typ!=='Bearer'||payload.email_verified!==true||payload.azp!==config.clientId||
    typeof payload.email!=='string'||typeof payload.sub!=='string'||!payload.sub||typeof payload.sid!=='string'||!payload.sid||
    typeof payload.exp!=='number'||typeof payload.iat!=='number'||payload.exp<=payload.iat||payload.exp-payload.iat>900)
   throw new Error('Access token policy rejected');
 const email=payload.email.trim().toLowerCase();
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Invalid email claim');
 return {email,subject:payload.sub};
}
