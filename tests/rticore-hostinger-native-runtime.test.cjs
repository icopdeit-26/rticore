const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('native runtime validates external PostgreSQL and excludes local and legacy Access credentials',()=>{
 const s=read('src/lib/runtime-env.ts');
 assert.match(s,/RTICORE_RUNTIME!=='hostinger'/);
 assert.match(s,/RTICORE_RUNTIME==='hostinger'/);
 assert.match(s,/validateHostingerConfig\(e\)/);
 assert.match(s,/key!=='RTICORE_LOCAL_SESSION_SECRET'/);
 assert.match(s,/!key.startsWith\('RTICORE_ACCESS_'\)/);
});
test('hosted batch uses a single pinned client with serializable isolation and rollback',()=>{
 const s=read('src/lib/postgres-atomic-batch.ts'), db=read('src/lib/postgres-db.ts');
 assert.match(db,/executeAtomicBatch\(pool,statements\)/);
 assert.match(s,/const client=await pool.connect\(\)/);
 assert.match(s,/client.query\('BEGIN ISOLATION LEVEL SERIALIZABLE'\)/);
 assert.match(s,/client.query\('COMMIT'\)/);
 assert.match(s,/client.query\('ROLLBACK'\)/);
 assert.match(s,/client.release\(discard\)/);
 assert.match(db,/if\(hostinger\)\{[\s\S]*?return exec;/);
 assert.match(db,/rejectUnauthorized:true/);
});
