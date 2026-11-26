#!/usr/bin/env node
// RTICORE local mode setup: no Cloudflare, no network.
//   npm run local:setup -- --admin you@company.co.id [--role admin] [--uat-users]
// 1. Creates/updates .env.local (RTICORE_LOCAL_MODE=1 + random local secrets; never overwrites existing values)
// 2. Applies pending migrations/*.sql to the local SQLite database (default .local-data/rticore.db)
// 3. Registers/activates the given member (default role admin)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..');
const args=process.argv.slice(2);
const opt=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:undefined;};
const flag=name=>args.includes('--'+name);
const ROLES=['admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer'];
const DEFAULT_LOCAL_MEMBERS=[
  ['admin@rticore.local','admin'],
  ['admin2@rticore.local','admin'],
  ['marketing@rticore.local','marketing'],
  ['sales.a@rticore.local','sales'],
  ['sales.b@rticore.local','sales'],
  ['presales@rticore.local','presales'],
  ['finance@rticore.local','finance'],
  ['approver@rticore.local','approver'],
  ['legal@rticore.local','legal'],
  ['pm@rticore.local','project_manager'],
  ['offense.lead@rticore.local','offense_lead'],
  ['offense.member@rticore.local','offense_member'],
  ['defense.leader@rticore.local','defense_leader'],
  ['defense.member@rticore.local','defense_member'],
  ['governance.leader@rticore.local','governance_leader'],
  ['governance.member@rticore.local','governance_member'],
  ['itdev.leader@rticore.local','itdev_leader'],
  ['itdev.member@rticore.local','itdev_member'],
  ['viewer@rticore.local','viewer'],
];

// 1. .env.local
const envFile=path.join(root,'.env.local');
const existing=fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8'):'';
const has=key=>new RegExp('^\\s*'+key+'\\s*=','m').test(existing);
const additions=[];
const want={
  RTICORE_LOCAL_MODE:'1',
  RTICORE_LOCAL_DB_PATH:'.local-data/rticore.db',
  RTICORE_LOCAL_SESSION_SECRET:crypto.randomBytes(48).toString('base64url'),
  RTICORE_AI_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),
  RTICORE_DOCUMENT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),
};
for(const [key,value] of Object.entries(want))if(!has(key))additions.push(key+'='+value);
if(additions.length){
  const header=existing?'':'# RTICORE local mode (generated). Keep private; never commit. Losing the encryption keys makes stored AI keys/documents unreadable.\n';
  fs.writeFileSync(envFile,existing+(existing&&!existing.endsWith('\n')?'\n':'')+header+additions.join('\n')+'\n');
  console.log('.env.local: ditambahkan '+additions.map(a=>a.split('=')[0]).join(', '));
}else console.log('.env.local: sudah lengkap');

const envText=fs.readFileSync(envFile,'utf8');
const dbRel=(/^\s*RTICORE_LOCAL_DB_PATH\s*=\s*(.+)$/m.exec(envText)?.[1]||'.local-data/rticore.db').trim();
const dbFile=path.resolve(root,dbRel);

// 2. migrations
fs.mkdirSync(path.dirname(dbFile),{recursive:true});
const db=new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS rticore_local_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
const applied=new Set(db.prepare('SELECT name FROM rticore_local_migrations').all().map(r=>r.name));
const files=fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort();
let count=0;
for(const file of files){
  if(applied.has(file))continue;
  const sql=fs.readFileSync(path.join(root,'migrations',file),'utf8');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(sql);
    db.prepare('INSERT INTO rticore_local_migrations(name) VALUES(?)').run(file);
    db.exec('COMMIT');count++;
    console.log('  migrasi '+file);
  }catch(error){
    db.exec('ROLLBACK');
    console.error('GAGAL migrasi '+file+': '+error.message);
    process.exit(1);
  }
}
console.log('Database: '+dbFile+' ('+count+' migrasi baru, '+(applied.size+count)+'/'+files.length+' total)');

