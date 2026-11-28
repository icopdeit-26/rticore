const {test}=require('node:test');const assert=require('node:assert/strict');
const {journalEnvelope,envelopeHash,validToken,lineSignature,independentPostingEvidence,serviceRequestContextAllowed}=require('../src/lib/cams-journal-contract.ts');
const id='12345678-1234-1234-1234-123456789abc';
const input={schemaVersion:'cams-journal/1',sourceSystem:'CAMSRTI',tenantId:id,journalId:id,idempotencyKey:'OUTBOX-JRN-'+id,period:'2026-11',currency:'IDR',sourceType:'tuition_payment',journalNumber:'JRN-1',totalDebit:'100.00',totalCredit:'100.00',lines:[{accountCode:'CASH',costCenterId:null,debitAmount:'100.00',creditAmount:'0.00'},{accountCode:'AR',costCenterId:null,debitAmount:'0.00',creditAmount:'100.00'}]};
test('balanced envelope deterministic hash',()=>assert.equal(envelopeHash(journalEnvelope(input)),envelopeHash(journalEnvelope({...input}))));
test('rejects nonmatching totals',()=>assert.throws(()=>journalEnvelope({...input,totalCredit:'99.00'})));
test('rejects wrong source and key',()=>{assert.throws(()=>journalEnvelope({...input,sourceSystem:'RTICORE'}));assert.throws(()=>journalEnvelope({...input,idempotencyKey:'other'}));});
test('requires strong service credential',()=>{assert.equal(validToken('Bearer short','short'),false);assert.equal(validToken('Bearer '+ 'a'.repeat(32),'a'.repeat(32)),true);assert.equal(validToken('Bearer '+ 'b'.repeat(32),'a'.repeat(32)),false);});
test('line signature compares accounts and amounts irrespective of order',()=>{const x=[{accountId:'a',debit:'100',credit:'0'},{accountId:'b',debit:'0',credit:'100'}];assert.equal(lineSignature(x),lineSignature([...x].reverse()));assert.notEqual(lineSignature(x),lineSignature([{...x[0],accountId:'c'},x[1]]));});

test('reconciliation requires three distinct actors and matching workflow evidence',()=>{
 const j={created_by:'service',reviewed_by:'checker',posted_by:'poster',reviewed_at:'stamp',posted_at:'stamp'};
 const w={lifecycle_stage:'posted',submitted_by:'service',checked_by:'checker',approved_by:'checker',posted_by:'poster',checked_at:'stamp',approved_at:'stamp',posted_at:'stamp'};
 assert.equal(independentPostingEvidence(j,w),true);
 for(const p of [{posted_by:'CHECKER'},{posted_by:'service'},{reviewed_at:null},{posted_at:null}])assert.equal(independentPostingEvidence({...j,...p},w),false);
 for(const p of [{lifecycle_stage:'approved'},{checked_by:'other'},{approved_by:null},{posted_by:'other'},{posted_at:null}])assert.equal(independentPostingEvidence(j,{...w,...p}),false);
 assert.equal(independentPostingEvidence(j,null),false);
});

test('CAMS service receiver rejects browser context and malformed bearer values',()=>{
 const secret='a'.repeat(32);
 assert.equal(serviceRequestContextAllowed(new Headers({authorization:'Bearer '+secret})),true);
 for(const h of [{origin:'https://example.invalid'},{cookie:'session=fixture'},{'sec-fetch-site':'same-origin'}])assert.equal(serviceRequestContextAllowed(new Headers(h)),false);
 for(const value of ['Bearer '+secret+' '+secret,'Bearer '+secret.repeat(20),'Basic '+secret])assert.equal(validToken(value,secret),false);
 assert.equal(validToken('Bearer '+secret.repeat(20),secret.repeat(20)),false);
});
