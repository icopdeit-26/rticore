// Run only from trusted operator workstation/terminal. Never run in CI or log the invite.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {validateHostingerConfig} from '../src/lib/hostinger-config.ts';
import {validEmail,iamKey,newToken,tokenHash,encryptSeed} from '../src/lib/business-iam-crypto.ts';
let client;
try{
 if(!process.stdout.isTTY||process.env.CI||process.env.RTICORE_AUTH_MODE!=='business')throw Error('Interactive private terminal and business mode required');
 const email=(process.argv[2]||'').trim().toLowerCase();
 if(!validEmail(email)||process.argv.length!==3)throw Error('Usage: business-iam-invite.mjs email');
 const url=validateHostingerConfig(process.env),key=iamKey();
 client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:15000});
 await client.connect();
 const token=newToken(),cipher=encryptSeed(randomBytes(20),email,key);
 const result=await client.query("WITH changed AS (INSERT INTO rticore_iam_credentials(email,totp_cipher,invite_hash,invite_expires) SELECT email,$2,$3,now()+interval '30 minutes' FROM rticore_members WHERE email=$1 AND active=1 ON CONFLICT(email) DO UPDATE SET totp_cipher=excluded.totp_cipher,invite_hash=excluded.invite_hash,invite_expires=excluded.invite_expires WHERE rticore_iam_credentials.enrolled_at IS NULL RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'invite' FROM changed RETURNING email",[email,cipher,tokenHash(token)]);
 if(result.rowCount!==1)throw Error('No eligible unenrolled active member');
 console.log('One-time invitation (30 minutes). Deliver privately to independently verified member. Do not record or share publicly.');
 console.log(token);
}catch{console.error('Invitation refused; verify active membership, operator configuration and migration. No invitation confirmed.');process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
