import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

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

// Historical source checks: contract lifecycle may legitimately advance after approval.
export async function scanContractSources(client){
 const {rows}=await client.query(`SELECT count(*)::text AS total,
 count(*) FILTER (WHERE c.id IS NULL OR p.id IS NULL)::text AS missing_source,
 count(*) FILTER (WHERE c.id IS NOT NULL AND (s.project_id IS NULL OR s.status<>'approved' OR s.legal_entity_id IS DISTINCT FROM e.legal_entity_id))::text AS invalid_project_scope,
 count(*) FILTER (WHERE c.id IS NOT NULL AND p.id IS NOT NULL AND (c.status NOT IN ('active','expired','churned') OR e.payload_json::jsonb->>'contract_id' IS DISTINCT FROM c.id OR e.payload_json::jsonb->>'project_id' IS DISTINCT FROM p.id OR e.payload_json::jsonb->>'opportunity_id' IS DISTINCT FROM p.opportunity_id OR e.payload_json::jsonb->>'model' IS DISTINCT FROM c.model OR e.payload_json::jsonb->>'recurring_cents' IS DISTINCT FROM c.recurring_cents::text OR e.payload_json::jsonb->>'renewal_cents' IS DISTINCT FROM c.renewal_cents::text OR lower(e.payload_json::jsonb->>'approved_by') IS DISTINCT FROM lower(c.approved_by)))::text AS source_mismatch
 FROM public.rticore_finance_integration_events e
 LEFT JOIN public.rticore_service_contracts c ON c.tenant_id=e.tenant_id AND c.id=e.source_document_id
 LEFT JOIN public.rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id
 LEFT JOIN public.rticore_erp_project_scopes s ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id
 WHERE e.direction='outbox' AND e.source_system='RTICORE' AND e.event_type='contract.approved'`);
 return rows[0];
}
// No accounting policy inference or automatic financial settlement.
export async function scanFlexGuardSources(client){
 const {rows}=await client.query(`SELECT count(*)::text AS total,
 count(*) FILTER (WHERE l.id IS NULL)::text AS missing_source,
 count(*) FILTER (WHERE l.id IS NOT NULL AND l.legal_entity_id IS DISTINCT FROM e.legal_entity_id)::text AS invalid_entity_scope,
 count(*) FILTER (WHERE l.id IS NOT NULL AND (l.approval_status<>'posted' OR l.financial_value_cents<=0 OR l.finance_outbox_event_id IS DISTINCT FROM e.id OR e.payload_json::jsonb->>'wallet_id' IS DISTINCT FROM l.wallet_id OR e.payload_json::jsonb->>'customer_id' IS DISTINCT FROM l.customer_id OR e.payload_json::jsonb->>'credits' IS DISTINCT FROM abs(l.credit_amount)::text OR (e.event_type='flexguard.credit_consumed' AND l.transaction_type<>'consumption') OR (e.event_type='flexguard.credit_purchased' AND l.transaction_type NOT IN ('purchase','top_up')) OR (e.event_type='flexguard.credit_expired' AND l.transaction_type<>'expiry') OR (e.event_type='flexguard.credit_adjusted' AND l.transaction_type<>'adjustment') OR e.payload_json::jsonb->>'amount_cents' IS DISTINCT FROM l.financial_value_cents::text OR e.payload_json::jsonb->>'unit_value_cents' IS DISTINCT FROM l.unit_value_cents::text))::text AS source_mismatch
 FROM public.rticore_finance_integration_events e
 LEFT JOIN public.rticore_flexguard_enterprise_ledger l ON l.tenant_id=e.tenant_id AND l.id=e.source_document_id
 WHERE e.direction='outbox' AND e.source_system='RTICORE' AND e.event_type IN ('flexguard.credit_purchased','flexguard.credit_consumed','flexguard.credit_expired','flexguard.credit_adjusted')`);
 return rows[0];
}

