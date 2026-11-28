// Fail closed on PR1 residual review evidence; no production mutation.
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const source='57b0c3230623b8f122359df13eabe305d60a4e55';
const retired=new Set(['migrations/0053_enterprise_service_catalog_pricing.sql','migrations/0054_flexguard_enterprise_suite.sql','migrations/0055_enterprise_cyber_grc_cti_bi_ops.sql','migrations/0056_vapt_dfir_soc_sla_enterprise.sql']);
const fail=(ok,code)=>{if(!ok)throw Error(code)};
const sha40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
const digest=b=>createHash('sha256').update(b).digest('hex');
export function gitBlobSha(bytes){return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')}
export function assertResidualDisposition({inventoryBytes,currentSha,sha,verified,signoffs}){
 const inventory=JSON.parse(inventoryBytes.toString('utf8'));
 fail(inventory.source===source&&Array.isArray(inventory.files)&&inventory.files.length===140&&new Set(inventory.files.map(f=>f.path)).size===140,'PR1_INVENTORY_INVALID');
 const unresolved=[];
 for(const f of inventory.files){
  fail(nonempty(f.path)&&!isAbsolute(f.path)&&!f.path.split('/').some(p=>p==='..'||p==='.')&&sha40(f.source),'PR1_INVENTORY_PATH_INVALID');
  const current=currentSha(f.path);
  if(retired.has(f.path)){fail(current===null,'PR1_LEGACY_MIGRATION_RESTORED');continue;}
  if(current===f.source)continue;
  if(f.disposition==='historical-reference'&&f.path.startsWith('docs/')&&f.target===null)continue;
  unresolved.push({...f,current});
 }
 const records=[];
 for(const item of verified){let record;try{record=JSON.parse(item.bytes.toString('utf8'));}catch{continue;}if(record?.schema==='rticore-pr1-residual-disposition-v1')records.push({record,item});}
 fail(records.length===1,'PR1_RESIDUAL_DISPOSITION_REQUIRED');
 const {record,item}=records[0];
 fail(record.release_sha===sha&&record.source_sha===source&&record.inventory_sha256===digest(inventoryBytes),'PR1_RESIDUAL_DISPOSITION_STALE');
 fail(Array.isArray(record.files)&&record.files.length===unresolved.length&&new Set(record.files.map(f=>f.path)).size===unresolved.length,'PR1_RESIDUAL_DISPOSITION_INCOMPLETE');
 for(const f of unresolved){
  const row=record.files.find(x=>x.path===f.path);
  fail(row&&row.source_sha===f.source&&row.current_sha===f.current&&['reconciled','native_equivalent','intentionally_retired'].includes(row.disposition)&&!(row.disposition==='reconciled'&&f.current===null)&&nonempty(row.rationale)&&nonempty(row.reviewer_subject)&&signoffs.some(s=>s.subject===row.reviewer_subject&&s.decision==='APPROVED'&&s.release_sha===sha),'PR1_RESIDUAL_REVIEW_INVALID_'+f.path);
  fail(Array.isArray(row.evidence)&&row.evidence.length>0&&row.evidence.every(ref=>verified.some(v=>v.ref.path!==item.ref.path&&v.ref.sha256!==item.ref.sha256&&v.ref.path===ref.path&&v.ref.sha256===ref.sha256&&v.bytes.length>0)),'PR1_RESIDUAL_TRACE_REQUIRED_'+f.path);
 }
 return {reviewed:unresolved.length};
}
export function verifyResidualDisposition({root,sha,verified,signoffs}){
 const base=realpathSync(root);
 const currentSha=path=>{
  const target=resolve(base,path);
  let file;try{file=realpathSync(target);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const rel=relative(base,file);
  fail(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'PR1_RESIDUAL_PATH_OUTSIDE_ROOT');
  return gitBlobSha(readFileSync(file));
 };
 return assertResidualDisposition({inventoryBytes:readFileSync(resolve(base,'docs/release/pr1-residual-inventory.json')),currentSha,sha,verified,signoffs});
}
