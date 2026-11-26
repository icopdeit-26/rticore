import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

/**
 * Live Finance Docking Outbox Bridge Controller (Section 8.1–8.6).
 * Allows Finance/Approver/Admin to inspect entity-scoped operational events emitted
 * by FlexGuard, Timesheets, and Procurement, validate payload integrity, and transition
 * them cleanly into processed or dead_letter state with full audit trail.
 * Respects Hostinger Finance fail-closed guard.
 */
export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  if (typeof process !== 'undefined' && process.env.RTICORE_RUNTIME === 'hostinger') {
    return erpReply({ success: false, message: 'Finance production scope certification pending.' }, 503);
  }
  const { db, role } = a.identity;
  try {
    erpAssert(['admin', 'finance', 'approver'].includes(role), 'Hanya Finance, Approver, atau Admin yang dapat mengakses Docking Bridge', 403);
    const requestedEntity = new URL(req.url).searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const events = await db.prepare(
      'SELECT id, legal_entity_id, direction, event_type, source_system, source_document_id, correlation_id, idempotency_key, payload_json, status, retry_count, error_message, resulting_journal_id, event_timestamp, processed_at, processed_by FROM rticore_finance_integration_events WHERE tenant_id=? AND legal_entity_id=? ORDER BY event_timestamp DESC LIMIT 200',
    ).bind(TENANT, legalEntityId).all();

    return erpReply({ success: true, legal_entity_id: legalEntityId, events: events.results });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  if (typeof process !== 'undefined' && process.env.RTICORE_RUNTIME === 'hostinger') {
    return erpReply({ success: false, message: 'Finance production scope certification pending.' }, 503);
  }
  const { db, role, email } = a.identity;
  try {
    erpOrigin(req);
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan memproses docking event', 403);
    erpAssert(['finance', 'approver'].includes(role), 'Hanya Finance atau Approver yang dapat memproses outbox event ke RTI Finance', 403);
    const v = (await readBoundedJSON(req, 8000)) as Record<string, unknown>;
    erpAssert(erpId(v.event_id), 'event_id wajib');
    const ev = await db.prepare('SELECT id, legal_entity_id, event_type, status, payload_json FROM rticore_finance_integration_events WHERE tenant_id=? AND id=?')
      .bind(TENANT, v.event_id as string).first<{ id: string; legal_entity_id: string; event_type: string; status: string; payload_json: string }>();
    erpAssert(ev, 'Docking event tidak ditemukan', 404);
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.includes(ev.legal_entity_id), 'Akses lintas legal entity ditolak', 403);
    erpAssert(ev.status === 'received' || ev.status === 'validated', 'Event sudah diproses atau berada di dead_letter', 409);

    const action = String(v.action || 'process_event');
    if (action === 'process_event') {
      // Verify JSON payload parses cleanly
      JSON.parse(ev.payload_json);
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("UPDATE rticore_finance_integration_events SET status='processed', processed_at=CURRENT_TIMESTAMP, processed_by=? WHERE tenant_id=? AND id=? AND status IN ('received','validated')")
            .bind(email, TENANT, ev.id),
        ],
        'finance_docking', ev.id, 'DOCKING_EVENT_PROCESSED', { event_type: ev.event_type, legal_entity_id: ev.legal_entity_id },
      );
      return erpReply({ success: true, id: ev.id, status: 'processed' });
    }

    if (action === 'quarantine_event') {
      const reason = String(v.error_message || 'Payload validation failed').slice(0, 500);
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("UPDATE rticore_finance_integration_events SET status='dead_letter', retry_count=retry_count+1, error_message=?, processed_by=? WHERE tenant_id=? AND id=?")
            .bind(reason, email, TENANT, ev.id),
        ],
        'finance_docking', ev.id, 'DOCKING_EVENT_QUARANTINED', { reason },
      );
      return erpReply({ success: true, id: ev.id, status: 'dead_letter' });
    }

    return erpReply({ success: false, message: 'Action docking bridge tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