// A linked journal is not evidence of settlement unless posted and correctly scoped.
export async function scanSettlementEvidence(client){
 const {rows}=await client.query(`SELECT
 (SELECT count(*) FROM public.rticore_finance_integration_events e JOIN public.rticore_gl_journals j ON j.tenant_id=e.tenant_id AND j.id=e.resulting_journal_id AND j.legal_entity_id=e.legal_entity_id WHERE e.status='processed' AND j.status<>'posted')::text AS processed_unposted_journal,
 (SELECT count(*) FROM public.rticore_gl_journals j LEFT JOIN public.rticore_gl_periods p ON p.tenant_id=j.tenant_id AND p.id=j.period_id AND p.legal_entity_id=j.legal_entity_id WHERE p.id IS NULL)::text AS invalid_period_scope,
 (SELECT count(*) FROM public.rticore_gl_journals WHERE status='posted' AND (posted_by IS NULL OR posted_at IS NULL OR reviewed_by IS NULL OR lower(created_by)=lower(reviewed_by)))::text AS missing_posting_evidence,
 (SELECT count(*) FROM public.rticore_finance_integration_events WHERE status='processed' AND (processed_at IS NULL OR processed_by IS NULL))::text AS missing_processing_evidence`);
 return rows[0];
}

// No writes or automatic backfill; a single candidate still requires independent evidence review.
export async function scanVendorBankScopes(client){
 const available=(await client.query("SELECT to_regclass('public.rticore_finance_vendor_bank_scopes') IS NOT NULL AS ready")).rows[0].ready;
 if(!available)return {schema_status:'MIGRATION_0053_REQUIRED'};
 const {rows}=await client.query(`WITH candidates AS (
 SELECT b.tenant_id,b.id,count(DISTINCT os.legal_entity_id) AS entity_count
 FROM public.rticore_finance_vendor_bank_accounts b
 LEFT JOIN public.rticore_document_library d ON d.tenant_id=b.tenant_id AND d.id=b.evidence_document_id
 LEFT JOIN public.rticore_purchase_orders p ON p.tenant_id=b.tenant_id AND p.vendor_id=b.vendor_id AND p.opportunity_id=d.opportunity_id AND p.status='approved'
 LEFT JOIN public.rticore_erp_opportunity_scopes os ON os.tenant_id=p.tenant_id AND os.opportunity_id=p.opportunity_id AND os.status='approved'
 GROUP BY b.tenant_id,b.id
)
SELECT count(*)::text AS total,
 count(*) FILTER(WHERE sc.bank_account_id IS NULL)::text AS unassigned,
 count(*) FILTER(WHERE sc.bank_account_id IS NULL AND c.entity_count=0)::text AS no_evidenced_candidate,
 count(*) FILTER(WHERE sc.bank_account_id IS NULL AND c.entity_count=1)::text AS single_candidate_review_required,
 count(*) FILTER(WHERE sc.bank_account_id IS NULL AND c.entity_count>1)::text AS ambiguous,
 count(*) FILTER(WHERE sc.bank_account_id IS NOT NULL AND (p.id IS NULL OR p.vendor_id IS DISTINCT FROM b.vendor_id OR p.status IS DISTINCT FROM 'approved' OR os.status IS DISTINCT FROM 'approved' OR os.legal_entity_id IS DISTINCT FROM sc.legal_entity_id OR d.id IS NULL OR d.opportunity_id IS DISTINCT FROM p.opportunity_id))::text AS invalid_assigned_scope
FROM public.rticore_finance_vendor_bank_accounts b
JOIN candidates c ON c.tenant_id=b.tenant_id AND c.id=b.id
LEFT JOIN public.rticore_finance_vendor_bank_scopes sc ON sc.tenant_id=b.tenant_id AND sc.bank_account_id=b.id
LEFT JOIN public.rticore_purchase_orders p ON p.tenant_id=sc.tenant_id AND p.id=sc.purchase_order_id
LEFT JOIN public.rticore_erp_opportunity_scopes os ON os.tenant_id=p.tenant_id AND os.opportunity_id=p.opportunity_id
LEFT JOIN public.rticore_document_library d ON d.tenant_id=b.tenant_id AND d.id=b.evidence_document_id`);
 return {schema_status:'AVAILABLE',...rows[0]};
}
export async function scanEntityConstraints(client){
 const manifest=JSON.parse(readFileSync(new URL('../deployment/hostinger/migrations/0054_entity_constraints.json',import.meta.url),'utf8'));
 if(manifest.length!==16||!manifest.every(e=>[e.table,e.column,e.parent,e.name].every(x=>typeof x==='string'&&/^[a-z_][a-z0-9_]*$/.test(x))))throw Error('Invalid entity manifest');
 const queries=manifest.map(e=>`SELECT '${e.name}' AS constraint_name,count(*)::text AS invalid FROM public.${e.table} c LEFT JOIN public.${e.parent} p ON p.tenant_id=c.tenant_id AND p.legal_entity_id=c.legal_entity_id AND p.id=c.${e.column} WHERE c.${e.column} IS NOT NULL AND p.id IS NULL`);
 const {rows}=await client.query(queries.join(' UNION ALL '));
 return Object.fromEntries(rows.map(r=>[r.constraint_name,r.invalid]));
}

