import path from 'node:path';
import fs from 'node:fs';
import type { D1DB, D1Prepared } from './boq-auth';

function normalizeRow(row: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') {
      out[k] = Number(v);
    } else if (typeof v === 'string' && /^-?\d+$/.test(v) && v.length <= 15 && (
      k === 'version' || k === 'active' || k === 'enabled' || k === 'tested_ok' || k === 'priority' ||
      k === 'sequence' || k === 'edit_seq' || k === 'flow_version' || k === 'chunk_count' || k === 'part' ||
      k === 'byte_length' || k === 'singleton' || k === 'present' || k === 'ok' || k === 'used' ||
      k === 'total' || k === 'pending' || k === 'active_users' || k === 'evaluations' || k === 'commit_ready' ||
      k === 'mandatory' || k === 'is_gap' || k === 'allowed' || k === 'sort_order' || k === 'qty' ||
      k === 'quantity' || k === 'capacity_units' || k === 'capacity_confirmed' || k === 'village_count' ||
      k === 'row_count' || k === 'province_count' || k === 'postal_count' || k === 'cadence_days' ||
      k === 'touch_count' || k === 'probability_pct' || k === 'notice_days' || k === 'attempts' || k === 'n' ||
      k === 'count' || k === 'qualified' || k === 'converted' || k === 'disqualified' || k === 'nurture' || k === 'overdue_nurture' || k === 'new_leads' || k === 'contacted' || k === 'won' || k === 'calls' || k === 'emails' || k === 'meetings' || k === 'follow_ups' || k === 'revision' || k.endsWith('_version') || k.endsWith('_cents') || k.endsWith('_idr') || k.endsWith('_count') || k.endsWith('_seq') || k.endsWith('_leads') || k.startsWith('total_') || k === 'rowid'
    )) {
      out[k] = Number(v);
    } else if (typeof v === 'boolean' && (k === 'used' || k === 'ok' || k === 'present')) {
      out[k] = v ? 1 : 0;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function translateSQLiteToPostgres(sql: string): string {
  let idx = 0;
  let out = sql.replace(/\?/g, () => `$${++idx}`);
  out = out
    .replace(/\$(\d+)(\s+IS\s+(?:NOT\s+)?NULL\b)/gi, 'CAST($$$1 AS TEXT)$2')
    .replace(/\$(\d+)(\s*(?:=|!=|<>)\s*'(?:[^']|'')*')/gi, 'CAST($$$1 AS TEXT)$2')
    .replace(/\$(\d+)(\s*(?:=|!=|<>)\s*-?\d+(?:\.\d+)?\b)/gi, 'CAST($$$1 AS BIGINT)$2')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\s+([a-zA-Z0-9_"]+)\s*(\([^)]+\))?\s*VALUES\s*(\([^;]+\))/gi,
      'INSERT INTO $1 $2 VALUES $3 ON CONFLICT DO NOTHING')
    .replace(/\bround\s*\(\s*avg\s*\(\s*json_extract\s*\(([^)]+)\)\s*\)\s*,\s*(\d+)\s*\)/gi,
      'round(avg((json_extract($1))::numeric), $2)')
    .replace(/\bsum\s*\(\s*json_extract\s*\(([^)]+)\)\s*-\s*coalesce\s*\(\s*json_extract\s*\(([^)]+)\)\s*,\s*0\s*\)\s*\)/gi,
      'sum((json_extract($1))::numeric - coalesce((json_extract($2))::numeric, 0))')
    .replace(/\bsum\s*\(\s*json_extract\s*\(([^)]+)\)\s*\)/gi,
      'sum((json_extract($1))::numeric)');
  return out;
}

type QueryExecutor = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  exec(sql: string): Promise<unknown>;
  batch?(statements: { sql: string; args: unknown[] }[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }[]>;
};

const globalPg = globalThis as unknown as {
  __rticorePgExecutorPromiseV3?: Promise<QueryExecutor> | null;
};

async function ensureSchema(exec: QueryExecutor, schemaSQL: string): Promise<void> {
  if (!schemaSQL) return;
  try {
    const check = await exec.query('SELECT COUNT(*) AS n FROM rticore_members');
    const count = Number(check.rows?.[0]?.n ?? 0);
    if (count > 0) return;
  } catch {
    // Table does not exist yet; apply full schema
  }
  await exec.exec(schemaSQL);
}

