const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {launchBrowser}=require('./helpers/browser.cjs');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.RTICORE_UAT_URL||'http://127.0.0.1:3100';
const shots=path.join(process.cwd(),'artifacts','browser-uat');
fs.mkdirSync(shots,{recursive:true});

test('Scoping displays selling estimates and keeps internal cost controls role-gated',async()=>{
 const browser=await launchBrowser({headless:true,args:['--no-sandbox']});
 try{
  for(const role of ['sales','admin']){
   const canViewCost=role==='admin';
   const page=await browser.newPage({viewport:{width:1280,height:800}});
   try{
    await page.route('**/api/sales/identity',r=>r.fulfill({json:{success:true,identity:{email:role+'@example.invalid',role}}}));
    await page.route('**/api/scoping/model',r=>r.fulfill({json:{success:true,canViewCost,modelVersion:null,estimate:{
     model:'md',periodLabel:'',ready:true,totalMd:10,staffing:[],tierMultiplier:1,dai:1,calibrationFactor:1,
     totalInternalCost:canViewCost?4000000:0,floor:canViewCost?5000000:null,standard:9000000,premium:11250000,
     marginAtStandard:canViewCost?55.56:null,marginWarning:false,heldAtFloor:false,
    }}}));
    const response=await page.goto(base+'/scoping');
    assert.equal(response?.status(),200);
    await page.getByText('Standard (tier', {exact:false}).waitFor();
    assert.equal(await page.getByText('HPP A–E',{exact:true}).count(),Number(canViewCost));
    assert.equal(await page.getByLabel('B · Komisi Sales & Partner',{exact:true}).count(),Number(canViewCost));
   }finally{await page.close();}
  }
 }finally{await browser.close();}
});

// Use a dedicated loopback-only server: a browser mock cannot change server-rendered runtime mode.
async function withIsolatedLocalServer(run){
 const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
 const {DatabaseSync}=require('node:sqlite'),net=require('node:net'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rticore-login-uat-'));
 let server,closed;
 try{
  const dbPath=path.join(dir,'login.sqlite');
  const db=new DatabaseSync(dbPath);
  try{
   db.exec('PRAGMA foreign_keys=ON');
   for(const file of fs.readdirSync('migrations').filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort()){
    db.exec(fs.readFileSync(path.join('migrations',file),'utf8'));
   }
  }finally{db.close();}
  const port=await new Promise((resolve,reject)=>{
   const listener=net.createServer();listener.once('error',reject);
   listener.listen(0,'127.0.0.1',()=>{const p=listener.address().port;listener.close(()=>resolve(p));});
  });
  const localBase='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p',String(port)],{
   stdio:['ignore','pipe','pipe'],
   env:{...process.env,RTICORE_RUNTIME:'local',RTICORE_LOCAL_MODE:'1',RTICORE_DB_ENGINE:'sqlite',
    RTICORE_LOCAL_DB_PATH:dbPath,RTICORE_LOCAL_SESSION_SECRET:randomBytes(48).toString('base64url'),DATABASE_URL:''}
  });
  let spawnError,logs='';
  server.once('error',e=>{spawnError=e;});
  closed=new Promise(resolve=>server.once('close',resolve));
  server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  let ready=false;
  for(let i=0;i<80;i++){
   if(spawnError)throw spawnError;
   if(server.exitCode!==null)throw Error('Isolated local login server exited: '+logs);
   try{if((await fetch(localBase+'/login',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Isolated local login server failed to start: '+logs);
  const status=await fetch(localBase+'/api/local-auth');
  assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{success:true,localMode:true,members:[]});
  await run(localBase);
 }finally{
  if(server){server.kill('SIGTERM');await closed;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

test('login on mobile uses the local account flow without a cloud link or password',async()=>{
 await withIsolatedLocalServer(async localBase=>{
  const browser=await launchBrowser({headless:true,args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   const pending=new Set();
   const failures=[];
   page.on('request',req=>pending.add(req));
   page.on('requestfinished',req=>pending.delete(req));
   page.on('requestfailed',req=>{pending.delete(req);failures.push(new URL(req.url()).pathname);});
   try {
   const authReady=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/local-auth' && res.request().method()==='GET');
   const response=await page.goto(localBase+'/login',{waitUntil:'domcontentloaded',timeout:30000});
   const authResponse=await authReady;
   assert.equal(authResponse.status(),200);
   assert.deepEqual(await authResponse.json(),{success:true,localMode:true,members:[]});
   assert.equal(response?.status(),200);
   await page.getByRole('heading',{name:'Login RTICORE'}).waitFor();
   await page.getByText('Mode lokal · tanpa cloud',{exact:false}).waitFor();
   assert.equal(await page.locator('input[type="password"]').count(),0);
   assert.equal(await page.getByText('Masuk dengan Cloudflare Access').count(),0);
   assert.equal(await page.getByRole('button',{name:'Logout / Ganti akun'}).isDisabled(),false);
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
   assert.ok(dimensions.scroll<=dimensions.width+2,'Mobile login overflows: '+JSON.stringify(dimensions));
   await page.screenshot({path:path.join(shots,'rticore-login-mobile.png'),fullPage:true});
   } catch(error) {
    console.error('Local login browser diagnostics:',JSON.stringify({pending:[...pending].map(req=>new URL(req.url()).pathname),failed:failures}));
    throw error;
   } finally { await page.close(); }
  }finally{await browser.close();}
 });
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
