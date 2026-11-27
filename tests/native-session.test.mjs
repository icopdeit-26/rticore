import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRequestOriginAllowed,requireActiveNativeSession} from '../src/lib/native-session.ts';
const origin='https://rticore.example.invalid';
const cfg={issuer:'https://sso.example.invalid/realms/rticore',clientId:'proxy',clientSecret:'test-only'};
test('native mutation rejects missing, foreign, null and cross-site origins',()=>{
 for(const value of [undefined,'null','https://evil.invalid',origin+'/path']){
  const request=new Request(origin+'/api/finance',{method:'POST',headers:value?{origin:value}:{}});
  assert.equal(nativeRequestOriginAllowed(request,origin),false);
 }
 assert.equal(nativeRequestOriginAllowed(new Request(origin,{method:'POST',headers:{origin,'sec-fetch-site':'cross-site'}}),origin),false);
 assert.equal(nativeRequestOriginAllowed(new Request(origin,{method:'POST',headers:{origin}}),origin),true);
 assert.equal(nativeRequestOriginAllowed(new Request(origin),origin),true);
});
test('introspection accepts active matching session and never caches',async()=>{
 let calls=0;
 const fake=async(url,opts)=>{calls++;assert.equal(url,cfg.issuer+'/protocol/openid-connect/token/introspect');assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');assert.equal(opts.body.get('token'),'synthetic');return Response.json({active:true,sub:'one'});};
 await requireActiveNativeSession('synthetic',cfg,'one',fake);await requireActiveNativeSession('synthetic',cfg,'one',fake);assert.equal(calls,2);
});
test('introspection fails closed on inactive session, wrong subject and outage',async()=>{
 for(const fake of [async()=>Response.json({active:false,sub:'one'}),async()=>Response.json({active:true,sub:'other'}),async()=>new Response('',{status:503}),async()=>{throw Error('network');}])await assert.rejects(requireActiveNativeSession('synthetic',cfg,'one',fake));
});

test('native mutation denies insecure or noncanonical trusted origins',()=>{
 for(const origin of ['', 'null','http://rticore.example.invalid','https://rticore.example.invalid/path','https://user@rticore.example.invalid','https://rticore.example.invalid/']){
  assert.equal(nativeRequestOriginAllowed(new Request('https://rticore.example.invalid',{method:'POST',headers:{origin}}),origin),false);
 }
});

test('introspection rejects invalid inputs and insecure issuers before network access',async()=>{
 const never=async()=>{assert.fail('unexpected network call');};
 for(const token of ['', 'x'.repeat(16385)]) await assert.rejects(requireActiveNativeSession(token,cfg,'one',never));
 await assert.rejects(requireActiveNativeSession('synthetic',cfg,'',never));
 for(const issuer of ['http://sso.example.invalid','https://user@sso.example.invalid','https://sso.example.invalid?x=1','https://sso.example.invalid#fragment']) await assert.rejects(requireActiveNativeSession('synthetic',{...cfg,issuer},'one',never));
});
test('introspection rejects malformed response bodies',async()=>{
 for(const data of [null,[],true,'active',{}]) await assert.rejects(requireActiveNativeSession('synthetic',cfg,'one',async()=>Response.json(data)));
});
