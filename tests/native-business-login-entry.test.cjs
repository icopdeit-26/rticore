const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('src/app/page.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({cookie=null,auth={ok:false},env={RTICORE_RUNTIME:'hostinger',RTICORE_AUTH_MODE:'business',RTICORE_PUBLIC_ORIGIN:'https://rticore.store'}}={}){
 let calls=0;const exports={};
 const modules={'next/headers':{headers:async()=>new Headers(cookie?{cookie}:{})},'next/navigation':{redirect:p=>{throw Error('REDIRECT:'+p)}},'@/lib/boq-auth':{authorizeBoQ:async req=>{calls++;assert.equal(req.url,'https://rticore.store/api/sales/identity');assert.equal(req.headers.get('cookie'),cookie);return auth;}},'@/lib/enterprise-navigation':{firstAccessibleHref:r=>r==='finance'?'/sales/executive':null},'@/lib/business-iam-crypto':{readSessionCookie:c=>c==='__Host-rticore_session=fixture'?'fixture':null},'@/components/auth/LegacyHomeEntry':{LegacyHomeEntry:()=>null},'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null}};
 vm.runInNewContext(code,{exports,process:{env},Headers,Request,URL,require:n=>{if(!(n in modules))throw Error(n);return modules[n]}});
 return {run:exports.default,calls:()=>calls};
}
test('anonymous native root redirects to login without touching DB',async()=>{const f=fixture();await assert.rejects(f.run(),/REDIRECT:\/login/);assert.equal(f.calls(),0)});
test('forged/invalid cookie never enters workspace',async()=>{const f=fixture({cookie:'__Host-rticore_session=forged'});await assert.rejects(f.run(),/REDIRECT:\/login/);assert.equal(f.calls(),0)});
test('expired session or database failure routes to login',async()=>{const f=fixture({cookie:'__Host-rticore_session=fixture'});await assert.rejects(f.run(),/REDIRECT:\/login/);assert.equal(f.calls(),1)});
test('verified Finance role alone selects canonical workspace',async()=>{const f=fixture({cookie:'__Host-rticore_session=fixture',auth:{ok:true,identity:{role:'finance'}}});await assert.rejects(f.run(),/REDIRECT:\/sales\/executive/);assert.equal(f.calls(),1)});
test('business login uses native endpoint, 2FA and fixed internal destination',()=>{const p=fs.readFileSync('src/components/auth/BusinessLoginPanel.tsx','utf8');assert.match(p,/fetch\('\/api\/business-auth'/);assert.match(p,/one-time-code/);assert.match(p,/window\.location\.replace\('\/'\)/);assert.doesNotMatch(p,/searchParams|callbackUrl|localStorage/);const shell=fs.readFileSync('src/components/layout/AppShell.tsx','utf8');assert.match(shell,/nativeBusiness&&\(res.status===401\|\|res.status===403\)/);});
