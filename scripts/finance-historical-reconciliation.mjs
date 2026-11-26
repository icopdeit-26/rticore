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

export async function scanJournalIntegrity(client){
  const integrity = (await client.query(`
      SELECT
        (SELECT count(*) FROM (
          SELECT j.tenant_id,j.id FROM public.rticore_gl_journals j
          LEFT JOIN public.rticore_gl_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id
          WHERE j.status='posted' GROUP BY j.tenant_id,j.id
          HAVING count(l.id)<2 OR coalesce(sum(l.debit_cents),0)<>coalesce(sum(l.credit_cents),0)
        ) x) AS unbalanced_posted_journals,
        (SELECT count(*) FROM public.rticore_gl_lines l JOIN public.rticore_gl_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id LEFT JOIN public.rticore_gl_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id AND a.legal_entity_id=j.legal_entity_id WHERE a.id IS NULL) AS invalid_account_scope,
        (SELECT count(*) FROM public.rticore_finance_integration_events e
          LEFT JOIN public.rticore_gl_journals j ON j.tenant_id=e.tenant_id AND j.id=e.resulting_journal_id AND j.legal_entity_id=e.legal_entity_id
          WHERE e.resulting_journal_id IS NOT NULL AND j.id IS NULL) AS invalid_journal_links,
        (SELECT count(*) FROM public.rticore_finance_integration_events WHERE status='processed' AND resulting_journal_id IS NULL) AS processed_without_journal_review,
        (SELECT count(*) FROM (SELECT tenant_id,idempotency_key FROM public.rticore_finance_integration_events GROUP BY tenant_id,idempotency_key HAVING count(*)>1) d) AS duplicate_event_keys
    `)).rows[0];
  return Object.fromEntries(Object.entries(integrity).map(([k,v])=>[k,String(v)]));
}

// Source verification is deliberately limited to the documented timesheet envelope.
export async function scanTimesheetSources(client){
 const {rows}=await client.query(`SELECT
 count(*)::text AS total,
 count(*) FILTER (WHERE t.id IS NULL)::text AS missing_source,
 count(*) FILTER (WHERE t.id IS NOT NULL AND (p.project_id IS NULL OR p.status<>'approved' OR p.legal_entity_id<>e.legal_entity_id))::text AS invalid_project_scope,
 count(*) FILTER (WHERE t.id IS NOT NULL AND (t.status<>'approved' OR e.payload_json::jsonb->>'timesheet_id' IS DISTINCT FROM t.id OR e.payload_json::jsonb->>'project_id' IS DISTINCT FROM t.project_id OR e.payload_json::jsonb->>'minutes' IS DISTINCT FROM t.minutes::text OR e.payload_json::jsonb->>'cost_snapshot_cents' IS DISTINCT FROM t.cost_snapshot_cents::text OR lower(e.payload_json::jsonb->>'approved_by') IS DISTINCT FROM lower(t.reviewed_by)))::text AS source_mismatch,
 count(*) FILTER (WHERE e.status='processed' AND (c.id IS NULL OR c.status<>'approved' OR c.is_actual<>1 OR c.legal_entity_id<>e.legal_entity_id OR c.project_id IS DISTINCT FROM t.project_id OR c.amount_cents IS DISTINCT FROM t.cost_snapshot_cents))::text AS processed_cost_ledger_review
 FROM public.rticore_finance_integration_events e
 LEFT JOIN public.rticore_project_timesheets t ON t.tenant_id=e.tenant_id AND t.id=e.source_document_id
 LEFT JOIN public.rticore_erp_project_scopes p ON p.tenant_id=t.tenant_id AND p.project_id=t.project_id
 LEFT JOIN public.rticore_finance_project_cost_ledger c ON c.tenant_id=e.tenant_id AND c.source_domain='psa_timesheet' AND c.source_record_id=e.source_document_id
 WHERE e.direction='outbox' AND e.source_system='RTICORE' AND e.event_type='timesheet.approved'`);
 return rows[0];
}

