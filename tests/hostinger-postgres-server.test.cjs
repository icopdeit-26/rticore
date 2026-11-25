const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg'),fs=require('node:fs'),ts=require('typescript');
const config={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true};
function load(file){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:config}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',code)(p=>p==='./hostinger-config'?load('src/lib/hostinger-config.ts'):require(p),m,m.exports);
 return m.exports;
}
const {runPostgresBatch}=load('src/lib/postgres-db.ts');
test('real PostgreSQL: schema, triggers, transaction atomicity and independent concurrent batches',async()=>{
 const connectionString=process.env.RTICORE_TEST_PG_URL;
 assert.ok(connectionString,'isolated CI PostgreSQL URL required');
 const url=new URL(connectionString);
 assert.equal(url.hostname,'127.0.0.1');
 assert.equal(url.pathname,'/rticore_ci');
 const pool=new Pool({connectionString,max:5});
 try{
  // This URL is restricted to an ephemeral CI service. No production credentials or data.
  await pool.query(fs.readFileSync('rticore_postgresql_schema.sql','utf8'));
  await pool.query(fs.readFileSync('rticore_postgresql_triggers.sql','utf8'));
  const counts=await pool.query("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A')");
  assert.ok(counts.rows[0].n>=267,'canonical business triggers must exist');
  await pool.query('CREATE TABLE hostinger_batch_probe (id text PRIMARY KEY, amount bigint NOT NULL CHECK(amount>0))');
  const insert=(id,amount)=>({sql:'INSERT INTO hostinger_batch_probe(id,amount) VALUES($1,$2)',args:[id,amount]});
  await assert.rejects(runPostgresBatch(pool,[insert('rollback-a',10),insert('rollback-b',-1)]));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM hostinger_batch_probe")).rows[0].n,0);
  const out=await Promise.allSettled([
   runPostgresBatch(pool,[insert('good-a',100),insert('good-b',200)]),
   runPostgresBatch(pool,[insert('bad-a',300),insert('bad-b',0)])
  ]);
  assert.equal(out[0].status,'fulfilled');assert.equal(out[1].status,'rejected');
  assert.deepEqual((await pool.query('SELECT id,amount FROM hostinger_batch_probe ORDER BY id')).rows,[{id:'good-a',amount:'100'},{id:'good-b',amount:'200'}]);
 }finally{await pool.end();}
});
