import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {financeGroups,groupResults,makeRegister} from '../scripts/wave09-uat-evidence.mjs';
const groups=financeGroups(fs.readFileSync('tests/rti-finance-uat-520.test.cjs','utf8'));
test('source totals match targets; group passes never promote individual slots',()=>{
 const cat=p=>JSON.parse(fs.readFileSync(p,'utf8')).cases;
 const reg=makeRegister(cat('docs/RTICORE_UAT_210_CATALOG.json'),cat('docs/RTICORE_ERP_UAT_210_CATALOG.json'),groups,groups.map((g,i)=>'ok '+(i+1)+' - '+g.title).join('\n'),'synthetic');
 assert.equal(reg.erp.cases.length,420);assert.equal(reg.finance.planning_slots.length,520);
 assert.equal(new Set(reg.finance.planning_slots.map(s=>s.id)).size,520);
 assert.ok(reg.finance.groups.every(g=>g.technical_group_status==='PASS'&&g.individual_execution_count===null));
 assert.ok(reg.finance.planning_slots.every(s=>s.acceptance_status==='UNMAPPED_NOT_RUN'&&s.scenario_definition===null));
 assert.equal(reg.erp.individual_business_pass+reg.finance.individual_business_pass,0);assert.equal(reg.production_release,'HOLD');
});
test('failed, missing and duplicate TAP group cannot be recorded as pass',()=>{
 const g=groups[0],ok='ok 1 - '+g.title;
 assert.equal(groupResults([g],'not '+ok)[0].technical_group_status,'FAIL');
 assert.equal(groupResults([g],'')[0].technical_group_status,'UNVERIFIED');
 assert.equal(groupResults([g],ok+'\n'+ok)[0].technical_group_status,'UNVERIFIED');
});
