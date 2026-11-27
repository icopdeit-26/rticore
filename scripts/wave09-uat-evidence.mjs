import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function financeGroups(source){
 const groups=[...source.matchAll(/^test\('(Domain (\d{2}(?: & \d{2})?) \((\d+) UAT Scenarios\): [^']+)', async \(\) => \{/gm)].map(m=>({title:m[1],domains:m[2],target:Number(m[3])}));
 if(groups.length!==14||new Set(groups.flatMap(g=>g.domains.split(' & '))).size!==15||groups.reduce((n,g)=>n+g.target,0)!==520)throw Error('Finance grouped suite target drift');
 return groups;
}
export function groupResults(groups,tap){
 const rows=groups.map(g=>{
  const matching=tap.split('\n').filter(line=>/^(ok|not ok) \d+ - /.test(line)&&line.replace(/^(ok|not ok) \d+ - /,'')===g.title);
  return {...g,technical_group_status:matching.length===1?(matching[0].startsWith('ok ')?'PASS':'FAIL'):'UNVERIFIED',individual_execution_count:null};
 });
 return rows;
}
export function makeRegister(legacy,erp,groups,tap,sha){
 const cases=[...legacy,...erp];if(legacy.length!==210||erp.length!==210||new Set(cases.map(c=>c.id)).size!==420||cases.some(c=>!c.id||!c.scenario))throw Error('ERP catalog drift');
 return {schema:'rticore-wave09-evidence-v1',source_sha:sha,scope:'synthetic_technical_only',erp:{defined:420,individual_business_pass:0,cases:cases.map(c=>({id:c.id,scenario:c.scenario,actor:c.actor||c.role,workflow:c.workflow||null,acceptance_status:'NOT_RUN',evidence:null}))},finance:{target:520,individual_business_pass:0,groups:groupResults(groups,tap),planning_slots:groups.flatMap(g=>Array.from({length:g.target},(_,i)=>({id:'FIN-'+g.domains.replace(' & ','-')+'-'+String(i+1).padStart(3,'0'),group:g.title,scenario_definition:null,acceptance_status:'UNMAPPED_NOT_RUN',evidence:null})))},production_release:'HOLD'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const read=p=>fs.readFileSync(p,'utf8');
 const reg=makeRegister(JSON.parse(read('docs/RTICORE_UAT_210_CATALOG.json')).cases,JSON.parse(read('docs/RTICORE_ERP_UAT_210_CATALOG.json')).cases,financeGroups(read('tests/rti-finance-uat-520.test.cjs')),read('artifacts/wave09/finance.tap'),sha);
 fs.mkdirSync('artifacts/wave09',{recursive:true});fs.writeFileSync('artifacts/wave09/uat-register.json',JSON.stringify(reg,null,2)+'\n');
 console.log(JSON.stringify({source_sha:sha,erp_definitions:reg.erp.defined,finance_planning_slots:reg.finance.planning_slots.length,finance_group_results:reg.finance.groups.map(g=>[g.domains,g.technical_group_status]),individual_business_pass:0,release:'HOLD'}));
 if(reg.finance.groups.some(g=>g.technical_group_status!=='PASS'))process.exitCode=1;
}