// 3. members (SQLite backup)
for(const [email,role] of DEFAULT_LOCAL_MEMBERS){
  db.prepare("INSERT INTO rticore_members(email,role,active,created_by) VALUES(?,?,1,'RTICORE_LOCAL_SETUP') ON CONFLICT(email) DO NOTHING").run(email,role);
}
if(flag('uat-users')){
  db.exec(fs.readFileSync(path.join(root,'scripts/uat/dummy-users.sql'),'utf8'));
  console.log('Akun uji UAT (*.invalid) ditambahkan.');
}
const admin=opt('admin');
if(admin){
  const email=admin.trim().toLowerCase(),role=(opt('role')||'admin').trim();
  if(!email.includes('@'))throw new Error('Email --admin tidak valid');
  if(!ROLES.includes(role))throw new Error('Role harus salah satu dari: '+ROLES.join(', '));
  db.prepare("INSERT INTO rticore_members(email,role,active,created_by) VALUES(?,?,1,'RTICORE_LOCAL_SETUP') ON CONFLICT(email) DO UPDATE SET role=excluded.role,active=1").run(email,role);
  console.log('Akun aktif: '+email+' ('+role+')');
}
const sqliteMembers=db.prepare('SELECT email,role,active FROM rticore_members WHERE active=1').all();
const members=sqliteMembers.length;
db.close();

// 4. PostgreSQL local database (.pgdata or DATABASE_URL)
const pgSchemaFile=path.join(root,'rticore_postgresql_schema.sql');
if(fs.existsSync(pgSchemaFile)){
  const pgSchema=fs.readFileSync(pgSchemaFile,'utf8');
  const pgDataDir=path.join(root,'.pgdata');
  const {PGlite}=await import('@electric-sql/pglite');
  // Opening an existing database must never destroy its contents.
  // Preserve the directory for operator-led diagnosis and verified restore.
  const pg=await PGlite.create(pgDataDir).catch(error=>{
    throw new Error('PostgreSQL lokal gagal dibuka; direktori data dipertahankan. Periksa backup sebelum recovery.',{cause:error});
  });
  await pg.exec(pgSchema);
  const {ensureTriggers}=await import('./postgres-worker.mjs');
  await ensureTriggers(pg);
  for(const [email,role] of DEFAULT_LOCAL_MEMBERS){
    await pg.query(
      "INSERT INTO rticore_members(email,role,active,created_by) VALUES($1,$2,1,'RTICORE_LOCAL_SETUP') ON CONFLICT(email) DO NOTHING",
      [email,role]
    );
  }
  for(const row of sqliteMembers){
    await pg.query(
      "INSERT INTO rticore_members(email,role,active,created_by) VALUES($1,$2,$3,'RTICORE_LOCAL_SETUP') ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active",
      [String(row.email).toLowerCase(),String(row.role),Number(row.active??1)]
    );
  }
  if(admin){
    const email=admin.trim().toLowerCase(),role=(opt('role')||'admin').trim();
    await pg.query(
      "INSERT INTO rticore_members(email,role,active,created_by) VALUES($1,$2,1,'RTICORE_LOCAL_SETUP') ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,active=1",
      [email,role]
    );
  }
  await pg.exec('CHECKPOINT');
  const pgMembers=await pg.query('SELECT COUNT(*) AS n FROM rticore_members WHERE active=1');
  const pgTables=await pg.query("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'rticore_%'");
  const pgTriggers=await pg.query("SELECT COUNT(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE NOT t.tgisinternal AND s.nspname='public'");
  await pg.close();
  console.log('PostgreSQL lokal (.pgdata): '+pgTables.rows[0].n+' tabel rticore_*, '+pgTriggers.rows[0].n+' trigger aturan bisnis, '+pgMembers.rows[0].n+' akun aktif siap digunakan.');
}

if(!members)console.log('\nPERHATIAN: belum ada akun aktif. Jalankan: npm run local:setup -- --admin email@anda');
console.log('\nSelesai. Jalankan aplikasi: npm run dev:local  ->  http://localhost:3000/login');
