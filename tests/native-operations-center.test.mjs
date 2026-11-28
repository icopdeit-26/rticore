import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('operations center uses scoped native register and explicit recovery actions and clears old scope',()=>{
 const ui=readFileSync('src/app/erp/operations-center/page.tsx','utf8');
 const api=readFileSync('src/app/api/erp/operations-jobs/route.ts','utf8');
 const nav=readFileSync('src/lib/enterprise-navigation.ts','utf8');
 assert.match(ui,/URLSearchParams\(\{legal_entity_id:id\}\)/);
 assert.match(ui,/credentials:'same-origin'/);
 assert.match(ui,/setResult\(null\)/);
 assert.match(ui,/request.current\?\.abort\(\)/);
 assert.match(ui,/method:\s*['"]POST/);
 assert.match(ui,/result.role==='finance'/);
 assert.match(ui,/result.role==='approver'/);
 assert.match(ui,/recovery\('request',j.id\)/);
 assert.match(ui,/recovery\('approve',x.job_id,x.id\)/);
 assert.match(api,/!rolePreview&&\['finance','approver'\]/);
 assert.match(api,/rticore_native_recovery_command/);
 assert.match(api,/automatic_posting:false/);
 assert.match(api,/grant\?\.role===role/);
 assert.match(api,/tenant_id=\? AND legal_entity_id=\?/);
 assert.match(nav,/item\('Operations Center','\/erp\/operations-center',FINANCE\)/);
});

test('feature governance is an explicit scoped maker-checker workspace, never a runtime activation switch',()=>{
 const ui=readFileSync('src/app/erp/operations-center/page.tsx','utf8');
 const panel=readFileSync('src/app/erp/operations-center/FeatureGovernance.tsx','utf8');
 assert.match(ui,/\['admin','approver'\].includes\(result.role\)&&<FeatureGovernance key=\{loadedEntity\}/);
 assert.match(panel,/endpoint='\/api\/admin\/feature-flags'/);
 assert.match(panel,/role==='admin'/);
 assert.match(panel,/role==='approver'&&x.status==='pending'/);
 assert.match(panel,/b.activation!==false/);
 assert.match(panel,/legal_entity_id:entity/);
 assert.match(panel,/mutation.current\?\.abort\(\)/);
 assert.match(panel,/credentials:'same-origin'/);
 assert.doesNotMatch(panel,/process\.env|localStorage/);
});
