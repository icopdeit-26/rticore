import { authorizeBoQ, type D1DB } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText } from '@/lib/erp-core';
import {
  computeFlexGuardWalletBalance,
  sanitizeFlexGuardForCustomerPortal,
  type FlexGuardLedgerEntry,
} from '@/lib/flexguard-enterprise';

export const dynamic = 'force-dynamic';

/**
 * Section 7.7 FlexGuard Customer Portal API.
 * Strictly isolated to the customer's own authorized `customer_id` + `legal_entity_id`.
 * NEVER exposes internal cost rates, employee compensation, internal margins, or other customers' data.
 */
async function resolvePortalGrant(db: D1DB, email: string, requestedCustomerId?: string | null) {
  const grant = await db.prepare(
    'SELECT id, legal_entity_id, customer_id, portal_role FROM rticore_flexguard_portal_grants WHERE tenant_id=? AND lower(portal_email)=? AND active=1'
    + (requestedCustomerId ? ' AND customer_id=?' : '') + ' LIMIT 1',
  ).bind(TENANT, email.toLowerCase(), ...(requestedCustomerId ? [requestedCustomerId] : [])).first<{
    id: string; legal_entity_id: string; customer_id: string; portal_role: string;
  }>();
  return grant;
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, email } = a.identity;
  try {
    const requestedCustomerId = new URL(req.url).searchParams.get('customer_id');
    const grant = await resolvePortalGrant(db, email, requestedCustomerId);
    erpAssert(grant, 'Akses Customer Portal FlexGuard ditolak atau lintas pelanggan tidak diizinkan', 403);

    const [lots, ledger, requests] = await Promise.all([
      db.prepare('SELECT id, wallet_id, contract_id, lot_code, lot_kind, credits_total, issued_at, expires_at, status FROM rticore_flexguard_credit_lots WHERE tenant_id=? AND legal_entity_id=? AND customer_id=? ORDER BY expires_at ASC LIMIT 100')
        .bind(TENANT, grant.legal_entity_id, grant.customer_id).all(),
      db.prepare('SELECT id, wallet_id, contract_id, service_request_id, transaction_type, credit_amount, reference_code, approval_status, reason, created_at FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND legal_entity_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 200')
        .bind(TENANT, grant.legal_entity_id, grant.customer_id).all<FlexGuardLedgerEntry & Record<string, unknown>>(),
      db.prepare('SELECT id, request_number, service_category, service_tier, title, scope_description, priority, status, estimated_credits, reserved_credits, consumed_credits, deliverable_document_id, customer_accepted_at, created_at FROM rticore_flexguard_service_requests WHERE tenant_id=? AND legal_entity_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 100')
        .bind(TENANT, grant.legal_entity_id, grant.customer_id).all(),
    ]);

    const balance = computeFlexGuardWalletBalance(ledger.results);

    return erpReply(sanitizeFlexGuardForCustomerPortal({
      success: true,
      customer_id: grant.customer_id,
      portal_role: grant.portal_role,
      balance,
      credit_lots: lots.results,
      history: ledger.results,
      service_requests: requests.results,
      monthly_statement: {
        generated_at: new Date().toISOString(),
        customer_id: grant.customer_id,
        purchased_credits: balance.purchasedCredits,
        reserved_credits: balance.reservedCredits,
        consumed_credits: balance.consumedCredits,
        available_credits: balance.availableCredits,
        expired_credits: balance.expiredCredits,
      },
    }));
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, email } = a.identity;
  try {
    erpOrigin(req);
    const v = (await readBoundedJSON(req, 16000)) as Record<string, unknown>;
    const grant = await resolvePortalGrant(db, email, typeof v.customer_id === 'string' ? v.customer_id : null);
    erpAssert(grant, 'Akses Customer Portal FlexGuard ditolak', 403);
    const action = String(v.action || '');

    if (action === 'submit_service_request') {
      erpAssert(erpId(v.contract_id) && erpId(v.wallet_id) && erpText(v.title, 5, 200) && erpText(v.scope_description, 12, 3000), 'Kontrak, wallet, judul, dan scope wajib');
      const id = crypto.randomUUID();
      const reqNum = `PORTAL-${id.slice(0, 8).toUpperCase()}`;
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_flexguard_service_requests(
              id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,request_number,
              service_category,service_tier,title,scope_description,emergency_flag,priority,status,requested_by,updated_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?)`,
          ).bind(
            id, TENANT, grant.legal_entity_id, grant.customer_id, v.contract_id as string, v.wallet_id as string,
            reqNum, String(v.service_category || 'web_app_pentest'), String(v.service_tier || 'standard_analyst'),
            String(v.title).trim(), String(v.scope_description).trim(), v.emergency_flag ? 1 : 0,
            v.emergency_flag ? 'emergency' : 'normal', email, email,
          ),
        ],
        'flexguard_portal', id, 'PORTAL_SR_SUBMITTED', { customer_id: grant.customer_id, request_number: reqNum },
      );
      return erpReply({ success: true, id, request_number: reqNum, status: 'submitted' }, 201);
    }

    if (action === 'approve_scope' || action === 'accept_delivery') {
      erpAssert(erpId(v.request_id), 'request_id wajib');
      const sr = await db.prepare('SELECT id, customer_id, legal_entity_id, status, version FROM rticore_flexguard_service_requests WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.request_id as string).first<{ id: string; customer_id: string; legal_entity_id: string; status: string; version: number }>();
      erpAssert(sr && sr.customer_id === grant.customer_id && sr.legal_entity_id === grant.legal_entity_id, 'Service request bukan milik pelanggan ini', 403);
      const expected = action === 'approve_scope' ? 'credit_quoted' : 'qa_passed';
      const target = action === 'approve_scope' ? 'customer_approved' : 'customer_accepted';
      erpAssert(sr.status === expected, `Status saat ini '${sr.status}' tidak dapat diubah ke '${target}'`, 409);

      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("UPDATE rticore_flexguard_service_requests SET status=?, customer_accepted_by=CASE WHEN ?='customer_accepted' THEN ? ELSE customer_accepted_by END, customer_accepted_at=CASE WHEN ?='customer_accepted' THEN CURRENT_TIMESTAMP ELSE customer_accepted_at END, version=version+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND version=?")
            .bind(target, target, email, target, email, TENANT, sr.id, sr.version),
        ],
        'flexguard_portal', sr.id, action === 'approve_scope' ? 'PORTAL_SCOPE_APPROVED' : 'PORTAL_DELIVERY_ACCEPTED',
        { customer_id: grant.customer_id },
      );
      return erpReply({ success: true, id: sr.id, status: target });
    }

    return erpReply({ success: false, message: 'Action Customer Portal tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
