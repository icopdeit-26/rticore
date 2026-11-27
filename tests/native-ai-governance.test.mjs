import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {containsRestrictedAIData,assertAIDataAllowed,aiOriginAllowed} from '../src/lib/ai-data-policy.ts';
test('outbound and response privacy blocks common credentials and identifiers',()=>{
 for(const s of ['customer@example.invalid','081234567890','1234567890123456','sk-proj-'+'A'.repeat(24),'ghp_'+'B'.repeat(30),'-----BEGIN PRIVATE KEY-----','postgresql://user:pass@example.invalid/db','password=synthetic-password','Bearer '+'x'.repeat(32),'ｓｋ-proj-'+'A'.repeat(24)]){assert.equal(containsRestrictedAIData(s),true);assert.throws(()=>assertAIDataAllowed([s]));}
 assert.equal(containsRestrictedAIData('Analisis margin proyek anonim sebesar 20 persen'),false);
});
test('native origin fails closed; legacy no-origin fixture remains supported',()=>{
 assert.equal(aiOriginAllowed(null,'https://example.invalid',null,true),false);
 assert.equal(aiOriginAllowed('https://example.invalid','https://example.invalid','same-origin',true),true);
 assert.equal(aiOriginAllowed('https://example.invalid','https://example.invalid','cross-site',true),false);
 assert.equal(aiOriginAllowed(null,'https://example.invalid',null,false),true);
});
test('native quota and egress guards are wired to all canonical AI endpoints',()=>{
 const read=p=>fs.readFileSync(p,'utf8');
 assert.match(read('src/lib/ai-request-budget.ts'),/rticore_reserve_ai_request/);
 const v=read('src/lib/ai-credential-vault.ts');assert.match(v,/assertAIDataAllowed\(\[output\]\)/);assert.match(v,/messages.map\(m=>m.content\)/);assert.match(v,/redirect:'error'/);
 for(const p of ['assist','generate','config']){const s=read('src/app/api/ai/'+p+'/route.ts');assert.match(s,/aiOriginAllowed/);assert.match(s,/identity.rolePreview/);}
 assert.match(read('src/app/api/ai/generate/route.ts'),/reserveAIRequest\(auth.identity.db,auth.identity.email,'chat_retry'\)/);
});
