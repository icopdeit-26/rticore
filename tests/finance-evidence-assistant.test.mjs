import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('F24 evidence assistant uses a bounded scoped posted GL query and never claims unsupported forecasts',()=>{
 const s=fs.readFileSync('src/app/api/finance/route.ts','utf8');const f=s.slice(s.indexOf("if (action === 'ai_financial_query')"));
 assert.match(f,/j.tenant_id=\? AND j.legal_entity_id=\? AND p.period=\? AND j.status='posted'/);
 assert.match(f,/bind\(TENANT,legalEntityId,String\(period\)\)/);
 assert.match(f,/mode:'local_evidence_only',providerUsed:null,requiresReview:true/);
 assert.match(f,/attempt_autonomous_mutation===true|attempt_autonomous_mutation === true/);
 assert.doesNotMatch(f,/runPriorityChain|invokeAI|INSERT INTO|UPDATE rticore_/);
 assert.match(s,/Finance production scope certification pending/);
});
