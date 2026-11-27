import assert from 'node:assert/strict';
// Deliberately fixed loopback only: never accepts a production destination.
const base='http://127.0.0.1:3199';
const call=(path,opts={})=>fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000),...opts});
for(const path of ['/login','/api/health/live','/api/wallets']){
 const r=await call(path);
 assert.equal(r.headers.get('x-content-type-options'),'nosniff',path);
 assert.equal(r.headers.get('x-frame-options'),'DENY',path);
 assert.match(r.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 assert.equal(r.headers.get('referrer-policy'),'no-referrer',path);
 assert.equal(r.headers.get('x-powered-by'),null,path);
 if(path==='/api/wallets')assert.equal(r.status,503);
 if(path==='/login')assert.equal(r.status,200);
 if(path==='/api/health/live')assert.equal(r.status,200);
 await r.arrayBuffer();
}
for(const headers of [{'Content-Type':'application/json'},{'Content-Type':'application/json',Origin:'https://invalid.example'},{'Content-Type':'application/json',Origin:'https://example.invalid','Sec-Fetch-Site':'cross-site'}]){
 const r=await call('/api/business-auth',{method:'POST',headers,body:'{"action":"logout"}'});
 assert.equal(r.status,403);await r.arrayBuffer();
}
const root=await call('/');assert.equal(root.status,307);assert.equal(new URL(root.headers.get('location'),base).pathname,'/login');await root.arrayBuffer();
console.log('Loopback security smoke PASS: response headers, legacy API hold, native origin and anonymous redirect.');
