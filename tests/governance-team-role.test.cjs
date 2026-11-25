// Governance Team roles (governance_leader / governance_member): menu set, migration 0050 and API
// scope limited to Governance, Risk & Compliance delivery projects with an active allocation.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {fixture,won,upload,operation,project,today,expect,tenant,users}=require('./helpers/service-operations-fixture.cjs');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

function navigation(){
 const out={};
 vm.runInNewContext(ts.transpileModule(read('src/lib/enterprise-navigation.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:n=>{throw Error('Unexpected '+n);}});
 return out;
}
const month=()=>today().slice(0,7);
function allocate(h,key,id){
 h.sql.prepare('INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES(?,?,?,?,?,?,?,?)').run('person-'+id,tenant,users[key],'Synthetic '+key,'ISO 27001',20,100000,users.admin);
 h.sql.prepare('INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run('alloc-'+id,tenant,'opp-qa','person-'+id,month(),'GRC Consultant',5,100000,users.admin);
}
async function grc({activate=true,family='Cybersecurity Governance'}={}){
 const h=await won(fixture(),family);
 allocate(h,'governance_leader','gl');allocate(h,'governance_member','gm');
 if(activate)h.sql.prepare("UPDATE rticore_delivery_projects SET status='active',start_date=?,end_date=?,version=version+1 WHERE opportunity_id='opp-qa'").run(today(),today());
 return h;
}
const taskId=(h,code)=>h.sql.prepare('SELECT id FROM rticore_delivery_tasks WHERE project_id=? AND code=?').get(project(h).id,code).id;
const work=(h,role,code,extra={})=>operation(h,role,'task',{id:taskId(h,code),detail:'Fieldwork notes for the GRC engagement',due_date:today(),complete:false,parameters:{},...extra});

test('Governance menu: Member delivery/timesheets/Vault; Leader adds read-only Feasibility',()=>{
 const {navigationForRole,canOpenRoute,firstAccessibleHref}=navigation();
 for(const r of ['governance_leader','governance_member'])assert.equal(firstAccessibleHref(r),'/sales/delivery',r+' landing');
 const routes=r=>Array.from(navigationForRole(r).flatMap(g=>g.items.map(i=>i.href)));
 assert.deepEqual(routes('governance_member'),['/sales/delivery','/psa/timesheets','/sales/documents']);
 assert.deepEqual(routes('governance_leader'),['/sales/feasibility','/sales/delivery','/psa/timesheets','/sales/documents']);
 for(const href of ['/boq','/sales/pipeline','/customers','/sales/billing','/approvals','/erp/cyber-operations','/settings/system'])
  for(const r of ['governance_leader','governance_member'])assert.equal(canOpenRoute(r,href),false,r+' '+href);
 for(const file of ['src/lib/boq-domain.ts','src/lib/boq-auth.ts','src/lib/sales-access.ts','scripts/rticore-local-setup.mjs','scripts/generate-postgres-triggers.mjs','rticore_postgresql_schema.sql'])
  assert.match(read(file),/'governance_member'/,file);
});

test('migration 0050 accepts Governance roles, keeps FK children and rejects unknown roles',()=>{
 const h=fixture();try{
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.governance_leader).role,'governance_leader');
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.governance_member).role,'governance_member');
  assert.throws(()=>h.sql.prepare("INSERT INTO rticore_members(email,role) VALUES('x@flow.invalid','governance')").run(),/CHECK/);
  assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='rticore_members_backup_0050'").get().n,0);
 }finally{h.close();}
});

