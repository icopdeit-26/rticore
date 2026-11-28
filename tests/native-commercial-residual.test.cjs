const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture(name,{role='finance',preview=false,enabled=true,authenticated=true,row=null,rows=[]}={}){
 const source=fs.readFileSync('src/app/api/erp/'+name+'/route.ts','utf8'),exp={},queries=[];
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const db={prepare:sql=>({bind:(...args)=>{queries.push({sql,args});return {first:async()=>row,all:async()=>({success:true,results:rows})};}})};
 vm.runInNewContext(code,{exports:exp,URL,process:{env:{RTICORE_RUNTIME:'hostinger',RTICORE_SERVICE_CATALOG_ENABLED:enabled?'1':'0'}},require:n=>{
  if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>authenticated?{ok:true,identity:{db,email:'review@example.invalid',role,rolePreview:preview}}:{ok:false,response:{status:401}}};
  if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
  if(n==='@/lib/erp-core')return {erpAssert:(ok,m,status=422)=>{if(!ok)throw Object.assign(Error(m),{status});},erpId:x=>typeof x==='string'&&x.length>0,erpReply:(body,status=200)=>({body,status}),erpError:e=>({status:e.status||503})};
  throw Error(n);
 }});
 return {queries,run:()=>exp.GET({url:'https://example.invalid/api/erp/'+name+'?legal_entity_id=entity-a&snapshot_id=snapshot-a'}),exp};
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
