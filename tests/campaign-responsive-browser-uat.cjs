const {launchBrowser}=require('./helpers/browser.cjs');
// Explicitly fixture-based browser UAT on localhost. NOT a substitute for genuine
// Cloudflare Access UAT with signed JWTs against a dedicated UAT Worker and D1.
const test = require('node:test');
const assert = require('node:assert/strict');
const { devices } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const origin = process.env.RTICORE_CAMPAIGN_FIXTURE_URL || 'http://127.0.0.1:3100';
const shots = path.join(process.cwd(), 'artifacts', 'campaign-browser-uat');
fs.mkdirSync(shots, { recursive: true });
const codePattern = /^CMP-\d{8}-[A-F0-9]{12}$/;

async function fixturePage(browser, name, role, mobile) {
 const context = await browser.newContext(mobile
  ? { ...devices['Pixel 7'], baseURL: origin }
  : { viewport: { width: 1366, height: 900 }, baseURL: origin });
 const page = await context.newPage();
 const submissions = [];
 await page.route('**/api/marketing/campaigns', async route => {
  const request = route.request();
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method() === 'POST') {
   const body = JSON.parse(request.postData() || '{}');
   submissions.push(body);
   await route.fulfill({ status: 201, headers,
    body: JSON.stringify({ success: true, id: 'fixture-record', code: body.code, status: body.status }) });
  } else {
   await route.fulfill({ status: 200, headers, body: JSON.stringify({
    success: true, role, email: role+'@example.test', owners:role === 'sales' ? undefined : [
     {email:'marketing@example.test',role:'marketing'},
     {email:'sales@example.test',role:'sales'},
    ], campaigns: role === 'sales' ? [{
     id:'existing-campaign', code:'CMP-20261116-000000000001', name:'Campaign Aktif UAT',
     status:'active', owner_email:'marketing@example.test', owner_emails:['marketing@example.test'],
    }] : []
   }) });
  }
 });
 try {
  const response = await page.goto('/sales/campaigns', { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200);
  await page.getByRole('heading', { name: 'Marketing Campaign Center' }).waitFor();
  const newButton = page.getByRole('button', { name: 'Campaign Baru' });
  if (role === 'sales') {
   await page.getByRole('button', { name: 'Buka Campaign Campaign Aktif UAT' }).click();
   await page.getByText('Hanya Marketing/Admin yang dapat mengubah Owner.', { exact: false }).waitFor();
   assert.equal(await newButton.count(), 0, 'Sales cannot register Campaign');
   assert.equal(await page.getByRole('button', { name: 'Simpan Revisi' }).count(), 0);
   return;
  }
  await newButton.click();
  await page.getByRole('heading', { name: 'Registrasi Campaign' }).waitFor();
  const code = page.locator('input[aria-label="Kode unik Campaign, dibuat otomatis"]');
  assert.equal(await code.count(), 1);
  assert.equal(await code.isDisabled(), true);
  const first = await code.inputValue();
  assert.match(first, codePattern, 'Auto generated code visible on '+name);
  assert.equal(await page.getByText('Kode unik *', {exact:true}).count(), 0);
  const rect = await code.boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= (mobile ? 412 : 1366) + 4,
   'Auto-generated code input clipped on '+name);
  await page.screenshot({ path: path.join(shots,name+'-new.png'), fullPage: true });

  await page.getByLabel('Nama campaign *').fill('UAT Responsive Campaign');
  const ownerGroup = page.getByRole('group', { name: 'Owner Campaign (anggota aktif)' });
  assert.equal(await ownerGroup.getByRole('checkbox', { name: 'marketing@example.test (marketing)' }).isChecked(), true);
  await ownerGroup.getByRole('checkbox', { name: 'sales@example.test (sales)' }).check();
  await page.getByRole('button', { name: 'Daftarkan Campaign' }).click();
  await page.getByText('Campaign berhasil diregistrasi di database.', { exact: false }).waitFor();
  assert.equal(submissions.length, 1, 'Expected one mocked POST');
  assert.equal(submissions[0].code, first, 'Disabled HTML input remains in React JSON payload');
  assert.deepEqual(submissions[0].owner_emails, ['marketing@example.test', 'sales@example.test']);
  await newButton.click();
  const second = await code.inputValue();
  assert.match(second,codePattern);
  assert.notEqual(first,second,'New Campaign must produce a fresh code');
  assert.equal(await code.isDisabled(),true);
  await page.screenshot({ path: path.join(shots,name+'-second.png'), fullPage: true });
 } finally { await context.close(); }
}

test('Campaign browser UI: Android emulation and desktop, Marketing and Admin; Sales denied', async () => {
 const browser = await launchBrowser({ headless: true, args: ['--no-sandbox'] });
 try {
  for(const scenario of [
   {name:'android-marketing',role:'marketing',mobile:true},
   {name:'desktop-admin',role:'admin',mobile:false},
   {name:'android-sales-denied',role:'sales',mobile:true},
  ]) await fixturePage(browser,scenario.name,scenario.role,scenario.mobile);
 } finally { await browser.close(); }
});