// Validate canonical operational procurement envelopes, not accounting recognition.
export async function scanProcurementSources(client){
 const {rows}=await client.query(`WITH sources AS (
 SELECT e.id,e.event_type,e.legal_entity_id,e.payload_json::jsonb AS payload,
 p.id AS po_id,p.opportunity_id,p.vendor_id AS po_vendor,p.qty,p.unit_price_cents,p.status AS po_status,p.reviewed_by AS po_reviewer,
 i.id AS invoice_id,i.vendor_id AS invoice_vendor,i.status AS invoice_status,i.reviewed_by AS invoice_reviewer,
 o.opportunity_id AS scope_id,o.status AS scope_status,o.legal_entity_id AS scope_entity
 FROM public.rticore_finance_integration_events e
 LEFT JOIN public.rticore_ap_supplier_invoices i ON e.event_type='vendor_invoice.approved' AND i.tenant_id=e.tenant_id AND i.id=e.source_document_id
 LEFT JOIN public.rticore_purchase_orders p ON p.tenant_id=e.tenant_id AND p.id=CASE WHEN e.event_type='purchase_order.approved' THEN e.source_document_id ELSE i.po_id END
 LEFT JOIN public.rticore_erp_opportunity_scopes o ON o.tenant_id=p.tenant_id AND o.opportunity_id=p.opportunity_id
 WHERE e.direction='outbox' AND e.source_system='RTICORE' AND e.event_type IN ('purchase_order.approved','vendor_invoice.approved')
 ) SELECT count(*)::text AS total,
 count(*) FILTER (WHERE po_id IS NULL OR (event_type='vendor_invoice.approved' AND invoice_id IS NULL))::text AS missing_source,
 count(*) FILTER (WHERE po_id IS NOT NULL AND (scope_id IS NULL OR scope_status<>'approved' OR scope_entity IS DISTINCT FROM legal_entity_id))::text AS invalid_opportunity_scope,
 count(*) FILTER (WHERE po_id IS NOT NULL AND (
 po_status<>'approved' OR
 (event_type='purchase_order.approved' AND (
 payload->>'po_id' IS DISTINCT FROM po_id OR payload->>'opportunity_id' IS DISTINCT FROM opportunity_id OR payload->>'vendor_id' IS DISTINCT FROM po_vendor OR payload->>'qty' IS DISTINCT FROM qty::text OR payload->>'unit_price_cents' IS DISTINCT FROM unit_price_cents::text OR payload->>'total_cents' IS DISTINCT FROM (qty::numeric*unit_price_cents::numeric)::text OR lower(payload->>'approved_by') IS DISTINCT FROM lower(po_reviewer)))
 OR (event_type='vendor_invoice.approved' AND invoice_id IS NOT NULL AND (
 invoice_status<>'approved' OR invoice_vendor IS DISTINCT FROM po_vendor OR payload->>'invoice_id' IS DISTINCT FROM invoice_id OR payload->>'po_id' IS DISTINCT FROM po_id OR payload->>'vendor_id' IS DISTINCT FROM invoice_vendor OR lower(payload->>'approved_by') IS DISTINCT FROM lower(invoice_reviewer)))
 ))::text AS source_mismatch FROM sources`);
 return rows[0];
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
    // Aggregate checks only: no customer data or journal identifiers leave staging.
    const invariantCounts=await scanJournalIntegrity(client);
    const timesheetSources=await scanTimesheetSources(client);
    const procurementSources=await scanProcurementSources(client);
    await client.query('ROLLBACK');
    const ok = counts.invalid_payload === 0 && counts.requires_source_reconciliation === 0 && ['unbalanced_posted_journals','invalid_journal_links','duplicate_event_keys','invalid_account_scope'].every(k=>invariantCounts[k]==='0') && ['missing_source','invalid_project_scope','source_mismatch','processed_cost_ledger_review'].every(k=>timesheetSources[k]==='0') && ['missing_source','invalid_opportunity_scope','source_mismatch'].every(k=>procurementSources[k]==='0');
    console.log(JSON.stringify({scope:'staging',mode:'read_only',...counts,integrity:invariantCounts,timesheet_sources:timesheetSources,procurement_sources:procurementSources,digest_scan:counts.invalid_payload===0&&counts.requires_source_reconciliation===0?'PASS':'FAIL',automated_scan:!ok?'FAIL':counts.total===0?'NO_DATA':'PASS',source_reconciliation_certified:false},null,2));
    if (!ok) process.exitCode = 1;
  } finally { await client.end().catch(()=>{}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{ console.error('Staging reconciliation failed; check approved configuration, TLS, permissions and schema. No writes performed.'); process.exitCode=1; });
}