export async function scanFlexGuardLedger(client){
 const ready=(await client.query("SELECT to_regclass('public.rticore_fg_finance_links') IS NOT NULL AS ready")).rows[0].ready;
 if(!ready)return {schema_status:'MIGRATION_0058_REQUIRED'};
 const {rows}=await client.query(`WITH lot_balance AS (
 SELECT l.tenant_id,l.id,l.credits_total,l.unit_value_cents,l.financial_value_cents,l.invoice_id,
 coalesce(sum(e.available_delta),0) AS available,coalesce(sum(e.reserved_delta),0) AS reserved,
 coalesce(sum(e.consumed_delta),0) AS consumed,coalesce(sum(e.expired_delta),0) AS expired,coalesce(sum(e.adjustment_delta),0) AS adjustment,
 coalesce(sum(e.credit_amount) FILTER(WHERE e.transaction_type IN ('purchase','top_up')),0) AS purchased
 FROM public.rticore_flexguard_credit_lots l LEFT JOIN public.rticore_flexguard_enterprise_ledger e ON e.tenant_id=l.tenant_id AND e.lot_id=l.id
 GROUP BY l.tenant_id,l.id
), ledger_check AS (
 SELECT l.*,e.status AS event_status,e.resulting_journal_id,
 x.journal_id AS linked_journal,j.status AS journal_status
 FROM public.rticore_flexguard_enterprise_ledger l
 LEFT JOIN public.rticore_finance_integration_events e ON e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.id=l.finance_outbox_event_id
 LEFT JOIN public.rticore_fg_finance_links x ON x.tenant_id=e.tenant_id AND x.legal_entity_id=e.legal_entity_id AND x.event_id=e.id
 LEFT JOIN public.rticore_gl_journals j ON j.tenant_id=x.tenant_id AND j.legal_entity_id=x.legal_entity_id AND j.id=x.journal_id
)
SELECT (SELECT count(*) FROM lot_balance)::text AS lots,
 (SELECT count(*) FROM lot_balance WHERE available<0 OR reserved<0 OR consumed<0 OR expired<0 OR purchased<>credits_total OR available+reserved+consumed+expired-adjustment<>purchased)::text AS invalid_balance,
 (SELECT count(*) FROM lot_balance b LEFT JOIN public.rticore_billing_invoices i ON i.tenant_id=b.tenant_id AND i.id=b.invoice_id WHERE i.id IS NULL OR i.status<>'approved' OR i.amount_cents<>b.financial_value_cents OR (SELECT coalesce(sum(p.amount_cents),0) FROM public.rticore_billing_payments p WHERE p.tenant_id=b.tenant_id AND p.invoice_id=b.invoice_id AND p.status='approved')<i.amount_cents+i.vat_cents)::text AS invoice_payment_review,
 (SELECT count(*) FROM ledger_check WHERE transaction_type IN ('purchase','top_up','consumption','expiry','adjustment') AND event_status IS NULL)::text AS missing_outbox,
 (SELECT count(*) FROM ledger_check WHERE event_status IS NOT NULL AND event_status<>'processed')::text AS pending_finance_ack,
 (SELECT count(*) FROM ledger_check WHERE event_status='processed' AND (linked_journal IS DISTINCT FROM resulting_journal_id OR journal_status IS DISTINCT FROM 'posted'))::text AS invalid_posted_link,
 (SELECT coalesce(sum((available+reserved)*unit_value_cents),0) FROM lot_balance)::text AS remaining_service_value_cents`);
 return {schema_status:'AVAILABLE',...rows[0]};
}
export async function scanFlexGuardAllocationControls(client){
 const ready=(await client.query("SELECT to_regclass('public.rticore_fg_invoice_allocations') IS NOT NULL AS ready")).rows[0].ready;
 if(!ready)return {schema_status:'MIGRATION_0060_REQUIRED'};
 const {rows}=await client.query(`SELECT
 (SELECT count(*) FROM public.rticore_flexguard_credit_lots l LEFT JOIN public.rticore_fg_invoice_allocations a ON a.tenant_id=l.tenant_id AND a.invoice_id=l.invoice_id AND a.legal_entity_id=l.legal_entity_id AND a.wallet_id=l.wallet_id AND a.credits=l.credits_total AND a.net_cents=l.financial_value_cents AND a.status='approved' WHERE a.invoice_id IS NULL)::text AS unverified_lot_allocations,
 (SELECT count(*) FROM public.rticore_fg_finance_links f JOIN public.rticore_finance_integration_events e ON e.tenant_id=f.tenant_id AND e.id=f.event_id JOIN public.rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.id=f.journal_id WHERE e.status='processed' AND j.source_type='flexguard' AND NOT EXISTS(SELECT 1 FROM public.rticore_finance_journal_workflows w WHERE w.tenant_id=j.tenant_id AND w.journal_id=j.id AND w.legal_entity_id=j.legal_entity_id AND w.lifecycle_stage='posted' AND w.approved_by=j.reviewed_by AND w.posted_by=j.posted_by AND lower(j.created_by)<>lower(j.posted_by) AND lower(j.reviewed_by)<>lower(j.posted_by)))::text AS legacy_journal_workflow_review,
 (SELECT count(*) FROM public.rticore_flexguard_enterprise_ledger l JOIN public.rticore_finance_integration_events e ON e.tenant_id=l.tenant_id AND e.id=l.finance_outbox_event_id WHERE e.status='processed' AND NOT EXISTS(SELECT 1 FROM public.rticore_fg_finance_links f WHERE f.tenant_id=e.tenant_id AND f.event_id=e.id AND f.legal_entity_id=l.legal_entity_id AND f.net_amount_cents=l.financial_value_cents AND f.journal_id=e.resulting_journal_id))::text AS acknowledged_amount_mismatch`);
 return {schema_status:'AVAILABLE',...rows[0]};
}

