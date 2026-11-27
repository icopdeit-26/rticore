const {test}=require('node:test');const assert=require('node:assert/strict');
const {journalEnvelope,envelopeHash,validToken,lineSignature}=require('../src/lib/cams-journal-contract.ts');
const id='12345678-1234-1234-1234-123456789abc';
const input={schemaVersion:'cams-journal/1',sourceSystem:'CAMSRTI',tenantId:id,journalId:id,idempotencyKey:'OUTBOX-JRN-'+id,period:'2026-11',currency:'IDR',sourceType:'tuition_payment',journalNumber:'JRN-1',totalDebit:'100.00',totalCredit:'100.00',lines:[{accountCode:'CASH',costCenterId:null,debitAmount:'100.00',creditAmount:'0.00'},{accountCode:'AR',costCenterId:null,debitAmount:'0.00',creditAmount:'100.00'}]};
test('balanced envelope deterministic hash',()=>assert.equal(envelopeHash(journalEnvelope(input)),envelopeHash(journalEnvelope({...input}))));
test('rejects nonmatching totals',()=>assert.throws(()=>journalEnvelope({...input,totalCredit:'99.00'})));
test('rejects wrong source and key',()=>{assert.throws(()=>journalEnvelope({...input,sourceSystem:'RTICORE'}));assert.throws(()=>journalEnvelope({...input,idempotencyKey:'other'}));});
test('requires strong service credential',()=>{assert.equal(validToken('Bearer short','short'),false);assert.equal(validToken('Bearer '+ 'a'.repeat(32),'a'.repeat(32)),true);assert.equal(validToken('Bearer '+ 'b'.repeat(32),'a'.repeat(32)),false);});
test('line signature compares accounts and amounts irrespective of order',()=>{const x=[{accountId:'a',debit:'100',credit:'0'},{accountId:'b',debit:'0',credit:'100'}];assert.equal(lineSignature(x),lineSignature([...x].reverse()));assert.notEqual(lineSignature(x),lineSignature([{...x[0],accountId:'c'},x[1]]));});
