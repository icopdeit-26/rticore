import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {verifyNativeOIDCToken} from '../src/lib/native-oidc.ts';
const cfg={issuer:'https://sso.example.invalid/realms/rticore',audience:'rticore-api',clientId:'rticore-proxy'};
const good=await generateKeyPair('RS256'), bad=await generateKeyPair('RS256');
const jwk=await exportJWK(good.publicKey);
const keys=createLocalJWKSet({keys:[{...jwk,kid:'test',alg:'RS256',use:'sig'}]});
const now=Math.floor(Date.now()/1000);
const claims={iss:cfg.issuer,aud:cfg.audience,azp:cfg.clientId,sub:'subject-1',sid:'session-1',email:'Admin@example.invalid',email_verified:true,typ:'Bearer',iat:now,exp:now+300};
async function sign(patch={},key=good.privateKey){
 return new SignJWT({...claims,...patch}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(key);
}
test('signed access token accepted and email normalized',async()=>assert.deepEqual(await verifyNativeOIDCToken(await sign(),cfg,keys),{email:'admin@example.invalid',subject:'subject-1'}));
for(const [name,patch] of Object.entries({issuer:{iss:'https://evil.invalid'},audience:{aud:'other'},client:{azp:'other'},expired:{iat:now-600,exp:now-60},future:{iat:now+600,exp:now+900},lifetime:{exp:now+3600},old:{iat:now-1000,exp:now+100},unverified:{email_verified:false},missingEmail:{email:undefined},invalidEmail:{email:'invalid'},missingSubject:{sub:undefined},missingSession:{sid:undefined},idToken:{typ:'ID'},missingExpiry:{exp:undefined},notYetValid:{nbf:now+300}})){
 test('reject '+name,async()=>assert.rejects(verifyNativeOIDCToken(await sign(patch),cfg,keys)));
}
test('reject wrong signature',async()=>assert.rejects(verifyNativeOIDCToken(await sign({},bad.privateKey),cfg,keys)));
test('reject forged token and empty token',async()=>{for(const t of ['','abc.def.ghi','x'.repeat(16385)])await assert.rejects(verifyNativeOIDCToken(t,cfg,keys));});
