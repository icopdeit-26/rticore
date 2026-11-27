// Trusted operator only; independently verify and approve identity recovery before use.
import pg from 'pg';
import {validateHostingerConfig} from '../src/lib/hostinger-config.ts';
import {validEmail} from '../src/lib/business-iam-crypto.ts';
let client;
try{
 if(!process.stdout.isTTY||process.env.CI||process.env.RTICORE_AUTH_MODE!=='business')throw Error();
 const email=(process.argv[2]||'').trim().toLowerCase();
 if(!validEmail(email)||process.argv[3]!=='REVOKE_ALL_SESSIONS_AND_MFA'||process.argv.length!==4)throw Error();
 const url=validateHostingerConfig(process.env);
 client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:15000});
 await client.connect();
 const result=await client.query("WITH removed AS (DELETE FROM rticore_iam_credentials WHERE email=$1 RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'revoke' FROM removed RETURNING email",[email]);
 if(result.rowCount!==1)throw Error();
 console.log('Credential and all linked sessions revoked. New MFA enrollment requires a new private invitation.');
}catch{console.error('Revocation refused or not confirmed. Verify operator approval and configuration.');process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
