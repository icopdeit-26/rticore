import type {D1DB, D1Prepared} from './boq-auth';

/**
 * Local-only D1 replacement backed by Node's built-in SQLite (node:sqlite).
 * Used exclusively when RTICORE_LOCAL_MODE=1 and the app runs on Node.js
 * (next dev / next start). It is never reached inside a Cloudflare Worker.
 *
 * Semantics mirror D1 where RTICORE relies on them:
 *  - foreign keys enforced, bind() positional parameters
 *  - run() -> {success, meta:{changes,last_row_id}}
 *  - batch() is atomic (single transaction, rollback on any failure)
 */
type SqliteValue=string|number|bigint|null|Uint8Array;
type StatementSync={
  all(...args:SqliteValue[]):Record<string,unknown>[];
  get(...args:SqliteValue[]):Record<string,unknown>|undefined;
  run(...args:SqliteValue[]):{changes:number|bigint;lastInsertRowid:number|bigint};
  columns?():unknown[];
};
type DatabaseSync={prepare(sql:string):StatementSync;exec(sql:string):void;close():void};
type SqliteModule={DatabaseSync:new(path:string,options?:Record<string,unknown>)=>DatabaseSync};
type NodePath={resolve(...p:string[]):string;dirname(p:string):string};
type NodeFs={mkdirSync(p:string,o:{recursive:boolean}):void};

declare const process:{env:Record<string,string|undefined>;cwd():string;getBuiltinModule?:(id:string)=>unknown};

function builtin<T>(id:string):T{
  const get=typeof process!=='undefined'?process.getBuiltinModule:undefined;
  const mod=get?get(id):undefined;
  if(!mod)throw new Error('Mode lokal RTICORE memerlukan Node.js >= 22.5 (modul '+id+' tidak tersedia).');
  return mod as T;
}

function toValue(v:unknown):SqliteValue{
  if(v===undefined)throw new TypeError('D1_TYPE_ERROR: undefined tidak dapat di-bind');
  if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='bigint'||v instanceof Uint8Array)return v;
  if(typeof v==='boolean')return v?1:0;
  if(v instanceof ArrayBuffer)return new Uint8Array(v);
  throw new TypeError('D1_TYPE_ERROR: tipe parameter tidak didukung');
}
const plain=(row:Record<string,unknown>|undefined|null)=>row?{...row}:null;
const isReader=(stmt:StatementSync,sql:string)=>{
  if(typeof stmt.columns==='function')return stmt.columns().length>0;
  return /^\s*(select|with|pragma|values)\b/i.test(sql)||/\breturning\b/i.test(sql);
};

class LocalStatement implements D1Prepared{
  constructor(private db:DatabaseSync,readonly sql:string,readonly args:SqliteValue[]=[]){}
  bind(...args:(string|number|null)[]):D1Prepared{return new LocalStatement(this.db,this.sql,args.map(toValue));}
  private stmt(){return this.db.prepare(this.sql);}
  async all<T=Record<string,unknown>>(){return this.allSync<T>();}
  allSync<T>(){
    const rows=this.stmt().all(...this.args).map(r=>({...r}));
    return {results:rows as T[],success:true,meta:{changes:0,rows_read:rows.length,last_row_id:0}};
  }
  async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{
    const row=plain(this.stmt().get(...this.args));
    if(column!==undefined)return (row?row[column]:null) as T|null;
    return row as T|null;
  }
  async run(){return this.runSync();}
  runSync(){
    const stmt=this.stmt();
    if(isReader(stmt,this.sql)){
      const rows=stmt.all(...this.args).map(r=>({...r}));
      return {success:true,results:rows,meta:{changes:0,last_row_id:0}};
    }
    const r=stmt.run(...this.args);
    return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};
  }
}

class LocalD1 implements D1DB{
  constructor(private db:DatabaseSync){}
  prepare(query:string):D1Prepared{return new LocalStatement(this.db,query);}
  async batch(statements:D1Prepared[]):Promise<unknown[]>{
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(s=>{
        if(!(s instanceof LocalStatement))throw new Error('Statement bukan milik database lokal');
        return s.runSync();
      });
      this.db.exec('COMMIT');
      return results;
    }catch(error){
      try{this.db.exec('ROLLBACK');}catch{/* already rolled back */}
      throw error;
    }
  }
  async exec(sql:string){this.db.exec(sql);return {count:0,duration:0};}
}

export function localDatabasePath():string{
  const path=builtin<NodePath>('node:path');
  return path.resolve(process.cwd(),process.env.RTICORE_LOCAL_DB_PATH||'.local-data/rticore.db');
}

const globalStore=globalThis as unknown as {__rticoreLocalD1?:LocalD1};

/** One shared connection per Node process (survives Next dev hot reloads). */
export function getLocalD1():D1DB{
  if(globalStore.__rticoreLocalD1)return globalStore.__rticoreLocalD1;
  const {DatabaseSync}=builtin<SqliteModule>('node:sqlite');
  const path=builtin<NodePath>('node:path');
  const fs=builtin<NodeFs>('node:fs');
  const file=localDatabasePath();
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  globalStore.__rticoreLocalD1=new LocalD1(db);
  return globalStore.__rticoreLocalD1;
}
