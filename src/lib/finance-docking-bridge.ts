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

function deterministicHex64(seed: string): string {
  // Deterministic 64-hex digest safe for sync statement builders; full SHA-256 used in async paths
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const part = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return part.repeat(4).slice(0, 64);
}

export function buildFinanceOutboxStatement(
  db: D1DB,
  params: {
    legalEntityId: string;
    eventType: DockingEventType;
    sourceDocumentId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): { eventId: string; stmt: D1Prepared } {
  const eventId = crypto.randomUUID();
  const payloadJson = JSON.stringify(params.payload);
  const hash = deterministicHex64(`${params.legalEntityId}|${params.eventType}|${params.sourceDocumentId}|${payloadJson}`);
  const stmt = db
    .prepare(
      `INSERT OR IGNORE INTO rticore_finance_integration_events(
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
