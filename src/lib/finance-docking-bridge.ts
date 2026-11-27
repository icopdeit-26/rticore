/**
 * RTICore Live End-to-End Finance Docking Outbox Bridge (Section 8.1–8.6).
 *
 * Builds atomic, idempotent `rticore_finance_integration_events` outbox writes
 * for operational modules (Timesheets, Procurement/AP, Contracts, FlexGuard)
 * without breaking legacy standalone tests when no legal entity scope is bound.
 */
import type { D1DB, D1Prepared } from './boq-auth';
import { TENANT } from './sales-workflow';

export type DockingEventType =
  | 'contract.approved'
  | 'project.milestone_accepted'
  | 'timesheet.approved'
  | 'purchase_order.approved'
  | 'vendor_invoice.approved'
  | 'customer_invoice.approved'
  | 'customer.payment_received'
  | 'flexguard.credit_purchased'
  | 'flexguard.credit_consumed';

/** Hash exactly the persisted UTF-8 JSON, consistently across Node and Workers. */
export async function financePayloadSha256(payloadJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadJson));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyFinancePayload(payloadJson: string, digest: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(digest)) return false;
  try { const value = JSON.parse(payloadJson); if (!value || typeof value !== 'object' || Array.isArray(value)) return false; } catch { return false; }
  return (await financePayloadSha256(payloadJson)) === digest;
}

export async function buildFinanceOutboxStatement(
  db: D1DB,
  params: {
    legalEntityId: string;
    eventType: DockingEventType;
    sourceDocumentId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<{ eventId: string; stmt: D1Prepared }> {
  if (params.idempotencyKey.length < 8 || params.idempotencyKey.length > 160 || params.idempotencyKey.trim() !== params.idempotencyKey) throw new Error('INVALID finance idempotency key');
  const eventId = crypto.randomUUID();
  const payloadJson = JSON.stringify(params.payload);
  const hash = await financePayloadSha256(payloadJson);
  const stmt = db
    .prepare(
      `INSERT INTO rticore_finance_integration_events(
        id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,
        correlation_id,idempotency_key,schema_version,payload_json,payload_sha256,status,event_timestamp
      ) VALUES(?,?,?,'outbox',?,'RTICORE',?,?,?,'1.0',?,?,'received',CURRENT_TIMESTAMP)`,
    )
    .bind(
      eventId,
      TENANT,
      params.legalEntityId,
      params.eventType,
      params.sourceDocumentId,
      `DOCK-${params.sourceDocumentId.slice(0, 12)}`,
      params.idempotencyKey,
      payloadJson,
      hash,
    );
  return { eventId, stmt };
}

/** Hostinger never permits an unscoped financial event. Legacy standalone fixtures
 * may omit scope; mapped projects always produce the same transactional outbox. */
export async function operationalFinanceScope(db: D1DB, projectId: string): Promise<string | null> {
 const row = await db.prepare("SELECT s.legal_entity_id FROM rticore_erp_project_scopes s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.legal_entity_id WHERE s.tenant_id=? AND s.project_id=? AND s.status='approved' AND u.kind='legal_entity' AND u.active=1").bind(TENANT,projectId).first<{legal_entity_id:string}>();
 if(!row && (typeof process !== 'undefined' && process.env.RTICORE_RUNTIME === 'hostinger')) throw new Error('FINANCE_SCOPE_REQUIRED');
 return row?.legal_entity_id ?? null;
}
export const operationalFinanceScopePredicate = "EXISTS(SELECT 1 FROM rticore_erp_project_scopes fs JOIN rticore_erp_org_units fu ON fu.tenant_id=fs.tenant_id AND fu.id=fs.legal_entity_id WHERE fs.tenant_id=? AND fs.project_id=? AND fs.legal_entity_id=? AND fs.status='approved' AND fu.kind='legal_entity' AND fu.active=1)";
