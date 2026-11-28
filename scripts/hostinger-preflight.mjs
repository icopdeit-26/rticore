import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';
import pg from 'pg';
import {checkNativeCompletion,assertNativeMfaEnrollment} from './hostinger-native-completion.mjs';
import {assertRuntimeLeastPrivilege} from './hostinger-runtime-privileges.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { duplicateMigrationVersions, schemaInventory, checkSchemaInventory, nativeLedgerCollisions } from './hostinger-schema-inventory.mjs';

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
    const duplicates=duplicateMigrationVersions(fs.readdirSync(stream),stream);
    if(duplicates.length) throw new Error('Duplicate migration versions in '+stream);
  }
  const nativeMigrations=streams.slice(1).filter(stream=>fs.existsSync(stream))
    .flatMap(stream=>fs.readdirSync(stream).filter(f=>/^\d{4}_.+\.sql$/.test(f)).map(f=>fs.readFileSync(path.join(stream,f),'utf8'))).join('\n');
  const canonical=fs.readdirSync('migrations').filter(f=>/^\d{4}_.+\.sql$/.test(f)).map(f=>fs.readFileSync(path.join('migrations',f),'utf8')).join('\n');
  if(nativeLedgerCollisions(schema+'\n'+canonical,nativeMigrations).length) throw new Error('Conflicting native and legacy FlexGuard ledger definitions');
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
  const fgDock=await client.query("SELECT to_regclass('public.rticore_fg_finance_links') IS NOT NULL AS links,to_regprocedure('public.rticore_fg_dock(text,text,text,text,text,text,text,text)') IS NOT NULL AS dock");
  if(!fgDock.rows.length||!Object.values(fgDock.rows[0]).every(Boolean))throw new Error('FlexGuard 0058 Finance docking migration incomplete');
  const fgWallet=await client.query("SELECT to_regprocedure('public.rticore_fg_wallet_command(text,text,text,text,text,bigint,text)') IS NOT NULL AS ready");
  if(fgWallet.rows[0]?.ready!==true)throw new Error('FlexGuard 0059 wallet migration incomplete');
  const fgControl=await client.query("SELECT to_regclass('public.rticore_fg_invoice_allocations') IS NOT NULL AS allocations,to_regprocedure('public.rticore_fg_allocate_invoice(text,text,text,text,text,text,bigint,text)') IS NOT NULL AS allocation,to_regprocedure('public.rticore_fg_journal_command(text,text,text,text,text,text)') IS NOT NULL AS journal");
  if(!fgControl.rows.length||!Object.values(fgControl.rows[0]).every(Boolean))throw new Error('FlexGuard 0060 control migration incomplete');
  const maintenance=await client.query("SELECT to_regclass('public.rticore_fg_retry_attempts') IS NOT NULL AS attempts,to_regprocedure('public.rticore_fg_retry_due(text,text,text,text,integer)') IS NOT NULL AS retry,to_regprocedure('public.rticore_fg_expiry_due(text,text,text,integer)') IS NOT NULL AS expiry");
  if(!maintenance.rows.length||!Object.values(maintenance.rows[0]).every(Boolean))throw new Error('FlexGuard 0061 maintenance migration incomplete');
  const product=await client.query(`SELECT
    to_regprocedure('public.rticore_fg_product_command(text,text,text,text,text,jsonb)') IS NOT NULL AS product_command,
    to_regprocedure('public.rticore_fg_bind_contract(text,text,text,text,text,text,text)') IS NOT NULL AS binding_command,
    to_regprocedure('public.rticore_fg_contract_binding_valid(text,text,text,text)') IS NOT NULL AS binding_validation,
    to_regprocedure('public.rticore_fg_bound_wallet_command(text,text,text,text,text,text)') IS NOT NULL AS bound_wallet,
    to_regprocedure('public.rticore_fg_psa_submit(text,text,text,text,text,text,text,text,jsonb,text,text)') IS NOT NULL AS psa_submit,
    to_regprocedure('public.rticore_fg_psa_source_valid(text,text,text,text)') IS NOT NULL AS psa_source,
    EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.rticore_fg_psa_consumption_evidence') AND c.contype='p' AND c.convalidated AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)=ARRAY['tenant_id','timesheet_id']) AS unique_timesheet
  `);
  if(!product.rows.length||!Object.values(product.rows[0]).every(Boolean))throw new Error('FlexGuard 0063–0066 contract and PSA migration incomplete');
  const catalog=await client.query("SELECT to_regprocedure('public.rticore_catalog_command(text,text,text,text,text,jsonb)') IS NOT NULL AS master,to_regprocedure('public.rticore_catalog_workflow_command(text,text,text,text,text,jsonb)') IS NOT NULL AS workflow,to_regclass('public.rticore_catalog_pricing_snapshots') IS NOT NULL AS snapshots");
  if(!catalog.rows.length||!Object.values(catalog.rows[0]).every(Boolean))throw Error('Service Catalog migrations 0067–0068 incomplete');
  await checkNativeCompletion(client);
  await assertRuntimeLeastPrivilege(client);
  const active = await client.query("SELECT 1 FROM rticore_members WHERE active=1 LIMIT 1");
  if (!active.rowCount) throw new Error('No active membership provisioned');
  if(process.env.RTICORE_AUTH_MODE==='business'){
    await assertNativeMfaEnrollment(client);
  }
  await client.query('ROLLBACK');
  console.log('Hostinger core preflight passed; Finance release certification remains separate.');
} catch {
  console.error('Hostinger preflight failed. Verify TLS, database privileges, membership and migration inventory. No database changes were made.');
  process.exitCode = 1;
} finally {
  await client.end().catch(()=>{});
}
