#!/usr/bin/env node
/**
 * RTICore Hostinger Durable Background Job Worker (H08 / M30).
 *
 * Dual-mode execution for Hostinger compatibility:
 * - Hostinger Web Hosting / Cron: `node scripts/hostinger-worker.mjs --once`
 * - Hostinger VPS KVM (systemd):  `node scripts/hostinger-worker.mjs`
 *
 * Uses PostgreSQL row locking and ownership checks. Uncertified handlers are quarantined;
 * business execution, retry scheduling and crash recovery require separate certification.
 * Never logs secrets or credentials.
 */
import os from 'node:os';
import pg from 'pg';
import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';

const runOnce = process.argv.includes('--once');
const pollMs = Math.max(2000, Number(process.env.RTICORE_WORKER_POLL_MS || 10000));
const workerId = `${os.hostname()}-${process.pid}`;
let shuttingDown = false;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', event: 'worker_shutdown_requested', workerId, signal: sig, ts: new Date().toISOString() }));
  });
}

async function processNextJob(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `SELECT id, tenant_id, legal_entity_id, job_type, payload_json, attempts, max_attempts
       FROM rticore_background_jobs
       WHERE status = 'queued' AND next_run_at <= to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const job = claimed.rows[0];
    await client.query("UPDATE rticore_background_jobs SET status='running', attempts=attempts+1, locked_by=$1 WHERE id=$2", [workerId, job.id]);
    await client.query('COMMIT');

    // No business handler is certified yet. Never fabricate completion or replay money events.
    const quarantined = await pool.query(
      "UPDATE rticore_background_jobs SET status='dead_letter', locked_by=NULL, last_error='HANDLER_NOT_CERTIFIED' WHERE id=$1 AND tenant_id=$2 AND status='running' AND locked_by=$3",
      [job.id, job.tenant_id, workerId],
    );
    if (quarantined.rowCount !== 1) throw new Error('Worker ownership changed before quarantine');
    console.error(JSON.stringify({level:'warn',event:'job_handler_not_certified',workerId,jobId:job.id,jobType:job.job_type,ts:new Date().toISOString()}));
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const url = validateHostingerConfig(process.env);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    max: 3,
  });
  try {
    console.log(JSON.stringify({ level: 'info', event: 'worker_started', workerId, mode: runOnce ? 'once' : 'daemon', ts: new Date().toISOString() }));
    do {
      let processed = 0;
      while (!shuttingDown && await processNextJob(pool)) {
        processed++;
        if (processed >= 50) break;
      }
      if (runOnce || shuttingDown) break;
      await new Promise(r => setTimeout(r, pollMs));
    } while (!shuttingDown);
  } finally {
    await pool.end();
    console.log(JSON.stringify({ level: 'info', event: 'worker_stopped', workerId, ts: new Date().toISOString() }));
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('hostinger-worker.mjs')) {
  main().catch(err => {
    console.error(JSON.stringify({ level: 'error', event: 'worker_fatal', message: 'Worker failed; inspect restricted infrastructure diagnostics', ts: new Date().toISOString() }));
    process.exitCode = 1;
  });
}
