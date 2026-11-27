const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
test('real PostgreSQL atomic commit and rollback under concurrent batches',async()=>{
 assert.equal(process.env.CI,'true');
 const url=process.env.RTICORE_ATOMIC_TEST_URL;
 assert.equal(url,'postgresql://rticore_ci:rticore_ci_only@127.0.0.1:5432/rticore_atomic_ci');
 const {executeAtomicBatch}=await import('../src/lib/postgres-atomic-batch.ts');
 const pool=new Pool({connectionString:url,max:4});
 try{
  await pool.query('CREATE TABLE atomic_probe(id integer PRIMARY KEY, amount integer NOT NULL CHECK(amount>=0))');
  const insert=(id,amount)=>({sql:'INSERT INTO atomic_probe VALUES($1,$2)',args:[id,amount]});
  const [ok,bad]=await Promise.allSettled([executeAtomicBatch(pool,[insert(1,100),insert(2,200)]),executeAtomicBatch(pool,[insert(3,300),insert(4,-1)])]);
  assert.equal(ok.status,'fulfilled');assert.equal(bad.status,'rejected');
  assert.deepEqual((await pool.query('SELECT * FROM atomic_probe ORDER BY id')).rows,[{id:1,amount:100},{id:2,amount:200}]);
  const results=await executeAtomicBatch(pool,[{sql:'SELECT pg_backend_pid() AS pid',args:[]},{sql:'SELECT pg_backend_pid() AS pid',args:[]}]);
  assert.equal(results[0].rows[0].pid,results[1].rows[0].pid);
  const changeResults=await executeAtomicBatch(pool,[{sql:'UPDATE atomic_probe SET amount=amount+1 WHERE id=1',args:[]},{sql:'SELECT changes() AS n',args:[]}]);
  assert.equal(changeResults[1].rows[0].n,1);
  await assert.rejects(executeAtomicBatch(pool,[insert(5,100),insert(1,999)]));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM atomic_probe WHERE id=5')).rows[0].n,0);
 }finally{await pool.end();}
});
