const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const script=path.join(__dirname,'..','scripts','release','d1-legacy-rename.mjs');
const load=()=>import(require('node:url').pathToFileURL(script).href);
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const master=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();

function legacyDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE india_schema_migrations(version INTEGER PRIMARY KEY);
  CREATE TABLE india_parent(id TEXT PRIMARY KEY,actor TEXT DEFAULT 'system');
  CREATE TABLE india_child(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES india_parent(id));
  CREATE TABLE plain_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES india_parent(id));
  CREATE INDEX idx_india_child_parent ON india_child(parent_id);
  CREATE VIEW india_child_view AS SELECT c.id,p.actor FROM india_child c JOIN india_parent p ON p.id=c.parent_id;
  CREATE TRIGGER india_child_no_delete BEFORE DELETE ON india_child BEGIN SELECT RAISE(ABORT,'INDIA_IMMUTABLE'); END;
  CREATE TRIGGER plain_guard BEFORE INSERT ON plain_child WHEN NOT EXISTS(SELECT 1 FROM india_parent p WHERE p.id=NEW.parent_id) BEGIN SELECT RAISE(ABORT,'NO_PARENT'); END;
  INSERT INTO india_schema_migrations VALUES(45);
  INSERT INTO india_parent(id) VALUES('p1');
  INSERT INTO india_child VALUES('c1','p1');`);
  return db;
}

test('classify separates legacy, renamed, mixed and v3-RTI schemas',async()=>{
  const {classify}=await load();
  const t=(...names)=>names.map(name=>({type:'table',name}));
  assert.equal(classify(t('india_schema_migrations')),'legacy');
  assert.equal(classify(t('rticore_schema_migrations')),'renamed');
  assert.equal(classify(t('india_schema_migrations','rticore_schema_migrations')),'mixed');
  assert.equal(classify(t('india_schema_migrations','india_sys_parameters')),'v3-rti');
  assert.equal(classify(t('other')),'empty');
});

test('generated rename keeps rows, foreign keys, indexes, views and triggers',async()=>{
  const {generate}=await load();
  const db=legacyDb();
  const {sql,counts}=generate(master(db));
  assert.deepEqual(counts,{tables:3,indexes:1,views:1,triggers:2});
  db.exec('BEGIN');db.exec(sql);db.exec('COMMIT');
  assert.equal(master(db).filter(r=>/india/i.test(r.name+(r.sql||''))).length,0,'no legacy names remain');
  assert.equal(db.prepare('SELECT count(*) n FROM rticore_child_view').get().n,1);
  assert.equal(db.prepare('SELECT max(version) v FROM rticore_schema_migrations').get().v,45);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>db.exec("DELETE FROM rticore_child"),/RTICORE_IMMUTABLE/);
  assert.throws(()=>db.exec("INSERT INTO rticore_child VALUES('c2','missing')"),/FOREIGN KEY/);
  assert.throws(()=>db.exec("INSERT INTO plain_child VALUES('x','missing')"),/NO_PARENT/);
  db.exec("INSERT INTO plain_child VALUES('x','p1')");
});

test('generation refuses to overwrite an existing target',async()=>{
  const {generate}=await load();
  assert.throws(()=>generate([{type:'table',name:'india_a',sql:'CREATE TABLE india_a(x)'},{type:'table',name:'rticore_a',sql:'CREATE TABLE rticore_a(x)'}]),/already exists/);
});

test('Cloudflare runtime keeps legacy secrets and decrypts legacy ciphertext',()=>{
  const env=source('src/lib/runtime-env.ts');
  for(const name of ['AI_ENCRYPTION_KEY','DOCUMENT_ENCRYPTION_KEY','SECURITY_ALLOWED_HOSTS','SIEM_OUTBOUND_TOKEN','EDR_OUTBOUND_TOKEN'])assert.match(env,new RegExp("'"+name+"'"));
  assert.match(env,/withLegacySecretNames\(\(await getCloudflareContext/);
  assert.match(source('src/lib/document-vault.ts'),/decrypt\(\)\.catch\(\(\)=>decrypt\('INDIA-DOCUMENT-v1'\)\)/);
  assert.match(source('src/lib/ai-credential-vault.ts'),/decrypt\('RTICORE-AI:'\)\.catch\(\(\)=>decrypt\('INDIA-AI:'\)\)/);
});

test('release renames before migrating and verifies before deploying',()=>{
  const wf=source('.github/workflows/rticore-production-release.yml');
  const at=text=>{const i=wf.indexOf(text);assert.ok(i>=0,'missing '+text);return i;};
  assert.ok(at('d1-legacy-rename.mjs generate')<at('Applying $f'));
  assert.ok(at('Applying $f')<at('name: Verify schema'));
  assert.ok(at('name: Verify schema')<at('name: Deploy Worker'));
  assert.match(wf,/steps\.migrate\.outputs\.renamed != 'true'/);
  assert.ok(at('from a different migration lineage')<at('Independent backup'));
  assert.ok(at('which this code reads')<at('Independent backup'));
});

test('migrations 0046-0051 record themselves in the ledger',()=>{
  const dir=path.join(__dirname,'..','migrations');
  for(const n of [46,47,48,49,50,51]){
    const file=fs.readdirSync(dir).find(f=>f.startsWith('00'+n+'_'));
    assert.match(fs.readFileSync(path.join(dir,file),'utf8'),new RegExp('INSERT INTO rticore_schema_migrations\\(version\\) VALUES\\('+n+'\\);'));
  }
});
