// IT Developer Team roles (itdev_leader / itdev_member): menu set, migration 0051, API scope limited
// to Technology & Implementation delivery projects with an active allocation, and read-only
// platform diagnostics (health for both, technical audit for the Leader).
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
 h.sql.prepare('INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES(?,?,?,?,?,?,?,?)').run('person-'+id,tenant,users[key],'Synthetic '+key,'SIEM engineering',20,100000,users.admin);
 h.sql.prepare('INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run('alloc-'+id,tenant,'opp-qa','person-'+id,month(),'Implementation Engineer',5,100000,users.admin);
}
async function tech({activate=true,family='Cybersecurity Technology'}={}){
 const h=await won(fixture(),family);
 allocate(h,'itdev_leader','dl');allocate(h,'itdev_member','dm');
 if(activate)h.sql.prepare("UPDATE rticore_delivery_projects SET status='active',start_date=?,end_date=?,version=version+1 WHERE opportunity_id='opp-qa'").run(today(),today());
 return h;
}
const taskId=(h,code)=>h.sql.prepare('SELECT id FROM rticore_delivery_tasks WHERE project_id=? AND code=?').get(project(h).id,code).id;
const work=(h,role,code,extra={})=>operation(h,role,'task',{id:taskId(h,code),detail:'Implementation notes for the technology project',due_date:today(),complete:false,parameters:{},...extra});

test('IT Developer menu: Member delivery/timesheets/Vault/diagnostics; Leader adds read-only Feasibility',()=>{
 const {navigationForRole,canOpenRoute}=navigation();
 const routes=r=>Array.from(navigationForRole(r).flatMap(g=>g.items.map(i=>i.href)));
 assert.deepEqual(routes('itdev_member'),['/sales/delivery','/psa/timesheets','/sales/documents','/platform/diagnostics']);
 assert.deepEqual(routes('itdev_leader'),['/sales/feasibility','/sales/delivery','/psa/timesheets','/sales/documents','/platform/diagnostics']);
 assert.ok(routes('admin').includes('/platform/diagnostics'));
 for(const href of ['/boq','/sales/pipeline','/customers','/sales/billing','/approvals','/erp/cyber-operations','/settings/system','/settings/ai','/boq/users'])
  for(const r of ['itdev_leader','itdev_member'])assert.equal(canOpenRoute(r,href),false,r+' '+href);
 for(const file of ['src/lib/boq-domain.ts','src/lib/boq-auth.ts','src/lib/sales-access.ts','scripts/rticore-local-setup.mjs','scripts/generate-postgres-triggers.mjs','rticore_postgresql_schema.sql','rticore_postgresql_triggers.sql'])
  assert.match(read(file),/'itdev_member'/,file);
});

test('migration 0051 accepts IT Developer roles, keeps FK children and rejects unknown roles',()=>{
 const h=fixture();try{
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.itdev_leader).role,'itdev_leader');
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.itdev_member).role,'itdev_member');
  assert.throws(()=>h.sql.prepare("INSERT INTO rticore_members(email,role) VALUES('x@flow.invalid','itdev')").run(),/CHECK/);
  assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='rticore_members_backup_0051'").get().n,0);
 }finally{h.close();}
});

