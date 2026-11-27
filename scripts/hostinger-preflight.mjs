import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { duplicateMigrationVersions, schemaInventory, checkSchemaInventory } from './hostinger-schema-inventory.mjs';

const url = validateHostingerConfig(process.env);
const { Client } = pg;
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const schema = fs.readFileSync(path.resolve('rticore_postgresql_schema.sql'), 'utf8');
  const triggers = fs.readFileSync(path.resolve('rticore_postgresql_triggers.sql'), 'utf8');
  const streams=['migrations','deployment/hostinger/migrations','sql/native-postgres'];
  for(const stream of streams) {
    if(!fs.existsSync(stream)) continue;
    const duplicates=duplicateMigrationVersions(fs.readdirSync(stream));
    if(duplicates.length) throw new Error('Duplicate migration versions in '+stream);
  }
  const nativeMigrations=streams.slice(1).filter(stream=>fs.existsSync(stream))
    .flatMap(stream=>fs.readdirSync(stream).filter(f=>/^\d{4}_.+\.sql$/.test(f)).map(f=>fs.readFileSync(path.join(stream,f),'utf8'))).join('\n');
  const expected=schemaInventory(schema,triggers,nativeMigrations);
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);
  const activeTriggers=(await client.query(`
    SELECT c.relname AS "table",t.tgname AS name,t.tgenabled AS enabled,p.proname AS function,pn.nspname AS function_schema
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND n.nspname='public'
  `)).rows;
  const foreignKeys=(await client.query(`
    SELECT c.relname AS "table",k.conname AS name,k.convalidated AS validated,
           r.relname AS target,rn.nspname AS target_schema,
           ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY AS x(num,ord)
                 JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord) AS columns,
           ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY AS x(num,ord)
                 JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord) AS target_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class r ON r.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
    WHERE k.contype='f' AND n.nspname='public' AND left(c.relname,8)='rticore_'
  `)).rows;
  const gaps=checkSchemaInventory(expected,{tables,triggers:activeTriggers,foreignKeys});
  if(Object.values(gaps).some(items=>items.length)) {
    console.error('Schema inventory gaps:',JSON.stringify(Object.fromEntries(Object.entries(gaps).map(([key,items])=>[key,items.length]))));
    throw new Error('Schema, trigger binding or foreign key certification incomplete');
  }
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
