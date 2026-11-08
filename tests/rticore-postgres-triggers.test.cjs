// Parity: business-rule triggers must behave the same on SQLite/D1 (canonical
// migrations) and on PostgreSQL (rticore_postgresql_schema.sql + generated
// rticore_postgresql_triggers.sql). Every scenario runs identical SQL on both.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const T="'defendit360'";

let sqlite,pg,generator;
test.before(async()=>{
  generator=await import(pathToFileURL(path.join(root,'scripts/generate-postgres-triggers.mjs')).href);
  sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const f of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())
    sqlite.exec(fs.readFileSync(path.join(root,'migrations',f),'utf8'));
  const {PGlite}=await import('@electric-sql/pglite');
  pg=await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(root,'rticore_postgresql_schema.sql'),'utf8'));
  await pg.exec(fs.readFileSync(path.join(root,'rticore_postgresql_triggers.sql'),'utf8'));
});
test.after(async()=>{sqlite?.close();await pg?.close();});

const errorCode=e=>String(e?.message||e).replace(/^.*?(?=[A-Z_]{4,}[:A-Z_ ]*)/s,'').split('\n')[0].trim();
async function both(sql){
  let a,b;
  try{sqlite.exec(sql);a={ok:true};}catch(e){a={ok:false,error:errorCode(e)};}
  try{await pg.exec(sql);b={ok:true};}catch(e){b={ok:false,error:errorCode(e)};}
  return {sqlite:a,pg:b};
}
async function rows(sql){
  const norm=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v===null?null:String(v)]));
  return {sqlite:sqlite.prepare(sql).all().map(norm),pg:(await pg.query(sql)).rows.map(norm)};
}
async function same(sql,expectOk){
  const r=await both(sql);
  assert.deepEqual(r.pg,r.sqlite,'PostgreSQL differs from SQLite for: '+sql.slice(0,120));
  if(expectOk!==undefined)assert.equal(r.sqlite.ok,expectOk,JSON.stringify(r.sqlite));
  return r.sqlite;
}

test('generated trigger file is up to date with migrations',()=>{
  const {sql,converted}=generator.generate();
  assert.equal(converted.length,generator.sqliteTriggers().length);
  assert.equal(fs.readFileSync(path.join(root,'rticore_postgresql_triggers.sql'),'utf8'),sql,
    'Run: npm run pg:triggers');
});

test('every SQLite trigger exists in PostgreSQL',async()=>{
  const names=generator.sqliteTriggers().map(t=>t.name).sort();
  const pgNames=(await pg.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).rows.map(r=>r.tgname).sort();
  assert.deepEqual(pgNames.filter(n=>names.includes(n)),names);
});

test('seed rows behave identically',async()=>{
  await same(`INSERT INTO rticore_members(email,role,active) VALUES('sales.a@uat.invalid','sales',1),('admin@uat.invalid','admin',1)`,true);
  await same(`INSERT INTO rticore_sales_accounts(id,tenant_id,legal_name,customer_number,data_json,created_by) VALUES('acc-1',${T},'PT Paritas','C-1','{}','sales.a@uat.invalid')`,true);
  await same(`INSERT INTO rticore_sales_opportunities(id,tenant_id,company_id,title,estimated_value_idr,data_json,created_by) VALUES('opp-1',${T},'acc-1','Paritas VAPT',1000000,'{"service_family":"VAPT"}','sales.a@uat.invalid')`,true);
});

test('flow_version increments on every material edit (stale-edit protection)',async()=>{
  await same(`UPDATE rticore_sales_opportunities SET title='Paritas VAPT v2' WHERE id='opp-1'`,true);
  await same(`UPDATE rticore_sales_opportunities SET data_json='{"service_family":"VAPT","client_need":"x"}' WHERE id='opp-1'`,true);
  const r=await rows(`SELECT flow_version FROM rticore_sales_opportunities WHERE id='opp-1'`);
  assert.deepEqual(r.pg,r.sqlite);
  assert.equal(r.pg[0].flow_version,'3');
});

test('stage gates reject skipping to quotation without approved package',async()=>{
  const r=await same(`UPDATE rticore_sales_opportunities SET stage='quotation_sent' WHERE id='opp-1'`,false);
  assert.match(r.error,/[A-Z_]{4,}/);
});

