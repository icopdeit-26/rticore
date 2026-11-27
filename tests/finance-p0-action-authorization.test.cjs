const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, expect, tenant, users} = require('./helpers/service-operations-fixture.cjs');
test('P0: deny Finance writes without entity assignment and deny cross-menu action despite maker rights',async()=>{
  const h=fixture();
  try {
    const id='p0-sec-entity';
    await expect(h.call('erp/organization','POST','admin',{action:'create_unit',id,code:'P0-SEC',label:'P0 Security Entity',kind:'legal_entity',parent_id:null}),201);
    const grant=(email,role)=>h.sql.prepare("INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,can_make,can_check,status,requested_by,reviewed_by,review_notes) VALUES(?,?,?,?,?,1,1,'approved',?,?,?)").run('p0-'+email,tenant,email,role,id,users.admin,users.approver,'Independent synthetic role grant');
    grant(users.finance,'ar_officer');
    await expect(h.call('finance','POST','finance',{action:'create_enterprise_budget',legal_entity_id:id}),403);
    await expect(h.call('finance','POST','finance',{action:'create_tax_rule',legal_entity_id:id}),403);
    await expect(h.call('finance','POST','viewer',{action:'submit_expense_claim',legal_entity_id:id}),403);
    await expect(h.call('finance','POST','admin',{action:'configure_docking'}),403);
    await expect(h.call('finance','POST','finance',{action:'create_profit_center',legal_entity_id:id},'',{'x-finance-role':'cfo'}),403);
    assert.equal(h.sql.prepare('SELECT count(*) AS n FROM rticore_finance_budgets WHERE legal_entity_id=?').get(id).n,0);
  }finally{h.close()}
});
