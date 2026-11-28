import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('operations center uses scoped read-only native register and clears old scope',()=>{
 const ui=readFileSync('src/app/erp/operations-center/page.tsx','utf8');
 const api=readFileSync('src/app/api/erp/operations-jobs/route.ts','utf8');
 const nav=readFileSync('src/lib/enterprise-navigation.ts','utf8');
 assert.match(ui,/URLSearchParams\(\{legal_entity_id:id\}\)/);
 assert.match(ui,/credentials:'same-origin'/);
 assert.match(ui,/setResult\(null\)/);
 assert.match(ui,/request.current\?\.abort\(\)/);
 assert.doesNotMatch(ui,/method:\s*['"]POST/);
 assert.match(api,/grant\?\.role===role/);
 assert.match(api,/tenant_id=\? AND legal_entity_id=\?/);
 assert.match(nav,/item\('Operations Center','\/erp\/operations-center',FINANCE\)/);
});
