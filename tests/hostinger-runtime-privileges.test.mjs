import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRuntimeLeastPrivilege} from '../scripts/hostinger-runtime-privileges.mjs';
const clean={privileged_role:false,schema_create:false,schema_owner:false,object_owner:false,truncate_grant:false,function_owner:false,broad_builtin_role:false,excessive_table_grant:false};
test('least privilege accepts complete all-false inventory only',async()=>{assert.equal(await assertRuntimeLeastPrivilege({query:async sql=>{assert.match(sql,/pg_has_role/);assert.match(sql,/has_table_privilege/);assert.match(sql,/^SELECT/);return {rows:[clean]};}}),true);});
for(const key of Object.keys(clean))test('reject '+key,async()=>{await assert.rejects(assertRuntimeLeastPrivilege({query:async()=>({rows:[{...clean,[key]:true}]})}),/privilege certification failed/);});
test('missing or unknown inventory fails closed',async()=>{for(const rows of [[],[{}],[{...clean,object_owner:null}],[clean,clean]])await assert.rejects(assertRuntimeLeastPrivilege({query:async()=>({rows})}));});
