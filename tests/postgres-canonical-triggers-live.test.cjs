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
 }finally{await db.end()}
});
