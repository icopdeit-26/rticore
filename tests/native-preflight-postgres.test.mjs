// Real database regression: CI disposable PostgreSQL only. Never use live credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {checkNativeCompletion,assertNativeMfaEnrollment} from '../scripts/hostinger-native-completion.mjs';

test('native preflight requires migrations 0074–0076 guards and two enrolled administrators on real PostgreSQL',async()=>{
 const e=process.env;
 assert.equal(e.CI,'true');
 assert.equal(e.PGHOST,'127.0.0.1');
 assert.equal(e.PGPORT,'5432');
 assert.equal(e.PGUSER,'cams_ci');
 assert.ok(['cams_docking_ci','cams_docking_restore_ci'].includes(e.PGDATABASE));
 assert.ok(!e.PGSERVICE&&!e.PGHOSTADDR);
 const client=new pg.Client({host:'127.0.0.1',port:5432,user:'cams_ci',database:e.PGDATABASE,password:e.PGPASSWORD,ssl:false,connectionTimeoutMillis:5000,statement_timeout:10000});
 await client.connect();
 try{
  assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db,e.PGDATABASE);
  await client.query('BEGIN');
  assert.equal((await checkNativeCompletion(client)).applied_ledger_verified,false);
  await client.query('SAVEPOINT guard_probe');
  await client.query('ALTER TABLE public.rticore_native_job_recovery DISABLE TRIGGER rticore_native_recovery_guard');
  await assert.rejects(checkNativeCompletion(client),/object inventory incomplete/);
  await client.query('ROLLBACK TO SAVEPOINT guard_probe');
  await client.query('SAVEPOINT index_probe');
  await client.query('DROP INDEX public.rticore_native_job_recovery_once');
  await assert.rejects(checkNativeCompletion(client),/object inventory incomplete/);
  await client.query('ROLLBACK TO SAVEPOINT index_probe');
  assert.equal((await checkNativeCompletion(client)).applied_ledger_verified,false);
  await client.query('SAVEPOINT historical_probe');
  const oldSource=readFileSync('deployment/hostinger/migrations/0070_flexguard_historical_review.sql','utf8');
  const oldDefinition=oldSource.match(/CREATE OR REPLACE FUNCTION rticore_fg_historical_allocation_review\([\s\S]*?\$fg\$;/);
  assert.ok(oldDefinition,'superseded historical review definition missing');
  await client.query(oldDefinition[0]);
  await assert.rejects(checkNativeCompletion(client),/definition mismatch/);
  await client.query('ROLLBACK TO SAVEPOINT historical_probe');
  assert.equal((await checkNativeCompletion(client)).applied_ledger_verified,false);
  await client.query('SAVEPOINT ack_probe');
  await client.query('ALTER FUNCTION public.rticore_fg_independent_posting(text,text,text,text) STABLE');
  await assert.rejects(checkNativeCompletion(client),/definition mismatch/);
  await client.query('ROLLBACK TO SAVEPOINT ack_probe');
  assert.equal((await checkNativeCompletion(client)).applied_ledger_verified,false);
  // A stale pricing function has the same signature; presence alone cannot certify 0093.
  await client.query('SAVEPOINT pricing_probe');
  const oldPricing=readFileSync('deployment/hostinger/migrations/0092_native_pricing_tier_volume.sql','utf8');
  const stalePricing=oldPricing.match(/CREATE OR REPLACE FUNCTION rticore_catalog_workflow_command\([\s\S]*?\$cat\$;/);
  assert.ok(stalePricing,'superseded pricing definition missing');
  await client.query(stalePricing[0]);
  await assert.rejects(checkNativeCompletion(client),/definition mismatch/);
  await client.query('ROLLBACK TO SAVEPOINT pricing_probe');
  assert.equal((await checkNativeCompletion(client)).applied_ledger_verified,false);
  // Synthetic enrollment rows test the SQL inventory only, not actual TOTP authentication.
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.rticore_iam_credentials')).rows[0].n,0);
  await assert.rejects(assertNativeMfaEnrollment(client),/Two independently enrolled administrators/);
  for(const email of ['preflight-admin-one@example.invalid','preflight-admin-two@example.invalid']){
   await client.query("INSERT INTO public.rticore_members(email,role,active,created_by) VALUES($1,'admin',1,'ci')",[email]);
   await client.query("INSERT INTO public.rticore_iam_credentials(email,password_hash,totp_cipher,enrolled_at) VALUES($1,'synthetic-not-a-password-hash','synthetic-not-a-totp-seed',now())",[email]);
   if(email.includes('-one@'))await assert.rejects(assertNativeMfaEnrollment(client),/Two independently enrolled administrators/);
  }
  assert.equal(await assertNativeMfaEnrollment(client),true);
  await client.query("UPDATE public.rticore_members SET active=0 WHERE email='preflight-admin-two@example.invalid'");
  await assert.rejects(assertNativeMfaEnrollment(client),/Two independently enrolled administrators/);
 }finally{
  await client.query('ROLLBACK').catch(()=>{});
  await client.end();
 }
});
