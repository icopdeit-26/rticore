#!/usr/bin/env node
// Generates rticore_postgresql_triggers.sql from the canonical SQLite/D1 migrations.
//
// The SQLite migrations remain the single source of truth for business rules
// (immutability, stage gates, segregation of duties, SLA rows, flow_version...).
// Each SQLite trigger becomes one PL/pgSQL trigger function with the same name.
//
//   node scripts/generate-postgres-triggers.mjs           -> writes the SQL file
//   node scripts/generate-postgres-triggers.mjs --check   -> also type-checks every
//        statement against the PostgreSQL schema in an in-memory PGlite
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..');
const OUT=path.join(root,'rticore_postgresql_triggers.sql');

// ---------------------------------------------------------------- inventory
export function sqliteTriggers(){
  const db=new DatabaseSync(':memory:');
  for(const f of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())
    db.exec(fs.readFileSync(path.join(root,'migrations',f),'utf8'));
  const rows=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  db.close();
  return rows.map(r=>({name:r.name,table:r.tbl_name,sql:r.sql}));
}

// ---------------------------------------------------------------- lexing
/** Split into [{code:true,text}|{code:false,text}] keeping string literals intact and dropping comments. */
function segments(sql){
  const out=[];let buf='';let i=0;
  while(i<sql.length){
    const c=sql[i];
    if(c==="'"){
      if(buf){out.push({code:true,text:buf});buf='';}
      let j=i+1;
      while(j<sql.length){if(sql[j]==="'"){if(sql[j+1]==="'"){j+=2;continue;}break;}j++;}
      out.push({code:false,text:sql.slice(i,j+1)});i=j+1;continue;
    }
    if(c==='-'&&sql[i+1]==='-'){while(i<sql.length&&sql[i]!=='\n')i++;buf+=' ';continue;}
    buf+=c;i++;
  }
  if(buf)out.push({code:true,text:buf});
  return out;
}
const join=segs=>segs.map(s=>s.text).join('');
const mapCode=(sql,fn)=>join(segments(sql).map(s=>s.code?{...s,text:fn(s.text)}:s));

/** Positions (in full string) of top-level occurrences of a regex in code segments only. */
function codeIndex(sql,re,from=0){
  let pos=0;
  for(const s of segments(sql)){
    if(s.code&&pos+s.text.length>from){
      const r=new RegExp(re.source,re.flags.replace('g','')+'g');
      r.lastIndex=Math.max(0,from-pos);
      const m=r.exec(s.text);
      if(m)return {index:pos+m.index,match:m};
    }
    pos+=s.text.length;
  }
  return null;
}
/** Split statements on top-level semicolons (outside strings and parentheses). */
function splitStatements(body){
  const parts=[];let depth=0,cur='';
  for(const s of segments(body)){
    if(!s.code){cur+=s.text;continue;}
    for(const ch of s.text){
      if(ch==='(')depth++;else if(ch===')')depth--;
      if(ch===';'&&depth===0){if(cur.trim())parts.push(cur.trim());cur='';}else cur+=ch;
    }
  }
  if(cur.trim())parts.push(cur.trim());
  return parts;
}
function lastCodeIndex(sql,word){
  let pos=0,found=-1;
  for(const s of segments(sql)){
    if(s.code){const r=new RegExp('\\b'+word+'\\b','gi');let m;while((m=r.exec(s.text)))found=pos+m.index;}
    pos+=s.text.length;
  }
  return found;
}

