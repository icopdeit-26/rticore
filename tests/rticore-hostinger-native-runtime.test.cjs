const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('native runtime is explicit and excludes local authentication',()=>{const s=read('src/lib/runtime-env.ts');assert.match(s,/RTICORE_RUNTIME!=='hostinger'/);assert.match(s,/RTICORE_RUNTIME==='hostinger'/);assert.match(s,/key!=='RTICORE_LOCAL_SESSION_SECRET'/);assert.match(s,/Hostinger PostgreSQL configuration required/);});
test('hosted batch uses pinned client with rollback',()=>{const s=read('src/lib/postgres-atomic-batch.ts');assert.match(read('src/lib/postgres-db.ts'),/executeAtomicBatch\(pool,statements\)/);assert.match(s,/const client=await pool.connect\(\)/);assert.match(s,/client.query\('BEGIN'\)/);assert.match(s,/client.query\('COMMIT'\)/);assert.match(s,/client.query\('ROLLBACK'\)/);assert.match(s,/client.release\(discard\)/);assert.match(read('src/lib/postgres-db.ts'),/RTICORE_RUNTIME==='hostinger'\)return exec/);});
