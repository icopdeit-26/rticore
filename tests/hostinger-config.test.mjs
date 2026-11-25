import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';
const good={RTICORE_RUNTIME:'hostinger',RTICORE_LOCAL_MODE:'0',DATABASE_URL:'postgresql://app:synthetic@db.example.invalid/rticore?sslmode=verify-full',RTICORE_ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',RTICORE_ACCESS_AUD:'a'.repeat(64)};
test('native hosting accepts strict TLS configuration and strips connection-string overrides',()=>{
 const u=validateHostingerConfig(good); assert.equal(u.search,''); assert.equal(u.hostname,'db.example.invalid');
});
for(const patch of [{RTICORE_LOCAL_MODE:'1'},{RTICORE_LOCAL_MODE:undefined},{RTICORE_DB_ENGINE:'sqlite'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{RTICORE_ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com.evil.invalid'},{RTICORE_ACCESS_AUD:'short'},{DATABASE_URL:undefined},{DATABASE_URL:'postgresql://app:synthetic@db.example.invalid/rticore?sslmode=require'},{DATABASE_URL:good.DATABASE_URL+'&sslmode=disable'},{DATABASE_URL:good.DATABASE_URL+'&sslrootcert=/tmp/custom'}]){
 test('reject unsafe configuration '+Object.keys(patch).join(','),()=>assert.throws(()=>validateHostingerConfig({...good,...patch})));
}
