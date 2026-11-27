import test from 'node:test';import assert from 'node:assert/strict';import {checkNativeCompletion,REQUIRED_NATIVE_COMMANDS} from '../scripts/hostinger-native-completion.mjs';
import {verifyNativeReceipt,NATIVE_GATES} from '../scripts/native-release-certification.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {generateKeyPairSync,sign} from 'node:crypto';
test('latest native command preflight is read-only and fails closed on missing inventory',async()=>{
 const commands=REQUIRED_NATIVE_COMMANDS.map(signature=>({signature,present:true}));
 const objects={boq:true,budget_index:true,journal_guard:true,workflow_guard:true};
 const run=(a,b)=>checkNativeCompletion({query:async(sql,args)=>{assert.match(sql,/^SELECT/);return {rows:args?a:[b]};}});
 assert.equal((await run(commands,objects)).applied_ledger_verified,false);
 await assert.rejects(run(commands.slice(1),objects),/command inventory incomplete/);
 await assert.rejects(run(commands,{...objects,workflow_guard:false}),/object inventory incomplete/);
});
test('native release refuses missing authority, legacy Cloudflare receipt and unsigned evidence',()=>{
 assert.throws(()=>verifyNativeReceipt({sha:'a'.repeat(40),camsSha:'b'.repeat(40)}),/NATIVE_SIGNED_RECEIPT_REQUIRED/);
 const dir=mkdtempSync(join(tmpdir(),'native-release-test-')),receiptPath=join(dir,'receipt.json');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 try{
  const payload={schema_version:1,release_sha:'a'.repeat(40),target:'cloudflare'};
  const save=()=>writeFileSync(receiptPath,JSON.stringify({payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64')}));
  save();const check=()=>verifyNativeReceipt({receiptPath,publicKey:publicKey.export({type:'spki',format:'pem'}),sha:'a'.repeat(40),camsSha:'b'.repeat(40)});
  assert.throws(check,/NATIVE_TARGET_OR_SHA_MISMATCH/);
  Object.assign(payload,{schema_version:2,cams_release_sha:'b'.repeat(40),target:'hostinger_business_web_hosting',origin:'https://rticore.store',database_engine:'postgres',auth_method:'native_business_totp',ai_provider:'openai',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),gates:NATIVE_GATES.map(id=>({id,status:'BLOCKED'}))});
  save();assert.throws(check,/GATE_NOT_PASS_exact_sha_ci/);
  payload.gates=[];save();assert.throws(check,/INCOMPLETE_NATIVE_GATES/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