// Compare each lot against real posted GL lines, not merely claimed event amounts.
export async function scanFlexGuardLiability(client){
 const ready=(await client.query("SELECT to_regclass('public.rticore_fg_finance_links') IS NOT NULL AS ready")).rows[0].ready;
 if(!ready)return {schema_status:'MIGRATION_0058_REQUIRED'};
 const {rows}=await client.query(`WITH acquisition AS (
 SELECT lot.tenant_id,lot.legal_entity_id,lot.id AS lot_id,lot.unit_value_cents,
   count(x.id) FILTER(WHERE x.transaction_type IN ('purchase','top_up')) AS acquisition_count,
   max(f.credit_account_id) FILTER(WHERE x.transaction_type IN ('purchase','top_up') AND e.status='processed' AND j.status='posted') AS liability_account_id
 FROM public.rticore_flexguard_credit_lots lot
 LEFT JOIN public.rticore_flexguard_enterprise_ledger x ON x.tenant_id=lot.tenant_id AND x.legal_entity_id=lot.legal_entity_id AND x.lot_id=lot.id
 LEFT JOIN public.rticore_finance_integration_events e ON e.tenant_id=x.tenant_id AND e.legal_entity_id=x.legal_entity_id AND e.id=x.finance_outbox_event_id
 LEFT JOIN public.rticore_fg_finance_links f ON f.tenant_id=e.tenant_id AND f.legal_entity_id=e.legal_entity_id AND f.event_id=e.id AND f.journal_id=e.resulting_journal_id
 LEFT JOIN public.rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.legal_entity_id=f.legal_entity_id AND j.id=f.journal_id
 GROUP BY lot.tenant_id,lot.legal_entity_id,lot.id,lot.unit_value_cents
), entries AS (
 SELECT a.tenant_id,a.legal_entity_id,a.lot_id,a.acquisition_count,a.liability_account_id,
 x.id AS tx_id,x.transaction_type,
 (x.available_delta+x.reserved_delta)*a.unit_value_cents AS expected_delta,
 e.id AS event_id,e.status AS event_status,j.id AS posted_journal,
 CASE WHEN j.id IS NOT NULL AND a.liability_account_id IS NOT NULL THEN
 (SELECT coalesce(sum(gl.credit_cents-gl.debit_cents),0) FROM public.rticore_gl_lines gl WHERE gl.tenant_id=j.tenant_id AND gl.journal_id=j.id AND gl.account_id=a.liability_account_id) ELSE 0 END AS posted_delta
 FROM acquisition a
 LEFT JOIN public.rticore_flexguard_enterprise_ledger x ON x.tenant_id=a.tenant_id AND x.legal_entity_id=a.legal_entity_id AND x.lot_id=a.lot_id
 LEFT JOIN public.rticore_finance_integration_events e ON e.tenant_id=x.tenant_id AND e.legal_entity_id=x.legal_entity_id AND e.id=x.finance_outbox_event_id
 LEFT JOIN public.rticore_fg_finance_links f ON f.tenant_id=e.tenant_id AND f.legal_entity_id=e.legal_entity_id AND f.event_id=e.id AND f.journal_id=e.resulting_journal_id
 LEFT JOIN public.rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.legal_entity_id=f.legal_entity_id AND j.id=f.journal_id AND j.status='posted' AND e.status='processed'
), per_lot AS (
 SELECT tenant_id,legal_entity_id,lot_id,acquisition_count,liability_account_id,
 coalesce(sum(expected_delta),0) AS expected_balance,
 coalesce(sum(posted_delta),0) AS posted_balance,
 count(*) FILTER(WHERE transaction_type IN ('purchase','top_up','consumption','expiry','adjustment') AND (event_status IS DISTINCT FROM 'processed' OR posted_journal IS NULL)) AS unacknowledged,
 count(*) FILTER(WHERE transaction_type IN ('purchase','top_up','consumption','expiry','adjustment') AND posted_journal IS NOT NULL AND posted_delta IS DISTINCT FROM expected_delta) AS mismatched_posting
 FROM entries GROUP BY tenant_id,legal_entity_id,lot_id,acquisition_count,liability_account_id
)
SELECT count(*)::text AS lots,
 count(*) FILTER(WHERE acquisition_count<>1 OR liability_account_id IS NULL)::text AS missing_purchase_evidence,
 count(*) FILTER(WHERE unacknowledged>0)::text AS lots_pending_ack,
 count(*) FILTER(WHERE expected_balance<>posted_balance)::text AS lots_with_variance,
 coalesce(sum(mismatched_posting),0)::text AS mismatched_postings,
 coalesce(sum(expected_balance),0)::text AS expected_liability_cents,
 coalesce(sum(posted_balance),0)::text AS posted_linked_liability_cents,
 coalesce(sum(abs(expected_balance-posted_balance)),0)::text AS absolute_lot_variance_cents,
 count(*) FILTER(WHERE acquisition_count=1 AND liability_account_id IS NOT NULL AND unacknowledged=0 AND expected_balance=posted_balance AND mismatched_posting=0)::text AS fully_matched_lots
FROM per_lot`);
 return {schema_status:'AVAILABLE',...rows[0]};
}

