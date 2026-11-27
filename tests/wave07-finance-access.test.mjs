import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
test('Finance denies unknown menu instead of silently using F01',()=>{
 const s=read('src/app/finance/[menuId]/page.tsx');assert.match(s,/if \(!matched\) notFound\(\)/);assert.doesNotMatch(s,/RTI_FINANCE_MENUS\[0\]/);
});
test('CAMS Inbox uses independent scope even when primary finance API is held',()=>{
 const s=read('src/components/finance/RTIFinanceWorkstation.tsx');assert.ok(s.indexOf('<CamsFinanceInbox')<s.indexOf('{!payload ?'));
 assert.match(s,/authorizedMenus \? authorizedMenus.includes\(m.id\) : m.id === 'F25'/);
 assert.match(s,/if \(actionRef.current \|\| !payload \|\| !selectedEntity \|\| loading\) return/);
 assert.match(s,/aria-current=\{active \? 'page' : undefined\}/);
 assert.match(read('src/app/api/finance/cams-inbox/route.ts'),/camsInboxScope/);
 assert.match(read('src/app/api/finance/route.ts'),/Finance production scope certification pending/);
 assert.match(read('src/app/erp/general-ledger/page.tsx'),/href="\/finance\/F25"/);
});
