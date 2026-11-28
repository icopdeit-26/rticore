import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyEvent,summarizeEvents,scanFlexGuardExceptionRegister,scanFlexGuardHistoricalEvidence,scanSettlementEvidence,scanFlexGuardAllocationControls} from '../scripts/finance-historical-reconciliation.mjs';
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

test('settlement evidence checks all actor pairs and blank processing metadata',async()=>{
 const expected={processed_unposted_journal:'0',invalid_period_scope:'0',missing_posting_evidence:'4',missing_processing_evidence:'1'};
 const client={query:async sql=>{
  for(const actor of ['created_by','reviewed_by','posted_by']) assert.ok(sql.includes("nullif(btrim("+actor+"),'') IS NULL"));
  for(const [a,b] of [['created_by','reviewed_by'],['created_by','posted_by'],['reviewed_by','posted_by']]) assert.ok(sql.includes('lower(btrim('+a+'))=lower(btrim('+b+'))'));
  assert.ok(sql.includes("nullif(btrim(processed_by),'') IS NULL"));
  assert.ok(sql.includes("j.status IS DISTINCT FROM 'posted'"));
  return {rows:[expected]};
 }};
 assert.deepEqual(await scanSettlementEvidence(client),expected);
});
test('allocation controls require scoped joins and three independent actors',async()=>{
 const expected={unverified_lot_allocations:'0',legacy_journal_workflow_review:'1',acknowledged_amount_mismatch:'0'};
 const client={query:async sql=>{
  if(sql.includes('to_regclass'))return {rows:[{ready:true}]};
  for(const expression of ['e.legal_entity_id=f.legal_entity_id','j.legal_entity_id=f.legal_entity_id','e.legal_entity_id=l.legal_entity_id','lower(btrim(j.created_by))<>lower(btrim(j.reviewed_by))'])assert.ok(sql.includes(expression));
  return {rows:[expected]};
 }};
 assert.deepEqual(await scanFlexGuardAllocationControls(client),{schema_status:'AVAILABLE',...expected});
});
test('PostgreSQL settlement scanner detects actor conflicts and blank processing evidence',{skip:!process.env.RTICORE_RECON_CI_URL},async()=>{
 const url=new URL(process.env.RTICORE_RECON_CI_URL);
 assert.equal(url.hostname,'127.0.0.1');
 assert.equal(url.pathname,'/rticore_recon_ci');
 const {default:pg}=await import('pg');
 const client=new pg.Client({connectionString:url.toString()});
 await client.connect();
 try{
  await client.query('BEGIN');
  await client.query(`
   CREATE TABLE public.rticore_gl_periods(tenant_id text,id text,legal_entity_id text);
   CREATE TABLE public.rticore_gl_journals(tenant_id text,id text,legal_entity_id text,period_id text,status text,created_by text,reviewed_by text,posted_by text,posted_at text);
   CREATE TABLE public.rticore_finance_integration_events(tenant_id text,legal_entity_id text,resulting_journal_id text,status text,processed_at text,processed_by text);
   INSERT INTO public.rticore_gl_periods VALUES('t','p','e');
   INSERT INTO public.rticore_gl_journals VALUES
    ('t','valid','e','p','posted','maker','checker','poster','2026-11-28'),
    ('t','mc','e','p','posted','maker',' MAKER ','poster','2026-11-28'),
    ('t','mp','e','p','posted','maker','checker',' MAKER ','2026-11-28'),
    ('t','cp','e','p','posted','maker','checker',' CHECKER ','2026-11-28'),
    ('t','blank','e','p','posted','maker','checker',' ','2026-11-28'),
    ('t','null','e','p','posted',NULL,'checker','poster','2026-11-28'),
    ('t','date','e','p','posted','maker','checker','poster',' '),
    ('t','not-posted','e','p',NULL,'maker','checker','poster',NULL);
   INSERT INTO public.rticore_finance_integration_events VALUES
    ('t','e','valid','processed','2026-11-28','processor'),
    ('t','e','valid','processed','2026-11-28',' '),
    ('t','e','not-posted','processed','2026-11-28','processor');
  `);
  assert.deepEqual(await scanSettlementEvidence(client),{processed_unposted_journal:'1',invalid_period_scope:'0',missing_posting_evidence:'6',missing_processing_evidence:'1'});
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
