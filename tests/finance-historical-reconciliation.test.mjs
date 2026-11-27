import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyEvent,summarizeEvents,scanFlexGuardExceptionRegister,scanFlexGuardHistoricalEvidence} from '../scripts/finance-historical-reconciliation.mjs';
const payload='{"amount":42,"note":"uji integritas"}';
const digest=createHash('sha256').update(payload).digest('hex');
test('exact stored UTF-8 digest matches',()=>assert.equal(classifyEvent({payload_json:payload,payload_sha256:digest}),'digest_valid'));
test('legacy pseudo-digest and altered payload are not automatically trusted',()=>{
  assert.equal(classifyEvent({payload_json:payload,payload_sha256:'a'.repeat(64)}),'requires_source_reconciliation');
  assert.equal(classifyEvent({payload_json:payload.replace('42','43'),payload_sha256:digest}),'requires_source_reconciliation');
});
test('invalid JSON and nonobject payloads are rejected',()=>{
  for(const payload_json of ['{','null','[]','42']) assert.equal(classifyEvent({payload_json,payload_sha256:digest}),'invalid_payload');
});
test('processed exceptions are counted separately without mutating rows',()=>{
  const rows=Object.freeze([Object.freeze({payload_json:payload,payload_sha256:digest,status:'validated'}),Object.freeze({payload_json:payload,payload_sha256:'b'.repeat(64),status:'processed'}),Object.freeze({payload_json:'{',payload_sha256:digest,status:'failed'})]);
  assert.deepEqual(summarizeEvents(rows),{total:3,digest_valid:1,invalid_payload:1,requires_source_reconciliation:1,processed_exceptions:1});
});

test('FlexGuard exception register uses aggregate read-only scoped joins and preserves blockers',async()=>{
 const expected=[{transaction_type:'top_up',reason_code:'MISSING_OUTBOX_SOURCE_REVIEW',entries:'1',evidence_value_cents:'100000'}];
 const client={query:async sql=>{assert.match(sql,/^SELECT /);assert.match(sql,/e.legal_entity_id=l.legal_entity_id/);assert.match(sql,/j.status IS DISTINCT FROM 'posted'/);assert.match(sql,/GROUP BY 1,2/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER)\b/i);return {rows:expected};}};
 assert.deepEqual(await scanFlexGuardExceptionRegister(client),expected);
});

test('historical evidence coverage remains read-only and is not equivalent to approval',async()=>{
 const evidence={allocation_exceptions:'3',allocation_source_candidates:'3',missing_allocation_records:'3',monetary_exceptions:'2',matching_independent_request_candidates:'2',journal_lifecycle_exceptions:'1',journal_distinct_actor_candidates:'0'};
 const client={query:async sql=>{assert.match(sql,/^WITH exceptions AS/);assert.match(sql,/r.legal_entity_id=l.legal_entity_id/);assert.match(sql,/lower\(r.approved_by\)=lower\(l.approved_by\)/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER)\b/i);return {rows:[evidence]};}};
 assert.deepEqual(await scanFlexGuardHistoricalEvidence(client),evidence);
});
