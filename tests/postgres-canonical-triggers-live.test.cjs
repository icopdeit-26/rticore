const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Client}=require('pg');
test('canonical PostgreSQL schema, all generated business rule triggers and migration inventory',async()=>{
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.RTICORE_ATOMIC_TEST_URL,'postgresql://rticore_ci:rticore_ci_only@127.0.0.1:5432/rticore_atomic_ci');
 const admin=new Client({connectionString:process.env.RTICORE_ATOMIC_TEST_URL});
 const db=new Client({connectionString:'postgresql://rticore_ci:rticore_ci_only@127.0.0.1:5432/rticore_trigger_ci'});
 await admin.connect();
 try{await admin.query('CREATE DATABASE rticore_trigger_ci')}finally{await admin.end()}
 await db.connect();
 try{
 const schema=fs.readFileSync('rticore_postgresql_schema.sql','utf8');
 const triggerSql=fs.readFileSync('rticore_postgresql_triggers.sql','utf8');
 await db.query(schema);
 await db.query(fs.readFileSync('deployment/hostinger/migrations/0053_finance_vendor_bank_entity_scope.sql','utf8'));
 await db.query(fs.readFileSync('deployment/hostinger/migrations/0054_finance_entity_constraints.sql','utf8'));
 await db.query(triggerSql);
 const expected=[...triggerSql.matchAll(/CREATE TRIGGER (\w+) .*? ON (\w+) /g)].map(m=>m[2]+'.'+m[1]).sort();
 assert.ok(expected.length>=267,'canonical trigger inventory unexpectedly reduced');
 const actual=(await db.query("SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")).rows;
 assert.deepEqual(actual.map(r=>r.relname+'.'+r.tgname).sort(),expected);
 assert.ok(actual.every(r=>['O','A'].includes(r.tgenabled)));
 const fks=JSON.parse(fs.readFileSync('deployment/hostinger/migrations/0054_entity_constraints.json','utf8'));
 const actualFks=(await db.query("SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.convalidated")).rows.map(r=>r.conname);
 assert.ok(fks.every(f=>actualFks.includes(f.name)));
 for(const file of ['0057_flexguard_native_enterprise.sql','0058_flexguard_finance_receiver.sql','0059_flexguard_wallet_onboarding.sql','0060_flexguard_allocation_and_journal_controls.sql','0061_flexguard_maintenance_queue.sql']){
  const migration=fs.readFileSync('deployment/hostinger/migrations/'+file,'utf8');
  await db.query(migration);await db.query(migration);
 }
 const fg=(await db.query("SELECT to_regclass('public.rticore_flexguard_enterprise_ledger') IS NOT NULL AS ledger,to_regclass('public.rticore_flexguard_credit_lots') IS NOT NULL AS lots,to_regclass('public.rticore_flexguard_requests') IS NOT NULL AS requests,to_regclass('public.rticore_fg_finance_links') IS NOT NULL AS links,to_regprocedure('public.rticore_fg_submit(text,text,text,text,text,bigint,text,text,text,text,text,text)') IS NOT NULL AS submit,to_regprocedure('public.rticore_fg_review(text,text,text,text,boolean,text)') IS NOT NULL AS review,to_regprocedure('public.rticore_fg_dock(text,text,text,text,text,text,text,text)') IS NOT NULL AS dock,to_regprocedure('public.rticore_fg_wallet_command(text,text,text,text,text,bigint,text)') IS NOT NULL AS wallet")).rows[0];
 assert.ok(Object.values(fg).every(Boolean));
 const ctrl=(await db.query("SELECT to_regclass('public.rticore_fg_invoice_allocations') IS NOT NULL AS allocation,to_regprocedure('public.rticore_fg_allocate_invoice(text,text,text,text,text,text,bigint,text)') IS NOT NULL AS allocate,to_regprocedure('public.rticore_fg_journal_command(text,text,text,text,text,text)') IS NOT NULL AS journal")).rows[0];
 assert.ok(Object.values(ctrl).every(Boolean));
 const guards=(await db.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A') AND tgname IN ('rticore_fg_allocation_immutable','rticore_fg_lot_allocation','rticore_fg_link_policy','rticore_fg_outbox_guard','rticore_fg_journal_control')")).rows;
 assert.equal(guards.length,5);
 await assert.rejects(db.query("SELECT rticore_fg_allocate_invoice('synthetic','unassigned','unknown@example.invalid','submit','none','invoice',1,'Synthetic denied allocation')"),/FLEXGUARD_ACCESS_DENIED/);
 await assert.rejects(db.query("SELECT rticore_fg_journal_command('synthetic','unassigned','unknown@example.invalid','none','post','Synthetic denied posting')"),/FLEXGUARD_ACCESS_DENIED/);
 await assert.rejects(db.query("SELECT rticore_fg_submit('synthetic','unassigned','unknown@example.invalid','none','purchase',1,'invoice',NULL,NULL,NULL,'synthetic-request-key','Synthetic denied request')"),/FLEXGUARD_ACCESS_DENIED/);
 await assert.rejects(db.query("SELECT rticore_fg_dock('synthetic','unassigned','unknown@example.invalid','none','ack',NULL,NULL,NULL)"),/FLEXGUARD_ACCESS_DENIED/);

 await assert.rejects(db.query("SELECT * FROM rticore_fg_retry_due('synthetic','unassigned','unknown@example.invalid',NULL,1)"),/FLEXGUARD_ACCESS_DENIED/);
 await assert.rejects(db.query("SELECT * FROM rticore_fg_expiry_due('synthetic','unassigned','unknown@example.invalid',1)"),/FLEXGUARD_ACCESS_DENIED/);
 }finally{await db.end()}
});
