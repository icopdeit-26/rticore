import pg from 'pg';
import {assertCronDatabaseIdentity} from './hostinger-runtime-privileges.mjs';
import {runSalesCron} from '../automation/sales-cron/native-postgres.mjs';
let client;
try{
 if(process.env.RTICORE_RUNTIME!=='hostinger'||process.env.RTICORE_LOCAL_MODE!=='0'||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||process.env.RTICORE_SALES_CRON_ENABLED!=='1')throw Error('Scheduler not explicitly enabled');
 const url=new URL(process.env.RTICORE_SALES_CRON_DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||url.pathname.length<2||url.hash||url.searchParams.getAll('sslmode').length!==1||url.searchParams.get('sslmode')!=='verify-full'||[...url.searchParams.keys()].some(k=>k!=='sslmode'))throw Error('Invalid dedicated scheduler database config');
 const expectedDatabase=process.env.RTICORE_SALES_CRON_EXPECTED_DATABASE;
 const expectedRole=decodeURIComponent(url.username);
 if(!expectedDatabase||decodeURIComponent(url.pathname.slice(1))!==expectedDatabase)throw Error('Cron database scope mismatch');
 url.search='';
 client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:30000});
 await client.connect();await assertCronDatabaseIdentity(client,expectedDatabase,expectedRole);const result=await runSalesCron(client);console.log(JSON.stringify({job:'sales-alerts',...result}));
}catch{console.error('Native Sales scheduler failed or not enabled; no successful batch reported.');process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
