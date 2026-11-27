import test from 'node:test';
import assert from 'node:assert/strict';
import {smoke} from '../scripts/native-iam-smoke.mjs';
const env={RTICORE_PUBLIC_ORIGIN:'https://staging.example',RTICORE_AUTH_MODE:'business'};
function fixture(mode='business',bad=false){
 const calls=[];
 const fetcher=async(url,options)=>{
 calls.push([url.pathname,options.method||'GET']);
 if(url.pathname==='/login')return new Response(mode==='business'?'RTICORE Masuk dengan MFA':'RTICORE Masuk dengan SSO + MFA');
 if(url.pathname==='/api/local-auth')return options.method==='POST'?new Response('',{status:404}):Response.json({localMode:false,authMode:mode});
 if(url.pathname==='/api/business-auth')return new Response('',{status:bad?200:403});
 if(url.pathname==='/oauth2/start')return new Response('',{status:302,headers:{location:'https://id.example/realm/protocol/openid-connect/auth'}});
 return new Response('',{status:401});
 };
 return {calls,fetcher};
}
test('Business IAM public smoke does not require OIDC and does not claim authenticated MFA',async()=>{
 const f=fixture();assert.deepEqual(await smoke(env,f.fetcher),{public_boundary:'PASS',mode:'business',authenticated_mfa:'NOT_TESTED'});
 assert.ok(!f.calls.some(([path])=>path==='/oauth2/start'));assert.ok(f.calls.some(([p,m])=>p==='/api/business-auth'&&m==='POST'));
});
test('Business IAM smoke fails closed on cross-origin acceptance',async()=>{await assert.rejects(smoke(env,fixture('business',true).fetcher));});
test('OIDC remains explicitly selectable',async()=>{const f=fixture('oidc');assert.equal((await smoke({...env,RTICORE_AUTH_MODE:'oidc',RTICORE_OIDC_ISSUER:'https://id.example/realm'},f.fetcher)).mode,'oidc');});
