#!/usr/bin/env node
// Moves a production D1 from the pre-rebrand india_* schema to the rticore_* names the code uses.
// Migrations 0001-0045 were rewritten in place by the rebrand, so the numbered runner can never
// apply this change; it is generated from the live sqlite_master and run once by the release.
//
//   node scripts/release/d1-legacy-rename.mjs classify <sqlite_master.json>
//   node scripts/release/d1-legacy-rename.mjs generate <sqlite_master.json> <output.sql>
//
// Input is `wrangler d1 execute --json` output, or a plain array of {type,name,tbl_name,sql}.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const swap=text=>text.replace(/india/g,'rticore').replace(/INDIA/g,'RTICORE').replace(/India/g,'RTICore');
const legacy=text=>/india/i.test(text||'');
const internal=name=>/^(sqlite_|_cf_|d1_)/.test(name);
const quote=name=>'"'+name.replace(/"/g,'""')+'"';

export function classify(rows){
  const tables=new Set(rows.filter(r=>r.type==='table').map(r=>r.name));
  // v3-RTI reuses migration numbers 0046-0051 with different content; its code is not in this branch.
  if([...tables].some(name=>/_sys_parameters$/.test(name)))return 'v3-rti';
  const old=tables.has('india_schema_migrations'),current=tables.has('rticore_schema_migrations');
  if(old&&current)return 'mixed';
  if(old)return 'legacy';
  return current?'renamed':'empty';
}

export function generate(rows){
  const objects=rows.filter(r=>!internal(r.name));
  const names=new Set(objects.map(r=>r.name));
  const of=type=>objects.filter(r=>r.type===type&&r.sql&&(legacy(r.name)||legacy(r.sql)));
  const tables=objects.filter(r=>r.type==='table'&&legacy(r.name));
  const [indexes,views,triggers]=['index','view','trigger'].map(of);
  for(const r of [...tables,...indexes,...views,...triggers]){
    const target=swap(r.name);
    if(target!==r.name&&names.has(target))throw new Error('Rename target already exists: '+target);
  }
  const create=r=>swap(r.sql).replace(/;?\s*$/,';');
  const statements=[
    'PRAGMA defer_foreign_keys=ON;',
    // Triggers and views go first so that no renamed table is re-parsed against a stale body.
    ...triggers.map(r=>'DROP TRIGGER '+quote(r.name)+';'),
    ...views.map(r=>'DROP VIEW '+quote(r.name)+';'),
    ...indexes.map(r=>'DROP INDEX '+quote(r.name)+';'),
    ...tables.map(r=>'ALTER TABLE '+quote(r.name)+' RENAME TO '+quote(swap(r.name))+';'),
    ...indexes.map(create),...views.map(create),...triggers.map(create),
  ];
  return {sql:statements.join('\n')+'\n',counts:{tables:tables.length,indexes:indexes.length,views:views.length,triggers:triggers.length}};
}

function load(path){
  const parsed=JSON.parse(readFileSync(path,'utf8'));
  return Array.isArray(parsed)&&parsed[0]?.results?parsed[0].results:parsed;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [mode,input,output]=process.argv.slice(2);
  if(mode==='classify')console.log(classify(load(input)));
  else if(mode==='generate'&&output){
    const {sql,counts}=generate(load(input));
    writeFileSync(output,sql);
    console.log('Rename plan: '+JSON.stringify(counts));
  }else{console.error('usage: d1-legacy-rename.mjs classify <json> | generate <json> <output.sql>');process.exit(2);}
}
