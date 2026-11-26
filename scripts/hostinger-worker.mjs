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
import { processNextJob } from './hostinger-job-engine.mjs';
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

async function main() {
  if(process.env.RTICORE_WORKER_CONTAINMENT_ONLY!=='1') throw Error('Uncertified worker disabled; explicit containment mode required');
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
      while (!shuttingDown && await processNextJob(pool,workerId)) {
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
