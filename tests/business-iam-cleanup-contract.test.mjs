import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../scripts/business-iam-cleanup.mjs',import.meta.url),'utf8');
const env=readFileSync(new URL('../deployment/hostinger/business-cron.env.example',import.meta.url),'utf8');
test('cleanup contract retains default-disabled gate, TLS, separate role and bounded deletion behind advisory lock',()=>{
 assert.match(env,/^RTICORE_IAM_CLEANUP_ENABLED=0$/m);
 assert.match(script,/RTICORE_IAM_CLEANUP_ENABLED!==['"]1['"]/);
 assert.match(script,/rejectUnauthorized:true/);
 assert.match(script,/RTICORE_IAM_CLEANUP_DATABASE_URL/);
 const lock=script.indexOf('pg_try_advisory_lock('),skip=script.indexOf('already-running'),del=script.indexOf('DELETE FROM rticore_iam_sessions');
 assert.ok(lock>=0&&lock<skip&&skip<del);
 assert.match(script,/LIMIT 500/);
 assert.match(script,/finally\{await client\?\.end\(/);
});
