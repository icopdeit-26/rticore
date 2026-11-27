import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCatalogs,inventory} from '../scripts/foundation-inventory.mjs';
test('duplicate IDs cannot inflate unique ERP inventory',()=>{
 const r=auditCatalogs([{cases:[{id:'A'},{id:'B'}]},{cases:[{id:'A'}]}]);
 assert.equal(r.defined_unique,2);assert.deepEqual(r.duplicate_ids,['A']);assert.equal(r.certified_executions,null);
 assert.throws(()=>auditCatalogs([{cases:[{id:''}]}]),/Missing UAT ID/);
});
test('native inventory distinguishes definitions, grouped suite and actual certification',()=>{
 const r=inventory(fileURLToPath(new URL('../',import.meta.url)));
 assert.equal(r.uat.defined_unique,420);assert.deepEqual(r.uat.duplicate_ids,[]);
 assert.equal(r.uat.finance_target,520);assert.equal(r.finance_grouped_suite_present,true);
 assert.ok(r.pages.includes('src/app/login/page.tsx'));assert.ok(r.apis.includes('src/app/api/business-auth/route.ts'));
 assert.equal(r.feature_activation_certified,false);assert.equal(r.uat.certified_executions,null);
});
