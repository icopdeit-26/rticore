// Roles offense_lead / offense_member: menu set, migration 0048, API allow-list, and API scope
// limited to Offensive Security delivery projects where the account has an active allocation.
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
function allocate(h,key,id){
 h.sql.prepare('INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES(?,?,?,?,?,?,?,?)').run('person-'+id,tenant,users[key],'Synthetic '+key,'VAPT OSCP',20,100000,users.admin);
 h.sql.prepare('INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run('alloc-'+id,tenant,'opp-qa','person-'+id,today().slice(0,7),'Pentester',5,100000,users.admin);
}
async function engagement({active=true,allocated=true}={}){
 const h=await won(fixture());
 await expect(operation(h,'presales','assign',{pm_email:users.project_manager,start_date:today(),end_date:plusDays(45)}),200);
 if(active)h.sql.prepare("UPDATE rticore_delivery_projects SET status='active',version=version+1 WHERE opportunity_id='opp-qa'").run();
 if(allocated){allocate(h,'offense_lead','lead');allocate(h,'offense_member','member');}
 return h;
}
const task=(h,code)=>h.sql.prepare('SELECT * FROM rticore_delivery_tasks WHERE project_id=? AND code=?').get(project(h).id,code);
const scopeParams={assets:'app.example.invalid',test_window:'Weekdays 20:00-04:00 WIB, authorized',methodology:'OWASP WSTG with agreed RoE'};

test('Offense menus: Member delivery/timesheets/Vault; Leader adds read-only Feasibility',()=>{
 const {navigationForRole,canOpenRoute,firstAccessibleHref}=navigation();
 for(const role of ['offense_lead','offense_member'])assert.equal(firstAccessibleHref(role),'/sales/delivery',role+' lands on its daily desk');
 const routes=role=>Array.from(navigationForRole(role).flatMap(g=>g.items.map(i=>i.href)));
 assert.deepEqual(routes('offense_member'),['/sales/delivery','/psa/timesheets','/sales/documents']);
 assert.deepEqual(routes('offense_lead'),['/sales/feasibility','/sales/delivery','/psa/timesheets','/sales/documents']);
 for(const role of ['offense_lead','offense_member'])
  for(const href of ['/boq','/sales/pipeline','/customers','/sales/billing','/flexguard','/approvals','/erp/cyber-operations','/settings/system'])
   assert.equal(canOpenRoute(role,href),false,role+' '+href);
 for(const file of ['src/lib/boq-domain.ts','src/lib/boq-auth.ts','src/lib/sales-access.ts','scripts/rticore-local-setup.mjs','rticore_postgresql_schema.sql','scripts/generate-postgres-triggers.mjs'])
  for(const role of ['offense_lead','offense_member'])assert.match(read(file),new RegExp("'"+role+"'"),file+' '+role);
});

test('API allow-list keeps Offense roles away from every other handler',()=>{
 const h=fixture();try{
  const {offenseRouteAllowed,OFFENSE_FAMILIES}=h.load('src/lib/offense-team.ts');
  assert.deepEqual(Array.from(OFFENSE_FAMILIES),['VAPT','Red Team / Adversary Simulation','Attack Surface Management']);
  for(const p of ['/api/sales','/api/sales/identity','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault'])
   for(const role of ['offense_lead','offense_member'])assert.equal(offenseRouteAllowed(p,role),true,role+' '+p);
  // The approval bell answers 403 for project-scoped roles; the shell shows no count.
  assert.equal(offenseRouteAllowed('/api/sales/approval-queue','offense_member'),false);
  assert.equal(offenseRouteAllowed('/api/sales/feasibility','offense_lead'),true);
  assert.equal(offenseRouteAllowed('/api/sales/feasibility','offense_member'),false);
  for(const p of ['/api/boq','/api/boq/export','/api/sales/flexguard','/api/erp/cyber-operations','/api/reports','/api/ai/generate','/api/sales/vault','/api/sales/lifecycle'])
   assert.equal(offenseRouteAllowed(p,'offense_lead'),false,p);
  assert.equal(offenseRouteAllowed('/api/boq','finance'),true,'other roles unaffected');
 }finally{h.close();}
});

test('migration 0048 accepts Offense members and still rejects unknown roles',()=>{
 const h=fixture();try{
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.offense_lead).role,'offense_lead');
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.offense_member).role,'offense_member');
  assert.throws(()=>h.sql.prepare("INSERT INTO rticore_members(email,role) VALUES('x@flow.invalid','pentester')").run(),/CHECK/);
  assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='rticore_members_backup_0048'").get().n,0);
 }finally{h.close();}
});

