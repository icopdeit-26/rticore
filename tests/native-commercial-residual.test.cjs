const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture(name,{role='finance',preview=false,enabled=true,authenticated=true,row=null,rows=[],failed=false}={}){
 const source=fs.readFileSync('src/app/api/erp/'+name+'/route.ts','utf8'),exp={},queries=[];
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const db={prepare:sql=>({bind:(...args)=>{queries.push({sql,args});return {first:async()=>row,all:async()=>({success:!failed,results:rows})};}})};
 vm.runInNewContext(code,{exports:exp,URL,process:{env:{RTICORE_RUNTIME:'hostinger',RTICORE_SERVICE_CATALOG_ENABLED:enabled?'1':'0',RTICORE_HISTORICAL_REVIEW_ENABLED:enabled?'1':'0'}},require:n=>{
  if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>authenticated?{ok:true,identity:{db,email:'review@example.invalid',role,rolePreview:preview}}:{ok:false,response:{status:401}}};
  if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
  if(n==='@/lib/bounded-json')return {};
  if(n==='@/lib/erp-core')return {erpAssert:(ok,m,status=422)=>{if(!ok)throw Object.assign(Error(m),{status});},erpId:x=>typeof x==='string'&&x.length>0,erpReply:(body,status=200)=>({body,status}),erpError:e=>({status:e.status||503})};
  throw Error(n);
 }});
 return {queries,run:()=>exp.GET({url:'https://example.invalid/api/erp/'+name+'?legal_entity_id=entity-a'+(name==='pricing-engine'?'&snapshot_id=snapshot-a':'')}),get:q=>exp.GET({url:'https://example.invalid/api/erp/'+name+'?'+q}),exp};
}
test('pricing evidence checks runtime, role, scoped Finance grant and exact stored digest',async()=>{
 for(const [opts,status] of [[{authenticated:false},401],[{role:'sales'},403],[{preview:true},403],[{enabled:false},503],[{},403],[{row:{digest_valid:false}},409]])assert.equal((await fixture('pricing-engine',opts).run()).status,status);
 const f=fixture('pricing-engine',{row:{digest_valid:true,calculation_sha256:'a'.repeat(64),calculation:{formula_version:'0068-v1'},status:'draft'}});
 const r=await f.run();assert.equal(r.status,200);assert.equal(r.body.read_only,true);assert.equal(f.exp.POST,undefined);assert.match(f.queries[0].sql,/rticore_catalog_finance_access/);assert.match(f.queries[0].sql,/sha256\(convert_to/);assert.deepEqual(f.queries[0].args.slice(0,3),['defendit360','entity-a','snapshot-a']);
});
test('outbox monitor distinguishes denied scope from authorized empty register and never writes',async()=>{
 for(const [opts,status] of [[{authenticated:false},401],[{role:'admin'},403],[{preview:true},403],[{},403]])assert.equal((await fixture('finance-docking-bridge',opts).run()).status,status);
 const empty=await fixture('finance-docking-bridge',{rows:[{scope_id:'entity-a',id:null}]}).run();assert.equal(empty.status,200);assert.equal(empty.body.events.length,0);
 const f=fixture('finance-docking-bridge',{rows:[{scope_id:'entity-a',id:'event-a',digest_valid:false,journal_status:null}]});const r=await f.run();assert.equal(r.status,200);assert.equal(r.body.events[0].digest_valid,false);assert.equal(r.body.automatic_posting,false);assert.equal(f.exp.POST,undefined);assert.match(f.queries[0].sql,/x.legal_entity_id=s.id/);assert.match(f.queries[0].sql,/j.legal_entity_id=s.id/);assert.match(f.queries[0].sql,/a.business_unit_id IS NULL AND a.department_id IS NULL/);assert.doesNotMatch(f.queries[0].sql,/\b(INSERT|UPDATE|DELETE)\b/);
});
test('FlexGuard related reads retain entity and wallet isolation; scheduler uses database time',()=>{
 const fg=fs.readFileSync('src/app/api/erp/flexguard-enterprise/route.ts','utf8'),worker=fs.readFileSync('scripts/native-operations-worker.mjs','utf8');
 assert.match(fg,/e.legal_entity_id=l.legal_entity_id AND e.wallet_id=l.wallet_id AND e.lot_id=l.id/);assert.match(fg,/e.legal_entity_id=l.legal_entity_id AND e.id=l.finance_outbox_event_id/);
 assert.match(worker,/extract\(epoch from statement_timestamp\(\)\)/);assert.doesNotMatch(worker,/Date.now\(/);
});


function scopedRegister(name,{role='finance',failed=false}={}){
 const source=fs.readFileSync('src/app/api/erp/'+name+'/route.ts','utf8'),exp={},queries=[];
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const db={prepare:sql=>({bind:(...args)=>{queries.push({sql,args});return {
  first:async()=>sql.includes('AS can_make')?{can_make:true,can_approve:true}:sql.includes(' AS role')?{role}:sql.includes('SELECT w.id')?{id:'wallet-a'}:null,
  all:async()=>({success:!failed,results:[]})
 };}})};
 vm.runInNewContext(code,{exports:exp,URL,process:{env:{RTICORE_RUNTIME:'hostinger',RTICORE_SERVICE_CATALOG_ENABLED:'1',RTICORE_FLEXGUARD_ENTERPRISE_ENABLED:'1'}},require:n=>{
  if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>({ok:true,identity:{db,email:'review@example.invalid',role,rolePreview:false}})};
  if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
  if(n==='@/lib/erp-core')return {erpAssert:(ok,m,status=422)=>{if(!ok)throw Object.assign(Error(m),{status});},erpId:x=>typeof x==='string'&&x.length>0,erpReply:(body,status=200)=>({body,status}),erpError:e=>({status:e.status||503})};
  if(n==='@/lib/bounded-json'||n==='@/lib/service-operations'||n==='@/lib/business-iam-crypto'||n==='@/lib/enterprise-pricing-engine')return {};
  throw Error(n);
 }});
 return {queries,get:q=>exp.GET({url:'https://example.invalid/api/erp/'+name+'?'+q})};
}
test('catalog rejects ambiguous scope, masks cost despite inconsistent role grant, and rejects failed reads',async()=>{
 const f=scopedRegister('service-catalog');assert.equal((await f.get('legal_entity_id=a&legal_entity_id=b')).status,422);assert.equal(f.queries.length,0);
 const sales=scopedRegister('service-catalog',{role:'sales'});const r=await sales.get('legal_entity_id=entity-a');
 assert.equal(r.status,200);assert.equal(r.body.cost_basis_visible,false);assert.equal(r.body.can_make,false);assert.equal(r.body.can_approve,false);
 assert.ok(!sales.queries.some(x=>x.sql.includes('rticore_catalog_pricing_snapshots')||x.sql.includes('internal_cost_rate_cents')));
 const finance=scopedRegister('service-catalog');assert.equal((await finance.get('legal_entity_id=entity-a')).body.cost_basis_visible,true);
 assert.equal((await scopedRegister('service-catalog',{failed:true}).get('')).status,503);
 assert.equal((await scopedRegister('service-catalog',{failed:true}).get('legal_entity_id=entity-a')).status,503);
});
test('FlexGuard rejects ambiguous scope before database access and joins portal acceptance by full scope',async()=>{
 for(const q of ['legal_entity_id=a&legal_entity_id=b','wallet_id=wallet-a','legal_entity_id=entity-a&portal_admin=1','legal_entity_id=entity-a&wallet_id=wallet-a&portal_admin=1&service_requests=1']){
  const f=scopedRegister('flexguard-enterprise');assert.equal((await f.get(q)).status,422);assert.equal(f.queries.length,0);
 }
 const f=scopedRegister('flexguard-enterprise');const r=await f.get('legal_entity_id=entity-a&wallet_id=wallet-a&service_requests=1');
 assert.equal(r.status,200);assert.match(f.queries.find(x=>x.sql.includes('SELECT w.id')).sql,/c.customer_id=w.customer_id/);
 const sql=f.queries.find(x=>x.sql.includes('LEFT JOIN rticore_native_fg_portal_binding')).sql;assert.match(sql,/b.tenant_id=s.tenant_id AND b.legal_entity_id=s.legal_entity_id AND b.wallet_id=s.wallet_id/);
 for(const q of ['', 'legal_entity_id=entity-a','legal_entity_id=entity-a&wallet_id=wallet-a','legal_entity_id=entity-a&wallet_id=wallet-a&service_requests=1','legal_entity_id=entity-a&wallet_id=wallet-a&portal_admin=1'])assert.equal((await scopedRegister('flexguard-enterprise',{failed:true}).get(q)).status,503);
});

test('native scheduler rejects privileged connection before mutation and rolls back expired lease before commit',async()=>{
 const source=fs.readFileSync('scripts/native-operations-worker.mjs','utf8');
 // Use a synthetic CommonJS filename for the VM harness; .mjs forces ESM emit.
 // The production worker remains native ESM and all privilege/lease assertions remain intact.
 const compiled=ts.transpileModule(source,{fileName:'native-operations-worker.fixture.cts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
 const code='(async()=>{\n'+compiled.outputText+'\n})()';
 async function run({privileged=false,expired=false,failedFinish=false,idle=false}={}){
  const queries=[],logs=[];let claim=0,closed=false,privilegeChecked=false;
  const process={env:{RTICORE_FG_MAINTENANCE_ENABLED:'1',RTICORE_FG_MAINTENANCE_DATABASE_URL:'postgresql://test:fixture@example.invalid/rticore?sslmode=verify-full',RTICORE_FG_MAINTENANCE_EXPECTED_DATABASE:'rticore',RTICORE_FG_MAINTENANCE_TENANT:'tenant-a',RTICORE_FG_MAINTENANCE_ENTITY:'entity-a',RTICORE_FG_MAINTENANCE_ACTOR:'worker@example.invalid',RTICORE_NATIVE_JOB_QUEUE_ENABLED:'1'}};
  class Client{
   async connect(){}
   async end(){closed=true;}
   async query(sql,args){queries.push({sql,args});
    if(sql.includes('current_database()'))return {rows:[{db:'rticore',rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false}]};
    if(sql.includes('rticore_fg_maintenance_actor'))return {rows:[{allowed:true}]};
    if(sql.includes('AS bucket'))return {rows:[{bucket:'123456'}]};
    if(sql.includes('rticore_native_job_claim'))return {rows:idle||claim++?[]:[{job_id:'job-a',job_kind:'flexguard_expiry'}]};
    if(sql.includes('FOR UPDATE'))return {rows:[{id:'job-a'}]};
    if(sql.includes('rticore_native_job_finish')&&sql.includes('true)'))return {rows:expired?[]:[{ok:true}]};
    if(sql.includes('rticore_native_job_finish')&&sql.includes('false)'))return {rows:[{ok:!failedFinish}]};
    return {rows:[]};
   }
  }
  let error;try{await vm.runInNewContext(code,{exports:{},URL,process,console:{log:x=>logs.push(JSON.parse(x))},require:n=>{if(n==='pg')return {Client};if(n==='node:crypto')return {randomUUID:()=> '12345678-1234-1234-1234-123456789abc'};if(n==='./hostinger-runtime-privileges.mjs')return {assertRuntimeLeastPrivilege:async()=>{privilegeChecked=true;if(privileged)throw Error('Runtime database privilege certification failed');}};throw Error('Unexpected worker import: '+n);}});}catch(e){error=e;}
  return {queries,logs,closed,privilegeChecked,error,exitCode:process.exitCode};
 }
 const denied=await run({privileged:true});assert.match(String(denied.error),/privilege certification failed/);assert.equal(denied.privilegeChecked,true);assert.equal(denied.closed,true);assert.ok(!denied.queries.some(x=>x.sql.includes('INSERT')));
 const empty=await run({idle:true});assert.equal(empty.error,undefined);assert.equal(empty.exitCode,undefined);assert.equal(empty.closed,true);assert.equal(empty.logs[0].idle,true);assert.equal(empty.logs[0].claimed,0);assert.equal(empty.logs[0].counts.succeeded,0);assert.ok(!empty.queries.some(x=>x.sql==='BEGIN'||x.sql==='COMMIT'));
 const valid=await run();assert.equal(valid.error,undefined);assert.equal(valid.exitCode,undefined);assert.equal(valid.logs[0].outcomes[0],'succeeded');assert.equal(valid.logs[0].event,'native_operations_cycle');assert.equal(valid.logs[0].claimed,1);assert.equal(valid.logs[0].counts.succeeded,1);assert.equal(valid.logs[0].idle,false);assert.equal(valid.logs[0].automatic_posting,false);assert.ok(valid.queries.some(x=>x.sql==='COMMIT'));
 for(const failedFinish of [false,true]){
  const result=await run({expired:true,failedFinish});assert.equal(result.error,undefined);assert.equal(result.exitCode,1);assert.equal(result.closed,true);assert.ok(result.queries.some(x=>x.sql==='ROLLBACK'));assert.ok(!result.queries.some(x=>x.sql==='COMMIT'));assert.equal(result.logs[0].outcomes[0],failedFinish?'lease_lost':'retry_or_dead_letter');assert.equal(result.logs[0].counts[failedFinish?'lease_lost':'retry_or_dead_letter'],1);assert.equal(result.logs[0].counts.succeeded,0);
  assert.match(result.queries.find(x=>x.sql.includes('rticore_native_job_finish')&&x.sql.includes('true)')).sql,/lease_until>clock_timestamp\(\)/);
 }
});

test('executive management requires an explicit period and scoped Finance grant, preserves signed profit',async()=>{
 const keys=['opportunities','won','open_pipeline_idr','certified_projects','certified_revenue_cents','certified_profit_cents','certified_direct_cost_cents','certified_indirect_cost_cents','certified_billed_cents','certified_cash_collected_cents','certified_committed_cost_cents','approved_minutes','billable_minutes','available_credits','reserved_credits','consumed_credits','expired_credits','opex_budget_records','opex_budget_cents','opex_actual_cents','high_open_grc_risks'];
 const row=Object.fromEntries(keys.map(k=>[k,'0']));row.certified_profit_cents='-100';row.certified_projects='1';row.certified_revenue_cents='1000';row.certified_direct_cost_cents='900';row.certified_indirect_cost_cents='200';row.certified_billed_cents='800';row.certified_cash_collected_cents='500';row.certified_committed_cost_cents='300';
 const f=fixture('executive-command',{row});
 const url='https://example.invalid/api/erp/executive-command?legal_entity_id=entity-a&view=management&period=2026-11';
 const result=await f.exp.GET({url});assert.equal(result.status,200);assert.equal(result.body.management_metrics.certified_profit_cents,-100);assert.equal(result.body.management_metrics.certified_cash_collected_cents,500);assert.equal((await fixture('executive-command',{row:{...row,certified_profit_cents:'-99'}}).exp.GET({url})).status,503);assert.equal(result.body.automatic_posting,false);
 assert.match(f.queries[0].sql,/a.business_unit_id IS NULL AND a.department_id IS NULL/);
 assert.match(f.queries[0].sql,/certification_status='certified_closed'/);
 assert.match(f.queries[0].sql,/t.billable=1/);
 assert.doesNotMatch(f.queries[0].sql,/TLP:RED|rticore_native_cti_case|INSERT INTO|UPDATE /);
 assert.deepEqual(f.queries[0].args,['defendit360','entity-a','review@example.invalid','finance','review@example.invalid','2026-11']);
 assert.equal((await fixture('executive-command').exp.GET({url})).status,403);
 assert.equal((await fixture('executive-command',{role:'sales',row}).exp.GET({url})).status,403);
 assert.equal((await fixture('executive-command',{preview:true,row}).exp.GET({url})).status,403);
 for(const suffix of ['&period=2026-12','&view=commercial','&unknown=1'])assert.equal((await fixture('executive-command',{row}).exp.GET({url:url+suffix})).status,422);
 assert.equal((await fixture('executive-command',{row:{...row,approved_minutes:'1',billable_minutes:'2'}}).exp.GET({url})).status,503);
});

test('native CTI/GRC rejects foreign lifecycle, self-review and stale transitions before Vault access',async()=>{
 const source=fs.readFileSync('src/lib/native-cti-grc.ts','utf8'),exp={};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 function runFixture({role='approver',cti=false,parent={created_by:'maker@example.invalid'},prior={status:'submitted',version:2,actor_email:'submitter@example.invalid'},grant=true}={}){
  const exports={},queries=[];let evidenceReads=0,mutations=0;
  const db={prepare:sql=>({bind:(...args)=>{queries.push({sql,args});return {first:async()=>{
   if(sql.includes('rticore_native_cti_grc_actor'))return {role:grant?role:null};
   if(sql.includes('FROM rticore_delivery_projects'))return {opportunity_id:'opp-a',service_family:cti?'CTI':'GRC'};
   if(sql.startsWith('SELECT created_by FROM'))return parent;
   if(sql.startsWith('SELECT status,version,actor_email'))return prior;
   throw Error('Unexpected read '+sql);
  }};}})};
  class ERPError extends Error{constructor(message,status=422){super(message);this.status=status;}}
  vm.runInNewContext(code,{exports,process:{env:{RTICORE_RUNTIME:'hostinger'}},crypto:{randomUUID:()=> 'fixture-id'},require:n=>{
   if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
   if(n==='@/lib/erp-core')return {ERPError,erpAssert:(ok,m,status=422)=>{if(!ok)throw new ERPError(m,status);},erpId:x=>typeof x==='string'&&x.length>0,erpText:(x,min,max)=>typeof x==='string'&&x.trim().length>=min&&x.length<=max,erpProjectUnit:async()=> 'entity-a',erpReply:(body,status)=>({body,status}),erpAtom:async()=>{mutations++;}};
   if(n==='@/lib/service-operations')return {ServiceError:class extends Error{},supportingOriginal:async()=>{evidenceReads++;return {sha256:'a'.repeat(64)};}};
   throw Error(n);
  }});
  const identity={db,email:'review@example.invalid',role,rolePreview:false};
  return {queries,transition:v=>exports.nativeGrcTransition(identity,v),write:v=>exports.nativeGrcWrite(identity,v),counts:()=>({evidenceReads,mutations})};
 }
 const payload={project_id:'project-a',record_kind:'grc_risk',record_id:'risk-a',status:'reviewed',expected_version:2,document_id:'doc-a',notes:'Independent review notes'};
 for(const [opts,patch,status] of [
  [{parent:null},{},403],
  [{parent:{created_by:'REVIEW@example.invalid'}},{},403],
  [{prior:{status:'submitted',version:2,actor_email:'REVIEW@example.invalid'}},{},403],
  [{},{expected_version:1},409],
  [{prior:{status:'in_progress',version:2,actor_email:'maker@example.invalid'}},{},409],
  [{grant:false},{},403],
  [{cti:true,parent:null},{record_kind:'cti_case'},403]
 ]){
  const f=runFixture(opts);await assert.rejects(()=>f.transition({...payload,...patch}),e=>e.status===status);assert.deepEqual(f.counts(),{evidenceReads:0,mutations:0});
  if(opts.cti){const q=f.queries.find(x=>x.sql.startsWith('SELECT created_by FROM'));assert.match(q.sql,/tlp<>'TLP:RED'/);assert.deepEqual(q.args,['defendit360','entity-a','project-a','risk-a','review@example.invalid']);}
 }
 const ok=runFixture();assert.equal((await ok.transition(payload)).status,201);assert.deepEqual(ok.counts(),{evidenceReads:1,mutations:1});
 const control={project_id:'project-a',record_kind:'grc_control_test',control_id:'control-a',test_type:'design',assessment_status:'effective',test_notes:'Independent control review',document_id:'doc-a'};
 for(const parent of [null,{created_by:'REVIEW@example.invalid'}]){const f=runFixture({parent});await assert.rejects(()=>f.write(control),e=>e.status===403);assert.deepEqual(f.counts(),{evidenceReads:0,mutations:0});}
 const independent=runFixture();assert.equal((await independent.write(control)).status,201);assert.deepEqual(independent.counts(),{evidenceReads:1,mutations:1});
});

test('finance docking exact event lookup is entity scoped and fails closed',async()=>{
 const f=fixture('finance-docking-bridge',{rows:[{scope_id:'entity-a',id:'event-a',digest_valid:true}]});
 const r=await f.get('legal_entity_id=entity-a&event_id=event-a');assert.equal(r.status,200);assert.equal(r.body.event_id,'event-a');assert.deepEqual(f.queries[0].args,['defendit360','entity-a','review@example.invalid','finance','review@example.invalid','event-a','event-a']);assert.match(f.queries[0].sql,/x\.legal_entity_id=s\.id/);assert.match(f.queries[0].sql,/x\.id=\?/);
 for(const q of ['legal_entity_id=entity-a&event_id=a&event_id=b','legal_entity_id=a&legal_entity_id=b','legal_entity_id=entity-a&mode=all','legal_entity_id=entity-a&event_id=']){const invalid=fixture('finance-docking-bridge');assert.equal((await invalid.get(q)).status,422);assert.equal(invalid.queries.length,0);}
 assert.equal((await fixture('finance-docking-bridge',{rows:[{scope_id:'entity-a',id:null}]}).get('legal_entity_id=entity-a&event_id=foreign')).status,404);
 assert.equal((await fixture('finance-docking-bridge',{failed:true}).get('legal_entity_id=entity-a&event_id=event-a')).status,503);
});
test('FlexGuard historical review denies ambiguous selectors and failed reads, never authorizes recovery',async()=>{
 for(const mode of ['allocation','missing_outbox']){
  const valid=fixture('flexguard-historical-review',{rows:[{id:'candidate-a'}]});const r=await valid.get('legal_entity_id=entity-a&mode='+mode);assert.equal(r.status,200);assert.equal(r.body.mode,mode);assert.equal(r.body.legal_entity_id,'entity-a');assert.equal(r.body.recovery_authorized,false);assert.equal(r.body.metadata_only,true);assert.deepEqual(valid.queries[0].args,['defendit360','entity-a','review@example.invalid']);assert.doesNotMatch(valid.queries[0].sql,/\b(INSERT|UPDATE|DELETE)\b/);
  assert.equal((await fixture('flexguard-historical-review',{failed:true}).get('legal_entity_id=entity-a&mode='+mode)).status,503);
 }
 for(const q of ['legal_entity_id=a&legal_entity_id=b','legal_entity_id=entity-a&mode=allocation&mode=missing_outbox','legal_entity_id=entity-a&mode=invalid','legal_entity_id=entity-a&wallet_id=wallet-a']){const invalid=fixture('flexguard-historical-review');assert.equal((await invalid.get(q)).status,422);assert.equal(invalid.queries.length,0);}
 for(const [opts,status] of [[{authenticated:false},401],[{preview:true},403],[{role:'sales'},403],[{enabled:false},503]])assert.equal((await fixture('flexguard-historical-review',opts).get('legal_entity_id=entity-a')).status,status);
});
test('advisory pricing withholds incomplete registers and invalid or future service inputs',()=>{
 const source=fs.readFileSync('src/app/erp/service-catalog/page.tsx','utf8');
 const start=source.indexOf(' function preview(){'),end=source.indexOf(' const estimate=preview();',start);assert.ok(start>=0&&end>start);
 const run=vm.runInNewContext('(function(context){const {finance,canMake,tab,data,fields,today,approved}=context;'+ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return preview();})',{});
 const service={id:'svc',effective_date:'2026-01-01',min_mandays_tenths:5,max_mandays_tenths:100};
 const records={services:[service],activity_profiles:[{id:'profile',service_id:'svc',activities:[{resource_role:'analyst',resource_count:1,hours_hundredths:800,billable:true}]}],complexity_matrices:[{id:'matrix',factor_bps:10000}],rate_cards:[{role_code:'analyst',effective_date:'2026-01-01',version:1,internal_cost_rate_cents:10000,min_selling_rate_cents:15000}]};
 const context={finance:true,canMake:true,tab:'pricing_snapshots',data:{},fields:{service_id:'svc',profile_id:'profile',complexity_id:'matrix'},today:'2026-11-28',approved:k=>records[k]};
 assert.ok(run(context)?.net>=15000);
 for(const patch of [{data:{truncated:true}},{data:{workflow_truncated:true}},{fields:{...context.fields,quantity:''}},{fields:{...context.fields,quantity:false}}])assert.equal(run({...context,...patch}),null);
 service.effective_date='2027-01-01';assert.equal(run(context),null);
});
