const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function load(p,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(!(n in deps))throw Error(n);return deps[n];}});return exports;}
const nav=load('src/lib/enterprise-navigation.ts');
const {searchRoleNavigation}=load('src/lib/command-palette.ts',{'./enterprise-navigation':nav});
test('palette never adds a destination outside canonical role navigation',()=>{
 const roles=new Set(nav.RTICORE_NAVIGATION.flatMap(g=>g.items.flatMap(i=>i.roles)));
 for(const role of roles){
  const allowed=nav.navigationForRole(role).flatMap(g=>g.items.map(i=>i.href));
  for(const q of ['', 'finance','settings','erp','sales','pricing','portal']){
   for(const item of searchRoleNavigation(role,q)){assert.ok(allowed.includes(item.href),role+':'+item.href);assert.ok(fs.existsSync(path.join(root,'src/app',item.href.slice(1),'page.tsx')),item.href);}
  }
 }
 assert.equal(searchRoleNavigation(null,'').length,0);assert.equal(searchRoleNavigation('unknown','').length,0);
 assert.deepEqual(Array.from(searchRoleNavigation('viewer',''),i=>i.href),['/boq']);
 assert.equal(searchRoleNavigation('sales','settings/ai').length,0);
 assert.equal(searchRoleNavigation('admin','portal/flexguard').length,0);
 assert.equal(searchRoleNavigation('finance','service catalog').length,1);
});
test('palette is mounted from verified role, uses modal and checked destination',()=>{
 const p=read('src/components/layout/EnterpriseCommandPalette.tsx');
 assert.match(read('src/components/layout/Navbar.tsx'),/<EnterpriseCommandPalette key=\{role\|\|'anonymous'\} role=\{role\}\/>/);
 assert.match(p,/showModal\(\)/);assert.match(p,/results.some\(item=>item.href===href\)/);assert.match(p,/if\(!role\)return null/);
 assert.doesNotMatch(p,/V4_ENTERPRISE_DESTINATIONS|\/erp\/pricing-simulator|\/portal\/flexguard/);
});