test('Offense delivery: allocation scope, technical view only, Member progress, Leader completion',async()=>{
 const h=await engagement({allocated:false});try{
  await expect(h.call('sales/service-operations','GET','offense_member',null,'?opportunity_id=opp-qa'),403);
  allocate(h,'offense_lead','lead');allocate(h,'offense_member','member');
  const view=await expect(h.call('sales/service-operations','GET','offense_member',null,'?opportunity_id=opp-qa'),200);
  assert.equal(view.body.project.contract_cents,undefined,'PO value hidden');
  assert.equal(view.body.project.po_number,undefined,'PO number hidden');
  assert.equal(view.body.project.budget_idr,undefined,'HPP hidden');
  assert.equal(view.body.project.baseline.payment_milestones,undefined,'payment terms hidden');
  assert.deepEqual([view.body.milestones,view.body.invoices,view.body.payments,view.body.assignments],[[],[],[],[]]);
  assert.ok(view.body.tasks.some(t=>t.code==='vapt_test'));
  await expect(h.call('sales/service-operations','GET','offense_lead',null,'?view=renewals'),403);
  const scope=task(h,'vapt_scope'),kickoff=task(h,'kickoff_scope');
  const base={detail:'Authorized scope confirmed with the customer',due_date:today(),parameters:scopeParams};
  await expect(operation(h,'offense_member','task',{...base,id:kickoff.id,complete:false}),403);
  await expect(operation(h,'offense_member','task',{...base,id:scope.id,complete:true,document_id:'x'}),403);
  await expect(operation(h,'offense_member','task',{...base,id:scope.id,complete:false}),201);
  for(const [action,extra] of [['milestone',{title:'Offense milestone',trigger_text:'Signed BAST',amount_idr:1000,due_date:today()}],['complete',{}],['activate',{}],['monthly_report',{period:today().slice(0,7)}]])
   await expect(operation(h,'offense_lead',action,extra),403);
  const doc=await expect(upload(h,'supporting','offense_lead'),201);
  await expect(operation(h,'offense_lead','task',{...base,id:scope.id,complete:true,document_id:doc.body.id}),201);
  assert.equal(task(h,'vapt_scope').status,'done');assert.equal(task(h,'vapt_scope').completed_by,users.offense_lead);
 }finally{h.close();}
});

test('Offense tasks wait for PM activation and non-Offensive projects stay closed',async()=>{
 const h=await engagement({active:false});try{
  await expect(operation(h,'offense_lead','task',{id:task(h,'vapt_scope').id,detail:'Authorized scope confirmed with the customer',due_date:today(),parameters:scopeParams,complete:false}),409);
 }finally{h.close();}
 // An allocation on a SOC/MDR project grants the Offense Team nothing.
 const soc=await won(fixture(),'SOC/MDR');try{
  allocate(soc,'offense_lead','lead');
  await expect(soc.call('sales/service-operations','GET','offense_lead',null,'?opportunity_id=opp-qa'),403);
  await expect(upload(soc,'supporting','offense_lead'),403);
  assert.equal((await expect(soc.call('sales','GET','offense_lead',null,'?entity=deals'),200)).body.deals.length,0);
  assert.equal((await expect(soc.call('psa/timesheets','GET','offense_lead'),200)).body.projects.length,0);
 }finally{soc.close();}
});

