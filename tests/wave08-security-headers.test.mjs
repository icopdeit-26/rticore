import test from 'node:test';import assert from 'node:assert/strict';import config from '../next.config.mjs';
test('baseline browser response policy covers all routes without advertising framework',async()=>{
 assert.equal(config.poweredByHeader,false);
 const rules=await config.headers();assert.equal(rules[0].source,'/:path*');
 const h=Object.fromEntries(rules[0].headers.map(x=>[x.key.toLowerCase(),x.value]));
 assert.equal(h['x-content-type-options'],'nosniff');assert.equal(h['x-frame-options'],'DENY');
 assert.match(h['content-security-policy'],/frame-ancestors 'none'/);assert.match(h['content-security-policy'],/object-src 'none'/);
 assert.equal(h['referrer-policy'],'no-referrer');assert.equal(h['strict-transport-security'],'max-age=31536000');
});
