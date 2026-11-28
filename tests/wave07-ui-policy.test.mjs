import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
test('provider controls follow server runtime; retired credentials can still be deleted',()=>{
 const s=read('src/app/settings/ai/page.tsx');
 assert.match(s,/setOpenAIOnly\(data.openAIOnly/);
 assert.match(s,/const allowed=\(id:ProviderId\)=>openAIOnly===false\|\|id==='openai'/);
 assert.match(s,/disabled=\{!!busy\|\|!p.hasKey\|\|!allowed\(p.id\)\} onClick=\{\(\)=>check/);
 assert.match(s,/disabled=\{!!busy\|\|!p.hasKey\} onClick=\{\(\)=>clear/);
 assert.match(read('src/app/api/ai/config/route.ts'),/openAIOnly:process.env.RTICORE_RUNTIME==='hostinger'/);
 assert.match(read('src/app/api/ai/assist/route.ts'),/providerAllowed\(x.id,process.env.RTICORE_RUNTIME\)/);
});
test('mobile menu supports keyboard dismissal and focus restoration',()=>{
 const s=read('src/components/layout/MobileNav.tsx');
 assert.match(s,/e.key==='Escape'/);assert.match(s,/trigger.current\?\.focus\(\)/);
 assert.match(s,/aria-controls="rticore-mobile-all-menu"/);
 assert.match(s,/navigationForRole\(role\)/);
});
