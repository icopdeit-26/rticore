import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('operations center uses scoped native register and explicit recovery actions and clears old scope',()=>{
 const ui=readFileSync('src/app/erp/operations-center/page.tsx','utf8');
 const api=readFileSync('src/app/api/erp/operations-jobs/route.ts','utf8');
 const nav=readFileSync('src/lib/enterprise-navigation.ts','utf8');
 assert.match(ui,/URLSearchParams\(\{legal_entity_id:id\}\)/);
 assert.match(ui,/credentials:'same-origin'/);
 assert.match(ui,/setResult\(null\)/);
 assert.match(ui,/request.current\?\.abort\(\)/);
 assert.match(ui,/method:\s*['"]POST/);
 assert.match(ui,/result.role==='finance'/);
 assert.match(ui,/result.role==='approver'/);
 assert.match(ui,/recovery\('request',j.id\)/);
 assert.match(ui,/recovery\('approve',x.job_id,x.id\)/);
 assert.match(api,/!rolePreview&&\['finance','approver'\]/);
 assert.match(api,/rticore_native_recovery_command/);
 assert.match(api,/automatic_posting:false/);
 assert.match(api,/grant\?\.role===role/);
 assert.match(api,/tenant_id=\? AND legal_entity_id=\?/);
 assert.match(nav,/item\('Operations Center','\/erp\/operations-center',FINANCE\)/);
});

test('feature governance is an explicit scoped maker-checker workspace, never a runtime activation switch',()=>{
 const ui=readFileSync('src/app/erp/operations-center/page.tsx','utf8');
 const panel=readFileSync('src/app/erp/operations-center/FeatureGovernance.tsx','utf8');
 assert.match(ui,/\['admin','approver'\].includes\(result.role\)&&<FeatureGovernance key=\{loadedEntity\}/);
 assert.match(panel,/endpoint='\/api\/admin\/feature-flags'/);
 assert.match(panel,/role==='admin'/);
 assert.match(panel,/role==='approver'&&x.status==='pending'/);
 assert.match(panel,/b.activation!==false/);
 assert.match(panel,/legal_entity_id:entity/);
 assert.match(panel,/mutation.current\?\.abort\(\)/);
 assert.match(panel,/credentials:'same-origin'/);
 assert.doesNotMatch(panel,/process\.env|localStorage/);
});

import ts from 'typescript';
import vm from 'node:vm';
test('native executive aggregate denies unauthorized scope, preview and malformed rows; never fabricates zero',async()=>{
 const source=readFileSync('src/app/api/erp/executive-command/route.ts','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const row={legal_entity_id:'entity-a',queued:'240',running:'3',succeeded:'900',dead_letter:'2',pending_recovery:'1'};
 async function run({role='finance',preview=false,runtime='hostinger',authenticated=true,result=row,entity='entity-a'}={}){
  const exp={},calls=[];
  const db={prepare:sql=>{calls.push(sql);return {bind:(...args)=>{assert.deepEqual(args,['defendit360',entity,'a@example.invalid',role]);return {first:async()=>result};}};}};
  const assertERP=(ok,message,status=422)=>{if(!ok)throw Object.assign(Error(message),{status});};
  vm.runInNewContext(code,{exports:exp,URL,process:{env:{RTICORE_RUNTIME:runtime}},require:n=>{
   if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>authenticated?{ok:true,identity:{db,email:'a@example.invalid',role,rolePreview:preview}}:{ok:false,response:{status:401}}};
   if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
   if(n==='@/lib/erp-core')return {erpAssert:assertERP,erpId:v=>typeof v==='string'&&v.length>0,erpReply:(body,status=200)=>({body,status}),erpError:e=>({status:e.status||503})};
   throw Error(n);
  }});
  return {r:await exp.GET({url:'https://example.invalid/api/erp/executive-command?legal_entity_id='+entity}),calls};
 }
 for(const [opts,status] of [[{authenticated:false},401],[{role:'sales'},403],[{preview:true},403],[{runtime:'local'},503],[{result:null},403],[{result:{...row,queued:'bad'}},503]])assert.equal((await run(opts)).r.status,status);
 const ok=await run();assert.equal(ok.r.status,200);assert.equal(ok.r.body.metrics.queued,240);assert.equal(ok.r.body.read_only,true);assert.equal(ok.r.body.automatic_posting,false);
 assert.equal(ok.calls.length,1);assert.match(ok.calls[0],/rticore_fg_actor_role/);assert.match(ok.calls[0],/j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id/);assert.doesNotMatch(ok.calls[0],/\b(UPDATE|DELETE|INSERT)\b/);
});


test('native operations denies duplicate entity and failed register reads; recovery requires configured origin',async()=>{
 const source=readFileSync('src/app/api/erp/operations-jobs/route.ts','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const origin='https://rticore.example.invalid';
 function fixture({failedRead=-1,role='finance',preview=false,grant='finance',configuredOrigin=origin}={}){
  const exp={},calls=[];let read=0;
  const db={prepare:sql=>({bind:(...args)=>{calls.push({sql,args});return {
   first:async()=>sql.includes('rticore_fg_actor_role')?{role:grant}:{result:{status:'pending'}},
   all:async()=>({success:read++!==failedRead,results:[]})
  };}})};
  const erpAssert=(ok,message,status=422)=>{if(!ok)throw Object.assign(Error(message),{status});};
  vm.runInNewContext(code,{exports:exp,URL,process:{env:{RTICORE_RUNTIME:'hostinger',RTICORE_PUBLIC_ORIGIN:configuredOrigin}},require:n=>{
   if(n==='@/lib/boq-auth')return {authorizeBoQ:async()=>({ok:true,identity:{db,email:'review@example.invalid',role,rolePreview:preview}})};
   if(n==='@/lib/sales-workflow')return {TENANT:'defendit360'};
   if(n==='@/lib/bounded-json')return {readBoundedJSON:async()=>({legal_entity_id:'entity-a',job_id:'job-a',action:'request',notes:'Recovery review reason'})};
   if(n==='@/lib/erp-core')return {erpAssert,erpId:x=>typeof x==='string'&&x.length>0,erpReply:(body,status=200)=>({body,status}),erpError:e=>({status:e.status||503}),erpOrigin:req=>erpAssert(!req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin,'Origin denied',403),erpText:x=>typeof x==='string'&&x.length>=12};
   throw Error(n);
  }});
  return {exp,calls,get:(query='legal_entity_id=entity-a')=>exp.GET({url:origin+'/api/erp/operations-jobs?'+query}),post:value=>exp.POST({url:origin+'/api/erp/operations-jobs',headers:{get:()=>value}})};
 }
 const ambiguous=fixture();assert.equal((await ambiguous.get('legal_entity_id=entity-a&legal_entity_id=entity-b')).status,422);assert.equal(ambiguous.calls.length,0);
 for(const failedRead of [0,1,2])assert.equal((await fixture({failedRead}).get()).status,503);
 const denied=fixture({grant:null});assert.equal((await denied.get()).status,403);assert.equal(denied.calls.length,1);
 const valid=fixture();assert.equal((await valid.get()).status,200);assert.match(valid.calls[1].sql,/b\.legal_entity_id=a\.legal_entity_id/);
 for(const value of [null,'https://other.example.invalid']){const f=fixture();assert.equal((await f.post(value)).status,403);assert.equal(f.calls.length,0);}
 const noConfig=fixture({configuredOrigin:''});assert.equal((await noConfig.post(origin)).status,403);assert.equal(noConfig.calls.length,0);
 const authorized=fixture();const res=await authorized.post(origin);assert.equal(res.status,201);assert.equal(res.body.automatic_posting,false);assert.match(authorized.calls[0].sql,/rticore_native_recovery_command/);
});