// Legacy wallets require independently verified source evidence, never automatic opening credit.
export async function scanFlexGuardLegacyBoundary(client){
 const {rows}=await client.query(`WITH running AS (
 SELECT tenant_id,wallet_id,
 sum(CASE WHEN kind IN ('ISSUE','TOPUP','RELEASE','REFUND') THEN units WHEN kind IN ('RESERVE','EXPIRY') THEN -units ELSE 0 END) OVER w AS available,
 sum(CASE WHEN kind='RESERVE' THEN units WHEN kind IN ('RELEASE','DEBIT') THEN -units ELSE 0 END) OVER w AS reserved,
 sum(CASE WHEN kind='DEBIT' THEN units WHEN kind='REFUND' THEN -units ELSE 0 END) OVER w AS consumed
 FROM public.rticore_flexguard_events WINDOW w AS (PARTITION BY tenant_id,wallet_id ORDER BY rowid ROWS UNBOUNDED PRECEDING)
 ), legacy AS (SELECT DISTINCT tenant_id,wallet_id FROM running)
 SELECT (SELECT count(*) FROM running)::text AS legacy_events,
 (SELECT count(*) FROM legacy)::text AS legacy_wallets_requiring_review,
 (SELECT count(*) FROM (SELECT DISTINCT tenant_id,wallet_id FROM running WHERE available<0 OR reserved<0 OR consumed<0) bad)::text AS negative_running_balance_wallets,
 (SELECT count(*) FROM legacy l WHERE EXISTS(SELECT 1 FROM public.rticore_flexguard_enterprise_ledger n WHERE n.tenant_id=l.tenant_id AND n.wallet_id=l.wallet_id) OR EXISTS(SELECT 1 FROM public.rticore_flexguard_requests n WHERE n.tenant_id=l.tenant_id AND n.wallet_id=l.wallet_id AND n.status IN ('posted','pending_approval')))::text AS mixed_ledger_wallets`);
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
    const contractSources=await scanContractSources(client);
    const flexguardAvailable=(await client.query("SELECT to_regclass('public.rticore_flexguard_enterprise_ledger') IS NOT NULL AS ready")).rows[0].ready;
    const flexguardSources=flexguardAvailable?await scanFlexGuardSources(client):{schema_status:'MISSING_ENTERPRISE_LEDGER'};
    const flexguardLedger=flexguardAvailable?await scanFlexGuardLedger(client):{schema_status:'MISSING_ENTERPRISE_LEDGER'};
    const fgAllocationControls=flexguardAvailable?await scanFlexGuardAllocationControls(client):{schema_status:'MISSING_ENTERPRISE_LEDGER'};
    const legacyBoundary=flexguardAvailable?await scanFlexGuardLegacyBoundary(client):{schema_status:'MISSING_ENTERPRISE_LEDGER'};
    const fgLiability=flexguardAvailable?await scanFlexGuardLiability(client):{schema_status:'MISSING_ENTERPRISE_LEDGER'};
    const vendorBankScopes=await scanVendorBankScopes(client);
    const entityConstraints=await scanEntityConstraints(client);
    const settlementEvidence=await scanSettlementEvidence(client);
    await client.query('ROLLBACK');
    const ok = flexguardAvailable && ['legacy_wallets_requiring_review','negative_running_balance_wallets','mixed_ledger_wallets'].every(k=>legacyBoundary[k]==='0') && fgLiability.schema_status==='AVAILABLE' && ['missing_purchase_evidence','lots_pending_ack','lots_with_variance','mismatched_postings','absolute_lot_variance_cents'].every(k=>fgLiability[k]==='0') && fgAllocationControls.schema_status==='AVAILABLE' && ['unverified_lot_allocations','legacy_journal_workflow_review','acknowledged_amount_mismatch'].every(k=>fgAllocationControls[k]==='0') && flexguardLedger.schema_status==='AVAILABLE' && ['invalid_balance','invoice_payment_review','missing_outbox','pending_finance_ack','invalid_posted_link'].every(k=>flexguardLedger[k]==='0') && vendorBankScopes.schema_status==='AVAILABLE' && vendorBankScopes.unassigned==='0' && vendorBankScopes.invalid_assigned_scope==='0' && Object.values(entityConstraints).every(v=>v==='0') && counts.invalid_payload === 0 && counts.requires_source_reconciliation === 0 && ['unbalanced_posted_journals','invalid_journal_links','duplicate_event_keys','invalid_account_scope','processed_without_journal_review'].every(k=>invariantCounts[k]==='0') && ['missing_source','invalid_project_scope','source_mismatch','processed_cost_ledger_review'].every(k=>timesheetSources[k]==='0') && ['missing_source','invalid_opportunity_scope','source_mismatch'].every(k=>procurementSources[k]==='0') && ['missing_source','invalid_project_scope','source_mismatch'].every(k=>contractSources[k]==='0') && ['missing_source','invalid_entity_scope','source_mismatch'].every(k=>flexguardSources[k]==='0') && Object.values(settlementEvidence).every(v=>v==='0');
    console.log(JSON.stringify({scope:'staging',mode:'read_only',...counts,integrity:invariantCounts,timesheet_sources:timesheetSources,procurement_sources:procurementSources,contract_sources:contractSources,flexguard_sources:flexguardSources,settlement_evidence:settlementEvidence,flexguard_ledger:flexguardLedger,flexguard_allocation_controls:fgAllocationControls,flexguard_liability:fgLiability,flexguard_legacy_boundary:legacyBoundary,vendor_bank_scopes:vendorBankScopes,entity_constraints:entityConstraints,digest_scan:counts.invalid_payload===0&&counts.requires_source_reconciliation===0?'PASS':'FAIL',automated_scan:!ok?'FAIL':counts.total===0?'NO_DATA':'PASS',source_reconciliation_certified:false},null,2));
    if (!ok || counts.total===0) process.exitCode = 1;
  } finally { await client.end().catch(()=>{}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{ console.error('Staging reconciliation failed; check approved configuration, TLS, permissions and schema. No writes performed.'); process.exitCode=1; });
}
