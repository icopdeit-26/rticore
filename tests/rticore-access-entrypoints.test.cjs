const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('RTICORE account dropdown exposes native SSO logout on mobile and desktop',()=>{
  const navbar=read('src/components/layout/Navbar.tsx');
  const sidebar=read('src/components/layout/Sidebar.tsx');
  assert.match(navbar, /<details className="group relative min-w-0">/);
  assert.match(navbar, /aria-label="Menu akun dan logout"/);
  assert.match(navbar, /Keluar \/ Logout/);
  assert.match(navbar, /LogoutButton/);
  assert.match(sidebar, /Keluar akun \/ Logout/);
  assert.match(sidebar, /LogoutButton/);
  assert.doesNotMatch(navbar, /document\.cookie\s*=/);
});

test('RTICORE login supports native business MFA and optional SSO with a protected shell',()=>{
  const page=read('src/app/login/page.tsx');
  const shell=read('src/components/layout/AppShell.tsx');
  assert.match(page, /Login RTICORE/);
  assert.match(page, /Masuk dengan SSO \+ MFA/);
  assert.match(page,/href="\/oauth2\/start\?rd=%2Flogin"/);
  assert.match(page, /LogoutButton/);
  assert.doesNotMatch(page, /type=["']password["']|localStorage\.setItem|jwtVerify\(/);
  assert.match(shell, /const isLoginPage=pathname==='\/login'/);
  assert.match(shell, /if\(isLoginPage\|\|\(nativeBusiness&&pathname==='\/'\)\)return <>{children}<\/>/);
  assert.match(shell, /if\(isLoginPage\|\|\(nativeBusiness&&pathname==='\/'\)\)return;/);
  assert.match(shell, /if\(nativeBusiness&&session.status!=='ready'\)return <main/);
  assert.match(shell, /nativeBusiness&&\(res.status===401\|\|res.status===403\)/);
  assert.match(page, /if\(businessMode\)return/);
  const layout=read('src/app/layout.tsx');
  assert.match(layout, /export const dynamic='force-dynamic'/);
  assert.match(layout, /nativeBusiness=\{process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_AUTH_MODE==='business'\}/);
  assert.match(shell, /Buka halaman login RTICORE/);
});

test('real transactional identity remains OIDC and database backed',()=>{
  const identity=read('src/app/api/sales/identity/route.ts');
  const auth=read('src/lib/boq-auth.ts');
  assert.match(identity, /authorizeBoQ\(req\)/);
  assert.match(auth,/verifyNativeOIDCToken\(token,/);
  assert.match(auth, /SELECT role,active FROM rticore_members WHERE email=\?/);
});
