import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditCatalogs,inventory} from '../scripts/foundation-inventory.mjs';
test('catalog duplicates cannot inflate unique UAT count',()=>{
 const r=auditCatalogs([{cases:[{id:'A'},{id:'B'}]},{cases:[{id:'A'}]}]);
 assert.equal(r.defined_unique,2);assert.deepEqual(r.duplicate_ids,['A']);assert.equal(r.certified_executions,null);
});
test('repository inventory preserves both existing catalogs',()=>{
 const r=inventory();assert.equal(r.uat.defined_unique,420);assert.deepEqual(r.uat.duplicate_ids,[]);assert.ok(r.pages.length>0&&r.apis.length>0);assert.equal(r.feature_activation_certified,false);
});
test('uncertified worker has no completion path',()=>{
 const source=fs.readFileSync(new URL('../scripts/hostinger-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/SET status='completed'/);
 assert.match(source,/status='dead_letter'.*HANDLER_NOT_CERTIFIED/);
 assert.match(source,/AND tenant_id=\$2 AND status='running' AND locked_by=\$3/);
});
