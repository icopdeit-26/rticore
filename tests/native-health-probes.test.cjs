const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(name,getRuntimeEnv){
 const source=fs.readFileSync('src/app/api/health/'+name+'/route.ts','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(js,{exports,Response,require:n=>{assert.equal(n,'@/lib/runtime-env');return {getRuntimeEnv}}});
 return exports.GET;
}
test('liveness is no-store and independent of database',async()=>{
 const r=load('live',()=>{throw Error('unexpected DB call')})();
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{status:'alive'});
});
test('readiness requires an active member and does not certify Finance',async()=>{
 let sql;
 const r=await load('ready',async()=>({RTICORE_DB:{prepare:s=>{sql=s;return {first:async()=>({ok:1})}}}}))();
 assert.match(sql,/^SELECT 1 AS ok FROM rticore_members WHERE active=1 LIMIT 1$/);assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'core_ready',finance:'not_certified'});
});
test('missing configuration, no active membership and database error fail closed without leaking details',async()=>{
 for(const provider of [async()=>({}),async()=>({RTICORE_DB:{prepare:()=>({first:async()=>null})}}),async()=>{throw Error('private database details')}]){
  const r=await load('ready',provider)();assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{status:'not_ready'});
 }
});
