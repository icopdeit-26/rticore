// Read-only deployment probes. No passwords, OTP seeds or token contents are logged.
import assert from 'node:assert/strict';
const origin=process.env.RTICORE_PUBLIC_ORIGIN;
const url=new URL(origin||'');
assert.equal(url.protocol,'https:');assert.equal(url.origin,origin);assert.ok(!url.username&&!url.password);
const req=(path,headers={})=>fetch(new URL(path,url),{redirect:'manual',headers,cache:'no-store',signal:AbortSignal.timeout(10000)});
const login=await req('/login');assert.equal(login.status,200,'public login shell must load');
const html=await login.text();assert.match(html,/RTICORE/i);assert.doesNotMatch(html,/Masuk dengan Cloudflare Access/);
for(const path of ['/api/sales/identity','/api/finance','/api/platform/diagnostics','/api/local-auth']){
 for(const headers of [{},{'x-rticore-oidc-token':'forged','cf-access-jwt-assertion':'forged','x-finance-role':'admin'}]){
  const res=await req(path,headers);assert.ok([401,403].includes(res.status),'anonymous/forged request must be denied: '+path);
 }
}
const begin=await req('/oauth2/start?rd=%2Flogin');assert.ok([302,303,307,308].includes(begin.status),'SSO start must redirect');
const issuer=new URL(process.env.RTICORE_OIDC_ISSUER||'');const target=new URL(begin.headers.get('location')||'',url);assert.equal(target.origin,issuer.origin,'unexpected identity provider');assert.ok(target.pathname.startsWith(issuer.pathname+'/protocol/openid-connect/auth'));
console.log('PASS: public login, anonymous/forged API denial and native SSO redirect. Authenticated MFA, refresh, revocation and isolation still require live browser UAT.');
