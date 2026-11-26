import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Read-only classification. Never repair a digest from an untrusted historical payload.
export function classifyEvent(row) {
  if (typeof row.payload_json !== 'string') return 'invalid_payload';
  try {
    const value = JSON.parse(row.payload_json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_payload';
  } catch { return 'invalid_payload'; }
  const digest = createHash('sha256').update(row.payload_json, 'utf8').digest('hex');
  return digest === row.payload_sha256 ? 'digest_valid' : 'requires_source_reconciliation';
}

export function summarizeEvents(rows) {
  const counts = { total: 0, digest_valid: 0, invalid_payload: 0, requires_source_reconciliation: 0, processed_exceptions: 0 };
  for (const row of rows) {
    const kind = classifyEvent(row);
    counts.total++;
    counts[kind]++;
    if (kind !== 'digest_valid' && row.status === 'processed') counts.processed_exceptions++;
  }
  return counts;
}

async function main() {
  // Require an explicitly approved separate staging database and expected DB name.
  if (process.env.RTICORE_RECONCILIATION_SCOPE !== 'staging' ||
      !process.env.RTICORE_STAGING_EXPECTED_DATABASE ||
      !process.env.RTICORE_STAGING_DATABASE_URL) throw Error('Staging reconciliation configuration required');
  const url = new URL(process.env.RTICORE_STAGING_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full' ||
      [...url.searchParams.keys()].some(k => k !== 'sslmode') ||
      decodeURIComponent(url.pathname.slice(1)) !== process.env.RTICORE_STAGING_EXPECTED_DATABASE ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('Staging TLS/database scope rejected');
  url.search = '';
  const { default: pg } = await import('pg');
  const client = new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:30000});
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS db')).rows[0];
    if (identity.db !== process.env.RTICORE_STAGING_EXPECTED_DATABASE) throw Error('Database identity mismatch');
    const counts = { total:0,digest_valid:0,invalid_payload:0,requires_source_reconciliation:0,processed_exceptions:0 };
    await client.query('DECLARE finance_recon NO SCROLL CURSOR FOR SELECT payload_json,payload_sha256,status FROM public.rticore_finance_integration_events');
    for (;;) {
      const {rows} = await client.query('FETCH FORWARD 500 FROM finance_recon');
      if (!rows.length) break;
      const part = summarizeEvents(rows);
      for (const key of Object.keys(counts)) counts[key] += part[key];
    }
    await client.query('ROLLBACK');
    const ok = counts.invalid_payload === 0 && counts.requires_source_reconciliation === 0;
    console.log(JSON.stringify({scope:'staging',mode:'read_only',...counts,digest_scan:ok?'PASS':'FAIL',source_reconciliation_certified:false},null,2));
    if (!ok) process.exitCode = 1;
  } finally { await client.end().catch(()=>{}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{ console.error('Staging reconciliation failed; check approved configuration, TLS, permissions and schema. No writes performed.'); process.exitCode=1; });
}
