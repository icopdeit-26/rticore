// Native Hostinger release receipt verifier. No deployment or flag mutation.
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash,verify,createPublicKey} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {financeGroups} from './wave09-uat-evidence.mjs';
import {nativeMigrationManifest} from './native-migration-manifest.mjs';
export const NATIVE_GATES=['exact_sha_ci','branch_protection','hostinger_staging','postgres_migration_ledger','database_privileges','native_mfa','erp_uat','finance_uat','business_journeys','historical_reconciliation','pricing_contracts','cams_roundtrip','openai_live','authenticated_performance','independent_security','backup_restore_rollback','functional_completion','business_signoff','deployment'];
const fail=(ok,code)=>{if(!ok)throw Error(code)};
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const sha40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
const hash=b=>createHash('sha256').update(b).digest('hex');
// A signed receipt cannot turn a shared generic attachment into 940 case results.
// Each case requires a typed, hash-checked record plus at least one separate trace.
export function assertIndividualEvidence({test,definition,roster,signoffs,verified}){
 const id=definition.id;
 const actor=roster.find(i=>i.subject===test.tester_subject);
 fail(nonempty(definition.actor_role)&&actor?.role===definition.actor_role,'UAT_ACTOR_ROLE_MISMATCH_'+id);
 fail(nonempty(definition.approved_by)&&definition.approved_by!==test.tester_subject&&signoffs.some(s=>s.subject===definition.approved_by&&s.decision==='APPROVED'&&s.release_sha===test.release_sha),'UAT_DEFINITION_APPROVAL_REQUIRED_'+id);
 const definitionSha=hash(Buffer.from(JSON.stringify(definition)));
 const matches=[];
 for(const item of verified){
  let record;try{record=JSON.parse(item.bytes.toString('utf8'));}catch{continue;}
  if(record?.schema==='rticore-native-uat-case-v1'&&record.case_id===id)matches.push({record,item});
 }
 fail(matches.length===1,'UAT_CASE_RECORD_REQUIRED_'+id);
 const {record,item}=matches[0];
 fail(record.definition_sha256===definitionSha&&record.release_sha===test.release_sha&&record.tester_subject===test.tester_subject&&record.actor_role===actor.role&&record.executed_at===test.executed_at&&record.actual_result===test.actual_result&&record.execution_kind===test.execution_kind&&record.status==='PASS'&&record.scope_verified===true&&record.sod_checked===true,'UAT_CASE_RECORD_MISMATCH_'+id);
 fail(Array.isArray(record.artifacts)&&record.artifacts.length>0&&record.artifacts.every(ref=>verified.some(v=>v.ref.path!==item.ref.path&&v.ref.sha256!==item.ref.sha256&&v.ref.path===ref.path&&v.ref.sha256===ref.sha256&&v.bytes.length>0)),'UAT_CASE_TRACE_REQUIRED_'+id);
}
export function verifyNativeReceipt({receiptPath,publicKey,sha,camsSha,phase='before',root=process.cwd(),now=Date.now()}){
 fail(receiptPath&&publicKey,'NATIVE_SIGNED_RECEIPT_REQUIRED');
 fail(sha40(sha)&&sha40(camsSha)&&['before','after'].includes(phase),'INVALID_RELEASE_TARGET');
 const e=JSON.parse(readFileSync(receiptPath,'utf8')),p=e.payload,key=createPublicKey(publicKey);
 fail(key.asymmetricKeyType==='ed25519'&&typeof e.signature==='string'&&verify(null,Buffer.from(JSON.stringify(p)),key,Buffer.from(e.signature,'base64')),'INVALID_NATIVE_RELEASE_SIGNATURE');
 fail(p.schema_version===2&&p.release_sha===sha&&p.cams_release_sha===camsSha&&p.target==='hostinger_business_web_hosting'&&p.origin==='https://rticore.store'&&p.database_engine==='postgres'&&p.auth_method==='native_business_totp'&&p.ai_provider==='openai','NATIVE_TARGET_OR_SHA_MISMATCH');
 const issued=Date.parse(p.issued_at),expires=Date.parse(p.expires_at);
 fail(Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now&&expires>now&&expires>issued&&expires-issued<=86400000,'STALE_NATIVE_RECEIPT');
 const dir=realpathSync(dirname(resolve(receiptPath)));
 const proof=refs=>{
  fail(Array.isArray(refs)&&refs.length>0,'EVIDENCE_REQUIRED');
  const verified=[];
  for(const ref of refs){
   fail(nonempty(ref.path)&&!isAbsolute(ref.path)&&hex(ref.sha256),'INVALID_EVIDENCE_REFERENCE');
   const file=realpathSync(resolve(dir,ref.path)),rel=relative(dir,file);
   fail(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&statSync(file).isFile(),'EVIDENCE_OUTSIDE_BUNDLE');
   const bytes=readFileSync(file);
   fail(hash(bytes)===ref.sha256,'EVIDENCE_HASH_MISMATCH');
   verified.push({ref,bytes});
  }
  return verified;
 };
 const unique=(rows,field,n)=>Array.isArray(rows)&&rows.length===n&&new Set(rows.map(r=>r[field])).size===n;
 fail(unique(p.gates,'id',NATIVE_GATES.length),'INCOMPLETE_NATIVE_GATES');
 for(const id of NATIVE_GATES){
  const gate=p.gates.find(g=>g.id===id);
  fail(gate,'MISSING_GATE_'+id);
  if(id==='deployment'&&phase==='before')continue;
  fail(gate.status==='PASS'&&gate.release_sha===sha&&nonempty(gate.reviewer),'GATE_NOT_PASS_'+id);proof(gate.evidence);
 }
 const manifest=nativeMigrationManifest(root);
 fail(unique(p.migrations,'path',manifest.length)&&manifest.every(m=>p.migrations.some(x=>x.path===m.path&&x.sha256===m.sha256&&x.applied===true&&Number.isFinite(Date.parse(x.applied_at))&&Date.parse(x.applied_at)<=issued)),'APPLIED_MIGRATION_LEDGER_MISMATCH');
 const roster=p.identities;
 fail(Array.isArray(roster)&&roster.length>0&&new Set(roster.map(i=>i.subject)).size===roster.length,'DISTINCT_NATIVE_IDENTITIES_REQUIRED');
 for(const [role,count] of Object.entries({admin:2,marketing:1,sales:2,presales:1,finance:2,approver:1,legal:1,viewer:1})){
  fail(roster.filter(i=>nonempty(i.subject)&&i.role===role&&i.auth_method==='native_business_totp'&&i.mfa_verified===true&&i.active_membership_verified===true).length>=count,'NATIVE_ROLE_MISSING_'+role);
 }
 const read=f=>JSON.parse(readFileSync(resolve(root,f),'utf8'));
 const erp=[...read('docs/RTICORE_UAT_210_CATALOG.json').cases,...read('docs/RTICORE_ERP_UAT_210_CATALOG.json').cases];
 fail(unique(erp,'id',420),'ERP_CATALOG_INCOMPLETE');
 const groups=financeGroups(readFileSync(resolve(root,'tests/rti-finance-uat-520.test.cjs'),'utf8'));
 const finIds=groups.flatMap(g=>Array.from({length:g.target},(_,i)=>'FIN-'+g.domains.replace(' & ','-')+'-'+String(i+1).padStart(3,'0')));
 fail(finIds.length===520&&new Set(finIds).size===520,'FINANCE_CATALOG_INCOMPLETE');
 fail(unique(p.finance_definitions,'id',520)&&finIds.every(id=>p.finance_definitions.some(d=>d.id===id&&nonempty(d.scenario)&&nonempty(d.expected)&&nonempty(d.actor)&&nonempty(d.approved_by))),'APPROVED_FINANCE_520_DEFINITIONS_REQUIRED');
 // Preserve historical IDs and bind approved native replacements to the original
 // catalog bytes, rather than silently treating legacy D1/Worker cases as native.
 fail(unique(p.erp_definitions,'id',420)&&erp.every(c=>p.erp_definitions.some(d=>d.id===c.id&&d.source_sha256===hash(Buffer.from(JSON.stringify(c)))&&nonempty(d.scenario)&&nonempty(d.expected)&&nonempty(d.actor_role)&&nonempty(d.approved_by))),'APPROVED_NATIVE_ERP_420_DEFINITIONS_REQUIRED');
 fail(Array.isArray(p.signoffs),'INDEPENDENT_SIGNOFFS_REQUIRED');
 for(const [name,cases,results] of [['ERP',p.erp_definitions,p.erp_uat],['FINANCE',p.finance_definitions,p.finance_uat]]){
  fail(unique(results,'id',cases.length),name+'_INDIVIDUAL_UAT_REQUIRED');
  for(const c of cases){
   const t=results.find(x=>x.id===c.id);
   fail(t&&t.release_sha===sha&&t.status==='PASS'&&t.execution_kind==='authenticated_native_hostinger_staging'&&nonempty(t.actual_result)&&t.scope_verified===true&&t.sod_checked===true&&roster.some(i=>i.subject===t.tester_subject&&i.mfa_verified===true&&i.auth_method==='native_business_totp'&&i.active_membership_verified===true)&&Number.isFinite(Date.parse(t.executed_at))&&Date.parse(t.executed_at)<=issued,name+'_UAT_NOT_PASS_'+c.id);
   assertIndividualEvidence({test:t,definition:c,roster,signoffs:p.signoffs,verified:proof(t.evidence)});
  }
 }
 const required=['security','finance','operations','release','legal','hr','procurement','cyber_operations'];
 fail(unique(p.signoffs,'kind',required.length)&&new Set(p.signoffs.map(s=>s.subject)).size===required.length,'INDEPENDENT_SIGNOFFS_REQUIRED');
 for(const kind of required){const s=p.signoffs.find(x=>x.kind===kind);fail(s&&s.decision==='APPROVED'&&s.release_sha===sha&&nonempty(s.subject),'SIGNOFF_MISSING_'+kind);proof(s.evidence);}
 fail(p.open_critical===0&&p.open_high===0&&p.open_p0===0,'OPEN_RELEASE_BLOCKERS');
 return {status:'PASS',decision:phase==='before'?'PREDEPLOYMENT_EVIDENCE_VERIFIED':'POSTDEPLOYMENT_EVIDENCE_VERIFIED',release_sha:sha,cams_release_sha:camsSha,erp_individual_pass:420,finance_individual_pass:520,scope:'signed_receipt_and_evidence_bytes_only'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const keyPath=process.env.RTICORE_NATIVE_RELEASE_PUBLIC_KEY_FILE;
  const result=verifyNativeReceipt({receiptPath:process.env.RTICORE_NATIVE_RELEASE_RECEIPT,publicKey:keyPath?readFileSync(keyPath):null,sha:process.env.RTICORE_RELEASE_SHA,camsSha:process.env.CAMS_RELEASE_SHA,phase:process.env.RTICORE_RELEASE_PHASE||'before'});
  console.log(JSON.stringify(result));
 }catch(e){console.error('NATIVE_RELEASE_HOLD:',e instanceof Error?e.message:'verification failed');process.exitCode=1;}
}