test('new Lead creates its response SLA row (120 minutes)',async()=>{
  await same(`INSERT INTO rticore_marketing_leads(id,tenant_id,lead_number,account_name,source,service_family,assigned_sales_email,created_by,updated_by) VALUES('lead-1',${T},'LD-1','PT Lead','Website','VAPT','sales.a@uat.invalid','admin@uat.invalid','admin@uat.invalid')`,true);
  const r=await rows(`SELECT lead_id,owner_email,baseline,first_response_at FROM rticore_sales_lead_sla WHERE lead_id='lead-1'`);
  assert.deepEqual(r.pg,r.sqlite);assert.equal(r.pg.length,1);
  const due=await pg.query(`SELECT assigned_at,response_due_at FROM rticore_sales_lead_sla WHERE lead_id='lead-1'`);
  const {assigned_at,response_due_at}=due.rows[0];
  assert.match(assigned_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal((Date.parse(response_due_at)-Date.parse(assigned_at))/60000,120);
});

test('backfill gives pre-trigger open Leads a legacy SLA without inventing a response',async()=>{
  await pg.exec(`INSERT INTO rticore_marketing_leads(id,tenant_id,lead_number,account_name,source,service_family,assigned_sales_email,created_by,updated_by) VALUES('lead-old',${T},'LD-OLD','PT Lama','Website','VAPT','sales.a@uat.invalid','admin@uat.invalid','admin@uat.invalid')`);
  await pg.exec(`DELETE FROM rticore_sales_lead_sla WHERE lead_id='lead-old'`); // simulate data written before triggers
  await pg.exec(generator.BACKFILL_SQL);
  await pg.exec(generator.BACKFILL_SQL); // idempotent
  const r=(await pg.query(`SELECT baseline,first_response_at FROM rticore_sales_lead_sla WHERE lead_id IN ('lead-old','lead-1') ORDER BY lead_id`)).rows;
  assert.deepEqual(r,[{baseline:'new',first_response_at:null},{baseline:'legacy_unverified',first_response_at:null}]);
});

test('overlapping meetings for the same Sales are rejected',async()=>{
  const task=(id,start,end)=>`INSERT INTO rticore_sales_activity_tasks(id,tenant_id,opportunity_id,owner_email,kind,subject,start_at,due_at,reminder_at,created_by) VALUES('${id}',${T},'opp-1','sales.a@uat.invalid','meeting','Meeting paritas','${start}','${end}','${start}','sales.a@uat.invalid')`;
  await same(task('t-1','2030-01-01T03:00:00Z','2030-01-01T04:00:00Z'),true);
  const r=await same(task('t-2','2030-01-01T03:30:00Z','2030-01-01T04:30:00Z'),false);
  assert.match(r.error,/[A-Z_]{4,}/);
  await same(task('t-3','2030-01-01T05:00:00Z','2030-01-01T06:00:00Z'),true);
});

test('immutable HR records cannot be deleted',async()=>{
  await same(`INSERT INTO rticore_hr_employees(tenant_id,email,employment_type,start_date,created_by) VALUES(${T},'sales.a@uat.invalid','permanent','2026-01-01','admin@uat.invalid')`,true);
  const r=await same(`DELETE FROM rticore_hr_employees WHERE email='sales.a@uat.invalid'`,false);
  assert.equal(r.error,'HR_IMMUTABLE');
});

test('closing a deal as lost runs the same follow-up writes',async()=>{
  await same(`UPDATE rticore_sales_opportunities SET data_json='{"service_family":"VAPT","lost_reason":"Harga","lost_notes":"Kalah harga"}' WHERE id='opp-1'`,true);
  await same(`UPDATE rticore_sales_opportunities SET stage='closed_lost' WHERE id='opp-1'`,true);
  const t=await rows(`SELECT id,status FROM rticore_sales_activity_tasks ORDER BY id`);
  assert.deepEqual(t.pg,t.sqlite);
  const o=await rows(`SELECT stage,flow_version FROM rticore_sales_opportunities WHERE id='opp-1'`);
  assert.deepEqual(o.pg,o.sqlite);
});

// ---- App level: the real Sales API handlers on PostgreSQL (same SQL translation as src/lib/postgres-db.ts)
function loadTS(file,stubs,cache={}){
  if(cache[file])return cache[file];
  const ts=require('typescript');
  const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mod={exports:{}};cache[file]=mod.exports;
  new Function('require','module','exports',js)(p=>{
    if(p in stubs)return stubs[p];
    if(p.startsWith('@/'))return loadTS('src/'+p.slice(2)+'.ts',stubs,cache);
    if(p.startsWith('.'))return loadTS(path.join(path.dirname(file),p+'.ts').replace(/\\/g,'/'),stubs,cache);
    return require(p);
  },mod,mod.exports);
  cache[file]=mod.exports;return mod.exports;
}
function pgD1(db,translate){
  const norm=r=>r&&Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='bigint'?Number(v):k==='flow_version'||k==='estimated_value_idr'?Number(v):v]));
  const stmt=(sql,args=[])=>({sql,args,bind:(...a)=>stmt(sql,a),
    async first(){const r=await db.query(translate(sql),args);return norm(r.rows[0])||null;},
    async all(){const r=await db.query(translate(sql),args);return {success:true,results:r.rows.map(norm)};},
    async run(){const r=await db.query(translate(sql),args);return {success:true,meta:{changes:r.affectedRows??0}};}});
  return {prepare:sql=>stmt(sql),async batch(list){
    await db.exec('BEGIN');
    try{const out=[];for(const s of list){const r=await db.query(translate(s.sql),s.args);out.push({success:true,results:r.rows.map(norm),meta:{changes:r.affectedRows??0}});}
      await db.exec('COMMIT');return out;}
    catch(e){await db.exec('ROLLBACK');throw e;}}};
}

