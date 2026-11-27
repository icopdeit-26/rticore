const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {camsReviewActions}=require('../src/lib/cams-review-actions.ts');
const grant={finance_role:'financial_controller',can_check:'1',can_approve:'1',can_post:'1',approval_limit_cents:'10000'};
const base={enabled:true,role:'finance',email:'checker@example.invalid',assignments:[grant],row:{journal_status:'draft',journal_version:1,created_by:'service',reviewed_by:null,period_open:'1',amount_cents:'10000'}};
test('approve and post affordances never overlap',()=>{
 assert.deepEqual(camsReviewActions(base),['approve']);
 const approved={...base,row:{...base.row,journal_status:'approved',journal_version:2,reviewed_by:base.email}};
 assert.deepEqual(camsReviewActions(approved),[]);
 assert.deepEqual(camsReviewActions({...approved,email:'poster@example.invalid'}),['post']);
 assert.deepEqual(camsReviewActions({...approved,email:'poster@example.invalid',role:'approver'}),[]);
});
test('held, unauthorized, stale or invalid scopes hide mutations',()=>{
 for(const p of [{enabled:false},{role:'admin'},{email:'SERVICE'},{assignments:[]},{assignments:[{...grant,approval_limit_cents:'9999'}]},{row:{...base.row,period_open:0}},{row:{...base.row,journal_version:null}},{row:{...base.row,amount_cents:'0'}},{row:{...base.row,journal_status:'posted'}}])assert.deepEqual(camsReviewActions({...base,...p}),[]);
});
test('UI submits server scope, version, distinct action and prevents duplicate writes',()=>{
 const s=fs.readFileSync('src/components/finance/CamsFinanceInbox.tsx','utf8');
 assert.match(s,/expectedVersion:row.journalVersion/);assert.match(s,/legalEntityId:scope,action/);
 assert.match(s,/lock.current/);assert.match(s,/AbortController/);assert.match(s,/Approve journal — tanpa posting/);assert.match(s,/Post approved journal/);assert.doesNotMatch(s,/Approve and post/);
 const route=fs.readFileSync('src/app/api/finance/cams-inbox/route.ts','utf8');
 assert.match(route,/if\(!scope.results.length\)/);assert.match(route,/allowedActions:camsReviewActions/);
});
