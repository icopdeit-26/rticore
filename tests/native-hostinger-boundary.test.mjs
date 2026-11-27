import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('runtime cannot fall back to external worker or Access authentication',()=>{
 const runtime=read('src/lib/runtime-env.ts'),auth=read('src/lib/boq-auth.ts');assert.doesNotMatch(runtime,/getCloudflareContext|@opennextjs/);assert.doesNotMatch(auth,/cf-access-jwt-assertion|cdn-cgi\/access\/certs/);assert.match(runtime,/throw new Error\('RTICORE runtime not configured/);assert.match(auth,/verifyNativeOIDCToken/);assert.match(auth,/requireActiveNativeSession/);
});
test('native production start refuses missing configuration without opening a port',()=>{
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('RTICORE_')||key==='DATABASE_URL')delete env[key];const p=spawnSync(process.execPath,['--experimental-strip-types','scripts/start-hostinger.mjs'],{env,encoding:'utf8',timeout:5000});assert.equal(p.status,1);assert.match(p.stderr,/Native startup refused/);
});
test('public login is isolated and protected API does not redirect unauthorized callers',()=>{
 const nginx=read('deployment/hostinger/nginx-rticore.conf.example');assert.match(nginx,/location = \/login/);const api=nginx.split('location ^~ /api/ {')[1].split('location / {')[0];assert.match(api,/auth_request \/oauth2\/auth/);assert.doesNotMatch(api,/error_page 401/);assert.match(api,/proxy_set_header X-RTICore-OIDC-Token \$oidc_token/);
 const page=read('src/app/login/page.tsx'),logout=read('src/components/auth/LogoutButton.tsx');assert.doesNotMatch(page+logout,/Cloudflare Access|cdn-cgi\/access/);assert.match(page,/oauth2\/start/);assert.match(logout,/oauth2\/sign_out/);
});