test('Sales API on PostgreSQL rejects a stale Opportunity edit (no silent overwrite)',async()=>{
  const {translateSQLiteToPostgres}=loadTS('src/lib/postgres-db.ts',{});
  const db=pgD1(pg,translateSQLiteToPostgres);
  const email='sales.a@uat.invalid';
  const route=loadTS('src/app/api/sales/route.ts',{
    '@/lib/boq-auth':{privateHeaders:{'Cache-Control':'no-store'},authorizeBoQ:async()=>({ok:true,identity:{email,role:'sales',assignedRole:'sales',rolePreview:false,db}})},
    'next/server':{NextResponse:{json:(x,o)=>Response.json(x,o)}},
  });
  const call=async(method,body,query='')=>{const r=await route[method](new Request('http://localhost/api/sales'+query,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost'},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};};
  const acc=await call('POST',{entity:'account',legal_name:'PT Paritas API',fields:{}});
  assert.equal(acc.status,201,JSON.stringify(acc.body));
  const deal=await call('POST',{entity:'deal',company_id:acc.body.id,title:'API VAPT',estimated_value:150000000,fields:{service_family:'VAPT'}});
  assert.equal(deal.status,201,JSON.stringify(deal.body));
  const before=await call('GET',null,'?entity=details&id='+deal.body.id);
  const v=before.body.deal.flow_version;
  const first=await call('PATCH',{entity:'deal',id:deal.body.id,flow_version:v,title:'API VAPT (edit)',estimated_value:160000000,fields:before.body.deal.fields});
  assert.equal(first.status,200,JSON.stringify(first.body));
  const stale=await call('PATCH',{entity:'deal',id:deal.body.id,flow_version:v,title:'stale',estimated_value:1,fields:before.body.deal.fields});
  assert.equal(stale.status,409,JSON.stringify(stale.body));
  const after=await call('GET',null,'?entity=details&id='+deal.body.id);
  assert.equal(after.body.deal.title,'API VAPT (edit)');
  assert.equal(after.body.deal.estimated_value,160000000);
});

test('SQLite compatibility helpers return SQLite-shaped values',async()=>{
  const q=async s=>(await pg.query(s)).rows[0].v;
  assert.equal(await q(`SELECT rticore_json_type('{"a":1,"b":1.5,"c":"x","d":[1]}','$.a') v`),'integer');
  assert.equal(await q(`SELECT rticore_json_type('{"a":1,"b":1.5}','$.b') v`),'real');
  assert.equal(await q(`SELECT rticore_json_type('{"c":"x"}','$.c') v`),'text');
  assert.equal(await q(`SELECT rticore_json_type('[1,2]') v`),'array');
  assert.equal(await q(`SELECT string_agg(key||'='||value,',') v FROM rticore_json_each('["a","b"]')`),'0=a,1=b');
  assert.equal(await q(`SELECT strftime('%Y-%m','2026-01-31','+1 month') v`),'2026-02');
  assert.equal(await q(`SELECT printf('+%d minutes',120) v`),'+120 minutes');
  assert.equal(await q(`SELECT length(lower(hex(randomblob(16)))) v`),32);
  assert.equal(await q(`SELECT json_remove('{"a":1,"b":2}','$.b') v`),'{"a": 1}');
});
