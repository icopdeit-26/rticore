import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const realm=JSON.parse(fs.readFileSync(new URL('../deployment/hostinger/keycloak-realm.template.json',import.meta.url),'utf8'));
test('realm template requires actual password and OTP at level 2',()=>{
 const browser=realm.authenticationFlows.find(f=>f.alias===realm.browserFlow);
 assert.equal(browser.authenticationExecutions.length,1);
 const entry=browser.authenticationExecutions[0];assert.equal(entry.requirement,'CONDITIONAL');
 const sub=realm.authenticationFlows.find(f=>f.alias===entry.flowAlias);
 assert.deepEqual(sub.authenticationExecutions.map(e=>[e.authenticator,e.requirement]),[['conditional-level-of-authentication','REQUIRED'],['auth-username-password-form','REQUIRED'],['auth-otp-form','REQUIRED']]);
 assert.equal(realm.authenticatorConfig.find(c=>c.alias===sub.authenticationExecutions[0].authenticatorConfig).config['loa-condition-level'],'2');
 const client=realm.clients.find(c=>c.clientId==='rticore-proxy');
 assert.equal(client.attributes['minimum.acr.value'],'2');assert.equal(client.attributes['default.acr.values'],'2');assert.ok(client.defaultClientScopes.includes('acr'));
 assert.equal(client.directAccessGrantsEnabled,false);assert.equal(client.implicitFlowEnabled,false);assert.equal(client.serviceAccountsEnabled,false);assert.ok(!client.optionalClientScopes.includes('offline_access'));
});
