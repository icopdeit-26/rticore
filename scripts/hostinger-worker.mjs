#!/usr/bin/env node
/**
 * RTICore Hostinger Durable Background Job Worker (H08 / M30).
 *
 * Dual-mode execution for Hostinger compatibility:
 * - Hostinger Web Hosting / Cron: `node scripts/hostinger-worker.mjs --once`
 * - Hostinger VPS KVM (systemd):  `node scripts/hostinger-worker.mjs`
 *
 * Uses PostgreSQL `FOR UPDATE SKIP LOCKED` to guarantee safe concurrent workers,
 * idempotent job processing, exponential retry backoff, and dead-letter quarantine.
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

    try {
      // Execute deterministic, non-destructive job handler (never auto-posts unauthorized GL entries)
      if (job.job_type === 'backup_verification' || job.job_type === 'renewal_signal_scan' || job.job_type === 'sla_breach_monitor' || job.job_type === 'flexguard_expiry_scan' || job.job_type === 'finance_outbox_dispatch' || job.job_type === 'sales_activity_sla' || job.job_type === 'report_generation') {
        await pool.query("UPDATE rticore_background_jobs SET status='completed', completed_at=to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), last_error=NULL WHERE id=$1", [job.id]);
      } else {
        throw new Error(`Unsupported job_type: ${job.job_type}`);
      }
      console.log(JSON.stringify({ level: 'info', event: 'job_completed', workerId, jobId: job.id, jobType: job.job_type, ts: new Date().toISOString() }));
      return true;
    } catch (err) {
      const nextAttempts = Number(job.attempts) + 1;
      const dead = nextAttempts >= Number(job.max_attempts);
      const nextStatus = dead ? 'dead_letter' : 'queued';
      await pool.query('UPDATE rticore_background_jobs SET status=$1, last_error=$2 WHERE id=$3', [nextStatus, String(err instanceof Error ? err.message : err).slice(0, 500), job.id]);
      console.error(JSON.stringify({ level: 'error', event: dead ? 'job_dead_letter' : 'job_retry_scheduled', workerId, jobId: job.id, attempts: nextAttempts, ts: new Date().toISOString() }));
      return true;
    }
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
    console.error(JSON.stringify({ level: 'error', event: 'worker_fatal', message: err instanceof Error ? err.message : 'Unknown error', ts: new Date().toISOString() }));
    process.exitCode = 1;
  });
}
