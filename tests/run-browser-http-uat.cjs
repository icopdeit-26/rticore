const {spawn}=require('node:child_process');
const net=require('node:net');
const fs=require('node:fs');

async function freePort(){
 return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
}
async function waitForServer(url,server){
 let logs='';server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
 for(let attempt=0;attempt<80;attempt++){
  if(server.exitCode!==null)throw Error('Local UAT server exited early: '+logs);
  try{const response=await fetch(url+'/login',{signal:AbortSignal.timeout(1000)});if(response.ok)return;}
  catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('Local UAT server did not start: '+logs);
}
async function main(){
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe']});
 try{
  await waitForServer(base,server);
  const files=process.argv.includes('--all')
   ?fs.readdirSync('tests').filter(name=>name.endsWith('.test.cjs')).map(name=>'tests/'+name)
   :['tests/browser-http-uat.test.cjs','tests/sales-lifecycle-browser.cjs'];
  const tests=spawn(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit',env:{...process.env,RTICORE_UAT_URL:base}});
  const code=await new Promise(resolve=>tests.once('exit',value=>resolve(value??1)));
  process.exitCode=code;
 }finally{server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
