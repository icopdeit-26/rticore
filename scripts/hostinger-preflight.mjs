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