test('Offense project list, Vault and CRM follow the allocation scope',async()=>{
 const h=await engagement();try{
  const deals=await expect(h.call('sales','GET','offense_member',null,'?entity=deals'),200);
  assert.deepEqual(deals.body.deals.map(d=>[d.id,d.scope]),[['opp-qa','delivery']]);
  await expect(h.call('sales','GET','offense_member',null,'?entity=accounts'),403);
  await expect(h.call('sales','GET','offense_lead',null,'?entity=details&id=opp-qa'),403);
  await expect(upload(h,'supporting','offense_member'),201);
  await expect(upload(h,'nda','offense_member'),403);
  const vault=await expect(h.call('sales/document-vault','GET','offense_member',null,'?opportunity_id=opp-qa'),200);
  assert.ok(vault.body.documents.length>0);
  assert.ok(vault.body.documents.every(d=>d.source==='library'),'commercial package hidden');
  const release=h.sql.prepare("SELECT id FROM rticore_document_vault WHERE opportunity_id='opp-qa' LIMIT 1").get();
  await expect(h.call('sales/document-vault','GET','offense_lead',null,'?opportunity_id=opp-qa&source=release&id='+release.id),403);
  await expect(h.call('sales/document-vault','GET','offense_lead',null,'?opportunity_id=opp-qa&audit=1'),403);
 }finally{h.close();}
});

test('Leader reviews the team timesheets on its engagement, never its own and never cost',async()=>{
 const h=await engagement();try{
  const p=project(h),day=today(),entry=desc=>({action:'submit',project_id:p.id,work_date:day,minutes:240,billable:true,description:desc});
  const member=await expect(h.call('psa/timesheets','POST','offense_member',{...entry('Authorized web application testing'),allocation_id:'alloc-member'}),201);
  const own=await expect(h.call('psa/timesheets','POST','offense_lead',{...entry('Report QA and finding validation'),allocation_id:'alloc-lead'}),201);
  const mine=await expect(h.call('psa/timesheets','GET','offense_member',null,'?project_id='+p.id),200);
  assert.equal(mine.body.reviewer,false);assert.deepEqual(mine.body.items.map(i=>i.id),[member.body.id]);
  const list=await expect(h.call('psa/timesheets','GET','offense_lead',null,'?project_id='+p.id),200);
  assert.equal(list.body.reviewer,true);assert.deepEqual(list.body.lead_projects,[p.id]);
  assert.equal(list.body.items.length,2);assert.ok(list.body.items.every(i=>i.cost_snapshot_cents===0));
  await expect(h.call('psa/timesheets','POST','offense_member',{action:'review',id:own.body.id,version:1,approve:true,notes:'Member must not review entries'}),403);
  await expect(h.call('psa/timesheets','POST','offense_lead',{action:'review',id:own.body.id,version:1,approve:true,notes:'Leader cannot approve own hours'}),403);
  await expect(h.call('psa/timesheets','POST','offense_lead',{action:'review',id:member.body.id,version:1,approve:true,notes:'Hours match the agreed test window'}),200);
  assert.equal(h.sql.prepare('SELECT reviewed_by FROM rticore_project_timesheets WHERE id=?').get(member.body.id).reviewed_by,users.offense_lead);
 }finally{h.close();}
});

test('Leader reads open Offensive Feasibility without costs; Member and writes are denied',async()=>{
 const h=fixture();try{
  const view=await expect(h.call('sales/feasibility','GET','offense_lead',null,'?opportunity_id=opp-qa'),200);
  assert.deepEqual([view.body.costs,view.body.offers],[[],[]]);
  assert.equal(view.body.report.total_cost_idr,null);assert.equal(view.body.report.margin_pct,null);
  assert.ok(view.body.people.every(x=>x.daily_cost_idr===undefined),'engineer rate hidden');
  await expect(h.call('sales/feasibility','GET','offense_member',null,'?opportunity_id=opp-qa'),403);
  await expect(h.call('sales/feasibility','POST','offense_lead',{opportunity_id:'opp-qa',flow_version:h.deal().flow_version,action:'plan'}),403);
  const lead=await expect(h.call('sales','GET','offense_lead',null,'?entity=deals'),200);
  assert.deepEqual(lead.body.deals.map(d=>[d.id,d.scope]),[['opp-qa','feasibility']]);
  h.sql.prepare("UPDATE rticore_sales_opportunities SET data_json=json_set(data_json,'$.service_family','SOC/MDR')").run();
  await expect(h.call('sales/feasibility','GET','offense_lead',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
});