async function createExecutor(): Promise<QueryExecutor> {
  const pgUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (pgUrl) {
    const schemaPath = path.join(process.cwd(), 'rticore_postgresql_schema.sql');
    const schemaSQL = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
    type PgPool = {
      query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
      connect(): Promise<{query: PgPool['query']; release(error?: Error):void}>;
    };
    const pgMod = (await import(/* webpackIgnore: true */ 'pg' as string)) as {
      Pool: new (opts: { connectionString: string }) => PgPool;
    };
    const pool = new pgMod.Pool({ connectionString: pgUrl });
    const exec: QueryExecutor = {
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      batch: async (statements) => {
        const client=await pool.connect();
        let discard:Error|undefined;
        try {
          await client.query('BEGIN');
          const results=[];
          for(const statement of statements)results.push(await client.query(statement.sql,statement.args));
          await client.query('COMMIT');
          return results;
        }catch(error){
          try{await client.query('ROLLBACK');}catch{discard=new Error('Rollback failed');}
          throw error;
        }finally{client.release(discard);}
      },
    };
    // Hosted schema changes are operator-controlled, not request-time DDL.
    if(process.env.RTICORE_RUNTIME==='hostinger')return exec;
    await ensureSchema(exec, schemaSQL);
    // Business-rule triggers generated from the SQLite migrations; idempotent.
    const triggersPath = path.join(process.cwd(), 'rticore_postgresql_triggers.sql');
    if (fs.existsSync(triggersPath)) await exec.exec(fs.readFileSync(triggersPath, 'utf8'));
    return exec;
  }

  if(process.env.RTICORE_RUNTIME==='hostinger')throw Error('External PostgreSQL is mandatory');
  type WorkerResponse = {
    id: number;
    ok: boolean;
    rows?: Record<string, unknown>[];
    rowCount?: number;
    batchResults?: { rows: Record<string, unknown>[]; rowCount?: number }[];
    error?: string;
  };
  type NodeWorker = {
    postMessage(msg: unknown): void;
    on(event: 'message', cb: (msg: WorkerResponse) => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
  };
  type WorkerThreadsMod = {
    Worker: new (filename: string, options?: { workerData?: unknown }) => NodeWorker;
  };

  const proc = process as unknown as { getBuiltinModule?: (id: string) => unknown };
  const wt = (proc.getBuiltinModule?.('node:worker_threads') ||
    (await import(/* webpackIgnore: true */ 'node:worker_threads' as string))) as WorkerThreadsMod;

  const root = process.cwd();
  const dataDir = process.env.PGLITE_DATA_DIR || path.join(root, '.pgdata');
  const workerPath = path.join(root, 'scripts', 'postgres-worker.mjs');
  const worker = new wt.Worker(workerPath, { workerData: { root, dataDir } });

  let seq = 0;
  const pending = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>();

  worker.on('message', (msg: WorkerResponse) => {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(new Error(msg.error || 'PostgreSQL worker error'));
  });

  worker.on('error', (err: Error) => {
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  });

  const callWorker = (payload: Record<string, unknown>): Promise<WorkerResponse> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...payload });
    });

  return {
    query: async (sql, params) => {
      const res = await callWorker({ type: 'query', sql, params });
      return { rows: res.rows || [], rowCount: res.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await callWorker({ type: 'exec', sql });
    },
    batch: async (statements) => {
      const res = await callWorker({ type: 'batch', statements });
      return res.batchResults || [];
    },
  };
}

function getExecutor(): Promise<QueryExecutor> {
  if (!globalPg.__rticorePgExecutorPromiseV3) {
    globalPg.__rticorePgExecutorPromiseV3 = createExecutor().catch((err) => {
      globalPg.__rticorePgExecutorPromiseV3 = null;
      throw err;
    });
  }
  return globalPg.__rticorePgExecutorPromiseV3;
}

class PostgresPrepared implements D1Prepared {
  public readonly sql: string;
  public args: (string | number | null)[] = [];

  constructor(sql: string, args: (string | number | null)[] = []) {
    this.sql = sql;
    this.args = args;
  }

  bind(...args: (string | number | null)[]): D1Prepared {
    return new PostgresPrepared(this.sql, args);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
    const exec = await getExecutor();
    const pgSql = translateSQLiteToPostgres(this.sql);
    const res = await exec.query(pgSql, this.args);
    const results = res.rows.map((r) => normalizeRow(r) as T);
    return { results, success: true };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const exec = await getExecutor();
    const pgSql = translateSQLiteToPostgres(this.sql);
    const res = await exec.query(pgSql, this.args);
    if (!res.rows.length) return null;
    const row = normalizeRow(res.rows[0]);
    if (column !== undefined) return (row ? row[column] : null) as T | null;
    return row as T;
  }

  async run(): Promise<{ success: boolean; meta?: { changes: number; last_row_id: number } }> {
    const exec = await getExecutor();
    const pgSql = translateSQLiteToPostgres(this.sql);
    const res = await exec.query(pgSql, this.args);
    return { success: true, meta: { changes: res.rowCount ?? 0, last_row_id: 0 } };
  }
}

export class PostgresD1Adapter implements D1DB {
  prepare(query: string): D1Prepared {
    return new PostgresPrepared(query);
  }

  async batch(statements: D1Prepared[]): Promise<unknown[]> {
    const exec = await getExecutor();
    const mapped = statements.map((stmt) => {
      const s = stmt as PostgresPrepared;
      return { sql: translateSQLiteToPostgres(s.sql), args: s.args };
    });
    if (exec.batch) {
      const results = await exec.batch(mapped);
      return results.map((res) => ({
        success: true,
        results: (res.rows || []).map(normalizeRow),
        meta: { changes: res.rowCount ?? 0, last_row_id: 0 },
      }));
    }
    await exec.exec('BEGIN');
    try {
      const out: unknown[] = [];
      for (const s of mapped) {
        const res = await exec.query(s.sql, s.args);
        out.push({ success: true, results: res.rows.map(normalizeRow), meta: { changes: res.rowCount ?? 0, last_row_id: 0 } });
      }
      await exec.exec('COMMIT');
      return out;
    } catch (err) {
      try { await exec.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }
}

export function getLocalPostgresDB(): D1DB {
  return new PostgresD1Adapter();
}
