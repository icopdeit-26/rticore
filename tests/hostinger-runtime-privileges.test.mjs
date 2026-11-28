import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRuntimeLeastPrivilege,assertCronDatabaseIdentity} from '../scripts/hostinger-runtime-privileges.mjs';
const clean={privileged_role:false,schema_create:false,schema_owner:false,object_owner:false,truncate_grant:false,function_owner:false,broad_builtin_role:false,excessive_table_grant:false};
test('least privilege accepts complete all-false inventory only',async()=>{assert.equal(await assertRuntimeLeastPrivilege({query:async sql=>{assert.match(sql,/pg_has_role/);assert.match(sql,/has_table_privilege/);assert.match(sql,/^SELECT/);return {rows:[clean]};}}),true);});
for(const key of Object.keys(clean))test('reject '+key,async()=>{await assert.rejects(assertRuntimeLeastPrivilege({query:async()=>({rows:[{...clean,[key]:true}]})}),/privilege certification failed/);});
test('missing or unknown inventory fails closed',async()=>{for(const rows of [[],[{}],[{...clean,object_owner:null}],[clean,clean]])await assert.rejects(assertRuntimeLeastPrivilege({query:async()=>({rows})}));});

test('cron database identity and login role are verified before privilege certification',async()=>{
 const valid={db:'staging',role:'cron',login_role:'cron'};
 for(const rows of [[],[valid,valid],[{...valid,db:'production'}],[{...valid,role:'owner'}],[{...valid,login_role:'owner'}]]){
  let queries=0;
  await assert.rejects(assertCronDatabaseIdentity({query:async()=>{queries++;return {rows};}},'staging','cron'),/identity mismatch/);
  assert.equal(queries,1);
 }
 let queries=0;
 const client={query:async()=>{queries++;return {rows:queries===1?[valid]:[clean]};}};
 assert.equal(await assertCronDatabaseIdentity(client,'staging','cron'),true);assert.equal(queries,2);
 await assert.rejects(assertCronDatabaseIdentity({query:async()=>{throw Error('unexpected query');}},'','cron'),/identity required/);
 await assert.rejects(assertCronDatabaseIdentity({query:async sql=>({rows:sql.includes('current_database')?[valid]:[{...clean,privileged_role:true}]})},'staging','cron'),/privilege certification failed/);
});
test('both native cron entry points enforce identity before executing their mutation paths',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const [path,operation] of [['run-native-sales-cron.mjs','const result=await runSalesCron'],['business-iam-cleanup.mjs','pg_try_advisory_lock(']]){
  const source=readFileSync(new URL('../scripts/'+path,import.meta.url),'utf8');
  const identity=source.indexOf('await assertCronDatabaseIdentity(client,expectedDatabase,expectedRole)');
  assert.ok(identity>source.indexOf('await client.connect()')&&identity<source.indexOf(operation));
  assert.match(source,/_EXPECTED_DATABASE/);
  assert.match(source,/decodeURIComponent\(url.pathname.slice\(1\)\)!==expectedDatabase/);
 }
});
