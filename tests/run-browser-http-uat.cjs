const {spawn}=require('node:child_process');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomBytes}=require('node:crypto');

const browserFiles=[
 'ai-chat-browser-uat.cjs',
 'ai-chat-composer-browser-uat.cjs',
 'browser-http-uat.test.cjs',
 'campaign-responsive-browser-uat.cjs',
 'modules-13-15-browser.cjs',
 'p1-p2-commercial-browser.cjs',
 'rticore-login-browser.test.cjs',
 'sales-lifecycle-browser.cjs',
 'sales-stage-filter-browser.test.cjs',
 'service-operations-browser.cjs',
];

function runTests(files,env,options=[]){
 const tests=spawn(process.execPath,['--experimental-strip-types','--test',...options,...files.map(file=>'tests/'+file)],{
  stdio:'inherit',env,
 });
 return new Promise((resolve,reject)=>{
  tests.once('error',reject);
  tests.once('close',code=>resolve(code??1));
 });
}

async function freePort(){
 return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
}
async function waitForServer(url,server){
 let logs='';server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
 let spawnError;
 server.once('error',error=>{spawnError=error;});
 for(let attempt=0;attempt<80;attempt++){
  if(spawnError)throw spawnError;
  if(server.exitCode!==null)throw Error('Local UAT server exited early: '+logs);
  try{const response=await fetch(url+'/login',{signal:AbortSignal.timeout(1000)});if(response.ok)return;}
  catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('Local UAT server did not start: '+logs);
}
async function withServer(serverEnv,run){
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe'],env:serverEnv});
 const closed=new Promise(resolve=>server.once('close',resolve));
 try{
  await waitForServer(base,server);
  return await run(base);
 }finally{server.kill('SIGTERM');await closed;}
}

async function runRoleSessions(){
 const {DatabaseSync}=require('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rticore-role-uat-'));
 const dbPath=path.join(dir,'uat.sqlite');
 try{
  const db=new DatabaseSync(dbPath);
  try{
   db.exec('PRAGMA foreign_keys=ON');
   for(const file of fs.readdirSync('migrations').filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort()){
    db.exec(fs.readFileSync(path.join('migrations',file),'utf8'));
   }
  }finally{db.close();}
  return await withServer({...process.env,RTICORE_LOCAL_MODE:'1',RTICORE_DB_ENGINE:'sqlite',RTICORE_LOCAL_DB_PATH:dbPath,
   RTICORE_LOCAL_SESSION_SECRET:randomBytes(48).toString('base64url')},base=>
    runTests(['local-role-sessions-browser.cjs'],{...process.env,RTICORE_ROLE_UAT_URL:base,RTICORE_ROLE_UAT_DB:dbPath}));
 }finally{
  for(const entry of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,entry));
  fs.rmdirSync(dir);
 }
}

async function main(){
 if(process.argv.includes('--role-sessions')){
  process.exitCode=await runRoleSessions();
  return;
 }
 const all=process.argv.includes('--all');
 const suiteStatus=await withServer(process.env,base=>{
  const env={...process.env,RTICORE_UAT_URL:base,RTICORE_UAT_BASE:base,RTICORE_CHAT_UAT_BASE:base,RTICORE_CAMPAIGN_FIXTURE_URL:base};
  if(!all)return runTests(['browser-http-uat.test.cjs','sales-lifecycle-browser.cjs'],env,['--test-concurrency=1']);
  return runAllTests(env);
 });
 const roleStatus=all?await runRoleSessions():0;
 process.exitCode=suiteStatus||roleStatus;
}

async function runAllTests(env){
  // The real PostgreSQL integration is required in its dedicated service-backed Hostinger CI job.
 // This generic suite does not provision a disposable PostgreSQL service.
 const generalFiles=fs.readdirSync('tests').filter(name=>name.endsWith('.test.cjs')&&!browserFiles.includes(name)&&name!=='hostinger-postgres-server.test.cjs');
  const generalStatus=await runTests(generalFiles,env);
  // Reuse the local build but run browser files serially to avoid resource contention.
  const browserStatus=await runTests(browserFiles,env,['--test-concurrency=1']);
  return generalStatus||browserStatus;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
