const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const file='src/lib/enterprise-navigation.ts';
const transpiled=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObject={};
vm.runInNewContext(transpiled,{exports:exportsObject,require:n=>{throw Error('Unexpected runtime dependency '+n)}},{filename:file});
const {RTICORE_NAVIGATION,navigationForRole}=exportsObject;

test('thirteen business, administration and platform menu groups, no duplicate or demo routes',()=>{
 assert.equal(RTICORE_NAVIGATION.length,13);
 assert.equal(new Set(RTICORE_NAVIGATION.map(x=>x.id)).size,13);
 const all=RTICORE_NAVIGATION.flatMap(x=>x.items.map(i=>i.href));
 assert.equal(new Set(all).size,all.length);
 for(const href of all){
  assert.match(href,/^\/(?:sales\/|psa\/timesheets$|erp\/|customers$|partners$|reports$|settings\/|boq(?:\/users)?$|flexguard$|post-po$|approvals$|scoping$|platform\/diagnostics$)/);
  assert.ok(fs.existsSync(path.join(root,'src/app',href.replace(/^\//,''),'page.tsx')),href);
 }
 for(const legacy of ['/','/pricing','/tender','/proposals'])
  assert.ok(!all.includes(legacy),legacy);
});

test('user roles are filtered; Admin alone gets secret-management menu',()=>{
 const admin=navigationForRole('admin').flatMap(g=>g.items.map(x=>x.href));
 assert.ok(admin.includes('/settings/system'));assert.ok(admin.includes('/settings/ai'));
 for(const role of ['sales','marketing','presales','finance','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer']){
  const routes=navigationForRole(role).flatMap(g=>g.items.map(x=>x.href));
  assert.ok(!routes.includes('/settings/system'),role);
  assert.ok(!routes.includes('/settings/ai'),role);
 }
 assert.deepEqual(Array.from(navigationForRole('viewer').flatMap(g=>g.items.map(x=>x.href))),['/boq']);
 assert.equal(navigationForRole('made-up-role').length,0);
 assert.equal(navigationForRole(null).length,0);
 assert.ok(!navigationForRole('sales').flatMap(x=>x.items.map(i=>i.href)).includes('/sales/billing'));
});

test('Finance and Legal feature catalogs match their complete role navigation',()=>{
 for(const [role,file,exportName] of [
  ['finance','src/components/sales/FinanceWorkspaceGuide.tsx','FINANCE_ROLE_CATALOG'],
  ['legal','src/components/sales/LegalWorkspaceGuide.tsx','LEGAL_ROLE_CATALOG'],
 ]){
  const source=read(file);
  const start=source.indexOf(`export const ${exportName}`);
  const end=source.indexOf('export function ',start);
  assert.ok(start>=0&&end>start,file+' catalog boundaries');
  const catalog=source.slice(start,end);
  const hrefs=[...catalog.matchAll(/href:\s*'([^']+)'/g)].map(match=>match[1]);
  const routes=navigationForRole(role).flatMap(group=>group.items.map(item=>item.href));
  assert.equal(new Set(hrefs).size,hrefs.length,role+' catalog has duplicate routes');
  assert.deepEqual([...hrefs].sort(),[...routes].sort(),role+' catalog must match its role routes');
 }
});

test('IT Developer Team: Leader/Member menus match the in-app catalog and the API allow-list',()=>{
 const source=read('src/components/sales/ITDevWorkspaceGuide.tsx');
 const start=source.indexOf('export const ITDEV_ROLE_CATALOG'),end=source.indexOf('export function ',start);
 assert.ok(start>=0&&end>start,'catalog boundaries');
 const catalog=source.slice(start,end);
 const menus=[...catalog.matchAll(/href:\s*'([^']+)'[\s\S]*?roles:\s*(BOTH|\[[^\]]*\])/g)].map(m=>({href:m[1],leaderOnly:m[2]!=='BOTH'}));
 const leader=navigationForRole('itdev_leader').flatMap(g=>g.items.map(x=>x.href));
 const member=navigationForRole('itdev_member').flatMap(g=>g.items.map(x=>x.href));
 assert.deepEqual([...leader].sort(),menus.map(m=>m.href).sort(),'Leader catalog must match Leader menu');
 assert.deepEqual([...member].sort(),menus.filter(m=>!m.leaderOnly).map(m=>m.href).sort(),'Member catalog must match Member menu');
 assert.ok(leader.includes('/sales/feasibility')&&!member.includes('/sales/feasibility'));
 for(const routes of [leader,member]){
  assert.ok(routes.includes('/platform/diagnostics'));
  for(const forbidden of ['/boq','/customers','/sales/billing','/sales/revenue','/sales/renewals','/approvals','/boq/users','/settings/system','/settings/ai','/erp/organization','/erp/cyber-operations'])
   assert.ok(!routes.includes(forbidden),forbidden);
 }
 // API allow-list (itdev-team.ts) and the diagnostics handler stay read-only and role-limited.
 const lib=read('src/lib/itdev-team.ts');
 assert.match(lib,/LEADER_API:readonly string\[\]=\['\/api\/sales\/feasibility'\]/);
 assert.match(read('src/lib/boq-auth.ts'),/itdevRouteAllowed\(path,role\)/);
 const diag=read('src/app/api/platform/diagnostics/route.ts');
 assert.doesNotMatch(diag,/export async function (POST|PUT|PATCH|DELETE)/);
 assert.match(diag,/AUDIT_ROLES=\['admin','itdev_leader'\]/);
 assert.doesNotMatch(diag,/key_ciphertext FROM|data_json|rticore_sales_audit/);
});

test('Smart Scoping is discoverable in Presales for Admin, Sales and Presales only',()=>{
 const presales=RTICORE_NAVIGATION.find(group=>group.id==='presales');
 assert.ok(presales);
 assert.ok(presales.items.some(item=>item.href==='/scoping'&&item.label==='Smart Scoping & Sizing'));
 for(const role of ['admin','sales','presales']){
  const links=navigationForRole(role).flatMap(group=>group.items.map(item=>item.href));
  assert.ok(links.includes('/scoping'),role);
 }
 for(const role of ['finance','approver','legal','marketing','viewer']){
  const links=navigationForRole(role).flatMap(group=>group.items.map(item=>item.href));
  assert.ok(!links.includes('/scoping'),role);
 }
 const scoped=read('src/app/scoping/page.tsx');
 assert.match(scoped,/SCOPING_SERVICE_TYPES\.map/);
});

test('Sales sees the tender workflow it acts in, and shortcut links follow the role menu',()=>{
 const {canOpenRoute}=exportsObject;
 const sales=navigationForRole('sales').flatMap(g=>g.items.map(x=>x.href));
 for(const href of ['/sales/compliance','/sales/bid-readiness','/sales/feasibility','/sales/procurement'])
  assert.ok(sales.includes(href),href);
 for(const href of ['/sales/billing','/sales/revenue','/sales/delivery']){
  assert.ok(!sales.includes(href),href);
  assert.equal(canOpenRoute('sales',href+'?opportunity_id=x'),false,href);
 }
 assert.equal(canOpenRoute('finance','/sales/billing'),true);
 assert.equal(canOpenRoute('sales','/sales/lifecycle?opportunity_id=x'),true,'contextual pages stay reachable');
 assert.equal(canOpenRoute(undefined,'/sales/billing'),false);
 for(const file of ['src/components/sales/CommercialUI.tsx','src/app/sales/forecast/page.tsx','src/app/customers/page.tsx'])
  assert.match(read(file),/canOpenRoute\(/,file);
});

test('current-user endpoint delegates to server Access and never reads client role',()=>{
 const handler=read('src/app/api/sales/identity/route.ts');
 assert.match(handler,/await authorizeBoQ\(req\)/);
 assert.match(handler,/if\(!auth\.ok\)return auth\.response/);
 assert.match(handler,/auth\.identity\.email/);
 assert.match(handler,/auth\.identity\.role/);
 assert.doesNotMatch(handler,/new URL\(req\.url\)\.searchParams/);
});

test('shell and header never supply demo users or selectable role; mobile has all groups',()=>{
 const shell=read('src/components/layout/AppShell.tsx');
 const header=read('src/components/layout/Navbar.tsx');
 const side=read('src/components/layout/Sidebar.tsx');
 const mobile=read('src/components/layout/MobileNav.tsx');
 assert.match(shell,/fetch\('\/api\/sales\/identity'/);
 assert.match(shell,/fetch\('\/api\/sales\/approval-queue'/);
 assert.match(shell,/pendingApprovalsCount=\{pendingApprovalsCount\}/);
 assert.doesNotMatch(shell,/useState<SystemRole>\('sales'\)/);
 assert.doesNotMatch(header,/RBAC Simulation|onRoleChange\(|const roles: Array/);
 assert.match(header,/Sesi belum terverifikasi/);
 assert.match(side,/navigationForRole\(role\)/);
 assert.match(mobile,/navigationForRole\(role\)/);
 assert.match(mobile,/aria-label="Buka seluruh menu RTICORE"/);
 assert.match(header,/href="\/approvals"/);
 assert.match(header,/role==='admin'&&<Link/);
});
