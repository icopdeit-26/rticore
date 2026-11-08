// Role project_manager: menu set, migration 0047, and API scope limited to the
// delivery project where the account is the assigned PM (pm_email).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {fixture,won,upload,operation,project,today,expect,tenant,users}=require('./helpers/service-operations-fixture.cjs');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

function navigation(){
 const file='src/lib/enterprise-navigation.ts',out={};
 vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:n=>{throw Error('Unexpected '+n);}});
 return out;
}
const plusDays=n=>new Date(Date.now()+7*3600000+n*86400000).toISOString().slice(0,10);
async function assigned(){
 const h=await won(fixture());
 await expect(operation(h,'presales','assign',{pm_email:users.project_manager,start_date:today(),end_date:plusDays(45)}),200);
 return h;
}

test('Project Manager menu: delivery, timesheets, FlexGuard and Vault only',()=>{
 const {navigationForRole,canOpenRoute}=navigation();
 const routes=navigationForRole('project_manager').flatMap(g=>g.items.map(i=>i.href));
 assert.deepEqual(Array.from(routes),['/sales/delivery','/psa/timesheets','/flexguard','/sales/documents']);
 for(const href of ['/boq','/sales/pipeline','/customers','/sales/billing','/sales/revenue','/approvals','/erp/general-ledger','/settings/system'])
  assert.equal(canOpenRoute('project_manager',href),false,href);
 for(const file of ['src/lib/boq-domain.ts','src/lib/boq-auth.ts','src/lib/sales-access.ts','scripts/rticore-local-setup.mjs'])
  assert.match(read(file),/'project_manager'/,file);
});

test('migration 0047 accepts project_manager members, keeps FK children and still rejects unknown roles',()=>{
 const h=fixture();try{
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.project_manager).role,'project_manager');
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.pm_other).role,'project_manager');
  assert.throws(()=>h.sql.prepare("INSERT INTO rticore_members(email,role) VALUES('x@flow.invalid','pm')").run(),/CHECK/);
  assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='rticore_members_backup_0047'").get().n,0);
 }finally{h.close();}
});

test('PM is assignable, then works only on its own project and never gains planning, commercial or finance actions',async()=>{
 const h=await assigned();try{
  assert.equal(project(h).pm_email,users.project_manager);
  const own=await expect(h.call('sales/service-operations','GET','project_manager',null,'?opportunity_id=opp-qa'),200);
  assert.equal(own.body.project.budget_idr,undefined,'HPP budget hidden from PM');
  assert.deepEqual(own.body.assignments,[]);
  await expect(h.call('sales/service-operations','GET','pm_other',null,'?opportunity_id=opp-qa'),403);
  await expect(h.call('sales/service-operations','GET','project_manager',null,'?view=renewals'),403);
  await expect(operation(h,'project_manager','assign',{pm_email:users.project_manager,start_date:today(),end_date:plusDays(30)}),403);
  await expect(operation(h,'pm_other','milestone',{title:'Foreign PM milestone',trigger_text:'Signed BAST',amount_idr:1000,due_date:today()}),403);
  const m=await expect(operation(h,'project_manager','milestone',{title:'Fieldwork completed',trigger_text:'Signed customer BAST',amount_idr:500000,due_date:today()}),201);
  const doc=await expect(upload(h,'supporting','project_manager'),201);
  await expect(operation(h,'project_manager','accept_milestone',{id:m.body.id,document_id:doc.body.id}),403);
  await expect(operation(h,'finance','accept_milestone',{id:m.body.id,document_id:doc.body.id}),201);
  await expect(operation(h,'project_manager','invoice',{milestone_id:m.body.id,document_id:doc.body.id,number:'INV-PM',issue_date:today(),due_date:today(),amount_idr:500000,vat_idr:55000}),403);
 }finally{h.close();}
});

test('PM project list, Vault and BoQ follow the PM scope',async()=>{
 const h=await assigned();try{
  const deals=await expect(h.call('sales','GET','project_manager',null,'?entity=deals'),200);
  assert.deepEqual(deals.body.deals.map(d=>d.id),['opp-qa']);
  assert.equal((await expect(h.call('sales','GET','pm_other',null,'?entity=deals'),200)).body.deals.length,0);
  await expect(h.call('sales','GET','project_manager',null,'?entity=accounts'),403);
  await expect(h.call('sales','GET','project_manager',null,'?entity=details&id=opp-qa'),403);
  await expect(h.call('boq','GET','project_manager',null),403);
  await expect(upload(h,'supporting','project_manager'),201);
  await expect(upload(h,'supporting','pm_other'),403);
  const vault=await expect(h.call('sales/document-vault','GET','project_manager',null,'?opportunity_id=opp-qa'),200);
  assert.ok(vault.body.documents.length>0);
  assert.ok(vault.body.documents.every(d=>d.source==='library'),'commercial package releases hidden from PM');
  await expect(h.call('sales/document-vault','GET','project_manager',null,'?opportunity_id=opp-qa&audit=1'),403);
 }finally{h.close();}
});

test('PM reviews its team timesheets on its own project only, without cost data',async()=>{
 const h=await assigned();try{
  const p=project(h),day=today();
  h.sql.prepare("UPDATE rticore_delivery_projects SET status='active',version=version+1 WHERE id=?").run(p.id);
  h.sql.prepare('INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES(?,?,?,?,?,?,?,?)').run('person-pm-team',tenant,users.presales,'Synthetic Consultant','VAPT',20,100000,users.admin);
  h.sql.prepare('INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run('alloc-pm-team',tenant,'opp-qa','person-pm-team',day.slice(0,7),'Tester',1,100000,users.admin);
  const entry=await expect(h.call('psa/timesheets','POST','presales',{action:'submit',project_id:p.id,allocation_id:'alloc-pm-team',work_date:day,minutes:240,billable:true,description:'Authorized VAPT execution for the customer'}),201);
  const list=await expect(h.call('psa/timesheets','GET','project_manager',null,'?project_id='+p.id),200);
  assert.equal(list.body.reviewer,true);assert.deepEqual(list.body.pm_projects,[p.id]);
  assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].cost_snapshot_cents,0);
  await expect(h.call('psa/timesheets','GET','pm_other',null,'?project_id='+p.id),404);
  await expect(h.call('psa/timesheets','POST','pm_other',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Foreign PM must not review'}),403);
  await expect(h.call('psa/timesheets','POST','project_manager',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Hours match the agreed fieldwork plan'}),200);
  assert.equal(h.sql.prepare('SELECT reviewed_by FROM rticore_project_timesheets WHERE id=?').get(entry.body.id).reviewed_by,users.project_manager);
 }finally{h.close();}
});
