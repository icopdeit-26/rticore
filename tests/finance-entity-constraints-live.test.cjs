const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Pool}=require('pg');
test('PostgreSQL 16: entity composite FK migration idempotency and cross-entity rejection',async()=>{
 assert.equal(process.env.CI,'true');
 assert.equal(process.env.RTICORE_ATOMIC_TEST_URL,'postgresql://rticore_ci:rticore_ci_only@127.0.0.1:5432/rticore_atomic_ci');
 const manifest=JSON.parse(fs.readFileSync('deployment/hostinger/migrations/0054_entity_constraints.json','utf8'));
 const migration=fs.readFileSync('deployment/hostinger/migrations/0054_finance_entity_constraints.sql','utf8');
 const pool=new Pool({connectionString:process.env.RTICORE_ATOMIC_TEST_URL,max:1});
 const db=await pool.connect();
 try{
  await db.query('CREATE SCHEMA p0_entity_ci');
  await db.query('SET search_path TO p0_entity_ci');
  const tables=new Map();
  for(const e of manifest){if(!tables.has(e.table))tables.set(e.table,new Set());if(!tables.has(e.parent))tables.set(e.parent,new Set());tables.get(e.table).add(e.column)}
  for(const [name,cols] of tables){await db.query('CREATE TABLE '+name+'(tenant_id text NOT NULL,legal_entity_id text NOT NULL,id text NOT NULL,PRIMARY KEY(tenant_id,id)'+[...cols].map(c=>','+c+' text').join('')+')');await db.query('INSERT INTO '+name+'(tenant_id,legal_entity_id,id) VALUES($1,$2,$3),($1,$4,$5)',['test','A','a','B','b'])}
  await db.query(migration);await db.query(migration);
  for(const e of manifest){
   await db.query('UPDATE '+e.table+' SET '+e.column+'=$1 WHERE tenant_id=$2 AND id=$3',['a','test','a']);
   await assert.rejects(db.query('UPDATE '+e.table+' SET '+e.column+'=$1 WHERE tenant_id=$2 AND id=$3',['b','test','a']),{code:'23503'});
  }
  const validated=(await db.query("SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='p0_entity_ci' AND c.contype='f' AND c.convalidated")).rows[0].n;
  assert.equal(validated,manifest.length);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.query('RESET search_path').catch(()=>{});await db.query('DROP SCHEMA IF EXISTS p0_entity_ci CASCADE').catch(()=>{});db.release();await pool.end()}
});
