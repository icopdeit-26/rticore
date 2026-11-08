const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const gate=fs.readFileSync('scripts/rticore-prod-ai-schema-preflight.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/rticore-chat-prod-hotfix-release.yml','utf8');

test('Production deploy gate fails closed without authorized Cloudflare token',()=>{
 const env={...process.env,CLOUDFLARE_API_TOKEN:'',GITHUB_SHA:'0'.repeat(40)};
 const r=spawnSync(process.execPath,['scripts/rticore-prod-ai-schema-preflight.mjs','before'],{
  env,encoding:'utf8',timeout:10000
 });
 assert.equal(r.status,2,r.stdout+' '+r.stderr);
 assert.match(r.stderr,/CLOUDFLARE_API_TOKEN_MISSING/);
 assert.match(r.stderr,/"result":"BLOCKED"/);
});
test('Worker rollout requires all 30 migrations, immutable backup and signoffs',()=>{
 assert.match(gate,/MISSING_MIGRATIONS/);
 assert.match(gate,/RTICORE_DOCUMENT_ENCRYPTION_KEY/);
 assert.match(gate,/RTICORE_AI_ENCRYPTION_KEY/);
 assert.match(gate,/RTICORE_PROD_VERIFIED_BACKUP_SHA256/);
 assert.match(gate,/RTICORE_PROD_SIGNED_ACCESS_UAT/);
 assert.match(gate,/RTICORE_PROD_FINANCE_SECURITY_SIGNOFF/);
 assert.match(gate,/version_before/);
 assert.doesNotMatch(gate,/\b(?:INSERT|UPDATE|DELETE|DROP TABLE|ALTER TABLE)\s+rticore_/i);
});
test('Production workflow cannot deploy before preflight and retains rollback',()=>{
 const preflight=workflow.indexOf('rticore-prod-ai-schema-preflight.mjs before');
 const deploy=workflow.indexOf('opennextjs-cloudflare deploy');
 assert.ok(preflight>0&&deploy>preflight);
 assert.match(workflow,/previous_version/);
 assert.match(workflow,/Rollback after RTICORE composer hotfix post-deploy gate failure/);
 assert.match(workflow,/git merge-base --is-ancestor 3b765b80879c1ea23b75bab894d8e4279d2ed5cf HEAD/);
});
