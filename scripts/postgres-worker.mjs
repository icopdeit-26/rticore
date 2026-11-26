import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const root = workerData?.root || process.cwd();
const dataDir = workerData?.dataDir || path.join(root, '.pgdata');
const schemaPath = path.join(root, 'rticore_postgresql_schema.sql');
const triggersPath = path.join(root, 'rticore_postgresql_triggers.sql');

/**
 * Business-rule triggers generated from the SQLite migrations
 * (scripts/generate-postgres-triggers.mjs). Re-applied only when the file changes.
 */
export async function ensureTriggers(pg) {
  if (!fs.existsSync(triggersPath)) return;
  const sql = fs.readFileSync(triggersPath, 'utf8');
  const version = crypto.createHash('sha256').update(sql).digest('hex');
  await pg.exec('CREATE TABLE IF NOT EXISTS rticore_pg_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const current = await pg.query("SELECT value FROM rticore_pg_meta WHERE key='triggers_sha256'");
  if (current.rows?.[0]?.value === version) return;
  await pg.exec('BEGIN');
  try {
    await pg.exec(sql);
    await pg.query("INSERT INTO rticore_pg_meta(key,value) VALUES('triggers_sha256',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [version]);
    await pg.exec('COMMIT');
  } catch (err) {
    try { await pg.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

let pgPromise = null;

async function getPg() {
  if (!pgPromise) {
    pgPromise = (async () => {
      // Never erase a database when opening it fails. Recovery requires an
      // explicit operator decision and a separately verified backup.
      const pg = await PGlite.create(dataDir);
      try {
        const check = await pg.query('SELECT COUNT(*) AS n FROM rticore_members');
        if (Number(check.rows?.[0]?.n ?? 0) === 0 && fs.existsSync(schemaPath)) {
          await pg.exec(fs.readFileSync(schemaPath, 'utf8'));
        }
      } catch {
        if (fs.existsSync(schemaPath)) {
          await pg.exec(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
      await ensureTriggers(pg);
      await pg.exec('CHECKPOINT');
      return pg;
    })();
  }
  return pgPromise;
}

const MUTATING_SQL = /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|TRUNCATE)\b/i;

// Serialize operations so transactions (BEGIN/COMMIT) never interleave
let queue = Promise.resolve();

parentPort?.on('message', (msg) => {
  queue = queue.then(async () => {
    const { id, type, sql, params, statements } = msg;
    try {
      const pg = await getPg();
      if (type === 'query') {
        const res = await pg.query(sql, params || []);
        if (MUTATING_SQL.test(String(sql || ''))) {
          await pg.exec('CHECKPOINT');
        }
        parentPort.postMessage({ id, ok: true, rows: res.rows, rowCount: res.affectedRows ?? 0 });
      } else if (type === 'exec') {
        await pg.exec(sql);
        await pg.exec('CHECKPOINT');
        parentPort.postMessage({ id, ok: true });
      } else if (type === 'batch') {
        await pg.exec('BEGIN');
        try {
          const out = [];
          let lastChanges = 0;
          for (const st of statements) {
            const sqlText = String(st.sql || '').replace(/\bchanges\s*\(\s*\)/gi, String(lastChanges));
            const r = await pg.query(sqlText, st.args || []);
            lastChanges = r.affectedRows ?? 0;
            out.push({ rows: r.rows, rowCount: lastChanges });
          }
          await pg.exec('COMMIT');
          await pg.exec('CHECKPOINT');
          parentPort.postMessage({ id, ok: true, batchResults: out });
        } catch (err) {
          try { await pg.exec('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        }
      }
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  });
});
