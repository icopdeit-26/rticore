// Prepare an unsigned, non-certifying review register from the exact checked-out catalogs.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {financeGroups} from './wave09-uat-evidence.mjs';
import {proposedFinanceDefinitions} from './native-finance-uat-drafts.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const nativeOverrides={
 'P00-002':{scenario:'Verify dedicated Hostinger staging deployment',expected:'Staging origin, candidate SHA and PostgreSQL isolation independently verified'},
 'P00-003':{scenario:'Rehearse independent PostgreSQL backup and restore',expected:'Restored schema and data digests match and RPO/RTO are recorded'},
 'P00-004':{scenario:'Reconcile full native PostgreSQL migration manifest',expected:'Every expected migration path and checksum matches applied ledger'},
 'P00-006':{scenario:'Provision native IAM user and TOTP with approved entity roles',expected:'Independent MFA enrollment, membership and denied cross-entity access verified'}
};
export function buildNativeReviewRegister(legacy,erp,groups,sha){
 if(!/^[a-f0-9]{40}$/.test(sha)||legacy.length!==210||erp.length!==210||new Set([...legacy,...erp].map(c=>c.id)).size!==420)throw Error('ERP_CATALOG_DRIFT');
 const slots=proposedFinanceDefinitions(groups);
 if(slots.length!==520||new Set(slots.map(s=>s.id)).size!==520)throw Error('FINANCE_CATALOG_DRIFT');
 const definitions=[...legacy,...erp].map(c=>{
  const obsolete=/\bD1\b|\bWorker\b|Cloudflare|\bAccess\s*&/i.test(JSON.stringify(c));
  const override=nativeOverrides[c.id];
  return {id:c.id,source_sha256:digest(c),original:c,scenario:override?.scenario??(obsolete?null:c.scenario),expected:override?.expected??(obsolete?null:c.expected??null),actor:c.actor??c.role??null,actor_role:null,approved_by:null,status:'REVIEW_REQUIRED',native_mapping_required:obsolete||!c.expected};
 });
 return {schema:'rticore-native-uat-review-v1',release_sha:sha,scope:'unsigned_planning_only',erp_definitions:definitions,finance_definitions:slots,erp_individual_pass:0,finance_individual_pass:0,release:'HOLD'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=process.cwd(),read=p=>readFileSync(resolve(root,p),'utf8');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const report=buildNativeReviewRegister(JSON.parse(read('docs/RTICORE_UAT_210_CATALOG.json')).cases,JSON.parse(read('docs/RTICORE_ERP_UAT_210_CATALOG.json')).cases,financeGroups(read('tests/rti-finance-uat-520.test.cjs')),sha);
 const output=process.argv[2];if(!output)throw Error('Usage: node scripts/native-uat-review-register.mjs <new-output.json>');
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({release_sha:sha,erp:420,finance:520,approved:0,pass:0,release:'HOLD'}));
}
