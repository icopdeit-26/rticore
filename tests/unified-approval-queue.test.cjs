const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const apiFile='src/app/api/sales/approval-queue/route.ts';
const code=fs.readFileSync(path.join(root,apiFile),'utf8');
const ui=fs.readFileSync(path.join(root,'src/app/approvals/page.tsx'),'utf8');
const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exp={};
const authModule={authorizeBoQ:async()=>({ok:false,response:{status:401}}),privateHeaders:{'Cache-Control':'private, no-store'}};
vm.runInNewContext(js,{exports:exp,require:n=>{
 if(n==='@/lib/boq-auth')return authModule;
 if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
 throw Error('Unexpected dependency '+n);
},Response:{json:(body,opts)=>({body,status:opts?.status||200})}},{filename:apiFile});
const get=exp.GET;
test('unverified request is denied by the real auth integration point',async()=>{
 assert.equal((await get({})).status,401);
 assert.match(code,/await authorizeBoQ\(req\)/);
 assert.doesNotMatch(code,/appStore|mock|dummy/);
});
test('read-only queue never invents pending data on missing tables or D1 errors',async()=>{
 authModule.authorizeBoQ=async()=>({ok:true,identity:{
  role:'approver',email:'checker@example.test',db:{prepare:()=>({bind:()=>({all:async()=>{throw Error('missing migration')}})})}
 }});
 const r=await get({});
 assert.equal(r.status,503);
 assert.equal(r.body.success,false);
 assert.doesNotMatch(JSON.stringify(r.body),/"items":\[\]/);
});
test('role-specific queries exclude maker and are read-only',async()=>{
 const sqls=[];
 authModule.authorizeBoQ=async()=>({ok:true,identity:{
  role:'legal',email:'legal@example.test',db:{prepare:sql=>{sqls.push(sql);return {bind:(...a)=>{
   assert.equal(a[0],'defendit360');
   assert.equal(a[1],'legal@example.test');
   return {all:async()=>({success:true,results:[]})};
  }}}}
 }});
 const r=await get({});
 assert.equal(r.body.success,true);
 assert.equal(r.body.items.length,0);
 assert.equal(sqls.length,1);
 assert.match(sqls[0],/legal_reviewed_by IS NULL/);
 assert.match(sqls[0],/lower\(a\.created_by\)!=\?/);
 assert.doesNotMatch(sqls[0],/UPDATE |DELETE |INSERT /);
});
test('reviewer sees only eligible D1 items and links to canonical module',async()=>{
 const sqls=[];
 authModule.authorizeBoQ=async()=>({ok:true,identity:{
  role:'approver',email:'checker@example.test',db:{prepare:sql=>{sqls.push(sql);return {bind:(...args)=>({all:async()=>({success:true,results:sql.includes("FROM rticore_boq")?[{id:'boq-001',kind:'boq',opportunity_id:'opp-42',title:'BoQ · Q-42',created_by:'maker@example.test',created_at:'2026-10-24 01:00:00'}]:[]})})}}}
 }});
 const r=await get({});
 assert.equal(r.status,200);
 assert.equal(r.body.items.length,1);
 assert.equal(r.body.items[0].href,'/boq?opportunity_id=opp-42');
 assert.ok(sqls.every(s=>s.includes('lower(')||s.includes('FROM rticore_billing')));
 assert.ok(sqls.some(s=>s.includes('FROM rticore_flexguard_wallets w')));
});
test('approval browser loads real queue, never treats failures as zero pending',()=>{
 assert.match(ui,/fetch\('\/api\/sales\/identity'/);
 assert.match(ui,/fetch\('\/api\/sales\/approval-queue'/);
 assert.match(ui,/Antrian tidak dapat dibaca/);
 assert.match(ui,/STATIONS\.filter\(s=>role&&s\.roles\.includes\(role\)\)/);
 assert.doesNotMatch(ui,/appStore/);
});

const nativeFile='src/app/api/erp/enterprise-approvals/route.ts';
const nativeCode=fs.readFileSync(path.join(root,nativeFile),'utf8');
const nativeJs=ts.transpileModule(nativeCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function nativeFixture({role='approver',preview=false,grant=role,direct=true,catalog=true,allowed=true,runtime='hostinger',authenticated=true,fail=false}={}){
 const sqls=[],exports={};
 const db={prepare:sql=>{const entry={sql,args:[]};sqls.push(entry);return {bind:(...args)=>{entry.args=args;return {
 first:async()=>sql.includes('AS role')?{role:grant}:sql.includes('AS allowed')?{allowed}:direct?{id:'entity-a'}:null,
 all:async()=>{if(fail)throw Error('missing native source');return {success:true,results:sql.includes('rticore_native_backup_drill')?[{id:'drill-1',title:'staging',maker:'maker@example.test'}]:[]}}
 }}}}};
 vm.runInNewContext(nativeJs,{exports,URL,process:{env:{RTICORE_RUNTIME:runtime,RTICORE_SERVICE_CATALOG_ENABLED:catalog?'1':'0'}},Response:{json:(body,opts)=>({body,status:opts.status,headers:opts.headers})},require:n=>{
 if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>authenticated?{ok:true,identity:{db,role,email:'checker@example.test',rolePreview:preview}}:{ok:false,response:{status:401}},privateHeaders:{'Cache-Control':'private, no-store'}};
 if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
 if(n==='@/lib/erp-core')return {erpId:v=>typeof v==='string'&&v.length>0};
 throw Error(n);
 }});
 return {sqls,run:(entity='entity-a')=>exports.GET({url:'https://example.invalid/api/erp/enterprise-approvals?legal_entity_id='+entity})};
}
test('native approval inbox denies anonymous, preview, unsupported roles, cross-entity and non-native runtime',async()=>{
 for(const [opts,status] of [[{authenticated:false},401],[{preview:true},403],[{role:'sales'},403],[{grant:null},403],[{runtime:'local'},503]]){
  const f=nativeFixture(opts);assert.equal((await f.run()).status,status);assert.ok(f.sqls.length<=1);
 }
});
test('native inbox scopes every query, excludes maker, never mutates and respects catalog release and approval grants',async()=>{
 const f=nativeFixture();const r=await f.run();
 assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].href,'/erp/operations-center');
 assert.equal(r.body.included_kinds.length,9);assert.equal(r.body.read_only,true);assert.equal(r.body.activation,false);assert.equal(r.body.automatic_posting,false);
 for(const q of f.sqls.filter(q=>/LIMIT 101/.test(q.sql))){
  assert.deepEqual(q.args,['defendit360','entity-a','checker@example.test']);assert.match(q.sql,/tenant_id=\?/);assert.match(q.sql,/legal_entity_id=\?/);assert.match(q.sql,/lower\([^)]*\)<>\?/);assert.doesNotMatch(q.sql,/\b(INSERT|UPDATE|DELETE)\b/);
 }
 for(const opts of [{catalog:false},{allowed:false}]){
  const f=nativeFixture(opts),r=await f.run();assert.equal(r.body.included_kinds.length,3);assert.equal(r.body.excluded_kinds.length,6);assert.ok(f.sqls.every(q=>!q.sql.includes('FROM rticore_catalog_')));
 }
 const g=await nativeFixture({direct:false}).run();assert.ok(g.body.excluded_kinds.includes('feature_governance'));
 const h=await nativeFixture({role:'finance'}).run();assert.equal(h.body.included_kinds.length,6);assert.ok(h.body.excluded_kinds.includes('backup_drill'));
 const missing=await nativeFixture({fail:true}).run();assert.equal(missing.status,503);assert.equal(missing.body.items,undefined);
});
test('native approval UI preserves canonical transaction modules and clears stale legal entity data',()=>{
 const panel=fs.readFileSync(path.join(root,'src/app/approvals/NativeApprovalInbox.tsx'),'utf8');
 assert.match(ui,/<NativeApprovalInbox\/>/);assert.match(panel,/req.current\?\.abort\(\)/);assert.match(panel,/setData\(null\)/);assert.match(panel,/b.read_only!==true/);assert.match(panel,/destinations.has\(x.href\)/);assert.doesNotMatch(panel,/method:\s*['"]POST/);
});