test('Governance reads only allocated GRC projects, technical view without PO value',async()=>{
 const h=await grc();try{
  const own=await expect(h.call('sales/service-operations','GET','governance_member',null,'?opportunity_id=opp-qa'),200);
  assert.equal(own.body.project.contract_cents,undefined);assert.equal(own.body.project.po_number,undefined);
  assert.equal(own.body.project.budget_idr,undefined);assert.deepEqual(own.body.invoices,[]);
  assert.deepEqual(own.body.governance_tasks,['grc_assessment','grc_gap','grc_remediation','service_deliverable']);
  await expect(h.call('sales/service-operations','GET','governance_leader',null,'?view=renewals'),403);
  h.sql.prepare("UPDATE rticore_resource_allocations SET status='cancelled' WHERE id='alloc-gm'").run();
  await expect(h.call('sales/service-operations','GET','governance_member',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
 const vapt=await won(fixture(),'VAPT');try{
  allocate(vapt,'governance_leader','gl');
  await expect(vapt.call('sales/service-operations','GET','governance_leader',null,'?opportunity_id=opp-qa'),403);
 }finally{vapt.close();}
});

test('Member saves progress; Leader completes GRC tasks in order with Vault evidence',async()=>{
 const draft=await grc({activate:false});try{
  await expect(work(draft,'governance_leader','grc_assessment'),409);
 }finally{draft.close();}
 const h=await grc();try{
  const params={parameters:{standard:'ISO 27001:2022 Annex A',domains:'Head office and data center'}};
  await expect(work(h,'governance_member','grc_assessment',params),201);
  await expect(work(h,'governance_member','kickoff_scope'),403);
  await expect(operation(h,'governance_leader','milestone',{title:'GRC milestone',trigger_text:'Signed BAST',amount_idr:1000,due_date:today()}),403);
  await expect(operation(h,'governance_leader','complete'),403);
  const doc=await expect(upload(h,'supporting','governance_member'),201);
  await expect(work(h,'governance_member','grc_assessment',{...params,complete:true,document_id:doc.body.id}),403);
  await expect(work(h,'governance_leader','grc_gap',{parameters:{gaps:'A.5.1 policy not approved',priority:'High'},complete:true,document_id:doc.body.id}),409);
  await expect(work(h,'governance_leader','grc_assessment',{...params,complete:true,document_id:doc.body.id}),201);
  const t=h.sql.prepare("SELECT status,completed_by FROM rticore_delivery_tasks WHERE project_id=? AND code='grc_assessment'").get(project(h).id);
  assert.equal(t.status,'done');assert.equal(t.completed_by,users.governance_leader);
 }finally{h.close();}
});

test('authorizeBoQ allow-list: Governance reaches only its APIs; Feasibility for the Leader only',()=>{
 const out={};
 const js=ts.transpileModule(read('src/lib/governance-team.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:out,require:n=>n==='./sales-workflow'?{TENANT:'t',SERVICE_CATALOG:[{name:'ISO 27001 / ISMS',group:'Governance, Risk & Compliance'},{name:'VAPT',group:'Offensive Security'}]}:{}});
 const {governanceRouteAllowed:allowed,GOVERNANCE_FAMILIES}=out;
 assert.deepEqual(Array.from(GOVERNANCE_FAMILIES),['GRC','ISO 27001 / ISMS']);
 for(const p of ['/api/sales/identity','/api/sales','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault/'])
  for(const r of ['governance_leader','governance_member'])assert.equal(allowed(p,r),true,r+' '+p);
 assert.equal(allowed('/api/sales/feasibility','governance_leader'),true);
 assert.equal(allowed('/api/sales/feasibility','governance_member'),false);
 for(const p of ['/api/sales/approval-queue','/api/boq','/api/boq/export','/api/sales/award','/api/sales/flexguard','/api/erp/cyber-cases','/api/admin/users'])
  for(const r of ['governance_leader','governance_member'])assert.equal(allowed(p,r),false,r+' '+p);
 assert.equal(allowed('/api/boq','finance'),true,'other roles are unaffected');
});

test('Governance deal selector, Vault and gate stay within the GRC engagement',async()=>{
 const h=await grc();try{
  const deals=await expect(h.call('sales','GET','governance_member',null,'?entity=deals'),200);
  assert.deepEqual(deals.body.deals.map(d=>d.id),['opp-qa']);
  await expect(h.call('sales','GET','governance_member',null,'?entity=accounts'),403);
  await expect(h.call('boq','GET','governance_leader',null),403);
  await expect(upload(h,'nda','governance_member'),403);
  const vault=await expect(h.call('sales/document-vault','GET','governance_member',null,'?opportunity_id=opp-qa'),200);
  assert.ok(vault.body.documents.every(d=>d.source==='library'),'commercial package hidden');
  await expect(h.call('sales/document-vault','GET','governance_leader',null,'?opportunity_id=opp-qa&audit=1'),403);
 }finally{h.close();}
});

test('Leader reviews team timesheets and reads Feasibility; Member cannot',async()=>{
 const h=await grc();try{
  const p=project(h);
  const entry=await expect(h.call('psa/timesheets','POST','governance_member',{action:'submit',project_id:p.id,allocation_id:'alloc-gm',work_date:today(),minutes:240,billable:true,description:'ISO 27001 gap assessment interviews'}),201);
  const list=await expect(h.call('psa/timesheets','GET','governance_leader',null,'?project_id='+p.id),200);
  assert.equal(list.body.reviewer,true);assert.equal(list.body.items[0].cost_snapshot_cents,0);
  await expect(h.call('psa/timesheets','POST','governance_member',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Member must not review entries'}),403);
  await expect(h.call('psa/timesheets','POST','governance_leader',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Hours match the assessment plan'}),200);
  const f=await expect(h.call('sales/feasibility','GET','governance_leader',null,'?opportunity_id=opp-qa'),200);
  assert.equal(f.body.report.total_cost_idr,null);
  await expect(h.call('sales/feasibility','GET','governance_member',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
});

test('Revoked Governance allocation blocks Won Feasibility and concurrent timesheet review',async()=>{
 const h=await grc();try{
  const pending=await expect(h.call('psa/timesheets','POST','governance_member',{action:'submit',project_id:project(h).id,allocation_id:'alloc-gm',work_date:today(),minutes:60,billable:true,description:'Follow-up control assessment'}),201);
  h.beforeBatch=()=>h.sql.prepare("UPDATE rticore_resource_allocations SET status='cancelled' WHERE id='alloc-gl'").run();
  await expect(h.call('psa/timesheets','POST','governance_leader',{action:'review',id:pending.body.id,version:1,approve:true,notes:'Hours match the assessment plan'}),409);
  assert.equal(h.sql.prepare('SELECT status FROM rticore_project_timesheets WHERE id=?').get(pending.body.id).status,'submitted');
  await expect(h.call('sales/feasibility','GET','governance_leader',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
});
