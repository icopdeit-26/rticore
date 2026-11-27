import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';
const good={RTICORE_RUNTIME:'hostinger',RTICORE_PUBLIC_ORIGIN:'https://rticore.example.invalid',RTICORE_OIDC_CLIENT_SECRET:'synthetic-test-only-secret-'.repeat(2),RTICORE_LOCAL_MODE:'0',DATABASE_URL:'postgresql://app:synthetic@db.example.invalid/rticore?sslmode=verify-full',RTICORE_OIDC_ISSUER:'https://sso.example.invalid/realms/rticore',RTICORE_OIDC_CLIENT_ID:'rticore-proxy',RTICORE_OIDC_AUDIENCE:'rticore-api'};
test('native hosting accepts strict TLS configuration and strips connection-string overrides',()=>{
 const u=validateHostingerConfig(good); assert.equal(u.search,''); assert.equal(u.hostname,'db.example.invalid');
});
for(const patch of [{RTICORE_PUBLIC_ORIGIN:'http://rticore.example.invalid'},{RTICORE_PUBLIC_ORIGIN:'https://rticore.example.invalid/path'},{RTICORE_OIDC_CLIENT_SECRET:undefined},{HOSTNAME_BIND:'0.0.0.0'},{RTICORE_LOCAL_MODE:'1'},{RTICORE_LOCAL_MODE:undefined},{RTICORE_DB_ENGINE:'sqlite'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{RTICORE_OIDC_ISSUER:'http://sso.example.invalid/realms/rticore'},{RTICORE_OIDC_ISSUER:'https://sso.example.invalid/realms/rticore?x=1'},{RTICORE_OIDC_ISSUER:'https://example.cloudflareaccess.com/realms/rticore'},{RTICORE_OIDC_CLIENT_ID:undefined},{RTICORE_OIDC_AUDIENCE:undefined},{DATABASE_URL:undefined},{DATABASE_URL:'postgresql://app:synthetic@db.example.invalid/rticore?sslmode=require'},{DATABASE_URL:good.DATABASE_URL+'&sslmode=disable'},{DATABASE_URL:good.DATABASE_URL+'&sslrootcert=/tmp/custom'}]){
 test('reject unsafe configuration '+Object.keys(patch).join(','),()=>assert.throws(()=>validateHostingerConfig({...good,...patch})));
}
