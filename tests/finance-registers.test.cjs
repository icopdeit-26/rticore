const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source=fs.readFileSync('src/lib/finance-registers.ts','utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={}; new Function('exports',output)(api);
test('all 25 menu IDs have explicit register definitions',()=>{
  assert.deepEqual(Object.keys(api.FINANCE_REGISTERS),Array.from({length:25},(_,i)=>'F'+String(i+1).padStart(2,'0')));
  assert.deepEqual(api.FINANCE_REGISTERS.F05,['apInvoices','apExtensions','vendorBanks']);
  assert.deepEqual(api.FINANCE_REGISTERS.F24,[]);
});
test('register projection excludes secrets and protects formula injection',()=>{
  const rows=api.registerRows([{id:'=1+1',name:'A,"B"',status:'ok',amount_cents:0,webhook_secret_sha256:'SECRET',bank_account_number:'SENSITIVE'}]);
  assert.equal(rows[0].debit,'0');
  const csv=api.registerCSV(rows);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"A,""B"""'));
  assert.ok(!csv.includes('SECRET') && !csv.includes('SENSITIVE'));
});
test('workstation cancels obsolete requests and hides unverified data',()=>{
  const ui=fs.readFileSync('src/components/finance/RTIFinanceWorkstation.tsx','utf8');
  assert.match(ui,/controller\.signal\.aborted/);
  assert.match(ui,/json\.legalEntityId !== selectedEntity/);
  assert.match(ui,/!payload \? <div role="status"/);
  assert.doesNotMatch(ui,/x-finance-role/);
});
