// SOC Defense Team roles (defense_leader / defense_member): menus, migration 0049, API allow-list and
// the cyber_ops-scoped SOC case workflow (open → assign → submit → return/review → close).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {fixture,won,upload,project,expect,tenant,users}=require('./helpers/service-operations-fixture.cjs');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const legal='entity-defense';

function navigation(){
 const out={};
 vm.runInNewContext(ts.transpileModule(read('src/lib/enterprise-navigation.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:n=>{throw Error('Unexpected '+n);}});
 return out;
}
function routes(){
 const out={};
 vm.runInNewContext(ts.transpileModule(read('src/lib/defense-routes.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out});
 return out;
}
function grant(h,email,cap='cyber_ops'){
 h.sql.prepare("INSERT OR IGNORE INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES(?,?,?,?,?,'approved',?,?)")
  .run(tenant,email,legal,'Synthetic SOC staff','requester@synthetic.invalid','checker@synthetic.invalid','Independent test-only staff affiliation');
 h.sql.prepare("INSERT OR IGNORE INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES(?,?,?,?,?,'approved',?,?,?)")
  .run(crypto.randomUUID(),tenant,email,cap,legal,'requester@synthetic.invalid','checker@synthetic.invalid','Independent synthetic test-only grant');
}
/** Won SOC/MDR project, active, with an approved legal-entity scope and cyber_ops grants. */
async function soc(grants=['defense_leader','defense_member','admin','approver']){
 const h=await won(fixture(),'SOC/MDR');
 const p=project(h);
 h.sql.prepare("UPDATE rticore_delivery_projects SET status='active',start_date='2026-10-01',end_date='2027-09-30',version=version+1 WHERE id=?").run(p.id);
 await expect(h.call('erp/organization','POST','admin',{action:'create_unit',id:legal,code:'RTI-SOC',label:'RTI SOC QA',kind:'legal_entity',parent_id:null}),201);
 await expect(h.call('erp/organization','POST','admin',{action:'request_project_scope',project_id:p.id,legal_entity_id:legal}),200);
 await expect(h.call('erp/organization','POST','approver',{action:'review_project_scope',project_id:p.id,version:1,approve:true}),200);
 for(const k of grants)grant(h,users[k]);
 return {h,p};
}
const cyber=(h,role,body)=>h.call('erp/cyber-operations','POST',role,body);
const caseRow=(h,id)=>h.sql.prepare('SELECT * FROM rticore_cyber_cases WHERE id=?').get(id);
const assignment=(h,id)=>h.sql.prepare('SELECT * FROM rticore_cyber_case_assignments WHERE case_id=?').get(id);

test('Defense menus, landing page and API allow-list',()=>{
 const {navigationForRole,canOpenRoute,firstAccessibleHref}=navigation();
 for(const role of ['defense_leader','defense_member']){
  const hrefs=navigationForRole(role).flatMap(g=>g.items.map(i=>i.href));
  assert.deepEqual([...hrefs].sort(),['/erp/cyber-operations','/erp/security-integrations','/psa/timesheets','/sales/documents'],role);
  assert.equal(firstAccessibleHref(role),'/erp/cyber-operations');
  for(const href of ['/boq','/customers','/sales/pipeline','/sales/billing','/approvals','/reports','/erp/general-ledger','/erp/organization','/sales/delivery','/settings/system'])
   assert.equal(canOpenRoute(role,href),false,role+' '+href);
 }
 const {defenseRouteAllowed}=routes();
 assert.equal(defenseRouteAllowed('/api/erp/cyber-operations','defense_member'),true);
 assert.equal(defenseRouteAllowed('/api/boq','defense_leader'),false);
 assert.equal(defenseRouteAllowed('/api/reports','defense_member'),false);
 assert.equal(defenseRouteAllowed('/api/boq','sales'),true,'other roles untouched');
 for(const file of ['src/lib/boq-domain.ts','src/lib/boq-auth.ts','src/lib/sales-access.ts','scripts/rticore-local-setup.mjs','src/components/layout/Navbar.tsx'])
  assert.match(read(file),/defense_leader/,file);
});

test('migration 0049: roles, ERP matrix cyber_ops only, cumulative CHECK and immutable assignments',()=>{
 const h=fixture();try{
  assert.equal(h.sql.prepare('SELECT role FROM rticore_members WHERE email=?').get(users.defense_leader).role,'defense_leader');
  assert.deepEqual(h.sql.prepare("SELECT capability FROM rticore_erp_role_capability_matrix WHERE role LIKE 'defense_%' AND allowed=1 GROUP BY capability").all().map(r=>r.capability),['cyber_ops']);
  assert.throws(()=>h.sql.prepare("INSERT INTO rticore_members(email,role) VALUES('x@flow.invalid','soc')").run(),/CHECK/);
  assert.throws(()=>h.sql.prepare("UPDATE rticore_erp_role_capability_matrix SET allowed=0 WHERE role='defense_member'").run(),/ROLE_POLICY_CHANGE_REQUIRED/);
  assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE '%backup_0049'").get().n,0);
 }finally{h.close();}
});

test('without an approved cyber_ops grant the Defense roles see nothing',async()=>{
 const {h,p}=await soc(['admin','approver']);try{
  const board=await expect(h.call('erp/cyber-operations','GET','defense_member',null,'?board=1'),200);
  assert.deepEqual(board.body.projects,[]);
  await expect(h.call('erp/cyber-operations','GET','defense_leader',null,'?project_id='+p.id),403);
  await expect(cyber(h,'defense_member',{action:'open',project_id:p.id,kind:'soc_incident',external_ref:'SIEM-0001',title:'Suspicious PowerShell beacon',severity:'high',classification:'restricted'}),403);
  await expect(h.call('sales/document-vault','GET','defense_member',null,'?opportunity_id=opp-qa'),403);
  assert.deepEqual((await expect(h.call('sales','GET','defense_member',null,'?entity=deals'),200)).body.deals,[]);
 }finally{h.close();}
});

test('SOC case: Member opens and investigates, Leader assigns, returns, reviews; Admin closes',async()=>{
 const {h,p}=await soc();try{
  const board=await expect(h.call('erp/cyber-operations','GET','defense_leader',null,'?board=1'),200);
  assert.deepEqual(board.body.projects.map(x=>x.id),[p.id]);
  assert.ok(board.body.analysts.some(a=>a.email===users.defense_member));
  await expect(cyber(h,'defense_member',{action:'open',project_id:p.id,kind:'vapt_finding',external_ref:'VAPT-1',title:'Defense must not open VAPT',severity:'low',classification:'restricted'}),403);
  const id=(await expect(cyber(h,'defense_member',{action:'open',project_id:p.id,kind:'soc_incident',external_ref:'SIEM-0001',title:'Suspicious PowerShell beacon',severity:'high',classification:'restricted'}),201)).body.id;
  // Assignment is Leader-only and goes to an active Defense analyst.
  await expect(cyber(h,'defense_member',{action:'assign',id,assignee_email:users.defense_member}),403);
  await expect(cyber(h,'defense_leader',{action:'assign',id,assignee_email:users.sales}),409);
  await expect(cyber(h,'defense_leader',{action:'assign',id,assignee_email:users.defense_member}),201);
  assert.equal(assignment(h,id).status,'assigned');
  // Not submitted yet: nobody can review.
  const doc=(await expect(upload(h,'supporting','defense_member'),201)).body.id;
  await expect(cyber(h,'defense_leader',{action:'review',id,version:1,approve:true,notes:'Premature review attempt',document_id:doc}),409);
  // Only the assignee submits, with original Vault evidence.
  await expect(cyber(h,'defense_leader',{action:'submit',id,assignment_version:1,notes:'Leader is not the assignee here',document_id:doc}),403);
  await expect(cyber(h,'defense_member',{action:'submit',id,assignment_version:1,notes:'Beacon to known C2, host isolated via EDR',document_id:'00000000-0000-4000-8000-000000000000'}),409);
  await expect(cyber(h,'defense_member',{action:'submit',id,assignment_version:1,notes:'Beacon to known C2, host isolated via EDR',document_id:doc}),200);
  // Leader returns for rework, analyst resubmits.
  await expect(cyber(h,'defense_leader',{action:'return',id,assignment_version:2,notes:'Add IOC list and timeline of lateral movement'}),200);
  assert.equal(assignment(h,id).status,'returned');
  await expect(cyber(h,'defense_member',{action:'submit',id,assignment_version:3,notes:'IOC list, timeline and containment confirmed',document_id:doc}),200);
  const mine=await expect(h.call('erp/cyber-operations','GET','defense_member',null,'?board=1'),200);
  assert.equal(mine.body.my_queue[0].assignment_status,'submitted');assert.deepEqual(mine.body.team_queue,[],'Member has no team queue');
  // Member cannot review; Leader reviews reusing the analyst evidence.
  await expect(cyber(h,'defense_member',{action:'review',id,version:1,approve:true,notes:'Analyst self review attempt'}),403);
  await expect(cyber(h,'defense_leader',{action:'review',id,version:1,approve:true,notes:'QA verified IOC, timeline and EDR isolation'}),200);
  assert.equal(caseRow(h,id).status,'reviewed');assert.equal(caseRow(h,id).evidence_document_id,doc);
  // Closer must differ from the reviewer.
  await expect(cyber(h,'defense_leader',{action:'close',id,version:2}),403);
  await expect(cyber(h,'defense_member',{action:'close',id,version:2}),403);
  await expect(cyber(h,'admin',{action:'close',id,version:2}),200);
  assert.equal(caseRow(h,id).status,'closed');
  assert.throws(()=>h.sql.prepare('DELETE FROM rticore_cyber_case_assignments WHERE case_id=?').run(id),/CYBER_ASSIGNMENT_IMMUTABLE/);
 }finally{h.close();}
});

test('assignee never reviews its own investigation, even as Leader; triggers back the API',async()=>{
 const {h,p}=await soc();try{
  const id=(await expect(cyber(h,'admin',{action:'open',project_id:p.id,kind:'soc_incident',external_ref:'SIEM-0002',title:'Impossible travel sign-in alert',severity:'medium',classification:'confidential'}),201)).body.id;
  await expect(cyber(h,'admin',{action:'assign',id,assignee_email:users.defense_leader}),201);
  const doc=(await expect(upload(h,'supporting','defense_leader'),201)).body.id;
  await expect(cyber(h,'defense_leader',{action:'submit',id,assignment_version:1,notes:'Confirmed VPN egress, benign travel',document_id:doc}),200);
  await expect(cyber(h,'defense_leader',{action:'review',id,version:1,approve:true,notes:'Self review by the investigating leader'}),403);
  assert.throws(()=>h.sql.prepare("UPDATE rticore_cyber_cases SET status='reviewed',version=version+1,reviewer_email=?,review_notes='Direct database bypass attempt',evidence_document_id=? WHERE id=?").run(users.defense_leader,doc,id),/CYBER_REVIEWER_IS_ASSIGNEE/);
  await expect(cyber(h,'approver',{action:'review',id,version:1,approve:false,notes:'Benign travel; reject as false positive'}),200);
  assert.equal(caseRow(h,id).status,'rejected');
 }finally{h.close();}
});

test('Defense roles: Vault supporting only, deal list scoped, BoQ/CRM/reports blocked',async()=>{
 const {h}=await soc();try{
  const deals=await expect(h.call('sales','GET','defense_member',null,'?entity=deals'),200);
  assert.deepEqual(deals.body.deals.map(d=>d.id),['opp-qa']);
  await expect(h.call('sales','GET','defense_member',null,'?entity=accounts'),403);
  await expect(h.call('sales/document-vault','GET','defense_leader',null,'?opportunity_id=opp-qa&audit=1'),403);
  const vault=await expect(h.call('sales/document-vault','GET','defense_leader',null,'?opportunity_id=opp-qa'),200);
  assert.ok(vault.body.documents.every(d=>d.source==='library'));
  await expect(upload(h,'supporting','defense_member'),201);
  await expect(upload(h,'nda','defense_member'),403);
  await expect(h.call('erp/security-integrations','GET','defense_member',null,'?legal_entity_id='+legal),200);
  await expect(h.call('erp/security-integrations','POST','defense_member',{action:'queue',connector_id:'00000000-0000-4000-8000-000000000001',case_id:'00000000-0000-4000-8000-000000000002'}),403);
 }finally{h.close();}
});

test('SOC assignment loses race to independent case review without creating an assignment',async()=>{
 const {h,p}=await soc();try{
  const id=(await expect(cyber(h,'defense_member',{action:'open',project_id:p.id,kind:'soc_incident',external_ref:'SIEM-RACE-01',title:'Concurrent case review and assignment',severity:'high',classification:'restricted'}),201)).body.id;
  const doc=(await expect(upload(h,'supporting','defense_member'),201)).body.id;
  // Simulate another transaction committing after the API pre-read but before its atomic write.
  h.beforeBatch=()=>h.sql.prepare("UPDATE rticore_cyber_cases SET status='reviewed',version=version+1,reviewer_email=?,review_notes=?,evidence_document_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(users.approver,'Independent concurrent technical QA accepted',doc,id);
  await expect(cyber(h,'defense_leader',{action:'assign',id,assignee_email:users.defense_member}),409);
  assert.equal(caseRow(h,id).status,'reviewed');
  assert.equal(assignment(h,id),undefined);
 }finally{h.close();}
});

test('SOC return loses race to independent review and leaves submitted evidence intact',async()=>{
 const {h,p}=await soc();try{
  const id=(await expect(cyber(h,'admin',{action:'open',project_id:p.id,kind:'soc_incident',external_ref:'SIEM-RACE-02',title:'Concurrent QA review and return',severity:'high',classification:'restricted'}),201)).body.id;
  await expect(cyber(h,'defense_leader',{action:'assign',id,assignee_email:users.defense_member}),201);
  const doc=(await expect(upload(h,'supporting','defense_member'),201)).body.id;
  await expect(cyber(h,'defense_member',{action:'submit',id,assignment_version:1,notes:'Investigation completed with original evidence',document_id:doc}),200);
  h.beforeBatch=()=>h.sql.prepare("UPDATE rticore_cyber_cases SET status='reviewed',version=version+1,reviewer_email=?,review_notes=?,evidence_document_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(users.approver,'Independent concurrent technical QA accepted',doc,id);
  await expect(cyber(h,'defense_leader',{action:'return',id,assignment_version:2,notes:'Request additional investigation details'}),409);
  assert.equal(caseRow(h,id).status,'reviewed');
  assert.equal(assignment(h,id).status,'submitted');
  assert.equal(assignment(h,id).version,2);
  assert.equal(assignment(h,id).evidence_document_id,doc);
 }finally{h.close();}
});
