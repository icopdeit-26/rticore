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
      params.idempotencyKey.slice(0, 160),
      payloadJson,
      hash,
    );
  return { eventId, stmt };
}
