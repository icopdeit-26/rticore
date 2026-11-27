export function nativeRequestOriginAllowed(request:Request, origin:string):boolean {
 if(['GET','HEAD','OPTIONS'].includes(request.method))return true;
 return request.headers.get('origin')===origin && request.headers.get('sec-fetch-site')!=='cross-site';
}
export async function requireActiveNativeSession(token:string, config:{issuer:string;clientId:string;clientSecret:string}, subject:string, fetcher:typeof fetch=fetch):Promise<void>{
 const res=await fetcher(config.issuer+'/protocol/openid-connect/token/introspect',{
  method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
  headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
  body:new URLSearchParams({token,token_type_hint:'access_token',client_id:config.clientId,client_secret:config.clientSecret})
 });
 if(!res.ok)throw new Error('Session verification unavailable');
 const data=await res.json();
 if(data.active!==true||data.sub!==subject)throw new Error('Session revoked or invalid');
}
