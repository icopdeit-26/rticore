import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const m=JSON.parse(readFileSync('docs/release/pr1-residual-inventory.json','utf8'));
assert.equal(m.files.length,140);
assert.equal(new Set(m.files.map(x=>x.path)).size,m.files.length);
const valid=/^[a-f0-9]{40}$/;
assert.match(m.source,valid); assert.match(m.baseline,valid);
for(const f of m.files){
 assert.match(f.source,valid);
 if(f.target!==null) assert.match(f.target,valid);
 assert.equal(f.disposition,f.source===f.target?'identical':f.target===null?(f.path.startsWith('docs/')?'historical-reference':'native-port-review'):'semantic-review');
 if(f.disposition==='identical') assert.equal(execFileSync('git',['rev-parse','HEAD:'+f.path],{encoding:'utf8'}).trim(),f.source);
}
for(const path of ['migrations/0053_enterprise_service_catalog_pricing.sql','migrations/0054_flexguard_enterprise_suite.sql','migrations/0055_enterprise_cyber_grc_cti_bi_ops.sql','migrations/0056_vapt_dfir_soc_sla_enterprise.sql']){
 const tracked=execFileSync('git',['ls-files','--',path],{encoding:'utf8'}).trim(); assert.equal(tracked,'','Legacy migration must not be restored: '+path);
}
console.log(JSON.stringify({inventory:m.files.length,unresolved:m.files.filter(x=>x.disposition!=='identical').length,certified:false},null,2));
