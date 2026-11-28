export function nativeRequestOriginAllowed(request:Request, origin:string):boolean {
 if(['GET','HEAD','OPTIONS'].includes(request.method))return true;
 // Never accept an absent/malformed trusted origin, even if a caller supplies a matching header.
 try {
  const parsed=new URL(origin);
  if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)return false;
 }catch{return false;}
 return request.headers.get('origin')===origin && request.headers.get('sec-fetch-site')!=='cross-site';
}
export async function requireActiveNativeSession(token:string, config:{issuer:string;clientId:string;clientSecret:string}, subject:string, fetcher:typeof fetch=fetch):Promise<void>{
 if(!token||token.length>16384||!subject)throw new Error('Invalid session input');
 const issuer=new URL(config.issuer);
 if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash)throw new Error('Invalid session issuer');
 const res=await fetcher(config.issuer+'/protocol/openid-connect/token/introspect',{
  method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
  headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
  body:new URLSearchParams({token,token_type_hint:'access_token',client_id:config.clientId,client_secret:config.clientSecret})
 });
 if(!res.ok)throw new Error('Session verification unavailable');
 const data=await res.json();
 if(!data||typeof data!=='object'||Array.isArray(data)||data.active!==true||data.sub!==subject)throw new Error('Session revoked or invalid');
}
