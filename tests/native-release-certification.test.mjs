import {buildNativeReviewRegister} from '../scripts/native-uat-review-register.mjs';
import {financeGroups} from '../scripts/wave09-uat-evidence.mjs';
import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {checkNativeCompletion,REQUIRED_NATIVE_COMMANDS,assertNativeMfaEnrollment,expectedReviewDefinitions} from '../scripts/hostinger-native-completion.mjs';
import {verifyNativeReceipt,NATIVE_GATES,assertIndividualEvidence} from '../scripts/native-release-certification.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {generateKeyPairSync,sign,createHash} from 'node:crypto';
test('latest native command preflight is read-only and fails closed on missing inventory',async()=>{
 const commands=REQUIRED_NATIVE_COMMANDS.map(signature=>({signature,present:true}));
 const objects={boq:true,budget_index:true,feature_requests:true,feature_pending_index:true,jobs:true,jobs_due_index:true,job_recovery:true,recovery_pending_index:true,recovery_once_index:true,recovery_guard:true,feature_guard:true,journal_guard:true,workflow_guard:true};
 const definitions=expectedReviewDefinitions();
 const run=(a,b,d=definitions)=>checkNativeCompletion({query:async(sql,args)=>{assert.match(sql,/^SELECT/);return {rows:sql.includes('p.prosrc AS body')?d:args?a:[b]};}});
 assert.equal((await run(commands,objects)).applied_ledger_verified,false);
 await assert.rejects(run(commands.slice(1),objects),/command inventory incomplete/);
 await assert.rejects(run(commands,objects,definitions.slice(1)),/definition mismatch/);
 for(const field of ['body','language','volatility','security_definer','config']){
  const bad=definitions.map((d,i)=>i===0?{...d,[field]:null}:d);
  await assert.rejects(run(commands,objects,bad),/definition mismatch/);
 }
 for(const key of Object.keys(objects)) await assert.rejects(run(commands,{...objects,[key]:false}),/object inventory incomplete/);
 for(const signature of ['rticore_native_job_claim(text,text,text,text)','rticore_native_job_finish(text,text,text,text,text,boolean)']){
  assert.ok(REQUIRED_NATIVE_COMMANDS.includes(signature));
  await assert.rejects(run(commands.filter(c=>c.signature!==signature),objects),/command inventory incomplete/);
 }
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
  payload.expires_at='invalid';save();assert.throws(check,/STALE_NATIVE_RECEIPT/);
  payload.issued_at=new Date(Date.now()+60000).toISOString();payload.expires_at=new Date(Date.now()+120000).toISOString();save();assert.throws(check,/STALE_NATIVE_RECEIPT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('native MFA preflight accepts only distinct active enrolled administrators and fails closed',async()=>{
 const run=rows=>assertNativeMfaEnrollment({query:async sql=>{assert.match(sql,/^SELECT/);assert.match(sql,/count\(DISTINCT lower\(trim\(m.email\)\)\)/);assert.match(sql,/c.password_hash IS NOT NULL/);assert.match(sql,/c.invite_hash IS NULL/);assert.match(sql,/m.active=1 AND m.role='admin'/);return {rows};}});
 assert.equal(await run([{n:2}]),true);
 for(const rows of [[],[{}],[{n:null}],[{n:1}],[{n:'2'}],[{n:NaN}],[{n:2.5}],[{n:2},{n:2}]]) await assert.rejects(run(rows),/Two independently enrolled administrators/);
});

test('individual native UAT evidence rejects generic, replayed and mismatched records',()=>{
 const sha='a'.repeat(40),definition={id:'ERP-GL-001',scenario:'Post journal',expected:'Balanced',actor_role:'finance',approved_by:'reviewer'};
 const t={tester_subject:'tester',release_sha:sha,executed_at:'2026-11-28T00:00:00Z',actual_result:'Balanced journal',execution_kind:'authenticated_native_hostinger_staging'};
 const roster=[{subject:'tester',role:'finance'}],signoffs=[{subject:'reviewer',decision:'APPROVED',release_sha:sha}];
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const entry=(path,bytes)=>({ref:{path,sha256:hash(bytes)},bytes});
 const trace=entry('trace.json',Buffer.from('{"audit_event":"test-only"}'));
 const record={schema:'rticore-native-uat-case-v1',case_id:definition.id,definition_sha256:hash(Buffer.from(JSON.stringify(definition))),...t,actor_role:'finance',status:'PASS',scope_verified:true,sod_checked:true,artifacts:[trace.ref]};
 const caseEntry=(v=record)=>entry('case.json',Buffer.from(JSON.stringify(v)));
 const run=(overrides={})=>assertIndividualEvidence({test:t,definition,roster,signoffs,verified:[trace,caseEntry()],...overrides});
 assert.doesNotThrow(()=>run());
 const usedTraces=new Set();
 assert.doesNotThrow(()=>run({usedTraces}));
 assert.throws(()=>run({usedTraces}),/UAT_CASE_TRACE_REUSED/);
 assert.throws(()=>run({verified:[trace]}),/UAT_CASE_RECORD_REQUIRED/);
 assert.throws(()=>run({verified:[trace,caseEntry(),caseEntry()]}),/UAT_CASE_RECORD_REQUIRED/);
 assert.throws(()=>run({definition:{...definition,id:'ERP-GL-002'}}),/UAT_CASE_RECORD_REQUIRED/);
 for(const [field,value] of Object.entries({definition_sha256:'0'.repeat(64),release_sha:'b'.repeat(40),tester_subject:'other',actor_role:'admin',executed_at:'2026-11-27T00:00:00Z',actual_result:'different',execution_kind:'synthetic',status:'FAIL',scope_verified:false,sod_checked:false})){
  assert.throws(()=>run({verified:[trace,caseEntry({...record,[field]:value})]}),/UAT_CASE_RECORD_MISMATCH/);
 }
 assert.throws(()=>run({verified:[caseEntry()]}),/UAT_CASE_TRACE_REQUIRED/);
 assert.throws(()=>run({verified:[trace,caseEntry({...record,artifacts:[]})]}),/UAT_CASE_TRACE_REQUIRED/);
 assert.throws(()=>run({verified:[trace,caseEntry({...record,artifacts:[{...trace.ref,sha256:'0'.repeat(64)}]})]}),/UAT_CASE_TRACE_REQUIRED/);
 assert.throws(()=>run({roster:[{subject:'tester',role:'admin'}]}),/UAT_ACTOR_ROLE_MISMATCH/);
 assert.throws(()=>run({signoffs:[]}),/UAT_DEFINITION_APPROVAL_REQUIRED/);
 assert.throws(()=>run({definition:{...definition,approved_by:'tester'}}),/UAT_DEFINITION_APPROVAL_REQUIRED/);
});

test('native review register preserves 420 original cases and 520 proposed Finance individual cases without fake approval',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const legacy=JSON.parse(read('docs/RTICORE_UAT_210_CATALOG.json')).cases,erp=JSON.parse(read('docs/RTICORE_ERP_UAT_210_CATALOG.json')).cases;
 const groups=financeGroups(read('tests/rti-finance-uat-520.test.cjs'));
 const r=buildNativeReviewRegister(legacy,erp,groups,'a'.repeat(40));
 assert.equal(r.erp_definitions.length,420);
 assert.equal(r.finance_definitions.length,520);
 assert.equal(r.release,'HOLD');
 assert.equal(r.erp_individual_pass+r.finance_individual_pass,0);
 assert.ok(r.erp_definitions.every(d=>d.approved_by===null&&d.actor_role===null&&d.status==='REVIEW_REQUIRED'&&d.source_sha256===createHash('sha256').update(JSON.stringify(d.original)).digest('hex')));
 assert.ok(r.finance_definitions.every(d=>d.approved_by===null&&d.actor_role===null&&d.status==='REVIEW_REQUIRED_NOT_RUN'&&d.scenario&&d.expected&&d.steps.length>0));
 assert.equal(new Set(r.finance_definitions.map(d=>d.id)).size,520);
 assert.equal(new Set(r.finance_definitions.map(d=>d.group+'|'+d.family+'|'+d.variant)).size,520);
 assert.equal(new Set(r.finance_definitions.map(d=>d.group+'|'+d.family)).size,104);
 for(const g of groups)assert.equal(r.finance_definitions.filter(d=>d.group===g.title).length,g.target);
 assert.match(r.erp_definitions.find(d=>d.id==='P00-003').expected,/RPO\/RTO/);
 assert.throws(()=>buildNativeReviewRegister(legacy.slice(1),erp,groups,'a'.repeat(40)),/ERP_CATALOG_DRIFT/);
 assert.throws(()=>buildNativeReviewRegister(legacy,erp,groups.slice(1),'a'.repeat(40)),/FINANCE_CATALOG_DRIFT/);
});

import {assertResidualDisposition,gitBlobSha} from '../scripts/pr1-residual-release-gate.mjs';
test('PR1 closure requires exact reviewed dispositions and independent evidence for every unresolved file',()=>{
 const sha='a'.repeat(40),source='57b0c3230623b8f122359df13eabe305d60a4e55',old='b'.repeat(40),current=gitBlobSha(Buffer.from('native implementation'));
 const files=[{path:'src/native.ts',source:old,target:current,disposition:'semantic-review'},{path:'src/legacy.ts',source:old,target:null,disposition:'native-port-review'},...Array.from({length:138},(_,i)=>({path:'docs/legacy-'+i+'.md',source:old,target:null,disposition:'historical-reference'}))];
 const inventoryBytes=Buffer.from(JSON.stringify({source,files}));
 const entry=(path,bytes)=>({ref:{path,sha256:createHash('sha256').update(bytes).digest('hex')},bytes});
 const trace=entry('review-trace.json',Buffer.from('synthetic comparison evidence'));
 const row={path:'src/native.ts',source_sha:old,current_sha:current,disposition:'reconciled',rationale:'synthetic fixture',reviewer_subject:'reviewer',evidence:[trace.ref]};
 const record={schema:'rticore-pr1-residual-disposition-v1',release_sha:sha,source_sha:source,inventory_sha256:createHash('sha256').update(inventoryBytes).digest('hex'),files:[row,{...row,path:'src/legacy.ts',current_sha:null,disposition:'native_equivalent'}]};
 const run=(v=record,overrides={})=>assertResidualDisposition({inventoryBytes,currentSha:p=>p==='src/native.ts'?current:null,sha,signoffs:[{subject:'reviewer',decision:'APPROVED',release_sha:sha}],verified:[trace,entry('disposition.json',Buffer.from(JSON.stringify(v)))],...overrides});
 assert.deepEqual(run(),{reviewed:2});
 assert.throws(()=>run(record,{verified:[trace]}),/PR1_RESIDUAL_DISPOSITION_REQUIRED/);
 assert.throws(()=>run({...record,release_sha:old}),/PR1_RESIDUAL_DISPOSITION_STALE/);
 assert.throws(()=>run({...record,files:[row]}),/PR1_RESIDUAL_DISPOSITION_INCOMPLETE/);
 assert.throws(()=>run({...record,files:[row,row]}),/PR1_RESIDUAL_DISPOSITION_INCOMPLETE/);
 assert.throws(()=>run({...record,files:[{...row,current_sha:old},record.files[1]]}),/PR1_RESIDUAL_REVIEW_INVALID/);
 assert.throws(()=>run({...record,files:[{...row,evidence:[]},record.files[1]]}),/PR1_RESIDUAL_TRACE_REQUIRED/);
 assert.throws(()=>run(record,{signoffs:[]}),/PR1_RESIDUAL_REVIEW_INVALID/);
 assert.throws(()=>run(record,{currentSha:p=>p==='src/native.ts'?old:null}),/PR1_RESIDUAL_DISPOSITION_INCOMPLETE/);
});
