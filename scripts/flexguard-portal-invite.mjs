// Private operator terminal only. Separate customer TOTP key and no internal membership.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {validateHostingerConfig} from '../src/lib/hostinger-config.ts';
import {validEmail,iamKey,newToken,tokenHash,encryptSeed} from '../src/lib/business-iam-crypto.ts';
let client;
try{
 if(process.env.CI||!process.stdout.isTTY||process.env.RTICORE_AUTH_MODE!=='business'||process.env.RTICORE_FLEXGUARD_PORTAL_ENABLED!=='1')throw Error('Private approved portal operator required');
 const email=(process.argv[2]||'').trim().toLowerCase();if(!validEmail(email)||process.argv.length!==3)throw Error('Invalid customer email');
 if(!process.env.RTICORE_PORTAL_IAM_KEY||process.env.RTICORE_PORTAL_IAM_KEY===process.env.RTICORE_IAM_ENCRYPTION_KEY)throw Error('Separate portal key required');
 const key=iamKey(process.env.RTICORE_PORTAL_IAM_KEY),url=validateHostingerConfig(process.env);
 client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:15000});await client.connect();
 const token=newToken(),cipher=encryptSeed(randomBytes(20),'portal:'+email,key);
 const result=await client.query("WITH changed AS (INSERT INTO rticore_native_fg_portal_credential(email,totp_cipher,invite_hash,invite_expires) SELECT a.email,$2,$3,now()+interval '30 minutes' FROM rticore_native_fg_portal_account a WHERE a.email=$1 AND a.active AND NOT EXISTS(SELECT 1 FROM rticore_members m WHERE lower(m.email)=a.email) AND EXISTS(SELECT 1 FROM rticore_native_fg_portal_grant g WHERE g.email=a.email AND rticore_native_fg_portal_allowed(g.tenant_id,g.legal_entity_id,g.wallet_id,a.email)) ON CONFLICT(email) DO UPDATE SET totp_cipher=excluded.totp_cipher,invite_hash=excluded.invite_hash,invite_expires=excluded.invite_expires WHERE rticore_native_fg_portal_credential.enrolled_at IS NULL RETURNING email) INSERT INTO rticore_native_fg_portal_audit(email,action) SELECT email,'invite' FROM changed RETURNING email",[email,cipher,tokenHash(token)]);
 if(result.rowCount!==1)throw Error('No eligible independently approved customer account');
 console.log('Private one-time portal invitation (30 minutes). Deliver to verified customer only.');console.log(token);
}catch{console.error('Portal invitation refused. No invitation confirmed.');process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
