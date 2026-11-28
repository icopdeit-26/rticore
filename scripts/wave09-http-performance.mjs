import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
// Fixed isolated CI endpoint; no external host, no authenticated traffic.
const base='http://127.0.0.1:3199',routes=[['/api/health/live',200],['/login',200],['/api/wallets',503],['/',307]];
const concurrency=8,total=120,results=[];
async function sample(i,record=true){
 const [route,expected]=routes[i%routes.length],start=performance.now();
 let status=null,error=null;
 try{const r=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});status=r.status;await r.arrayBuffer();if(status!==expected)error='unexpected_status';}catch{error='request_failed';}
 const row={route,expected,status,ms:Math.round((performance.now()-start)*100)/100,error};
 if(record)results.push(row);return row;
}
for(let i=0;i<routes.length;i++)if((await sample(i,false)).error)throw Error('Warmup failed');
const start=performance.now();let cursor=0;
await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<total){const i=cursor++;await sample(i);}}));
const elapsed=performance.now()-start;
const stat=rows=>{const a=rows.map(r=>r.ms).sort((a,b)=>a-b);const pct=p=>a[Math.max(0,Math.ceil(p*a.length)-1)];return {requests:rows.length,errors:rows.filter(r=>r.error).length,p50_ms:pct(.5),p95_ms:pct(.95),p99_ms:pct(.99),max_ms:a.at(-1)};};
const report={scope:'loopback_unauthenticated_synthetic',source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),concurrency,total,elapsed_ms:elapsed,requests_per_second:total/(elapsed/1000),overall:stat(results),routes:routes.map(([route])=>({route,...stat(results.filter(r=>r.route===route))})),provisional_gate:{max_p95_ms:1500,allowed_errors:0},production_certified:false};
mkdirSync('artifacts/wave09',{recursive:true});writeFileSync('artifacts/wave09/http-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
if(report.overall.errors||report.routes.some(r=>r.p95_ms>1500))process.exitCode=1;
