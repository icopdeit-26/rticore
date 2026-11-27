import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {renderNativeIAM} from '../scripts/render-native-iam.mjs';
test('native IAM renderer creates consistent candidate config and prevents overwrite',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rticore-iam-'));
 try{
 const output=path.join(temp,'candidate'),opts={mode:'staging',appHost:'uat.example.com',ssoHost:'sso-uat.example.com',emailDomains:['example.com'],output};
 assert.equal(renderNativeIAM(opts).length,10);
 const read=n=>fs.readFileSync(path.join(output,n),'utf8');
 const realm=JSON.parse(read('keycloak-realm.template.json'));
 assert.equal(realm.clients[1].redirectUris[0],'https://uat.example.com/oauth2/callback');
 assert.match(read('oauth2-proxy.cfg.example'),/email_domains = \["example.com"\]/);
 assert.match(read('nginx-sso.conf.example'),/proxy_pass http:\/\/127\.0\.0\.1:8080/);
 assert.match(read('keycloak.env.example'),/KC_HTTP_HOST=127\.0\.0\.1/);
 assert.match(read('app.env.example'),/RTICORE_OIDC_ISSUER=https:\/\/sso-uat\.example\.com\/realms\/rticore/);
 assert.match(read('app.env.example'),/REPLACE_WITH_GENERATED_SECRET/);
 assert.throws(()=>renderNativeIAM(opts));
 for(const patch of [{appHost:'rticore.store'},{ssoHost:'foo.cloudflareaccess.com'},{ssoHost:'https://example.com'},{emailDomains:['*']},{ssoHost:'uat.example.com'}])assert.throws(()=>renderNativeIAM({...opts,...patch,output:path.join(temp,'bad')}));
 assert.ok(!fs.existsSync(path.join(temp,'bad')));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
