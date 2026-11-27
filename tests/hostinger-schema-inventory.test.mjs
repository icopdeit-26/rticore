import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {duplicateMigrationVersions,schemaInventory,checkSchemaInventory,vendorScopeFKs,nativeLedgerCollisions} from '../scripts/hostinger-schema-inventory.mjs';
const expected=schemaInventory('CREATE TABLE IF NOT EXISTS t (id TEXT);','CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION fn();');
const good={tables:['t'],triggers:[{table:'t',name:'tr',function:'fn',function_schema:'public',enabled:'O'}],foreignKeys:vendorScopeFKs.map(r=>({...r,validated:true,target_schema:'public'}))};
test('migration numbering collision is rejected, separate streams allowed',()=>{
 assert.deepEqual(duplicateMigrationVersions(['0053_finance.sql','0053_pricing.sql','0054_flexguard.sql']),[['0053',['0053_finance.sql','0053_pricing.sql']]]);
 assert.deepEqual(duplicateMigrationVersions(['0053_finance.sql','0054_flexguard.sql']),[]);
});
test('actual repository inventory is parseable and migration stream is unique',()=>{
 const inv=schemaInventory(fs.readFileSync('rticore_postgresql_schema.sql','utf8'),fs.readFileSync('rticore_postgresql_triggers.sql','utf8'));
 assert.ok(inv.tables.includes('rticore_finance_vendor_bank_scopes'));
 assert.ok(inv.rules.length>200);
 for(const dir of ['migrations','deployment/hostinger/migrations','sql/native-postgres']){
  if(fs.existsSync(dir)) assert.deepEqual(duplicateMigrationVersions(fs.readdirSync(dir),dir),[],dir);
 }
});
test('correct trigger and validated scope FKs pass inventory',()=>{
 assert.ok(Object.values(checkSchemaInventory(expected,good)).every(v=>v.length===0));
});
test('wrong relation, function, schema or disabled trigger fail closed',()=>{
 for(const patch of [{table:'other'},{function:'other'},{function_schema:'other'},{enabled:'D'},{enabled:'R'}]){
  const actual={...good,triggers:[{...good.triggers[0],...patch}]};
  assert.equal(checkSchemaInventory(expected,actual).missingTriggers.length,1);
 }
});
test('missing and unvalidated foreign keys are release blockers',()=>{
 const missing={...good,foreignKeys:good.foreignKeys.slice(1)};
 assert.equal(checkSchemaInventory(expected,missing).missingVendorScopeFKs.length,1);
 const invalid={...good,foreignKeys:[{...good.foreignKeys[0],validated:false},...good.foreignKeys.slice(1)]};
 assert.equal(checkSchemaInventory(expected,invalid).missingVendorScopeFKs.length,1);
 assert.equal(checkSchemaInventory(expected,invalid).unvalidatedForeignKeys.length,1);
});
test('missing table and unsupported trigger syntax fail closed',()=>{
 assert.deepEqual(checkSchemaInventory(expected,{...good,tables:[]}).missingTables,['t']);
 assert.throws(()=>schemaInventory('CREATE TABLE IF NOT EXISTS t (id TEXT);','CREATE TRIGGER unsupported;'));
});
test('only the exact historical canonical 0002 pair is exempt, never a new duplicate',()=>{
 const legacy=['0002_ai_connections.sql','0002_rticore_boq_edit_seq.sql'];
 assert.deepEqual(duplicateMigrationVersions(legacy,'migrations'),[]);
 assert.equal(duplicateMigrationVersions(legacy,'deployment/hostinger/migrations').length,1);
 assert.equal(duplicateMigrationVersions([...legacy,'0002_other.sql'],'migrations').length,1);
 assert.equal(duplicateMigrationVersions(['0053_finance.sql','0053_pricing.sql'],'migrations').length,1);
});
test('reject conflicting native and legacy FlexGuard ledger schemas',()=>{
 const legacy='CREATE TABLE rticore_flexguard_credit_lots (id text); CREATE TABLE rticore_flexguard_enterprise_ledger (id text);';
 const native='CREATE TABLE IF NOT EXISTS rticore_flexguard_credit_lots (id text); CREATE TABLE IF NOT EXISTS rticore_flexguard_enterprise_ledger (id text);';
 assert.equal(nativeLedgerCollisions(legacy,native).length,2);
 assert.deepEqual(nativeLedgerCollisions('',native),[]);
});
