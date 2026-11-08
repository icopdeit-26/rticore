const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {launchBrowser}=require('./helpers/browser.cjs');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.RTICORE_UAT_URL||'http://127.0.0.1:3100';
const shots=path.join(process.cwd(),'artifacts','browser-uat');
fs.mkdirSync(shots,{recursive:true});

test('login on mobile uses the local account flow without a cloud link or password',async()=>{
 const browser=await launchBrowser({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/api/sales/identity',r=>r.fulfill({
   status:401,contentType:'application/json',body:JSON.stringify({success:false,message:'Login required'})
  }));
  await page.route('**/api/local-auth',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,localMode:true,members:[]})}));
  const response=await page.goto(base+'/login',{waitUntil:'networkidle'});
  assert.equal(response?.status(),200);
  await page.getByRole('heading',{name:'Login RTICORE'}).waitFor();
  await page.getByText('Mode lokal · tanpa cloud',{exact:false}).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(),0);
  assert.equal(await page.getByText('Masuk dengan Cloudflare Access').count(),0);
  assert.equal(await page.getByRole('button',{name:'Logout / Ganti akun'}).isDisabled(),false);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+2,'Mobile login overflows: '+JSON.stringify(dimensions));
  await page.screenshot({path:path.join(shots,'rticore-login-mobile.png'),fullPage:true});
  await page.close();
 }finally{await browser.close();}
});

test('valid server-provided role and email display only its allowed workspace target',async()=>{
 const browser=await launchBrowser({headless:true,args:['--no-sandbox']});
 try{
  for(const [role,target] of [['sales','/sales/activities'],['marketing','/sales/campaigns'],['admin','/sales/executive']]){
   const page=await browser.newPage({viewport:{width:1280,height:800}});
   await page.route('**/api/sales/identity',r=>r.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({success:true,identity:{email:role+'@example.invalid',role}})
   }));
   await page.route('**/api/local-auth',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,localMode:true,members:[]})}));
   await page.goto(base+'/login',{waitUntil:'networkidle'});
   await page.getByText('Sesi terverifikasi').waitFor();
   const workspace=page.getByRole('link',{name:'Buka workspace sesuai role'});
   assert.equal(await workspace.getAttribute('href'),target);
   assert.ok((await page.locator('main').innerText()).includes(role+'@example.invalid'));
   if(role==='admin')await page.screenshot({path:path.join(shots,'rticore-login-authenticated-desktop.png'),fullPage:true});
   await page.close();
  }
 }finally{await browser.close();}
});

test('unauthorized identity produces clear admin-registration guidance and never grants workspace',async()=>{
 const browser=await launchBrowser({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/api/sales/identity',r=>r.fulfill({
   status:403,contentType:'application/json',body:JSON.stringify({success:false})
  }));
  await page.route('**/api/local-auth',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,localMode:true,members:[]})}));
  await page.goto(base+'/login',{waitUntil:'networkidle'});
  await page.getByText('Identitas belum diizinkan membuka RTICORE.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Buka workspace sesuai role'}).count(),0);
  await page.close();
 }finally{await browser.close();}
});
