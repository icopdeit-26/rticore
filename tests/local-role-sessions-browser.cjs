const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const { launchBrowser } = require('./helpers/browser.cjs');

const base = process.env.RTICORE_ROLE_UAT_URL;
const dbPath = process.env.RTICORE_ROLE_UAT_DB;
const roleSource = ts.createSourceFile('boq-domain.ts', fs.readFileSync('src/lib/boq-domain.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const roleType = roleSource.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'BoQRole');
const roles = roleType.type.types.map(type => type.literal.text);
const navSource = fs.readFileSync('src/lib/enterprise-navigation.ts', 'utf8');
const navModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(navSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, navModule);
const { RTICORE_NAVIGATION, firstAccessibleHref } = navModule.exports;

async function checkSidebar(page, variant, expected) {
  const sidebar = page.locator(`#rticore-left-sidebar-${variant}`);
  const nav = sidebar.getByRole('navigation', { name: 'Daftar modul RTICORE' });
  await nav.waitFor();
  const hrefs = await nav.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')).sort());
  assert.deepEqual(hrefs, expected, `Menu ${variant} tidak sesuai kewenangan role`);
  return sidebar;
}

test('Local browser sessions exercise login, desktop/mobile menus and logout for every role', async t => {
  assert.match(base ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  const db = new DatabaseSync(dbPath);
  try {
    const insert = db.prepare("INSERT INTO rticore_members(email,role,active,created_by) VALUES(?,?,1,'UAT')");
    for (const role of roles) insert.run(`${role}@uat.invalid`, role);
  } finally {
    db.close();
  }

  const browser = await launchBrowser({ headless: true });
  try {
    for (const role of roles) {
      await t.test(role, async () => {
        const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          const pageErrors = [];
          page.on('pageerror', error => pageErrors.push(`${page.url()}: ${error.message}`));
          const email = `${role}@uat.invalid`;
          const landing = firstAccessibleHref(role);
          const menu = Array.from(RTICORE_NAVIGATION.flatMap(group => group.items)
            .filter(item => item.roles.includes(role)).map(item => item.href)).sort();
          assert.ok(landing && menu.includes(landing), role);

          await page.goto('/login');
          await page.getByLabel('Masuk sebagai akun terdaftar').selectOption(email);
          await page.getByRole('button', { name: 'Masuk (mode lokal)' }).click();
          await page.waitForURL(base + landing);
          const identity = await context.request.get('/api/sales/identity');
          assert.equal(identity.status(), 200);
          assert.deepEqual((await identity.json()).identity, { email, role, assignedRole: role, rolePreview: false });

          const desktop = await checkSidebar(page, 'desktop', menu);
          await desktop.getByRole('button', { name: 'Sembunyikan sidebar kiri' }).click();
          await desktop.waitFor({ state: 'detached' });
          await page.getByRole('button', { name: 'Tampilkan menu kiri RTICORE' }).click();
          const search = desktop.getByRole('searchbox', { name: 'Cari menu' });
          await search.fill('menu-yang-tidak-ada-di-uat');
          await desktop.locator('nav a[href]').first().waitFor({ state: 'detached' });
          await desktop.getByRole('button', { name: 'Hapus pencarian' }).click();
          await desktop.locator(`nav a[href="${landing}"]`).waitFor({ state: 'attached' });
          const activeLinks = desktop.locator('nav a[aria-current="page"]');
          for (const target of menu) {
            const link = desktop.locator(`nav a[href="${target}"]`);
            const group = link.locator('xpath=ancestor::details');
            if (await group.getAttribute('open') === null) await group.locator('summary').click();
            await link.click();
            await page.waitForURL(base + target);
            await link.and(activeLinks).waitFor({ state: 'attached' });
            assert.deepEqual(await activeLinks.evaluateAll(links => links.map(a => a.getAttribute('href'))), [target]);
          }

          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: 'Buka seluruh menu RTICORE' }).click();
          const allMenus = page.getByRole('dialog', { name: 'Seluruh menu RTICORE' });
          assert.deepEqual(await allMenus.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')).sort()), menu);
          await allMenus.getByRole('button', { name: 'Tutup menu' }).click();
          await allMenus.waitFor({ state: 'hidden' });
          await page.getByRole('button', { name: 'Buka seluruh menu RTICORE' }).click();
          await allMenus.locator(`a[href="${landing}"]`).click();
          await page.waitForURL(base + landing);
          await allMenus.waitFor({ state: 'hidden' });
          await page.getByRole('button', { name: 'Buka menu kiri RTICORE' }).click();
          const mobile = await checkSidebar(page, 'mobile', menu);
          await mobile.getByRole('button', { name: 'Keluar akun / Logout' }).click();
          await page.waitForURL(base + '/login');
          assert.equal((await context.request.get('/api/sales/identity')).status(), 401);
          assert.deepEqual(pageErrors, []);
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
