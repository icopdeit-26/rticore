// Short-lived cron job. Separate dedicated PostgreSQL role; no unbounded daemon.
import pg from 'pg';
let client;
try{
 if(process.env.RTICORE_RUNTIME!=='hostinger'||process.env.RTICORE_AUTH_MODE!=='business'||process.env.RTICORE_IAM_CLEANUP_ENABLED!=='1'||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error();
 const url=new URL(process.env.RTICORE_IAM_CLEANUP_DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||url.pathname.length<2||url.hash||url.searchParams.getAll('sslmode').length!==1||url.searchParams.get('sslmode')!=='verify-full'||[...url.searchParams.keys()].some(k=>k!=='sslmode'))throw Error();
 url.search='';client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:15000});
 await client.connect();
 const lock=await client.query("SELECT pg_try_advisory_lock(74201954) AS acquired");
 if(!lock.rows[0]?.acquired){console.log(JSON.stringify({job:"iam-session-cleanup",skipped:"already-running"}));}else{
 const result=await client.query("DELETE FROM rticore_iam_sessions WHERE token_hash IN (SELECT token_hash FROM rticore_iam_sessions WHERE expires_at<=now() OR last_seen<=now()-interval '30 minutes' LIMIT 500) AND (expires_at<=now() OR last_seen<=now()-interval '30 minutes')");
 console.log(JSON.stringify({job:'iam-session-cleanup',removed:result.rowCount}));
 }
}catch{console.error('IAM cleanup failed or not enabled.');process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
