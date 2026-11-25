const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,expect}=require('./helpers/service-operations-fixture.cjs');

test('BoQ list and export enforce reader roles and Sales ownership',async()=>{
 const h=fixture();
 try{
  const id=h.sql.prepare('SELECT id FROM rticore_boq LIMIT 1').get().id;
  const query='?id='+id+'&format=customer';
  const exportBoq=h.load('src/app/api/boq/export/route.ts').GET;
  const exportRequest=role=>exportBoq(new Request('https://flow.invalid/api/boq/export'+query,{headers:{'x-test-role':role}}));
  await expect(h.call('boq','GET','marketing'),403);
  assert.equal((await exportRequest('marketing')).status,403);
  assert.equal((await exportRequest('other')).status,404);
  await expect(h.call('boq','GET','viewer'),200);
 }finally{h.close();}
});

test('Scoping pricing separates indicative selling price from internal costs',async()=>{
 const h=fixture();
 try{
  const ctx={client_tier:'A',location_type:'remote',urgency:'normal',total_md:'20',role_md:{},costs:{D:'900000000'}};
  const input={service:'GRC',ctx,serviceValues:{}};
  const sales=await expect(h.call('scoping/model','POST','sales',input),200);
  const presales=await expect(h.call('scoping/model','POST','presales',{...input,ctx:{...ctx,costs:{}}}),200);
  const approver=await expect(h.call('scoping/model','POST','approver',input),200);
  const admin=await expect(h.call('scoping/model','POST','admin',input),200);
  assert.equal(sales.body.canViewCost,false);
  assert.equal(sales.body.estimate.standard,presales.body.estimate.standard);
  assert.equal(approver.body.estimate.standard,sales.body.estimate.standard);
  assert.equal(approver.body.canViewCost,false);
  assert.equal(sales.body.estimate.floor,null);
  assert.equal(sales.body.estimate.marginAtStandard,null);
  assert.equal(sales.body.estimate.totalInternalCost,0);
  assert.ok(sales.body.estimate.staffing.every(row=>row.rate===0&&row.subtotal===0));
  assert.equal(admin.body.canViewCost,true);
  assert.equal(admin.body.estimate.costs.D,900000000);
  await expect(h.call('scoping/model','POST','viewer',input),403);
 }finally{h.close();}
});
