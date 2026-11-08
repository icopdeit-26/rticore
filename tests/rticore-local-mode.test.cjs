// Local mode (RTICORE_LOCAL_MODE=1): SQLite D1 adapter + signed local session.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function load(file,stubs={}){
  const js=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',js)(p=>{
    if(p in stubs)return stubs[p];
    if(p.startsWith('./'))return load('src/lib/'+p.slice(2)+'.ts',stubs);
    return require(p);
  },mod,mod.exports);
  return mod.exports;
}
const auth=load('src/lib/local-auth.ts');
const SECRET='x'.repeat(48);

test('local session: signed cookie round-trips and rejects tampering, expiry and weak secrets',async()=>{
  const now=Date.now();
  const value=await auth.createLocalSession(SECRET,' Admin@Example.COM ',now);
  const cookie=auth.LOCAL_SESSION_COOKIE+'='+value;
  assert.equal(await auth.emailFromLocalSession('a=b; '+cookie,SECRET,now),'admin@example.com');
  const [mail,until,sig]=value.split('.');
  const other=Buffer.from('attacker@example.com').toString('base64url');
  assert.equal(await auth.emailFromLocalSession(auth.LOCAL_SESSION_COOKIE+'='+other+'.'+until+'.'+sig,SECRET,now),null);
  assert.equal(await auth.emailFromLocalSession(auth.LOCAL_SESSION_COOKIE+'='+mail+'.'+(Number(until)+1)+'.'+sig,SECRET,now),null);
  assert.equal(await auth.emailFromLocalSession(cookie,'y'.repeat(48),now),null);
  assert.equal(await auth.emailFromLocalSession(cookie,SECRET,now+auth.LOCAL_SESSION_TTL_SECONDS*1000+1),null);
  assert.equal(await auth.emailFromLocalSession(cookie,'short',now),null);
  assert.equal(await auth.emailFromLocalSession(null,SECRET,now),null);
});

test('local login endpoints only accept loopback hosts',()=>{
  for(const url of ['http://localhost:3000/x','http://127.0.0.1:3000/x','http://[::1]:3000/x','http://app.localhost/x'])
    assert.equal(auth.isLoopbackRequest(new Request(url)),true,url);
  for(const url of ['http://192.168.1.5:3000/x','https://rticore.example.com/x','http://localhost.evil.com/x'])
    assert.equal(auth.isLoopbackRequest(new Request(url)),false,url);
});

test('SQLite D1 adapter: bind/first/all/run meta and atomic batch rollback',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rticore-local-'));
  process.env.RTICORE_LOCAL_DB_PATH=path.join(dir,'t.db');
  delete globalThis.__rticoreLocalD1;
  const {getLocalD1}=load('src/lib/local-d1.ts');
  const db=getLocalD1();
  try{
    await db.prepare('CREATE TABLE p(id TEXT PRIMARY KEY)').run();
    await db.prepare('CREATE TABLE c(id TEXT PRIMARY KEY, p TEXT NOT NULL REFERENCES p(id))').run();
    const ins=await db.prepare('INSERT INTO p(id) VALUES(?)').bind('a').run();
    assert.equal(ins.meta.changes,1);
    assert.deepEqual(await db.prepare('SELECT id FROM p WHERE id=?').bind('a').first(),{id:'a'});
    assert.equal(await db.prepare('SELECT id FROM p WHERE id=?').bind('zz').first(),null);
    // FK enforced like D1; failing batch must roll back the earlier statement.
    await assert.rejects(db.batch([db.prepare('INSERT INTO p(id) VALUES(?)').bind('b'),db.prepare('INSERT INTO c(id,p) VALUES(?,?)').bind('c1','missing')]));
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM p').all()).results[0].n,1);
    const ok=await db.batch([db.prepare('UPDATE p SET id=? WHERE id=?').bind('a2','a'),db.prepare('SELECT id FROM p')]);
    assert.equal(ok[0].meta.changes,1);
    assert.deepEqual(ok[1].results,[{id:'a2'}]);
  }finally{delete globalThis.__rticoreLocalD1;delete process.env.RTICORE_LOCAL_DB_PATH;}
});

test('authorizeBoQ keeps Cloudflare Access in cloud mode and uses the signed local session only in local mode',()=>{
  const src=read('src/lib/boq-auth.ts');
  assert.match(src,/if\(env\.RTICORE_LOCAL_MODE==='1'\)/);
  assert.match(src,/emailFromLocalSession\(request\.headers\.get\('cookie'\),env\.RTICORE_LOCAL_SESSION_SECRET\)/);
  assert.match(src,/jwtVerify\(token,keys/);
  const env=read('src/lib/runtime-env.ts');
  assert.match(env,/userAgent==='Cloudflare-Workers'\)return false/);
  assert.match(env,/RTICORE_LOCAL_MODE==='1'/);
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.scripts['dev:local'],/-H 127\.0\.0\.1/);
  assert.match(read('.gitignore'),/^\.local-data\/$/m);
});
