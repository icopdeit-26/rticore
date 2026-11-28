import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {nativeMigrationManifest} from './native-migration-manifest.mjs';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const m=JSON.parse(readFileSync('docs/release/pr1-residual-inventory.json','utf8'));
assert.equal(m.files.length,155);
assert.equal(m.source,'d9219ab257843cb21f2714b6937a8b1263a7fbae');
assert.equal(new Set(m.files.map(x=>x.path)).size,m.files.length);
const valid=/^[a-f0-9]{40}$/;
assert.match(m.source,valid); assert.match(m.baseline,valid);
const head=git(['rev-parse','HEAD']).trim();
const tracked=new Map(git(['ls-tree','-r','-z','--full-tree','HEAD']).split('\0').filter(Boolean).map(entry=>{
 const i=entry.indexOf('\t');
 const [mode,type,sha]=entry.slice(0,i).split(' ');
 return [entry.slice(i+1),{mode,type,sha}];
}));
const retired=['migrations/0053_enterprise_service_catalog_pricing.sql','migrations/0054_flexguard_enterprise_suite.sql','migrations/0055_enterprise_cyber_grc_cti_bi_ops.sql','migrations/0056_vapt_dfir_soc_sla_enterprise.sql'];
for(const path of retired)assert.ok(!tracked.has(path),'Legacy migration must not be restored: '+path);
// Known native counterparts are traceability links, not semantic closure.
const counterparts={
 'src/app/api/erp/cyber-delivery/route.ts':['src/app/api/erp/cyber-operations/route.ts','src/app/api/erp/technical-registers/route.ts'],
 'src/app/api/erp/cyber-grc-cti/route.ts':['src/app/api/erp/cyber-operations/route.ts','src/app/api/erp/technical-registers/route.ts'],
 'src/app/erp/cyber-delivery/page.tsx':['src/app/erp/cyber-operations/page.tsx','src/app/erp/technical-registers/page.tsx'],
 'src/app/erp/cyber-grc-cti/page.tsx':['src/app/erp/cyber-operations/page.tsx','src/app/erp/technical-registers/page.tsx'],
 'src/app/erp/executive-command/page.tsx':['src/app/erp/operations-center/page.tsx','src/app/erp/operations-center/ExecutiveSummary.tsx','src/app/api/erp/executive-command/route.ts'],
 'src/app/erp/pricing-simulator/page.tsx':['src/app/erp/service-catalog/page.tsx','src/app/erp/service-catalog/PricingEvidence.tsx','src/app/api/erp/pricing-engine/route.ts'],
 'scripts/hostinger-job-engine.mjs':['scripts/native-operations-worker.mjs'],
 'scripts/hostinger-worker-telemetry.mjs':['src/app/api/erp/executive-command/route.ts','src/app/erp/operations-center/ExecutiveSummary.tsx','scripts/native-operations-worker.mjs'],
 'scripts/hostinger-sales-alerts.mjs':['automation/sales-cron/native-postgres.mjs','scripts/run-native-sales-cron.mjs','tests/native-sales-cron.test.mjs'],
 'scripts/hostinger-backup-restore-drill.mjs':['scripts/ci-native-migration-rehearsal.sh','src/app/api/erp/backup-drills/route.ts','src/app/erp/operations-center/BackupDrills.tsx'],
};
for(const [source,targets] of Object.entries(counterparts)){
 assert.ok(m.files.some(f=>f.path===source),'Unknown mapped source: '+source);
 for(const target of targets)assert.equal(tracked.get(target)?.type,'blob','Missing mapped counterpart: '+target);
}
const files=m.files.map(f=>{
 assert.match(f.source,valid);
 if(f.target!==null) assert.match(f.target,valid);
 assert.equal(f.disposition,f.source===f.target?'identical':f.target===null?(f.path.startsWith('docs/')?'historical-reference':'native-port-review'):'semantic-review');
 const current=tracked.get(f.path);
 const sha=current?.type==='blob'?current.sha:null;
 if(f.disposition==='identical')assert.equal(sha,f.source,'Previously identical file drift: '+f.path);
 const status=sha===f.source?'source-identical':retired.includes(f.path)?'legacy-migration-excluded':f.disposition==='historical-reference'&&sha===null?'historical-reference':sha===null?'native-port-review-required':'semantic-review-required';
 const targetPaths=[...new Set([...(sha?[f.path]:[]),...(counterparts[f.path]||[])])];
 return {path:f.path,source_sha:f.source,baseline_sha:f.target,current_sha:sha,status,changed_since_baseline:sha!==f.target,target_candidates:targetPaths.map(path=>({path,sha:tracked.get(path).sha})),mapping_status:sha===f.source?'identical':targetPaths.length?'candidate-not-certified':'unmapped-or-excluded'};
});
const migrations=nativeMigrationManifest();
assert.equal(new Set(migrations.map(x=>x.path)).size,migrations.length,'Duplicate native migration path');
for(const migration of migrations)assert.equal(tracked.get(migration.path)?.type,'blob','Untracked native migration: '+migration.path);
const counts=Object.fromEntries([...new Set(files.map(f=>f.status))].map(s=>[s,files.filter(f=>f.status===s).length]));
console.log(JSON.stringify({scope:'current-head source inventory; not semantic or functional certification',source_sha:m.source,inventory_baseline_sha:m.baseline,head_sha:head,inventory:files.length,counts,native_migration_paths:migrations,unresolved:files.filter(f=>f.status.endsWith('review-required')).length,certified:false,files},null,2));