test('IT Developer reads only allocated Technology projects, technical view without PO value',async()=>{
 const h=await tech();try{
  const own=await expect(h.call('sales/service-operations','GET','itdev_member',null,'?opportunity_id=opp-qa'),200);
  assert.equal(own.body.project.contract_cents,undefined);assert.equal(own.body.project.po_number,undefined);
  assert.equal(own.body.project.budget_idr,undefined);assert.deepEqual(own.body.invoices,[]);
  assert.deepEqual(own.body.itdev_tasks,['tech_license','tech_implementation','tech_support','service_deliverable']);
  await expect(h.call('sales/service-operations','GET','itdev_leader',null,'?view=renewals'),403);
  h.sql.prepare("UPDATE rticore_resource_allocations SET status='cancelled' WHERE id='alloc-dm'").run();
  await expect(h.call('sales/service-operations','GET','itdev_member',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
 const vapt=await won(fixture(),'VAPT');try{
  allocate(vapt,'itdev_leader','dl');
  await expect(vapt.call('sales/service-operations','GET','itdev_leader',null,'?opportunity_id=opp-qa'),403);
 }finally{vapt.close();}
});

test('Member saves progress; Leader completes implementation tasks in order with Vault evidence',async()=>{
 const draft=await tech({activate:false});try{
  await expect(work(draft,'itdev_leader','tech_license'),409);
 }finally{draft.close();}
 const h=await tech();try{
  const params={parameters:{sku:'FSM-500 x 1, EPS 2000',validity:'2026-12-01 to 2027-11-30'}};
  await expect(work(h,'itdev_member','tech_license',params),201);
  await expect(work(h,'itdev_member','kickoff_scope'),403);
  await expect(operation(h,'itdev_leader','milestone',{title:'Tech milestone',trigger_text:'Signed BAST',amount_idr:1000,due_date:today()}),403);
  await expect(operation(h,'itdev_leader','complete'),403);
  const doc=await expect(upload(h,'supporting','itdev_member'),201);
  await expect(work(h,'itdev_member','tech_license',{...params,complete:true,document_id:doc.body.id}),403);
  await expect(work(h,'itdev_leader','tech_implementation',{parameters:{configuration:'FortiSIEM 7.2 HA',test_results:'UAT passed 42/42'},complete:true,document_id:doc.body.id}),409);
  await expect(work(h,'itdev_leader','tech_license',{...params,complete:true,document_id:doc.body.id}),201);
  const t=h.sql.prepare("SELECT status,completed_by FROM rticore_delivery_tasks WHERE project_id=? AND code='tech_license'").get(project(h).id);
  assert.equal(t.status,'done');assert.equal(t.completed_by,users.itdev_leader);
 }finally{h.close();}
});

test('authorizeBoQ allow-list: IT Developer reaches only its APIs; Feasibility for the Leader only',()=>{
 const out={};
 const js=ts.transpileModule(read('src/lib/itdev-team.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:out,require:n=>n==='./sales-workflow'?{TENANT:'t',SERVICE_CATALOG:[{name:'SIEM / SOAR Implementation',group:'Technology & Implementation'},{name:'VAPT',group:'Offensive Security'}]}:{}});
 const {itdevRouteAllowed:allowed,ITDEV_FAMILIES}=out;
 assert.deepEqual(Array.from(ITDEV_FAMILIES),['FortiSIEM','SIEM / SOAR Implementation']);
 for(const p of ['/api/sales/identity','/api/sales','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault/','/api/platform/diagnostics'])
  for(const r of ['itdev_leader','itdev_member'])assert.equal(allowed(p,r),true,r+' '+p);
 assert.equal(allowed('/api/sales/feasibility','itdev_leader'),true);
 assert.equal(allowed('/api/sales/feasibility','itdev_member'),false);
 for(const p of ['/api/boq','/api/boq/export','/api/sales/award','/api/sales/flexguard','/api/erp/cyber-cases','/api/admin/system','/api/admin/options','/api/boq/members'])
  for(const r of ['itdev_leader','itdev_member'])assert.equal(allowed(p,r),false,r+' '+p);
 assert.equal(allowed('/api/boq','finance'),true,'other roles are unaffected');
});

test('IT Developer deal selector, Vault and gate stay within the Technology project',async()=>{
 const h=await tech();try{
  const deals=await expect(h.call('sales','GET','itdev_member',null,'?entity=deals'),200);
  assert.deepEqual(deals.body.deals.map(d=>d.id),['opp-qa']);
  await expect(h.call('sales','GET','itdev_member',null,'?entity=accounts'),403);
  await expect(h.call('boq','GET','itdev_leader',null),403);
  await expect(upload(h,'nda','itdev_member'),403);
  const vault=await expect(h.call('sales/document-vault','GET','itdev_member',null,'?opportunity_id=opp-qa'),200);
  assert.ok(vault.body.documents.every(d=>d.source==='library'),'commercial package hidden');
  await expect(h.call('sales/document-vault','GET','itdev_leader',null,'?opportunity_id=opp-qa&audit=1'),403);
 }finally{h.close();}
});

test('Leader reviews team timesheets and reads Feasibility; Member cannot',async()=>{
 const h=await tech();try{
  const p=project(h);
  const entry=await expect(h.call('psa/timesheets','POST','itdev_member',{action:'submit',project_id:p.id,allocation_id:'alloc-dm',work_date:today(),minutes:240,billable:true,description:'SIEM collector deployment and parsing'}),201);
  const list=await expect(h.call('psa/timesheets','GET','itdev_leader',null,'?project_id='+p.id),200);
  assert.equal(list.body.reviewer,true);assert.equal(list.body.items[0].cost_snapshot_cents,0);
  await expect(h.call('psa/timesheets','POST','itdev_member',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Member must not review entries'}),403);
  await expect(h.call('psa/timesheets','POST','itdev_leader',{action:'review',id:entry.body.id,version:1,approve:true,notes:'Hours match the implementation plan'}),200);
  const f=await expect(h.call('sales/feasibility','GET','itdev_leader',null,'?opportunity_id=opp-qa'),200);
  assert.equal(f.body.report.total_cost_idr,null);
  await expect(h.call('sales/feasibility','GET','itdev_member',null,'?opportunity_id=opp-qa'),403);
 }finally{h.close();}
});

test('Platform diagnostics: health for both, technical audit for Leader only, never secrets',async()=>{
 const h=fixture();try{
  const leader=await expect(h.call('platform/diagnostics','GET','itdev_leader',null,'?section=health'),200);
  assert.equal(leader.body.database.ok,true);assert.equal(leader.body.can_read_audit,true);
  assert.equal(leader.body.release.production_gate,'HOLD');
  const member=await expect(h.call('platform/diagnostics','GET','itdev_member',null,'?section=health'),200);
  assert.equal(member.body.can_read_audit,false);
  const {identityEmail,...rest}=member.body;
  assert.equal(identityEmail,users.itdev_member);
  assert.doesNotMatch(JSON.stringify(rest),/@flow\.invalid|key_ciphertext/,'no other emails or key material in health');
  await expect(h.call('platform/diagnostics','GET','itdev_member',null,'?section=audit'),403);
  const audit=await expect(h.call('platform/diagnostics','GET','itdev_leader',null,'?section=audit'),200);
  assert.ok(audit.body.items.every(r=>!('data_json' in r)&&audit.body.areas.includes(r.area)));
  for(const r of ['sales','finance','presales','viewer','governance_leader'])
   await expect(h.call('platform/diagnostics','GET',r,null,'?section=health'),403);
  await expect(h.call('admin/system','GET','itdev_leader',null,'?section=health'),403);
 }finally{h.close();}
});
