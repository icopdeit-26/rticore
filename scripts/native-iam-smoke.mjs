// Read-only deployment probes. No credentials, OTP seeds or token values are logged.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export async function smoke(env=process.env,fetcher=fetch){
 const origin=env.RTICORE_PUBLIC_ORIGIN;
 const url=new URL(origin||'');
 assert.equal(url.protocol,'https:');assert.equal(url.origin,origin);assert.ok(!url.username&&!url.password);
 const mode=env.RTICORE_AUTH_MODE||'business';assert.ok(['business','oidc'].includes(mode));
 const req=(path,options={})=>fetcher(new URL(path,url),{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),...options});
 const login=await req('/login');assert.equal(login.status,200,'public login shell must load');
 const html=await login.text();assert.match(html,/RTICORE/i);assert.doesNotMatch(html,/Masuk dengan Cloudflare Access/);
 const config=await req('/api/local-auth');assert.equal(config.status,200,'native auth configuration must load');
 const c=await config.json();assert.equal(c.localMode,false);assert.equal(c.authMode,mode);assert.ok(!('members' in c),'must not expose member list');
 for(const path of ['/api/sales/identity','/api/finance','/api/platform/diagnostics']){
  for(const headers of [{},{'x-rticore-oidc-token':'forged','cf-access-jwt-assertion':'forged','x-finance-role':'admin'}]){
   const res=await req(path,{headers});assert.ok([401,403].includes(res.status),'anonymous/forged request must be denied: '+path);
  }
 }
 const local=await req('/api/local-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.ok([403,404].includes(local.status),'local login mutation must be disabled');
 if(mode==='business'){
  assert.match(html,/Masuk dengan MFA/);assert.doesNotMatch(html,/Masuk dengan SSO \+ MFA/);
  // Wrong-origin request is denied before database access; no credential guessing or session mutation.
  const invalid=await req('/api/business-auth',{method:'POST',headers:{origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(invalid.status,403,'cross-origin Business IAM request must be rejected');
 }else{
  const begin=await req('/oauth2/start?rd=%2Flogin');assert.ok([302,303,307,308].includes(begin.status),'SSO start must redirect');
  const issuer=new URL(env.RTICORE_OIDC_ISSUER||'');const target=new URL(begin.headers.get('location')||'',url);assert.equal(target.origin,issuer.origin,'unexpected identity provider');assert.ok(target.pathname.startsWith(issuer.pathname+'/protocol/openid-connect/auth'));
 }
 return {public_boundary:'PASS',mode,authenticated_mfa:'NOT_TESTED'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await smoke();console.log(JSON.stringify(result));}catch{console.error('Native IAM public boundary smoke failed; verify canonical origin, deployment and auth mode. No credentials logged.');process.exitCode=1;}
}
