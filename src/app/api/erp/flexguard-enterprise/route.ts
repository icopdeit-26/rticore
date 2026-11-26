import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText, erpDate } from '@/lib/erp-core';
import {
  FLEXGUARD_DEFAULT_PACKAGES,
  FLEXGUARD_CONVERSION_TIERS,
  calculateFlexGuardConsumedCredits,
  computeFlexGuardWalletBalance,
  validateFlexGuardTransition,
  buildFlexGuardAccountingPlan,
  evaluateFlexGuardRenewalSignals,
  type FlexGuardEnterpriseTxType,
  type FlexGuardLedgerEntry,
  type FlexGuardRequestStatus,
} from '@/lib/flexguard-enterprise';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager', 'offense_lead', 'defense_leader', 'governance_leader'];

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

async function requireEntity(identity: BoQIdentity, entityId: string): Promise<void> {
  erpAssert((await authorizedEntities(identity)).includes(entityId), 'Akses legal entity FlexGuard ditolak', 403);
}

async function loadWalletBalance(identity: BoQIdentity, legalEntityId: string, walletId: string) {
  const [txRows, lotRows] = await Promise.all([
    identity.db.prepare('SELECT transaction_type, credit_amount, approval_status, financial_value_cents FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at, id')
      .bind(TENANT, legalEntityId, walletId).all<FlexGuardLedgerEntry>(),
    identity.db.prepare("SELECT coalesce(max(overdraft_limit_credits),0) AS overdraft_limit, coalesce(sum(CASE WHEN status='active' AND expires_at <= date('now','+60 days') THEN credits_total ELSE 0 END),0) AS expiring_credits FROM rticore_flexguard_credit_lots WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=?")
      .bind(TENANT, legalEntityId, walletId).first<{ overdraft_limit: number; expiring_credits: number }>(),
  ]);
  return computeFlexGuardWalletBalance(txRows.results, {
    overdraftLimitCredits: Number(lotRows?.overdraft_limit || 0),
    expiringCredits: Number(lotRows?.expiring_credits || 0),
  });
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(STAFF_ROLES.includes(role), 'Hak akses FlexGuard Enterprise ditolak', 403);
    const url = new URL(req.url);
    const requestedEntity = url.searchParams.get('legal_entity_id');
    const walletId = url.searchParams.get('wallet_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [packages, conversions, lots, ledger, requests, slaEvents] = await Promise.all([
      db.prepare('SELECT * FROM rticore_flexguard_packages WHERE tenant_id=? AND legal_entity_id=? ORDER BY credits_included, package_code LIMIT 100').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_flexguard_conversion_matrix WHERE tenant_id=? AND legal_entity_id=? ORDER BY contract_id, contract_version DESC LIMIT 200').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_flexguard_credit_lots WHERE tenant_id=? AND legal_entity_id=? ORDER BY expires_at ASC LIMIT 200').bind(TENANT, legalEntityId).all(),
      walletId
        ? db.prepare('SELECT * FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC LIMIT 300').bind(TENANT, legalEntityId, walletId).all<FlexGuardLedgerEntry & Record<string, unknown>>()
        : db.prepare('SELECT * FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 300').bind(TENANT, legalEntityId).all<FlexGuardLedgerEntry & Record<string, unknown>>(),
      db.prepare('SELECT * FROM rticore_flexguard_service_requests WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_flexguard_sla_events WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all(),
    ]);

    const balance = walletId ? await loadWalletBalance(a.identity, legalEntityId, walletId) : null;
    const renewal = balance ? evaluateFlexGuardRenewalSignals(balance, 45) : null;

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      authorized_entities: entities,
      reference: { default_packages: FLEXGUARD_DEFAULT_PACKAGES, conversion_tiers: FLEXGUARD_CONVERSION_TIERS },
      packages: packages.results,
      conversion_matrix: conversions.results,
      credit_lots: lots.results,
      ledger: ledger.results,
      service_requests: requests.results,
      sla_events: slaEvents.results,
      wallet_balance: balance,
      renewal_signals: renewal,
    });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role, email } = a.identity;
  try {
    erpOrigin(req);
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah FlexGuard Enterprise', 403);
    const v = (await readBoundedJSON(req, 32000)) as Record<string, unknown>;
    const action = String(v.action || '');

    // 1. Package Builder
    if (action === 'create_package') {
      erpAssert(['admin', 'finance', 'presales'].includes(role), 'Hanya Admin, Finance, atau Presales yang dapat membuat paket FlexGuard', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.package_code, 3, 48) && erpText(v.package_name, 3, 160), 'Data paket wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const credits = Number(v.credits_included);
      const unitPrice = Number(v.unit_credit_price_cents);
      const pkgPrice = Number(v.package_price_cents || credits * unitPrice);
      erpAssert(Number.isSafeInteger(credits) && credits > 0 && Number.isSafeInteger(unitPrice) && unitPrice > 0, 'Credits dan harga paket wajib positif');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_flexguard_packages(
              id,tenant_id,legal_entity_id,package_code,package_name,billing_model,credit_pool_mode,
              credits_included,unit_credit_price_cents,package_price_cents,validity_days,
              carry_forward_allowed,carry_forward_max_bps,emergency_reserve_credits,overdraft_limit_credits,
              sla_ack_hours,sla_mobilize_hours,sla_delivery_hours,eligible_services_json,version,status,created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, String(v.package_code).trim(), String(v.package_name).trim(),
            String(v.billing_model || 'prepaid_mandays'), String(v.credit_pool_mode || 'shared_pool'),
            credits, unitPrice, pkgPrice, Number(v.validity_days || 365),
            v.carry_forward_allowed ? 1 : 0, Number(v.carry_forward_max_bps || 0),
            Number(v.emergency_reserve_credits || 0), Number(v.overdraft_limit_credits || 0),
            Number(v.sla_ack_hours || 4), Number(v.sla_mobilize_hours || 24), Number(v.sla_delivery_hours || 120),
            JSON.stringify(Array.isArray(v.eligible_services) ? v.eligible_services : []),
            Number(v.version || 1), email,
          ),
        ],
        'flexguard_enterprise',
        id,
        'FG_PACKAGE_CREATED',
        { package_code: v.package_code, credits_included: credits },
      );
      return erpReply({ success: true, id, status: 'draft' }, 201);
    }

    if (action === 'approve_package') {
      erpAssert(['admin', 'approver'].includes(role), 'Hanya Admin atau Approver independen yang dapat menyetujui paket', 403);
      erpAssert(erpId(v.package_id) && erpText(v.approval_notes, 12, 500), 'package_id dan approval_notes minimal 12 karakter wajib');
      const pkg = await db.prepare('SELECT id, legal_entity_id, created_by, status FROM rticore_flexguard_packages WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.package_id as string).first<{ id: string; legal_entity_id: string; created_by: string; status: string }>();
      erpAssert(pkg, 'Paket tidak ditemukan', 404);
      await requireEntity(a.identity, pkg.legal_entity_id);
      erpAssert(pkg.created_by.toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui paket sendiri (SoD)', 403);
      await erpAtom(
        a.identity, '1=1', [],
        [db.prepare("UPDATE rticore_flexguard_packages SET status='approved', approved_by=?, approval_notes=? WHERE tenant_id=? AND id=? AND status='draft' AND lower(created_by)!=?").bind(email, String(v.approval_notes).trim(), TENANT, pkg.id, email.toLowerCase())],
        'flexguard_enterprise', pkg.id, 'FG_PACKAGE_APPROVED', { legal_entity_id: pkg.legal_entity_id },
      );
      return erpReply({ success: true, id: pkg.id, status: 'approved' });
    }

    // 2. Versioned Service Credit Conversion Matrix
    if (action === 'upsert_conversion_rule') {
      erpAssert(['admin', 'finance', 'presales'].includes(role), 'Hak akses ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpId(v.contract_id), 'legal_entity_id dan contract_id wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const tier = String(v.service_tier || 'standard_analyst');
      const multBps = Number(v.multiplier_bps || 10000);
      const contractVersion = Number(v.contract_version || 1);
      const effFrom = String(v.effective_from || new Date().toISOString().slice(0, 10));
      erpAssert(erpDate(effFrom) && Number.isSafeInteger(multBps) && multBps >= 5000 && multBps <= 50000, 'Multiplier atau effective_from tidak valid');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_flexguard_conversion_matrix(id,tenant_id,legal_entity_id,contract_id,contract_version,service_tier,service_category,multiplier_bps,effective_from,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,'active',?)`,
          ).bind(id, TENANT, v.legal_entity_id as string, v.contract_id as string, contractVersion, tier, typeof v.service_category === 'string' ? v.service_category : null, multBps, effFrom, email),
        ],
        'flexguard_enterprise', id, 'FG_CONVERSION_SAVED', { contract_id: v.contract_id, contract_version: contractVersion, service_tier: tier, multiplier_bps: multBps },
      );
      return erpReply({ success: true, id, contract_version: contractVersion, multiplier_bps: multBps }, 201);
    }

    // 3. Immutable Ledger Posting (All 12 Types + Credit Lots + Finance Docking Outbox)
    if (action === 'post_ledger_tx') {
      erpAssert(erpId(v.legal_entity_id) && erpId(v.customer_id) && erpId(v.contract_id) && erpId(v.wallet_id), 'Identitas legal_entity, customer, contract, dan wallet wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const legalEntityId = v.legal_entity_id as string;
      const txType = String(v.transaction_type || '') as FlexGuardEnterpriseTxType;
      const creditAmount = Number(v.credit_amount);
      const idempKey = String(v.idempotency_key || '');
      const reason = String(v.reason || '');
      erpAssert(Number.isSafeInteger(creditAmount) && creditAmount !== 0, 'credit_amount wajib integer bukan nol');
      erpAssert(idempKey.length >= 12 && idempKey.length <= 128 && reason.length >= 12, 'idempotency_key (>=12) dan reason (>=12) wajib');

      // Role checks per transaction type
      if (['initial_allocation', 'purchase', 'top_up', 'refund', 'expiry', 'adjustment', 'reversal', 'carry_forward'].includes(txType)) {
        erpAssert(['admin', 'finance'].includes(role), `Transaksi '${txType}' hanya diizinkan untuk Finance/Admin`, 403);
      } else {
        erpAssert(['admin', 'finance', 'sales', 'presales', 'project_manager'].includes(role), `Transaksi '${txType}' ditolak untuk role ${role}`, 403);
      }

      // Expiry revenue policy guard (Section 7.10)
      if (txType === 'expiry' && v.recognize_breakage_revenue === true) {
        erpAssert(v.finance_breakage_policy_approved === true, 'FLEXGUARD_EXPIRY_REVENUE_POLICY_REQUIRED: Unused expired credits cannot be auto-recognized as revenue without approved Finance PSAK 115 breakage analysis', 409);
        buildFlexGuardAccountingPlan('flexguard.credit_expired', Math.max(1, Number(v.financial_value_cents || 1)), {
          financeBreakagePolicyApproved: true,
        });
      }

      // Compute current balance before mutating (concurrency + overdraft guard)
      const currentBalance = await loadWalletBalance(a.identity, legalEntityId, v.wallet_id as string);
      const effectiveOverdraft = Number(v.overdraft_limit_credits ?? currentBalance.overdraftLimitCredits ?? 0);
      if (txType === 'reservation') {
        erpAssert(creditAmount > 0, 'Reservation wajib positif');
        erpAssert(currentBalance.availableCredits - creditAmount >= -effectiveOverdraft, 'FLEXGUARD_INSUFFICIENT_BALANCE: Saldo kredit tidak mencukupi untuk reservasi', 409);
      }
      if (txType === 'consumption') {
        erpAssert(creditAmount > 0, 'Consumption wajib positif');
        erpAssert(currentBalance.reservedCredits >= creditAmount || currentBalance.availableCredits >= creditAmount, 'FLEXGUARD_INSUFFICIENT_RESERVED: Reservasi atau saldo kredit tidak mencukupi', 409);
      }
      if (txType === 'expiry' || txType === 'refund') {
        erpAssert(creditAmount > 0 && currentBalance.availableCredits >= creditAmount, 'Saldo tersedia tidak mencukupi untuk expiry/refund', 409);
      }

      const txId = crypto.randomUUID();
      const approvalStatus = txType === 'adjustment' ? 'pending_approval' : 'posted';
      const finValCents = Math.max(0, Number(v.financial_value_cents || 0));
      const writes = [];

      // Create credit lot on allocation/purchase/top_up/carry_forward
      let lotId: string | null = null;
      if (['initial_allocation', 'purchase', 'top_up', 'carry_forward'].includes(txType)) {
        lotId = crypto.randomUUID();
        const issuedAt = String(v.issued_at || new Date().toISOString().slice(0, 10));
        const expiresAt = String(v.expires_at || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
        erpAssert(erpDate(issuedAt) && erpDate(expiresAt), 'Tanggal issued_at / expires_at tidak valid');
        writes.push(
          db.prepare(
            `INSERT INTO rticore_flexguard_credit_lots(id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_code,lot_kind,credits_total,unit_value_cents,overdraft_limit_credits,carry_forward_cap_credits,issued_at,expires_at,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`,
          ).bind(
            lotId, TENANT, legalEntityId, v.customer_id as string, v.contract_id as string, v.wallet_id as string,
            `LOT-${txId.slice(0, 8).toUpperCase()}`, txType, Math.abs(creditAmount),
            Math.max(100, Number(v.unit_value_cents || (finValCents > 0 ? Math.round(finValCents / Math.abs(creditAmount)) : 450_000_000))),
            effectiveOverdraft, Number(v.carry_forward_cap_credits || 0), issuedAt, expiresAt, email,
          ),
        );
      }

      // Emit Finance Docking Outbox event (Section 7.10) when financial value > 0
      let outboxEventId: string | null = null;
      if (finValCents > 0 && ['purchase', 'top_up', 'consumption'].includes(txType)) {
        const plan = buildFlexGuardAccountingPlan(
          txType === 'consumption' ? 'flexguard.credit_consumed' : 'flexguard.invoice_issued',
          finValCents,
        );
        outboxEventId = crypto.randomUUID();
        writes.push(
          db.prepare(
            `INSERT INTO rticore_finance_integration_events(
              id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,
              correlation_id,idempotency_key,schema_version,payload_json,payload_sha256,status,event_timestamp
            ) VALUES(?,?,?,'outbox',?,'RTICORE',?,?,?,'1.0',?,?,'received',CURRENT_TIMESTAMP)`,
          ).bind(
            outboxEventId, TENANT, legalEntityId,
            txType === 'consumption' ? 'flexguard.credit_consumed' : 'flexguard.credit_purchased',
            txId, `FG-${txId.slice(0, 12)}`, `fg-dock-${idempKey}`,
            JSON.stringify({ wallet_id: v.wallet_id, customer_id: v.customer_id, credits: Math.abs(creditAmount), accounting: plan }),
            idempKey.replace(/[^a-f0-9]/gi, '0').padEnd(64, 'a').slice(0, 64),
          ),
        );
      }

      writes.push(
        db.prepare(
          `INSERT INTO rticore_flexguard_enterprise_ledger(
            id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_id,service_request_id,
            transaction_type,credit_amount,actual_mandays_tenths,billable_mandays_tenths,multiplier_bps,
            financial_value_cents,source_tx_id,reference_code,idempotency_key,actor_email,
            approval_status,reason,finance_outbox_event_id
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          txId, TENANT, legalEntityId, v.customer_id as string, v.contract_id as string, v.wallet_id as string,
          lotId, typeof v.service_request_id === 'string' ? v.service_request_id : null,
          txType, creditAmount, Number(v.actual_mandays_tenths || 0), Number(v.billable_mandays_tenths || 0),
          Number(v.multiplier_bps || 10000), finValCents,
          typeof v.source_tx_id === 'string' ? v.source_tx_id : null,
          String(v.reference_code || `REF-${txId.slice(0, 8)}`), idempKey, email, approvalStatus, reason, outboxEventId,
        ),
      );

      await erpAtom(a.identity, '1=1', [], writes, 'flexguard_enterprise', txId, `FG_LEDGER_${txType.toUpperCase()}`, {
        wallet_id: v.wallet_id, credit_amount: creditAmount, approval_status: approvalStatus, finance_outbox_event_id: outboxEventId,
      });

      const updatedBalance = await loadWalletBalance(a.identity, legalEntityId, v.wallet_id as string);
      return erpReply({ success: true, id: txId, approval_status: approvalStatus, finance_outbox_event_id: outboxEventId, balance: updatedBalance }, 201);
    }

    // 4. Maker-Checker Adjustment Approval (Section 7.4 & 10.4)
    if (action === 'approve_adjustment') {
      erpAssert(['admin', 'approver'].includes(role), 'Hanya Admin atau Approver independen yang dapat menyetujui adjustment FlexGuard', 403);
      erpAssert(erpId(v.tx_id), 'tx_id wajib');
      const tx = await db.prepare('SELECT id, legal_entity_id, wallet_id, actor_email, approval_status, transaction_type FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.tx_id as string).first<{ id: string; legal_entity_id: string; wallet_id: string; actor_email: string; approval_status: string; transaction_type: string }>();
      erpAssert(tx, 'Transaksi adjustment tidak ditemukan', 404);
      await requireEntity(a.identity, tx.legal_entity_id);
      erpAssert(tx.transaction_type === 'adjustment' && tx.approval_status === 'pending_approval', 'Transaksi bukan adjustment pending', 409);
      erpAssert(tx.actor_email.toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui adjustment FlexGuard sendiri (SoD)', 403);
      await erpAtom(
        a.identity, '1=1', [],
        [db.prepare("UPDATE rticore_flexguard_enterprise_ledger SET approval_status='posted', approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND approval_status='pending_approval' AND lower(actor_email)!=?").bind(email, TENANT, tx.id, email.toLowerCase())],
        'flexguard_enterprise', tx.id, 'FG_ADJUSTMENT_APPROVED', { wallet_id: tx.wallet_id },
      );
      return erpReply({ success: true, id: tx.id, approval_status: 'posted' });
    }

    // 5. 14-Step FlexGuard Service Request Lifecycle (Section 7.6)
    if (action === 'create_service_request') {
      erpAssert(STAFF_ROLES.includes(role), 'Hak akses ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpId(v.customer_id) && erpId(v.contract_id) && erpId(v.wallet_id), 'Identitas wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      erpAssert(erpText(v.title, 5, 200) && erpText(v.scope_description, 12, 3000), 'Judul dan deskripsi scope wajib');
      const id = crypto.randomUUID();
      const reqNum = String(v.request_number || `FGSR-${id.slice(0, 8).toUpperCase()}`);
      const isEmergency = v.emergency_flag === true || v.emergency_flag === 1 ? 1 : 0;
      const tier = isEmergency ? 'emergency_response' : String(v.service_tier || 'standard_analyst');
      const contractVersion = Number(v.contract_version || 1);

      // Look up contractual multiplier for this contract version
      const conv = await db.prepare("SELECT multiplier_bps FROM rticore_flexguard_conversion_matrix WHERE tenant_id=? AND contract_id=? AND contract_version=? AND service_tier=? AND status='active'")
        .bind(TENANT, v.contract_id as string, contractVersion, tier).first<{ multiplier_bps: number }>();
      const multBps = conv?.multiplier_bps ?? (FLEXGUARD_CONVERSION_TIERS[tier as keyof typeof FLEXGUARD_CONVERSION_TIERS]?.defaultMultiplierBps ?? 10000);

      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_flexguard_service_requests(
              id,tenant_id,legal_entity_id,customer_id,contract_id,contract_version,wallet_id,request_number,
              service_category,service_tier,title,scope_description,emergency_flag,priority,status,multiplier_bps,
              requested_by,updated_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, v.customer_id as string, v.contract_id as string, contractVersion,
            v.wallet_id as string, reqNum, String(v.service_category || 'web_app_pentest'), tier,
            String(v.title).trim(), String(v.scope_description).trim(), isEmergency,
            isEmergency ? 'emergency' : String(v.priority || 'normal'), multBps, email, email,
          ),
        ],
        'flexguard_enterprise', id, 'FG_SR_CREATED', { request_number: reqNum, emergency_flag: isEmergency, multiplier_bps: multBps },
      );
      return erpReply({ success: true, id, request_number: reqNum, status: 'submitted', multiplier_bps: multBps }, 201);
    }

    if (action === 'transition_service_request') {
      erpAssert(STAFF_ROLES.includes(role), 'Hak akses ditolak', 403);
      erpAssert(erpId(v.request_id), 'request_id wajib');
      const sr = await db.prepare('SELECT * FROM rticore_flexguard_service_requests WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.request_id as string).first<Record<string, unknown>>();
      erpAssert(sr, 'Service request tidak ditemukan', 404);
      await requireEntity(a.identity, String(sr.legal_entity_id));

      const nextStatus = String(v.next_status || '') as FlexGuardRequestStatus;
      const actualMdTenths = v.actual_mandays_tenths !== undefined ? Number(v.actual_mandays_tenths) : Number(sr.actual_mandays_tenths || 0);
      const multBps = Number(sr.multiplier_bps || 10000);
      let consumedCredits = Number(sr.consumed_credits || 0);
      let internalCostCents = Number(sr.internal_cost_cents || 0);

      if (nextStatus === 'consumed' && actualMdTenths > 0) {
        const calc = calculateFlexGuardConsumedCredits({
          approvedActualMandaysTenths: actualMdTenths,
          contractualMultiplierBps: multBps,
          creditUnitValueCents: Number(v.credit_unit_value_cents || 450_000_000),
          internalCostRatePerMandayCents: Number(v.internal_cost_rate_cents || 1_800_000_00),
        });
        consumedCredits = calc.consumedCredits;
        internalCostCents = calc.directServiceCostCents;
      }

      const check = validateFlexGuardTransition(String(sr.status) as FlexGuardRequestStatus, nextStatus, {
        reservedCredits: Number(sr.reserved_credits || 0),
        plannedConsumptionCredits: consumedCredits,
        additionalCreditsApproved: Boolean(sr.additional_credits_approved_by || v.additional_credits_approved_by),
      });
      erpAssert(check.ok, check.ok ? '' : check.reason, 409);

      const estMd = v.estimated_mandays_tenths !== undefined ? Number(v.estimated_mandays_tenths) : Number(sr.estimated_mandays_tenths || 0);
      const estCredits = v.estimated_credits !== undefined ? Number(v.estimated_credits) : Number(sr.estimated_credits || 0);
      const resCredits = v.reserved_credits !== undefined ? Number(v.reserved_credits) : Number(sr.reserved_credits || 0);

      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `UPDATE rticore_flexguard_service_requests SET
              status=?, estimated_mandays_tenths=?, estimated_credits=?, reserved_credits=?,
              assigned_resource_email=coalesce(?, assigned_resource_email),
              actual_mandays_tenths=?, consumed_credits=?, internal_cost_cents=?,
              additional_credits_approved_by=coalesce(?, additional_credits_approved_by),
              deliverable_document_id=coalesce(?, deliverable_document_id),
              customer_accepted_by=CASE WHEN ?='customer_accepted' THEN ? ELSE customer_accepted_by END,
              customer_accepted_at=CASE WHEN ?='customer_accepted' THEN CURRENT_TIMESTAMP ELSE customer_accepted_at END,
              version=version+1, updated_by=?, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND id=? AND version=?`,
          ).bind(
            nextStatus, estMd, estCredits, resCredits,
            typeof v.assigned_resource_email === 'string' ? v.assigned_resource_email : null,
            actualMdTenths, consumedCredits, internalCostCents,
            typeof v.additional_credits_approved_by === 'string' ? v.additional_credits_approved_by : null,
            typeof v.deliverable_document_id === 'string' ? v.deliverable_document_id : null,
            nextStatus, email, nextStatus, email, TENANT, String(sr.id), Number(sr.version),
          ),
        ],
        'flexguard_enterprise', String(sr.id), `FG_SR_${nextStatus.toUpperCase()}`,
        { from: sr.status, to: nextStatus, consumed_credits: consumedCredits },
      );
      return erpReply({ success: true, id: sr.id, status: nextStatus, consumed_credits: consumedCredits });
    }

    // 6. SLA Event Recording (Section 7.8)
    if (action === 'record_sla_event') {
      erpAssert(STAFF_ROLES.includes(role), 'Hak akses ditolak', 403);
      erpAssert(erpId(v.service_request_id) && erpText(v.notes, 8, 1000), 'service_request_id dan notes wajib');
      const sr = await db.prepare('SELECT id, legal_entity_id FROM rticore_flexguard_service_requests WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.service_request_id as string).first<{ id: string; legal_entity_id: string }>();
      erpAssert(sr, 'Service request tidak ditemukan', 404);
      await requireEntity(a.identity, sr.legal_entity_id);
      const targetHrs = Number(v.target_hours);
      const actualHrsH = Number(v.actual_hours_hundredths);
      const breached = actualHrsH > targetHrs * 100 ? 1 : 0;
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_flexguard_sla_events(id,tenant_id,legal_entity_id,service_request_id,sla_stage,target_hours,actual_hours_hundredths,breached,escalated_to,remedy_credits,notes,recorded_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(
            id, TENANT, sr.legal_entity_id, sr.id, String(v.sla_stage || 'acknowledgment'),
            targetHrs, actualHrsH, breached, typeof v.escalated_to === 'string' ? v.escalated_to : null,
            Number(v.remedy_credits || 0), String(v.notes).trim(), email,
          ),
        ],
        'flexguard_enterprise', id, 'FG_SLA_RECORDED', { sla_stage: v.sla_stage, breached },
      );
      return erpReply({ success: true, id, breached: Boolean(breached) }, 201);
    }

    // 7. Customer Portal Grant Provisioning (Section 7.7)
    if (action === 'grant_portal_access') {
      erpAssert(['admin'].includes(role), 'Hanya Admin yang dapat memberikan akses Customer Portal', 403);
      erpAssert(erpId(v.legal_entity_id) && erpId(v.customer_id) && erpText(v.portal_email, 5, 160), 'Data akses portal wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("INSERT INTO rticore_flexguard_portal_grants(id,tenant_id,legal_entity_id,customer_id,portal_email,portal_role,active,created_by) VALUES(?,?,?,?,?,?,1,?)")
            .bind(id, TENANT, v.legal_entity_id as string, v.customer_id as string, String(v.portal_email).trim().toLowerCase(), String(v.portal_role || 'customer_user'), email),
        ],
        'flexguard_portal', id, 'FG_PORTAL_GRANTED', { customer_id: v.customer_id, portal_email: v.portal_email },
      );
      return erpReply({ success: true, id }, 201);
    }

    return erpReply({ success: false, message: 'Action FlexGuard Enterprise tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
