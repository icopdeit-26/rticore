const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const {fixture,expect}=require('./helpers/service-operations-fixture.cjs');

test('Finance rejects client persona on GET and POST',async()=>{
 const h=fixture();try{
  await expect(h.call('finance','GET','finance',null,'?menu=F01',{'x-finance-role':'cfo'}),403);
  await expect(h.call('finance','POST','finance',{action:'ai_financial_query'},'',{'x-finance-role':'cfo'}),403);
 }finally{h.close();}
});

test('native hosting does not enable local mode or silently bootstrap Finance',async()=>{
 const prior=process.env.RTICORE_RUNTIME;
 const local=process.env.RTICORE_LOCAL_MODE;
 const h=fixture();
 try{
  process.env.RTICORE_RUNTIME='hostinger';
  process.env.RTICORE_LOCAL_MODE='1';
  const code=ts.transpileModule(fs.readFileSync('src/lib/runtime-env.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>{
   if(name==='@opennextjs/cloudflare')return {getCloudflareContext:()=>{throw Error('unexpected worker runtime')}};
   if(name==='./local-d1')return {getLocalD1:()=>{throw Error('unexpected local database')}};
   if(name==='./postgres-db')return {getLocalPostgresDB:()=>{throw Error('unexpected database connection')}};
   throw Error(name);
  },mod,mod.exports);
  assert.equal(mod.exports.isLocalMode(),false);
  await assert.rejects(mod.exports.getRuntimeEnv(),/Hostinger requires/);
  await expect(h.call('finance','GET','finance',null,'?menu=F01'),503);
 }finally{
  if(prior===undefined)delete process.env.RTICORE_RUNTIME;else process.env.RTICORE_RUNTIME=prior;
  if(local===undefined)delete process.env.RTICORE_LOCAL_MODE;else process.env.RTICORE_LOCAL_MODE=local;
  h.close();
 }
});