// ---------------------------------------------------------------- translation
function translateExpr(sql){
  let out=sql.replace(/\bRAISE\s*\(\s*(?:ABORT|FAIL|ROLLBACK)\s*,\s*('(?:[^']|'')*')\s*\)/gi,'rticore_raise($1)');
  out=mapCode(out,code=>code
    .replace(/\bIS\s+NOT\s+(?!NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi,'IS DISTINCT FROM ')
    .replace(/\bIS\s+(?!NOT\b|NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi,'IS NOT DISTINCT FROM ')
    .replace(/==/g,'=')
    .replace(/\bjson_object\s*\(/gi,'jsonb_build_object(')
    .replace(/\bjson_array\s*\(/gi,'jsonb_build_array(')
    .replace(/\bjson_each\s*\(/gi,'rticore_json_each(')
    // SQLite type names ('integer','real','text'...), not jsonb_typeof names.
    .replace(/\bjson_type\s*\(/gi,'rticore_json_type(')
    // pg_catalog.date(text) would shadow a public date('now') and return a DATE.
    // (a code segment ending in "date(" is always followed by a string literal)
    .replace(/\bdate\s*\(\s*$/gi,'rticore_date_text(')
    .replace(/\bchanges\s*\(\s*\)/gi,'_rc')
    .replace(/\bCURRENT_TIMESTAMP\b/gi,'rticore_now_text()'));
  return out;
}

function translateStatement(stmt){
  let s=translateExpr(stmt.trim());
  let suffix='';
  if(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s)){s=s.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i,'INSERT INTO');suffix=' ON CONFLICT DO NOTHING';}
  else if(/^INSERT\s+OR\s+REPLACE\b/i.test(s))throw new Error('INSERT OR REPLACE is not supported: '+s.slice(0,80));
  if(/^SELECT\b/i.test(s))s=s.replace(/^SELECT\b/i,'PERFORM');
  const dml=/^(INSERT|UPDATE|DELETE)\b/i.test(s);
  return {sql:s+suffix,dml};
}

export function parseTrigger(t){
  const header=/^\s*CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+(BEFORE|AFTER)\s+(INSERT|DELETE|UPDATE(?:\s+OF\s+[\w\s,]+?)?)\s+ON\s+(\w+)(\s+FOR\s+EACH\s+ROW)?/i.exec(t.sql);
  if(!header)throw new Error('Cannot parse trigger header: '+t.name);
  const begin=codeIndex(t.sql,/\bBEGIN\b/i,header[0].length);
  const end=lastCodeIndex(t.sql,'END');
  if(!begin||end<begin.index)throw new Error('Cannot find BEGIN/END: '+t.name);
  const between=t.sql.slice(header[0].length,begin.index).trim();
  const when=between?between.replace(/^WHEN\b/i,'').trim():'';
  if(between&&!/^WHEN\b/i.test(between))throw new Error('Unexpected text before BEGIN in '+t.name+': '+between.slice(0,60));
  const body=t.sql.slice(begin.index+5,end);
  return {name:header[1],timing:header[2].toUpperCase(),event:header[3].replace(/\s+/g,' ').trim(),table:header[4],when,statements:splitStatements(body)};
}

const PATCHES_FILE=path.join(root,'scripts','postgres-trigger-patches.json');
function loadPatches(){return fs.existsSync(PATCHES_FILE)?JSON.parse(fs.readFileSync(PATCHES_FILE,'utf8')):{};}

export function toPlpgsql(t,patches={}){
  const p=parseTrigger(t);
  const fn=(p.name.length>60?p.name.slice(0,52)+'_'+p.name.length:p.name)+'_fn';
  const ret=p.timing==='AFTER'?'NULL':/^DELETE/i.test(p.event)?'OLD':'NEW';
  const stmts=p.statements.map(translateStatement);
  const selfWrite=new RegExp('^(UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+'+p.table+'\\b','i');
  const guard=stmts.some(s=>selfWrite.test(s.sql));
  const usesRc=stmts.some(s=>/\b_rc\b/.test(s.sql));
  const lines=[];
  for(const s of stmts){lines.push('    '+s.sql+';');if(s.dml&&usesRc)lines.push('    GET DIAGNOSTICS _rc = ROW_COUNT;');}
  let inner=lines.join('\n');
  if(guard){
    // SQLite runs with recursive_triggers OFF: a trigger never re-fires itself.
    inner=`    IF current_setting('rticore.trg_${p.name}', true) = '1' THEN RETURN ${ret}; END IF;\n`+
      `    PERFORM set_config('rticore.trg_${p.name}', '1', true);\n${inner}\n`+
      `    PERFORM set_config('rticore.trg_${p.name}', '', true);`;
  }
  // SQLite treats a bare integer as a boolean: WHEN (1) AND ...
  let whenSql=p.when?translateExpr(p.when).replace(/^\(\s*1\s*\)/,'(TRUE)').replace(/^\(\s*0\s*\)/,'(FALSE)'):'';
  let code=`-- ${p.name}: ${p.timing} ${p.event} ON ${p.table}\n`+
    `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $fn$\n`+
    `DECLARE _rc bigint := 0;\nBEGIN\n`+
    (whenSql?`  IF (${whenSql}) THEN\n${inner}\n  END IF;\n`:`${inner}\n`)+
    `  RETURN ${ret};\nEND\n$fn$;\n`+
    `DROP TRIGGER IF EXISTS ${p.name} ON ${p.table};\n`+
    `CREATE TRIGGER ${p.name} ${p.timing} ${p.event} ON ${p.table} FOR EACH ROW EXECUTE FUNCTION ${fn}();\n`;
  const patch=(text)=>{for(const [from,to] of patches[p.name]||[])text=text.split(from).join(to);return text;};
  for(const [from] of patches[p.name]||[])
    if(!code.includes(from))throw new Error('Patch for '+p.name+' no longer matches: '+from);
  code=patch(code);
  return {parsed:p,fn,code,statements:stmts.map(s=>patch(s.sql)),when:patch(whenSql)};
}

export const COMPAT_SQL=`-- SQLite compatibility helpers used by translated triggers.
CREATE OR REPLACE FUNCTION rticore_raise(msg text) RETURNS text LANGUAGE plpgsql VOLATILE AS $f$
BEGIN RAISE EXCEPTION USING MESSAGE = msg, ERRCODE = 'P0001'; END $f$;
CREATE OR REPLACE FUNCTION rticore_now_text() RETURNS text LANGUAGE sql VOLATILE AS $f$
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $f$;
CREATE OR REPLACE FUNCTION randomblob(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS $f$
SELECT substring(decode(md5(random()::text || clock_timestamp()::text) || md5(random()::text || n::text), 'hex') FROM 1 FOR greatest(n, 1)) $f$;
CREATE OR REPLACE FUNCTION hex(b bytea) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT upper(encode(b, 'hex')) $f$;
CREATE OR REPLACE FUNCTION round(v double precision, d integer) RETURNS numeric LANGUAGE sql IMMUTABLE AS $f$ SELECT round(v::numeric, d) $f$;
CREATE OR REPLACE FUNCTION printf(fmt text, a anyelement) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
SELECT format(replace(replace(fmt, '%d', '%s'), '%i', '%s'), a) $f$;
CREATE OR REPLACE FUNCTION rticore_json_each(doc text) RETURNS TABLE(key bigint, value text) LANGUAGE sql IMMUTABLE AS $f$
SELECT (t.o - 1)::bigint, CASE WHEN jsonb_typeof(t.e) = 'string' THEN t.e #>> '{}' ELSE t.e::text END
FROM jsonb_array_elements(CASE WHEN doc IS NULL OR doc = '' THEN '[]'::jsonb ELSE doc::jsonb END) WITH ORDINALITY AS t(e, o) $f$;
CREATE OR REPLACE FUNCTION rticore_json_type(val text, path text DEFAULT '$') RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE j jsonb;
BEGIN
  IF val IS NULL THEN RETURN NULL; END IF;
  j := val::jsonb;
  IF path IS NOT NULL AND path <> '$' THEN j := j #> string_to_array(regexp_replace(path, '^\\$\\.?', ''), '.'); END IF;
  IF j IS NULL THEN RETURN NULL; END IF;
  RETURN CASE jsonb_typeof(j) WHEN 'number' THEN CASE WHEN (j #>> '{}')::numeric = trunc((j #>> '{}')::numeric) AND (j #>> '{}') !~ '[.eE]' THEN 'integer' ELSE 'real' END
    WHEN 'string' THEN 'text' WHEN 'boolean' THEN j #>> '{}' ELSE jsonb_typeof(j) END;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $f$;
CREATE OR REPLACE FUNCTION json_remove(doc text, VARIADIC paths text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE j jsonb; p text;
BEGIN
  IF doc IS NULL THEN RETURN NULL; END IF;
  j := doc::jsonb;
  FOREACH p IN ARRAY paths LOOP j := j #- string_to_array(regexp_replace(p, '^\\$\\.?', ''), '.'); END LOOP;
  RETURN j::text;
END $f$;
CREATE OR REPLACE FUNCTION strftime(fmt text, val text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE plpgsql VOLATILE AS $f$
DECLARE ts timestamp; m text; out text := ''; i integer := 1; c text;
BEGIN
  IF val IS NULL THEN RETURN NULL; END IF;
  IF val = 'now' THEN ts := clock_timestamp() AT TIME ZONE 'UTC';
  ELSE BEGIN ts := val::timestamp; EXCEPTION WHEN OTHERS THEN RETURN NULL; END; END IF;
  FOREACH m IN ARRAY coalesce(mods, '{}') LOOP ts := ts + m::interval; END LOOP;
  WHILE i <= length(fmt) LOOP
    c := substr(fmt, i, 1);
    IF c = '%' AND i < length(fmt) THEN
      i := i + 1; c := substr(fmt, i, 1);
      out := out || CASE c WHEN 'Y' THEN to_char(ts, 'YYYY') WHEN 'm' THEN to_char(ts, 'MM') WHEN 'd' THEN to_char(ts, 'DD')
        WHEN 'H' THEN to_char(ts, 'HH24') WHEN 'M' THEN to_char(ts, 'MI') WHEN 'S' THEN to_char(ts, 'SS')
        WHEN 's' THEN extract(epoch FROM ts)::bigint::text WHEN '%' THEN '%' ELSE '%' || c END;
    ELSE out := out || c; END IF;
    i := i + 1;
  END LOOP;
  RETURN out;
END $f$;
CREATE OR REPLACE FUNCTION rticore_date_text(val text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE sql VOLATILE AS $f$
SELECT strftime('%Y-%m-%d', val, VARIADIC mods) $f$;
`;

// Rows the triggers would have created had they existed when the data was written.
// Mirrors migration 0013: open Leads get an SLA marked legacy_unverified; no past
// response is inferred. Idempotent (ON CONFLICT DO NOTHING).
export const BACKFILL_SQL=`-- Backfill: response SLA for open Leads created before the triggers existed.
INSERT INTO rticore_sales_lead_sla(tenant_id,lead_id,owner_email,assigned_at,response_due_at,baseline)
SELECT l.tenant_id,l.id,l.assigned_sales_email,strftime('%Y-%m-%dT%H:%M:%SZ','now'),
 strftime('%Y-%m-%dT%H:%M:%SZ','now',printf('+%d minutes',coalesce(p.lead_response_minutes,120))),'legacy_unverified'
FROM rticore_marketing_leads l LEFT JOIN rticore_sales_activity_policy p ON p.tenant_id=l.tenant_id
WHERE l.status NOT IN ('converted','disqualified')
ON CONFLICT DO NOTHING;
`;

// Constraint/view changes that rticore_postgresql_schema.sql (CREATE ... IF NOT EXISTS)
// cannot apply to a database created by an older schema. Idempotent.
// Mirrors migrations 0047-0051 (PM, Offense, Defense, Governance and IT Developer login roles).
export const SCHEMA_UPGRADE_SQL=`-- Schema upgrades for databases created before the current rticore_postgresql_schema.sql.
ALTER TABLE rticore_members DROP CONSTRAINT IF EXISTS rticore_members_role_check;
ALTER TABLE rticore_members ADD CONSTRAINT rticore_members_role_check
 CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer'));
ALTER TABLE rticore_erp_role_policy_changes DROP CONSTRAINT IF EXISTS rticore_erp_role_policy_changes_role_check;
ALTER TABLE rticore_erp_role_policy_changes ADD CONSTRAINT rticore_erp_role_policy_changes_role_check
 CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','defense_leader','defense_member','viewer'));
ALTER TABLE rticore_erp_role_capability_matrix DROP CONSTRAINT IF EXISTS rticore_erp_role_capability_matrix_check;
ALTER TABLE rticore_erp_role_capability_matrix DROP CONSTRAINT IF EXISTS rticore_erp_role_capability_matrix_role_check;
ALTER TABLE rticore_erp_role_capability_matrix ADD CONSTRAINT rticore_erp_role_capability_matrix_role_check
 CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','defense_leader','defense_member','viewer'));
INSERT INTO rticore_erp_role_capability_matrix(role,capability,allowed) VALUES
 ('defense_leader','cyber_ops',1),('defense_member','cyber_ops',1)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS rticore_cyber_case_assignments (
 tenant_id TEXT NOT NULL,case_id TEXT NOT NULL,
 assignee_email TEXT NOT NULL ,assigned_by TEXT NOT NULL ,
 status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','submitted','returned')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 investigation_notes TEXT CHECK(investigation_notes IS NULL OR length(investigation_notes) BETWEEN 12 AND 2000),
 evidence_document_id TEXT,
 leader_notes TEXT CHECK(leader_notes IS NULL OR length(leader_notes) BETWEEN 12 AND 800),
 assigned_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 submitted_at TEXT,updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,case_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id),
 CHECK(status!='submitted' OR (investigation_notes IS NOT NULL AND evidence_document_id IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status!='returned' OR leader_notes IS NOT NULL)
, rowid BIGSERIAL);
CREATE INDEX IF NOT EXISTS rticore_cyber_assignment_queue ON rticore_cyber_case_assignments(tenant_id,assignee_email,status);
CREATE OR REPLACE VIEW rticore_delivery_planned_pm AS
 SELECT f.tenant_id,f.opportunity_id,min(e.email) pm_email,f.start_date,f.end_date
 FROM rticore_feasibility_plans f JOIN rticore_resource_allocations a ON a.tenant_id=f.tenant_id AND a.opportunity_id=f.opportunity_id AND a.status='active' AND lower(trim(a.work_role)) IN ('pm','project manager','project_manager')
 JOIN rticore_resource_people e ON e.tenant_id=a.tenant_id AND e.id=a.person_id AND e.active=1
 JOIN rticore_members m ON lower(m.email)=lower(e.email) AND m.active=1 AND m.role IN ('presales','admin','project_manager')
 WHERE f.status='approved' GROUP BY f.tenant_id,f.opportunity_id,f.start_date,f.end_date HAVING count(DISTINCT lower(e.email))=1;
`;

export function generate(){
  const patches=loadPatches();
  const triggers=sqliteTriggers();
  const converted=triggers.map(t=>toPlpgsql(t,patches));
  const sql=`-- =============================================================================\n`+
    `-- GENERATED by scripts/generate-postgres-triggers.mjs - DO NOT EDIT BY HAND.\n`+
    `-- ${converted.length} business-rule triggers translated from migrations/*.sql (SQLite/D1).\n`+
    `-- Idempotent: safe to apply on every start after rticore_postgresql_schema.sql.\n`+
    `-- =============================================================================\n\n`+
    SCHEMA_UPGRADE_SQL+'\n'+COMPAT_SQL+'\n'+converted.map(c=>c.code).join('\n')+'\n'+BACKFILL_SQL;
  return {sql,converted};
}

// ---------------------------------------------------------------- type check
/** Type-checks every translated statement with EXPLAIN (nothing executes). */
export async function typeCheck(converted){
  const {PGlite}=await import('@electric-sql/pglite');
  const pg=await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(root,'rticore_postgresql_schema.sql'),'utf8'));
  await pg.exec(COMPAT_SQL);
  const cols=(await pg.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'`)).rows;
  const types={};for(const c of cols)(types[c.table_name]??={})[c.column_name]=c.data_type;
  const problems=[];
  for(const c of converted){
    const t=types[c.parsed.table.toLowerCase()];
    if(!t){problems.push({trigger:c.parsed.name,error:'table missing in PostgreSQL schema: '+c.parsed.table});continue;}
    const bind=s=>mapCode(s,code=>code.replace(/\b(NEW|OLD)\.(\w+)/gi,(_,_r,col)=>t[col.toLowerCase()]?`(NULL::${t[col.toLowerCase()]})`:`__missing_column_${col}`).replace(/\b_rc\b/g,'(0::bigint)'));
    const checks=[...(c.when?[`SELECT 1 WHERE (${c.when})`]:[]),...c.statements.map(s=>s.replace(/^PERFORM\b/i,'SELECT'))];
    for(const q of checks){
      try{await pg.query('EXPLAIN '+bind(q));}
      catch(e){problems.push({trigger:c.parsed.name,error:String(e.message).split('\n')[0],sql:bind(q).slice(0,240)});}
    }
    try{await pg.exec(c.code);}catch(e){problems.push({trigger:c.parsed.name,error:'CREATE failed: '+String(e.message).split('\n')[0]});}
  }
  await pg.close();
  return problems;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))){
  const {sql,converted}=generate();
  fs.writeFileSync(OUT,sql);
  console.log('Wrote '+path.relative(root,OUT)+' ('+converted.length+' triggers)');
  if(process.argv.includes('--check')){
    const problems=await typeCheck(converted);
    for(const p of problems)console.log('PROBLEM',p.trigger,'::',p.error,p.sql?'\n   '+p.sql:'');
    console.log(problems.length?problems.length+' problem(s)':'All triggers type-check against the PostgreSQL schema.');
    if(problems.length)process.exitCode=1;
  }
}
