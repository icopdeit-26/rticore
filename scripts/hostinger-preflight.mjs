import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const url = validateHostingerConfig(process.env);
const { Client } = pg;
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const schema = fs.readFileSync(path.resolve('rticore_postgresql_schema.sql'), 'utf8');
  const triggers = fs.readFileSync(path.resolve('rticore_postgresql_triggers.sql'), 'utf8');
  const expectedTables = [...new Set([...(schema+'\n'+triggers).matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1]))];
  const expectedTriggers = [...new Set([...triggers.matchAll(/CREATE TRIGGER\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1]))];
  if (!expectedTables.length || !expectedTriggers.length) throw new Error('Missing schema manifest');
  const tables = new Set((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename));
  const activeTriggers = new Set((await client.query("SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND n.nspname='public'")).rows.map(r=>r.tgname));
  const missingTables = expectedTables.filter(t=>!tables.has(t));
  const missingTriggers = expectedTriggers.filter(t=>!activeTriggers.has(t));
  if (missingTables.length || missingTriggers.length) throw new Error('Schema or trigger migration incomplete');
  const entityManifest=JSON.parse(fs.readFileSync(path.resolve('deployment/hostinger/migrations/0054_entity_constraints.json'),'utf8'));
  const entityFks=await client.query(`SELECT c.conname,child.relname AS child,parent.relname AS parent,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS child_columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=child.relnamespace JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE c.contype='f' AND c.convalidated AND n.nspname='public' AND pn.nspname='public'`);
  if(!entityManifest.every(e=>entityFks.rows.some(r=>r.conname===e.name&&r.child===e.table&&r.parent===e.parent&&JSON.stringify(r.child_columns)===JSON.stringify(['tenant_id','legal_entity_id',e.column])&&JSON.stringify(r.parent_columns)===JSON.stringify(['tenant_id','legal_entity_id','id']))))throw new Error('Validated entity FK inventory incomplete');
  const fg=await client.query("SELECT to_regclass('public.rticore_flexguard_enterprise_ledger') IS NOT NULL AS ledger,to_regclass('public.rticore_flexguard_credit_lots') IS NOT NULL AS lots,to_regclass('public.rticore_flexguard_requests') IS NOT NULL AS requests,to_regprocedure('public.rticore_fg_review(text,text,text,text,boolean,text)') IS NOT NULL AS review,to_regprocedure('public.rticore_fg_submit(text,text,text,text,text,bigint,text,text,text,text,text,text)') IS NOT NULL AS submit");
  if(!Object.values(fg.rows[0]||{}).every(Boolean)||!fg.rows.length)throw new Error('FlexGuard 0057 migration incomplete');
  const account = await client.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user");
  if (Object.values(account.rows[0] || {}).some(Boolean)) throw new Error('Runtime role has excessive database privileges');
  const active = await client.query("SELECT 1 FROM rticore_members WHERE active=1 LIMIT 1");
  if (!active.rowCount) throw new Error('No active membership provisioned');
  await client.query('ROLLBACK');
  console.log('Hostinger core preflight passed; Finance release certification remains separate.');
} catch {
  console.error('Hostinger preflight failed. Verify TLS, database privileges, membership and migration inventory. No database changes were made.');
  process.exitCode = 1;
} finally {
  await client.end().catch(()=>{});
}
