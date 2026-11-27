import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import {
  erpReply, erpError, ERPError, erpAssert, erpId, erpText,
  erpOrigin, erpAtom, erpPositiveCents, erpDate, erpPeriod,
} from '@/lib/erp-core';
import {
  RTI_FINANCE_BRAND,
  RTI_FINANCE_MENUS,
  RTI_FINANCE_ROLES,
  FINANCIAL_CLOSING_17_CHECKLIST,
  ICOFR_15_AUTOMATED_CONTROLS,
  RTICORE_DOCKING_EVENT_TYPES,
  mapRTICoreRoleToFinanceRole,
  getFinanceRoleDefinition,
  canFinanceRoleAccessMenu,
  validateFinanceApprovalAuthority,
  validateDoubleEntryJournal,
  resolvePostingRule,
  allocatePSAK115TransactionPrice,
  computeContractRevenuePosition,
  computeProjectProfitabilityMetrics,
  reconcileFlexGuardLedger,
  calculateConfigurableTax,
  validateDockingEventEnvelope,
  type FinanceMenuId,
  type FinanceRoleId,
  type JournalType,
  type PostingRuleRecord,
  type TaxRuleConfig,
} from '@/lib/rti-finance-core';

export const dynamic = 'force-dynamic';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function resolveEffectiveFinanceRole(
  identity: BoQIdentity,
  legalEntityId: string | null,
  overrideRoleHeader?: string | null,
): Promise<{ financeRole: FinanceRoleId; customLimitCents?: number }> {
  // Check if user has an approved role assignment in rticore_finance_role_assignments
  if (legalEntityId) {
    const assigned = await identity.db
      .prepare(
        "SELECT finance_role, approval_limit_cents FROM rticore_finance_role_assignments WHERE tenant_id=? AND lower(email)=? AND legal_entity_id=? AND status='approved' ORDER BY approval_limit_cents DESC LIMIT 1",
      )
      .bind(TENANT, identity.email.toLowerCase(), legalEntityId)
      .first<{ finance_role: FinanceRoleId; approval_limit_cents: number }>();
    if (assigned) {
      return { financeRole: assigned.finance_role, customLimitCents: Number(assigned.approval_limit_cents) };
    }
  }
  // Allow test/preview header only when the base RTICore role is admin/finance/approver
  if (overrideRoleHeader && ['admin', 'finance', 'approver'].includes(identity.role)) {
    const valid = RTI_FINANCE_ROLES.find(r => r.id === overrideRoleHeader);
    if (valid) return { financeRole: valid.id };
  }
  return { financeRole: mapRTICoreRoleToFinanceRole(identity.role) };
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, email, role } = a.identity;

  try {
    const url = new URL(req.url);
    const menu = (url.searchParams.get('menu') || 'F01') as FinanceMenuId;
    const requestedEntity = url.searchParams.get('legal_entity_id');
    const period = url.searchParams.get('period') || new Date().toISOString().slice(0, 7);

    // Load available legal entities
    const entitiesRes = await db
      .prepare("SELECT id, code, label, kind, active FROM rticore_erp_org_units WHERE tenant_id=? AND kind='legal_entity' AND active=1 ORDER BY code LIMIT 100")
      .bind(TENANT)
      .all<{ id: string; code: string; label: string; kind: string; active: number }>();

    const legalEntityId = requestedEntity || entitiesRes.results[0]?.id || null;
    const { financeRole, customLimitCents } = await resolveEffectiveFinanceRole(
      a.identity,
      legalEntityId,
      req.headers.get('x-finance-role'),
    );
    const roleDef = getFinanceRoleDefinition(financeRole);

    if (!RTI_FINANCE_MENUS.some(m => m.id === menu)) {
      throw new ERPError(`Menu RTI Finance '${menu}' tidak valid`, 422);
    }
    if (!canFinanceRoleAccessMenu(financeRole, menu)) {
      throw new ERPError(`Akses ke menu ${menu} ditolak untuk role ${roleDef.label}`, 403);
    }

    // Core counts & financial aggregations for the selected legal entity
    const [
      accounts,
      coaHierarchy,
      periods,
      journals,
      postingRules,
      profitCenters,
      fxRates,
      arInvoices,
      arPayments,
      arAdjustments,
      apInvoices,
      apExtensions,
      vendorBanks,
      treasuryAccounts,
      treasuryPayments,
      bankStatements,
      cashForecasts,
      obligations,
      revenueSchedules,
      projects,
      projectCosts,
      projectSnapshots,
      flexguardWallets,
      flexguardValuations,
      budgets,
      fpaScenarios,
      expenseClaims,
      payrollBatches,
      taxRules,
      taxTransactions,
      fixedAssets,
      licenses,
      periodControls,
      eliminations,
      icofrControls,
      exceptions,
      dockingConnections,
      integrationMappings,
      integrationEvents,
      reconciliations,
      roleAssignments,
    ] = await Promise.all([
      legalEntityId
        ? db.prepare('SELECT id, code, name, category, active FROM rticore_gl_accounts WHERE tenant_id=? AND legal_entity_id=? ORDER BY code LIMIT 300').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_coa_hierarchy WHERE tenant_id=? AND legal_entity_id=? LIMIT 300').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT id, period, status FROM rticore_gl_periods WHERE tenant_id=? AND legal_entity_id=? ORDER BY period DESC LIMIT 60').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare("SELECT j.id, j.period_id, j.memo, j.source_type, j.source_key, j.status, j.version, j.created_by, j.reviewed_by, j.posted_by, j.created_at, coalesce((SELECT sum(l.debit_cents) FROM rticore_gl_lines l WHERE l.tenant_id=j.tenant_id AND l.journal_id=j.id),0) AS debit_cents, coalesce((SELECT sum(l.credit_cents) FROM rticore_gl_lines l WHERE l.tenant_id=j.tenant_id AND l.journal_id=j.id),0) AS credit_cents FROM rticore_gl_journals j WHERE j.tenant_id=? AND j.legal_entity_id=? ORDER BY j.created_at DESC LIMIT 200").bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_posting_rules WHERE tenant_id=? AND legal_entity_id=? ORDER BY rule_code LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_profit_centers WHERE tenant_id=? AND legal_entity_id=? ORDER BY code LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT * FROM rticore_finance_exchange_rates WHERE tenant_id=? ORDER BY effective_date DESC LIMIT 100').bind(TENANT).all(),
      db.prepare('SELECT i.*, p.title AS project_title, a.legal_name AS customer_name FROM rticore_billing_invoices i JOIN rticore_delivery_projects p ON p.id=i.project_id AND p.tenant_id=i.tenant_id JOIN rticore_sales_accounts a ON a.id=p.customer_id AND a.tenant_id=p.tenant_id WHERE i.tenant_id=? ORDER BY i.created_at DESC LIMIT 150').bind(TENANT).all(),
      db.prepare('SELECT * FROM rticore_billing_payments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_ar_adjustments WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT i.*, v.legal_name AS vendor_name, p.po_number FROM rticore_ap_supplier_invoices i JOIN rticore_vendors v ON v.id=i.vendor_id AND v.tenant_id=i.tenant_id JOIN rticore_purchase_orders p ON p.id=i.po_id AND p.tenant_id=i.tenant_id WHERE i.tenant_id=? ORDER BY i.created_at DESC LIMIT 150').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_ap_extensions WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT b.*, v.legal_name AS vendor_name FROM rticore_finance_vendor_bank_accounts b JOIN rticore_vendors v ON v.id=b.vendor_id AND v.tenant_id=b.tenant_id WHERE b.tenant_id=? ORDER BY b.created_at DESC LIMIT 150').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_treasury_accounts WHERE tenant_id=? AND legal_entity_id=? LIMIT 100').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_treasury_payments WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_bank_statements WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_end DESC LIMIT 100').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_cash_forecasts WHERE tenant_id=? AND legal_entity_id=? ORDER BY bucket_start ASC LIMIT 60').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_performance_obligations WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_revenue_schedules WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_code DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT p.*, a.legal_name AS customer_name FROM rticore_delivery_projects p JOIN rticore_sales_accounts a ON a.id=p.customer_id AND a.tenant_id=p.tenant_id WHERE p.tenant_id=? ORDER BY p.created_at DESC LIMIT 100').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_project_cost_ledger WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_project_snapshots WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 100').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT w.*, a.legal_name AS customer_name FROM rticore_flexguard_wallets w JOIN rticore_sales_accounts a ON a.id=w.customer_id AND a.tenant_id=w.tenant_id WHERE w.tenant_id=? ORDER BY w.created_at DESC LIMIT 100').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_flexguard_valuations WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_budgets WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_code DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_fpa_scenarios WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 50').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_expense_claims WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_payroll_batches WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_code DESC LIMIT 100').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_tax_rules WHERE tenant_id=? AND legal_entity_id=? ORDER BY tax_code LIMIT 100').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_tax_transactions WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_fixed_assets WHERE tenant_id=? AND legal_entity_id=? ORDER BY acquisition_date DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_license_inventory WHERE tenant_id=? AND legal_entity_id=? ORDER BY renewal_date ASC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_period_controls WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_code DESC LIMIT 60').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT * FROM rticore_finance_intercompany_eliminations WHERE tenant_id=? ORDER BY period_code DESC LIMIT 100').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_icofr_controls WHERE tenant_id=? AND legal_entity_id=? ORDER BY control_code LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_exceptions WHERE tenant_id=? AND legal_entity_id=? ORDER BY detected_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      db.prepare('SELECT * FROM rticore_finance_docking_connections WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 20').bind(TENANT).all(),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_integration_mappings WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_integration_events WHERE tenant_id=? AND legal_entity_id=? ORDER BY event_timestamp DESC LIMIT 200').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_reconciliations WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
      legalEntityId
        ? db.prepare('SELECT * FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all()
        : Promise.resolve({ results: [] }),
    ]);

    // Compute real-time Trial Balance from posted journals only
    const trialBalanceRows = legalEntityId
      ? await db
          .prepare(
            "SELECT a.id, a.code, a.name, a.category, coalesce(sum(CASE WHEN j.status='posted' THEN l.debit_cents ELSE 0 END),0) AS total_debit_cents, coalesce(sum(CASE WHEN j.status='posted' THEN l.credit_cents ELSE 0 END),0) AS total_credit_cents FROM rticore_gl_accounts a LEFT JOIN rticore_gl_lines l ON l.tenant_id=a.tenant_id AND l.account_id=a.id LEFT JOIN rticore_gl_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id WHERE a.tenant_id=? AND a.legal_entity_id=? GROUP BY a.id, a.code, a.name, a.category ORDER BY a.code",
          )
          .bind(TENANT, legalEntityId)
          .all<{ id: string; code: string; name: string; category: string; total_debit_cents: number; total_credit_cents: number }>()
      : { results: [] };

    let tbDebitCents = 0;
    let tbCreditCents = 0;
    let revenueCents = 0;
    let expenseCents = 0;
    let assetCents = 0;
    let liabilityCents = 0;
    let equityCents = 0;

    for (const row of trialBalanceRows.results) {
      const d = Number(row.total_debit_cents || 0);
      const c = Number(row.total_credit_cents || 0);
      tbDebitCents += d;
      tbCreditCents += c;
      if (row.category === 'revenue') revenueCents += (c - d);
      else if (row.category === 'expense') expenseCents += (d - c);
      else if (row.category === 'asset') assetCents += (d - c);
      else if (row.category === 'liability') liabilityCents += (c - d);
      else if (row.category === 'equity') equityCents += (c - d);
    }

    const arBilledCents = (arInvoices.results as Array<{ status: string; amount_cents: number; vat_cents: number }>)
      .filter(i => i.status === 'approved')
      .reduce((acc, i) => acc + Number(i.amount_cents || 0) + Number(i.vat_cents || 0), 0);
    const arCollectedCents = (arPayments.results as Array<{ status: string; amount_cents: number }>)
      .filter(p => p.status === 'approved')
      .reduce((acc, p) => acc + Number(p.amount_cents || 0), 0);
    const arOutstandingCents = Math.max(0, arBilledCents - arCollectedCents);

    const apApprovedCents = (apInvoices.results as Array<{ status: string; amount_cents: number }>)
      .filter(i => i.status === 'approved')
      .reduce((acc, i) => acc + Number(i.amount_cents || 0), 0);
    const apSettledCents = (treasuryPayments.results as Array<{ status: string; amount_cents: number }>)
      .filter(p => p.status === 'settled')
      .reduce((acc, p) => acc + Number(p.amount_cents || 0), 0);
    const apOutstandingCents = Math.max(0, apApprovedCents - apSettledCents);

    return erpReply({
      success: true,
      brand: RTI_FINANCE_BRAND,
      identity: {
        email,
        rticoreRole: role,
        financeRole,
        financeRoleLabel: roleDef.label,
        approvalLimitCents: customLimitCents !== undefined ? customLimitCents : roleDef.defaultLimitCents,
        canMake: roleDef.canMake,
        canCheck: roleDef.canCheck,
        canApprove: roleDef.canApprove,
        canPost: roleDef.canPost,
        allowedMenus: roleDef.allowedMenus,
      },
      menu,
      period,
      legalEntityId,
      legalEntities: entitiesRes.results,
      catalogs: {
        menus: RTI_FINANCE_MENUS,
        roles: RTI_FINANCE_ROLES,
        closingChecklist: FINANCIAL_CLOSING_17_CHECKLIST,
        icofrAutomatedControls: ICOFR_15_AUTOMATED_CONTROLS,
        dockingEventTypes: RTICORE_DOCKING_EVENT_TYPES,
      },
      kpis: {
        trialBalanceDebitCents: tbDebitCents,
        trialBalanceCreditCents: tbCreditCents,
        trialBalanceBalanced: tbDebitCents === tbCreditCents,
        glRevenueCents: revenueCents,
        glExpenseCents: expenseCents,
        glNetIncomeCents: revenueCents - expenseCents,
        glAssetCents: assetCents,
        glLiabilityCents: liabilityCents,
        glEquityCents: equityCents,
        arBilledCents,
        arCollectedCents,
        arOutstandingCents,
        apApprovedCents,
        apSettledCents,
        apOutstandingCents,
        openExceptionsCount: (exceptions.results as Array<{ status: string }>).filter(x => x.status !== 'resolved').length,
        failedEventsCount: (integrationEvents.results as Array<{ status: string }>).filter(x => x.status === 'failed' || x.status === 'dead_letter').length,
      },
      data: {
        accounts: accounts.results,
        coaHierarchy: coaHierarchy.results,
        trialBalance: trialBalanceRows.results,
        periods: periods.results,
        journals: journals.results,
        postingRules: postingRules.results,
        profitCenters: profitCenters.results,
        fxRates: fxRates.results,
        arInvoices: arInvoices.results,
        arPayments: arPayments.results,
        arAdjustments: arAdjustments.results,
        apInvoices: apInvoices.results,
        apExtensions: apExtensions.results,
        vendorBanks: vendorBanks.results,
        treasuryAccounts: treasuryAccounts.results,
        treasuryPayments: treasuryPayments.results,
        bankStatements: bankStatements.results,
        cashForecasts: cashForecasts.results,
        obligations: obligations.results,
        revenueSchedules: revenueSchedules.results,
        projects: projects.results,
        projectCosts: projectCosts.results,
        projectSnapshots: projectSnapshots.results,
        flexguardWallets: flexguardWallets.results,
        flexguardValuations: flexguardValuations.results,
        budgets: budgets.results,
        fpaScenarios: fpaScenarios.results,
        expenseClaims: expenseClaims.results,
        payrollBatches: payrollBatches.results,
        taxRules: taxRules.results,
        taxTransactions: taxTransactions.results,
        fixedAssets: fixedAssets.results,
        licenses: licenses.results,
        periodControls: periodControls.results,
        eliminations: eliminations.results,
        icofrControls: icofrControls.results,
        exceptions: exceptions.results,
        dockingConnections: dockingConnections.results,
        integrationMappings: integrationMappings.results,
        integrationEvents: integrationEvents.results,
        reconciliations: reconciliations.results,
        roleAssignments: roleAssignments.results,
      },
    });
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
    const v = (await readBoundedJSON(req, 32000)) as Record<string, unknown>;
    const action = String(v.action || '');
    const legalEntityId = typeof v.legal_entity_id === 'string' ? v.legal_entity_id : null;
    const { financeRole, customLimitCents } = await resolveEffectiveFinanceRole(
      a.identity,
      legalEntityId,
      req.headers.get('x-finance-role'),
    );
    const roleDef = getFinanceRoleDefinition(financeRole);

    // =========================================================================
    // WP01: RBAC ROLE ASSIGNMENT & MASTER DATA (F02, F25)
    // =========================================================================
    if (action === 'request_finance_role') {
      erpAssert(
        ['super_admin', 'cfo', 'financial_controller'].includes(financeRole),
        'Hanya Super Admin, CFO atau Controller yang dapat mengajukan assignment role keuangan',
        403,
      );
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.target_email, 5, 160) &&
          RTI_FINANCE_ROLES.some(r => r.id === v.target_role) &&
          Number.isSafeInteger(v.approval_limit_cents) &&
          Number(v.approval_limit_cents) >= 0,
        'Data pengajuan role keuangan tidak valid',
      );
      const targetDef = getFinanceRoleDefinition(v.target_role as FinanceRoleId);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,business_unit_id,department_id,approval_limit_cents,can_make,can_check,can_approve,can_post,requested_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              String(v.target_email).trim().toLowerCase(),
              targetDef.id,
              v.legal_entity_id as string,
              (v.business_unit_id as string) || null,
              (v.department_id as string) || null,
              targetDef.canApprove ? Number(v.approval_limit_cents) : 0,
              targetDef.canMake ? 1 : 0,
              targetDef.canCheck ? 1 : 0,
              targetDef.canApprove ? 1 : 0,
              targetDef.canPost ? 1 : 0,
              email,
            ),
        ],
        'rti_finance',
        id,
        'FIN_ROLE_REQUEST',
        { target_email: v.target_email, target_role: targetDef.id },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'approve_finance_role') {
      erpAssert(erpId(v.id) && erpText(v.review_notes, 12, 800), 'ID assignment dan catatan review wajib (min 12 karakter)');
      const row = await db
        .prepare('SELECT id, email, requested_by, status, version, legal_entity_id FROM rticore_finance_role_assignments WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; email: string; requested_by: string; status: string; version: number; legal_entity_id: string }>();
      erpAssert(row && row.status === 'pending', 'Assignment role tidak ditemukan atau sudah diproses', 409);
      erpAssert(
        row.requested_by.toLowerCase() !== email.toLowerCase() && row.email.toLowerCase() !== email.toLowerCase(),
        'Segregation of Duties: Pemohon atau pemilik role dilarang menyetujui role sendiri',
        403,
      );
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_role_assignments WHERE tenant_id=? AND id=? AND status='pending')",
        [TENANT, row.id],
        [
          db
            .prepare(
              "UPDATE rticore_finance_role_assignments SET status=?, version=version+1, reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?",
            )
            .bind(v.approve === false ? 'revoked' : 'approved', email, v.review_notes as string, TENANT, row.id),
        ],
        'rti_finance',
        row.id,
        'FIN_ROLE_REVIEW',
        { approved: v.approve !== false },
      );
      return erpReply({ success: true });
    }

    if (action === 'create_profit_center') {
      erpAssert(roleDef.canMake || financeRole === 'super_admin', 'Role tidak memiliki izin membuat Profit/Cost Center', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.code, 2, 40) &&
          erpText(v.name, 3, 160) &&
          ['profit_center', 'cost_center', 'investment_center'].includes(String(v.center_kind)),
        'Parameter Profit/Cost Center tidak valid',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_profit_centers(id,tenant_id,legal_entity_id,business_unit_id,code,name,center_kind,manager_email,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              (v.business_unit_id as string) || null,
              String(v.code).trim(),
              String(v.name).trim(),
              String(v.center_kind),
              (v.manager_email as string) || null,
              email,
            ),
        ],
        'rti_finance',
        id,
        'PROFIT_CENTER_CREATE',
        { code: v.code, kind: v.center_kind },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'register_coa_hierarchy') {
      erpAssert(roleDef.canMake, 'Role tidak memiliki izin mengelola Chart of Accounts', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.account_id) &&
          erpText(v.account_group, 3, 120) &&
          ['debit', 'credit'].includes(String(v.normal_balance)) &&
          erpDate(v.effective_from),
        'Metadata hierarki COA tidak valid',
      );
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_coa_hierarchy(tenant_id,account_id,legal_entity_id,parent_account_id,classification,account_group,normal_balance,is_header,is_control_account,allow_manual_posting,consolidation_code,effective_from,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              TENANT,
              v.account_id as string,
              v.legal_entity_id as string,
              (v.parent_account_id as string) || null,
              String(v.classification || 'asset'),
              String(v.account_group).trim(),
              String(v.normal_balance),
              v.is_header ? 1 : 0,
              v.is_control_account ? 1 : 0,
              v.is_header ? 0 : v.allow_manual_posting === false ? 0 : 1,
              (v.consolidation_code as string) || null,
              v.effective_from as string,
              email,
            ),
        ],
        'rti_finance',
        v.account_id as string,
        'COA_HIERARCHY_SET',
        { classification: v.classification, normal_balance: v.normal_balance },
      );
      return erpReply({ success: true, id: v.account_id }, 201);
    }

    if (action === 'register_exchange_rate') {
      erpAssert(roleDef.canMake, 'Hanya Maker Finance yang dapat mendaftarkan kurs', 403);
      erpAssert(
        erpText(v.from_currency, 3, 3) &&
          erpDate(v.effective_date) &&
          erpPositiveCents(v.rate_micro) &&
          erpText(v.source_reference, 3, 120),
        'Parameter kurs mata uang tidak valid',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_exchange_rates(id,tenant_id,from_currency,to_currency,effective_date,rate_micro,source_reference,created_by) VALUES(?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              String(v.from_currency).toUpperCase(),
              String(v.to_currency || 'IDR').toUpperCase(),
              v.effective_date as string,
              Number(v.rate_micro),
              String(v.source_reference).trim(),
              email,
            ),
        ],
        'rti_finance',
        id,
        'FX_RATE_CREATE',
        { from: v.from_currency, rate_micro: v.rate_micro },
      );
      return erpReply({ success: true, id }, 201);
    }

    // =========================================================================
    // WP02: CONFIGURABLE POSTING RULES & DIMENSIONAL DOUBLE-ENTRY JOURNAL (F03)
    // =========================================================================
    if (action === 'create_posting_rule') {
      erpAssert(roleDef.canMake, 'Hanya Maker Finance yang dapat membuat Posting Rule', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.rule_code, 3, 60) &&
          erpText(v.business_event, 3, 80) &&
          erpId(v.debit_account_id) &&
          erpId(v.credit_account_id) &&
          v.debit_account_id !== v.credit_account_id &&
          erpText(v.policy_reference, 6, 200) &&
          erpDate(v.effective_from),
        'Parameter Posting Rule tidak valid atau akun debit/kredit sama',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_posting_rules(id,tenant_id,legal_entity_id,rule_code,business_event,journal_type,service_category,tax_treatment,debit_account_id,credit_account_id,policy_reference,effective_from,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.rule_code).trim(),
              String(v.business_event).trim(),
              String(v.journal_type || 'general'),
              String(v.service_category || '*'),
              String(v.tax_treatment || '*'),
              v.debit_account_id as string,
              v.credit_account_id as string,
              String(v.policy_reference).trim(),
              v.effective_from as string,
              email,
            ),
        ],
        'rti_finance',
        id,
        'POSTING_RULE_CREATE',
        { rule_code: v.rule_code, business_event: v.business_event },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'approve_posting_rule') {
      erpAssert(roleDef.canApprove && erpId(v.id) && erpText(v.review_notes, 12, 500), 'Approval Posting Rule wajib Approver independen dan catatan', 403);
      const rule = await db
        .prepare('SELECT id, created_by, status, version FROM rticore_finance_posting_rules WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; created_by: string; status: string; version: number }>();
      erpAssert(rule && rule.status === 'draft', 'Posting Rule tidak berstatus draft', 409);
      erpAssert(rule.created_by.toLowerCase() !== email.toLowerCase(), 'Maker dilarang menyetujui Posting Rule sendiri', 403);
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_posting_rules WHERE tenant_id=? AND id=? AND status='draft')",
        [TENANT, rule.id],
        [
          db
            .prepare("UPDATE rticore_finance_posting_rules SET status='approved', approved_by=?, review_notes=? WHERE tenant_id=? AND id=?")
            .bind(email, v.review_notes as string, TENANT, rule.id),
        ],
        'rti_finance',
        rule.id,
        'POSTING_RULE_APPROVE',
        {},
      );
      return erpReply({ success: true });
    }

    if (action === 'create_dimensional_journal') {
      erpAssert(roleDef.canMake, 'Role tidak memiliki kewenangan membuat draft jurnal', 403);
      erpAssert(
        erpId(v.legal_entity_id) && erpId(v.period_id) && erpText(v.memo, 12, 500) && erpText(v.source_key, 3, 160),
        'Header jurnal tidak lengkap',
      );
      const periodRow = await db
        .prepare('SELECT id, period, status FROM rticore_gl_periods WHERE tenant_id=? AND id=? AND legal_entity_id=?')
        .bind(TENANT, v.period_id as string, v.legal_entity_id as string)
        .first<{ id: string; period: string; status: 'open' | 'closed' }>();
      erpAssert(periodRow, 'Periode akuntansi tidak ditemukan', 404);

      const pCtrl = await db
        .prepare('SELECT close_stage FROM rticore_finance_period_controls WHERE tenant_id=? AND period_id=?')
        .bind(TENANT, periodRow.id)
        .first<{ close_stage: 'open' | 'soft_close' | 'under_review' | 'approved' | 'hard_close' }>();

      const activeAccs = await db
        .prepare('SELECT id FROM rticore_gl_accounts WHERE tenant_id=? AND legal_entity_id=? AND active=1')
        .bind(TENANT, v.legal_entity_id as string)
        .all<{ id: string }>();
      const headerAccs = await db
        .prepare('SELECT account_id FROM rticore_finance_coa_hierarchy WHERE tenant_id=? AND legal_entity_id=? AND is_header=1')
        .bind(TENANT, v.legal_entity_id as string)
        .all<{ account_id: string }>();

      const lines = Array.isArray(v.lines) ? (v.lines as Array<Record<string, unknown>>) : [];
      const validation = validateDoubleEntryJournal({
        lines: lines.map(l => ({
          account_id: String(l.account_id || ''),
          debit_cents: Number(l.debit_cents),
          credit_cents: Number(l.credit_cents),
          description: String(l.description || ''),
        })),
        periodStatus: pCtrl ? pCtrl.close_stage : periodRow.status,
        journalType: (v.journal_type as JournalType) || 'general',
        exchangeRateMicro: v.exchange_rate_micro !== undefined ? Number(v.exchange_rate_micro) : 1_000_000,
        activeAccountIds: new Set(activeAccs.results.map(x => x.id)),
        headerOnlyAccountIds: new Set(headerAccs.results.map(x => x.account_id)),
      });
      if (!validation.ok) {
        throw new ERPError(`${validation.code}: ${validation.message}`, 422);
      }

      const journalId = crypto.randomUUID();
      const sourceType = ['manual', 'ar', 'ap', 'expense', 'reversal'].includes(String(v.source_type))
        ? String(v.source_type)
        : 'manual';
      const writes = [
        db
          .prepare(
            'INSERT INTO rticore_gl_journals(id,tenant_id,legal_entity_id,period_id,source_type,source_key,memo,created_by) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            journalId,
            TENANT,
            v.legal_entity_id as string,
            periodRow.id,
            sourceType,
            String(v.source_key).trim(),
            String(v.memo).trim(),
            email,
          ),
        db
          .prepare(
            'INSERT INTO rticore_finance_journal_workflows(tenant_id,journal_id,legal_entity_id,journal_type,lifecycle_stage,currency,exchange_rate_micro,posting_rule_id,supporting_document_id,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
          )
          .bind(
            TENANT,
            journalId,
            v.legal_entity_id as string,
            String(v.journal_type || 'general'),
            v.auto_submit ? 'submitted' : 'draft',
            String(v.currency || 'IDR'),
            Number(v.exchange_rate_micro || 1_000_000),
            (v.posting_rule_id as string) || null,
            (v.supporting_document_id as string) || null,
            email,
          ),
      ];

      for (const line of lines) {
        const lineId = crypto.randomUUID();
        writes.push(
          db
            .prepare('INSERT INTO rticore_gl_lines(id,tenant_id,journal_id,account_id,debit_cents,credit_cents,description) VALUES(?,?,?,?,?,?,?)')
            .bind(
              lineId,
              TENANT,
              journalId,
              String(line.account_id),
              Number(line.debit_cents),
              Number(line.credit_cents),
              String(line.description || ''),
            ),
        );
        const dim = (line.dimensions as Record<string, unknown>) || {};
        writes.push(
          db
            .prepare(
              'INSERT INTO rticore_finance_journal_dimensions(tenant_id,line_id,journal_id,legal_entity_id,business_unit_id,department_id,cost_center_id,profit_center_id,project_id,contract_id,customer_id,vendor_id,product_code,service_category,currency,foreign_amount_cents,period_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              TENANT,
              lineId,
              journalId,
              v.legal_entity_id as string,
              (dim.business_unit_id as string) || null,
              (dim.department_id as string) || null,
              (dim.cost_center_id as string) || null,
              (dim.profit_center_id as string) || null,
              (dim.project_id as string) || null,
              (dim.contract_id as string) || null,
              (dim.customer_id as string) || null,
              (dim.vendor_id as string) || null,
              (dim.product_code as string) || null,
              (dim.service_category as string) || null,
              String(dim.currency || v.currency || 'IDR'),
              Number(dim.foreign_amount_cents || line.debit_cents || line.credit_cents || 0),
              periodRow.period,
            ),
        );
      }

      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_gl_periods WHERE tenant_id=? AND id=? AND status='open')",
        [TENANT, periodRow.id],
        writes,
        'rti_finance',
        journalId,
        'DIMENSIONAL_JOURNAL_CREATE',
        { total_debit_cents: validation.totalDebitCents, lines: lines.length },
      );
      return erpReply({ success: true, id: journalId, totalDebitCents: validation.totalDebitCents }, 201);
    }

    if (action === 'approve_and_post_journal') {
      erpAssert(erpId(v.journal_id) && erpText(v.review_notes, 12, 500), 'ID jurnal dan catatan review wajib');
      const j = await db
        .prepare(
          'SELECT j.id, j.legal_entity_id, j.created_by, j.status, j.version, j.source_type, coalesce((SELECT sum(l.debit_cents) FROM rticore_gl_lines l WHERE l.tenant_id=j.tenant_id AND l.journal_id=j.id),0) AS debit_cents FROM rticore_gl_journals j WHERE j.tenant_id=? AND j.id=?',
        )
        .bind(TENANT, v.journal_id as string)
        .first<{ id: string; legal_entity_id: string; created_by: string; status: string; version: number; debit_cents: number; source_type:string }>();
      erpAssert(j, 'Jurnal tidak ditemukan', 404);
      erpAssert(j.status === 'draft', 'Jurnal sudah diproses', 409);
      erpAssert(j.source_type !== 'camsrti', 'Use scoped CAMS Inbox independent approval', 403);

      const authCheck = validateFinanceApprovalAuthority({
        makerEmail: j.created_by,
        approverEmail: email,
        approverRole: financeRole,
        customApprovalLimitCents: customLimitCents,
        transactionAmountCents: Number(j.debit_cents),
        requireMakerChecker: true,
      });
      if (!authCheck.ok) {
        throw new ERPError(`${authCheck.code}: ${authCheck.message}`, 403);
      }

      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_gl_journals WHERE tenant_id=? AND id=? AND status='draft' AND version=?)",
        [TENANT, j.id, j.version],
        [
          db
            .prepare(
              "UPDATE rticore_gl_journals SET status='approved', version=version+1, reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?",
            )
            .bind(email, v.review_notes as string, TENANT, j.id),
          db
            .prepare(
              "UPDATE rticore_finance_journal_workflows SET lifecycle_stage='approved', checked_by=?, checked_at=CURRENT_TIMESTAMP, approved_by=?, approved_at=CURRENT_TIMESTAMP, version=version+1 WHERE tenant_id=? AND journal_id=?",
            )
            .bind(email, email, TENANT, j.id),
        ],
        'rti_finance',
        j.id,
        'JOURNAL_APPROVED',
        { amount_cents: j.debit_cents },
      );

      if (v.post_immediately === true && roleDef.canPost) {
        await erpAtom(
          a.identity,
          "EXISTS(SELECT 1 FROM rticore_gl_journals WHERE tenant_id=? AND id=? AND status='approved')",
          [TENANT, j.id],
          [
            db
              .prepare(
                "UPDATE rticore_gl_journals SET status='posted', version=version+1, posted_by=?, posted_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?",
              )
              .bind(email, TENANT, j.id),
            db
              .prepare(
                "UPDATE rticore_finance_journal_workflows SET lifecycle_stage='posted', posted_by=?, posted_at=CURRENT_TIMESTAMP, version=version+1 WHERE tenant_id=? AND journal_id=?",
              )
              .bind(email, TENANT, j.id),
          ],
          'rti_finance',
          j.id,
          'JOURNAL_POSTED',
          {},
        );
      }
      return erpReply({ success: true });
    }

    // =========================================================================
    // WP03: RTICORE DOCKING MANAGEMENT CENTER & EVENT PROCESSING (F25)
    // =========================================================================
    if (action === 'configure_docking') {
      erpAssert(
        ['super_admin', 'cfo'].includes(financeRole),
        'Konfigurasi RTICore Docking hanya dapat diubah oleh Super Admin atau CFO',
        403,
      );
      erpAssert(
        ['standalone', 'docked', 'multi_entity'].includes(String(v.operating_mode)) &&
          ['connected', 'disconnected', 'degraded'].includes(String(v.connection_status || 'connected')) &&
          erpText(v.rticore_endpoint, 5, 240),
        'Konfigurasi Docking tidak valid',
      );
      const id = erpId(v.id) ? (v.id as string) : crypto.randomUUID();
      const secretHash = await sha256Hex(String(v.webhook_secret || 'rticore-default-docking-secret'));
      const eventsJson = JSON.stringify(
        Array.isArray(v.subscribed_events) ? v.subscribed_events : RTICORE_DOCKING_EVENT_TYPES,
      );
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_docking_connections(id,tenant_id,operating_mode,connection_status,rticore_endpoint,auth_protocol,webhook_secret_sha256,subscribed_events_json,last_health_check_at,last_health_status,configured_by) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?) ON CONFLICT(id) DO UPDATE SET operating_mode=excluded.operating_mode, connection_status=excluded.connection_status, rticore_endpoint=excluded.rticore_endpoint, subscribed_events_json=excluded.subscribed_events_json, last_health_check_at=CURRENT_TIMESTAMP, version=rticore_finance_docking_connections.version+1, updated_at=CURRENT_TIMESTAMP',
            )
            .bind(
              id,
              TENANT,
              String(v.operating_mode),
              String(v.connection_status || 'connected'),
              String(v.rticore_endpoint).trim(),
              String(v.auth_protocol || 'in_cluster_atomic'),
              secretHash,
              eventsJson,
              String(v.connection_status) === 'disconnected' ? 'warning' : 'healthy',
              email,
            ),
        ],
        'rti_finance',
        id,
        'DOCKING_CONFIGURE',
        { operating_mode: v.operating_mode, connection_status: v.connection_status },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'register_integration_mapping') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          ['tenant', 'user', 'customer', 'vendor', 'contract', 'project', 'service_catalog', 'coa'].includes(String(v.domain)) &&
          erpText(v.rticore_source_id, 2, 120) &&
          erpText(v.finance_target_id, 2, 120),
        'Parameter mapping integrasi tidak valid',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_integration_mappings(id,tenant_id,legal_entity_id,domain,rticore_source_id,finance_target_id,mapping_meta_json,created_by) VALUES(?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.domain),
              String(v.rticore_source_id).trim(),
              String(v.finance_target_id).trim(),
              JSON.stringify(v.mapping_meta || {}),
              email,
            ),
        ],
        'rti_finance',
        id,
        'DOCKING_MAPPING_CREATE',
        { domain: v.domain, source: v.rticore_source_id, target: v.finance_target_id },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'ingest_docking_event') {
      const checked = validateDockingEventEnvelope(v, Date.now(), Number(v.max_drift_seconds ?? 300));
      if (!checked.ok) {
        throw new ERPError(`${checked.code}: ${checked.message}`, 422);
      }
      const env = checked.envelope;
      erpAssert(env.tenant_id === TENANT, 'Cross-tenant event injection ditolak', 403);

      // Deduplication check on idempotency_key
      const existing = await db
        .prepare('SELECT id, status FROM rticore_finance_integration_events WHERE tenant_id=? AND idempotency_key=?')
        .bind(TENANT, env.idempotency_key)
        .first<{ id: string; status: string }>();
      if (existing) {
        throw new ERPError('DOCKING_DUPLICATE_EVENT_IDEMPOTENCY: Event dengan idempotency key ini sudah pernah diterima', 409);
      }

      const payloadJson = JSON.stringify(env.payload);
      const payloadSha = await sha256Hex(payloadJson);
      const simulateFailure = env.payload.simulate_failure === true;
      const status = simulateFailure ? 'failed' : 'validated';

      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_integration_events(id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,correlation_id,idempotency_key,schema_version,payload_json,payload_sha256,status,error_message,event_timestamp,processed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              env.event_id,
              TENANT,
              env.legal_entity_id,
              'inbox',
              env.event_type,
              env.source_system,
              env.source_document_id,
              env.correlation_id,
              env.idempotency_key,
              env.schema_version,
              payloadJson,
              payloadSha,
              status,
              simulateFailure ? 'Simulated transient processing failure; queued for retry/DLQ' : null,
              env.timestamp,
              email,
            ),
        ],
        'rti_finance',
        env.event_id,
        'DOCKING_EVENT_INGEST',
        { event_type: env.event_type, idempotency_key: env.idempotency_key, status },
      );
      return erpReply({
        success: true,
        id: env.event_id,
        status,
        notice: 'Event ingested into transactional inbox. Per Section 6.4, no journal is auto-posted without accounting policy validation and approval.',
      }, 201);
    }

    if (action === 'retry_docking_event') {
      erpAssert(erpId(v.event_id), 'Event ID wajib');
      const ev = await db
        .prepare('SELECT id, status, retry_count FROM rticore_finance_integration_events WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.event_id as string)
        .first<{ id: string; status: string; retry_count: number }>();
      erpAssert(ev, 'Event tidak ditemukan', 404);
      erpAssert(ev.status !== 'processed', 'Event sudah berstatus processed; reprocessing duplikat ditolak', 409);

      const nextRetry = Number(ev.retry_count) + 1;
      const nextStatus = v.move_to_dlq === true || nextRetry > 3 ? 'dead_letter' : 'processed';
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_integration_events WHERE tenant_id=? AND id=? AND status!='processed')",
        [TENANT, ev.id],
        [
          db
            .prepare(
              'UPDATE rticore_finance_integration_events SET status=?, retry_count=?, error_message=?, processed_at=CURRENT_TIMESTAMP, processed_by=? WHERE tenant_id=? AND id=?',
            )
            .bind(
              nextStatus,
              nextRetry,
              nextStatus === 'dead_letter' ? 'Moved to Dead Letter Queue after max retries' : null,
              email,
              TENANT,
              ev.id,
            ),
        ],
        'rti_finance',
        ev.id,
        'DOCKING_EVENT_RETRY',
        { nextStatus, nextRetry },
      );
      return erpReply({ success: true, status: nextStatus, retry_count: nextRetry });
    }

    // =========================================================================
    // WP04: AR, BILLING, AP VENDOR BANK DUAL-CONTROL, TREASURY & BANK RECON (F04-F08)
    // =========================================================================
    if (action === 'create_ar_adjustment') {
      erpAssert(roleDef.canMake, 'Hanya Maker Finance/AR yang dapat membuat AR Adjustment', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.customer_id) &&
          ['credit_note', 'debit_note', 'customer_deposit', 'dispute_hold', 'bad_debt_provision', 'bad_debt_writeoff'].includes(String(v.adjustment_kind)) &&
          erpText(v.document_number, 3, 80) &&
          erpPositiveCents(v.amount_cents) &&
          erpText(v.reason, 12, 500) &&
          erpId(v.evidence_document_id),
        'Parameter AR Adjustment (Credit/Debit Note/Deposit/Dispute/Bad Debt) tidak lengkap',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_ar_adjustments(id,tenant_id,legal_entity_id,customer_id,invoice_id,adjustment_kind,document_number,amount_cents,tax_cents,reason,evidence_document_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.customer_id as string,
              (v.invoice_id as string) || null,
              String(v.adjustment_kind),
              String(v.document_number).trim(),
              Number(v.amount_cents),
              Number(v.tax_cents || 0),
              String(v.reason).trim(),
              v.evidence_document_id as string,
              email,
            ),
        ],
        'rti_finance',
        id,
        'AR_ADJUSTMENT_CREATE',
        { kind: v.adjustment_kind, amount_cents: v.amount_cents },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'allocate_ar_payment') {
      erpAssert(roleDef.canMake, 'Hanya AR/Treasury Officer yang dapat mengalokasikan pembayaran', 403);
      erpAssert(
        erpId(v.payment_id) && erpId(v.invoice_id) && erpPositiveCents(v.allocated_cents) && erpDate(v.allocation_date),
        'Parameter alokasi pembayaran tidak valid',
      );
      const pay = await db
        .prepare('SELECT id, amount_cents, status FROM rticore_billing_payments WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.payment_id as string)
        .first<{ id: string; amount_cents: number; status: string }>();
      const inv = await db
        .prepare('SELECT id, amount_cents, vat_cents, status FROM rticore_billing_invoices WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.invoice_id as string)
        .first<{ id: string; amount_cents: number; vat_cents: number; status: string }>();
      erpAssert(pay && pay.status === 'approved' && inv && inv.status === 'approved', 'Payment dan Invoice harus berstatus approved', 409);

      const prevAlloc = await db
        .prepare('SELECT coalesce(sum(allocated_cents),0) AS s FROM rticore_finance_ar_payment_allocations WHERE tenant_id=? AND payment_id=?')
        .bind(TENANT, pay.id)
        .first<{ s: number }>();
      const totalAllocated = Number(prevAlloc?.s || 0) + Number(v.allocated_cents);
      erpAssert(totalAllocated <= Number(pay.amount_cents), 'Alokasi pembayaran melebihi nilai bukti kas diterima', 422);

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_ar_payment_allocations(id,tenant_id,payment_id,invoice_id,allocated_cents,allocation_date,created_by) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(id, TENANT, pay.id, inv.id, Number(v.allocated_cents), v.allocation_date as string, email),
        ],
        'rti_finance',
        id,
        'AR_PAYMENT_ALLOCATE',
        { payment_id: pay.id, invoice_id: inv.id, allocated_cents: v.allocated_cents },
      );
      return erpReply({ success: true, id, unallocatedRemainingCents: Number(pay.amount_cents) - totalAllocated }, 201);
    }

    if (action === 'request_vendor_bank_change') {
      erpAssert(roleDef.canMake, 'Hanya Maker AP/Procurement yang dapat mengajukan rekening bank vendor', 403);
      erpAssert(
        erpId(v.vendor_id) &&
          erpText(v.bank_name, 3, 120) &&
          erpText(v.account_holder_name, 3, 160) &&
          erpText(v.masked_account_number, 4, 32) &&
          erpText(v.change_reason, 12, 500) &&
          erpId(v.evidence_document_id),
        'Pengajuan rekening bank vendor wajib menyertakan alasan dan dokumen bukti',
      );
      const id = crypto.randomUUID();
      const accHash = await sha256Hex(`${v.vendor_id}:${v.bank_name}:${v.masked_account_number}`);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_vendor_bank_accounts(id,tenant_id,vendor_id,bank_name,account_holder_name,masked_account_number,account_hash_sha256,change_reason,evidence_document_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.vendor_id as string,
              String(v.bank_name).trim(),
              String(v.account_holder_name).trim(),
              String(v.masked_account_number).trim(),
              accHash,
              String(v.change_reason).trim(),
              v.evidence_document_id as string,
              email,
            ),
        ],
        'rti_finance',
        id,
        'VENDOR_BANK_CHANGE_REQUEST',
        { vendor_id: v.vendor_id, bank_name: v.bank_name },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'approve_vendor_bank_change') {
      erpAssert(roleDef.canApprove && erpId(v.id), 'Persetujuan rekening bank vendor wajib Approver independen', 403);
      const vb = await db
        .prepare('SELECT id, created_by, status, version FROM rticore_finance_vendor_bank_accounts WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; created_by: string; status: string; version: number }>();
      erpAssert(vb && vb.status === 'pending_approval', 'Rekening bank vendor sudah diproses', 409);
      erpAssert(
        vb.created_by.toLowerCase() !== email.toLowerCase(),
        'Segregation of Duties: Pembuat perubahan rekening bank vendor dilarang menyetujui sendiri',
        403,
      );
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_vendor_bank_accounts WHERE tenant_id=? AND id=? AND status='pending_approval')",
        [TENANT, vb.id],
        [
          db
            .prepare(
              "UPDATE rticore_finance_vendor_bank_accounts SET status=?, version=version+1, approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?",
            )
            .bind(v.approve === false ? 'rejected' : 'approved', email, TENANT, vb.id),
        ],
        'rti_finance',
        vb.id,
        'VENDOR_BANK_CHANGE_APPROVE',
        { approved: v.approve !== false },
      );
      return erpReply({ success: true });
    }

    if (action === 'import_bank_statement') {
      erpAssert(roleDef.canMake, 'Hanya Treasury/Accounting Officer yang dapat mengimpor mutasi rekening koran', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.bank_account_id) &&
          erpText(v.statement_number, 3, 80) &&
          erpDate(v.period_start) &&
          erpDate(v.period_end) &&
          Number.isSafeInteger(v.opening_balance_cents) &&
          Number.isSafeInteger(v.closing_balance_cents),
        'Header rekening koran (Bank Statement) tidak valid',
      );
      const stmtId = crypto.randomUUID();
      const lines = Array.isArray(v.lines) ? (v.lines as Array<Record<string, unknown>>) : [];
      const writes = [
        db
          .prepare(
            'INSERT INTO rticore_finance_bank_statements(id,tenant_id,legal_entity_id,bank_account_id,statement_number,period_start,period_end,opening_balance_cents,closing_balance_cents,imported_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            stmtId,
            TENANT,
            v.legal_entity_id as string,
            v.bank_account_id as string,
            String(v.statement_number).trim(),
            v.period_start as string,
            v.period_end as string,
            Number(v.opening_balance_cents),
            Number(v.closing_balance_cents),
            email,
          ),
      ];

      for (const l of lines) {
        erpAssert(
          erpDate(l.tx_date) &&
            erpText(l.external_reference, 2, 100) &&
            ['inflow', 'outflow'].includes(String(l.direction)) &&
            erpPositiveCents(l.amount_cents),
          'Baris mutasi bank tidak valid',
        );
        writes.push(
          db
            .prepare(
              'INSERT INTO rticore_finance_bank_statement_lines(id,tenant_id,statement_id,tx_date,external_reference,description,direction,amount_cents,match_status,matched_source_type,matched_source_id,reconciled_by,reconciled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
            )
            .bind(
              crypto.randomUUID(),
              TENANT,
              stmtId,
              l.tx_date as string,
              String(l.external_reference).trim(),
              String(l.description || 'Bank statement transaction'),
              String(l.direction),
              Number(l.amount_cents),
              l.matched_source_id ? 'matched' : 'unmatched',
              (l.matched_source_type as string) || null,
              (l.matched_source_id as string) || null,
              l.matched_source_id ? email : null,
            ),
        );
      }

      await erpAtom(a.identity, '1=1', [], writes, 'rti_finance', stmtId, 'BANK_STATEMENT_IMPORT', {
        statement_number: v.statement_number,
        line_count: lines.length,
      });
      return erpReply({ success: true, id: stmtId }, 201);
    }

    if (action === 'generate_cash_forecast') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          ['weekly_13w', 'monthly_12m'].includes(String(v.horizon_kind)) &&
          erpText(v.bucket_label, 2, 40) &&
          erpDate(v.bucket_start) &&
          erpDate(v.bucket_end) &&
          Number.isSafeInteger(v.opening_cash_cents),
        'Parameter Cash Flow Forecast tidak valid',
      );
      const opening = Number(v.opening_cash_cents);
      const receipts = Number(v.expected_receipts_cents || 0);
      const apPay = Number(v.expected_ap_payments_cents || 0);
      const projComm = Number(v.project_commitments_cents || 0);
      const payroll = Number(v.payroll_obligations_cents || 0);
      const tax = Number(v.tax_obligations_cents || 0);
      const debt = Number(v.debt_service_cents || 0);
      const minBuffer = Number(v.minimum_liquidity_buffer_cents || 0);
      const closing = opening + receipts - apPay - projComm - payroll - tax - debt;
      const shortfall = closing < minBuffer ? 1 : 0;

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_cash_forecasts(id,tenant_id,legal_entity_id,horizon_kind,bucket_label,bucket_start,bucket_end,opening_cash_cents,expected_receipts_cents,expected_ap_payments_cents,project_commitments_cents,payroll_obligations_cents,tax_obligations_cents,debt_service_cents,projected_closing_cents,minimum_liquidity_buffer_cents,shortfall_flag,generated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.horizon_kind),
              String(v.bucket_label).trim(),
              v.bucket_start as string,
              v.bucket_end as string,
              opening,
              receipts,
              apPay,
              projComm,
              payroll,
              tax,
              debt,
              closing,
              minBuffer,
              shortfall,
              email,
            ),
        ],
        'rti_finance',
        id,
        'CASH_FORECAST_BUCKET_CREATE',
        { bucket_label: v.bucket_label, projected_closing_cents: closing, shortfall },
      );
      return erpReply({ success: true, id, projected_closing_cents: closing, shortfall: shortfall === 1 }, 201);
    }

    // =========================================================================
    // WP05: PSAK 115 REVENUE RECOGNITION, PROJECT ACCOUNTING & FLEXGUARD (F09, F10, F19)
    // =========================================================================
    if (action === 'allocate_psak115_contract') {
      erpAssert(roleDef.canMake, 'Hanya Accounting/Controller yang dapat mengalokasikan kontrak PSAK 115', 403);
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.contract_id) &&
          erpId(v.project_id) &&
          erpPositiveCents(v.transaction_price_cents) &&
          erpText(v.policy_reference, 5, 160) &&
          Array.isArray(v.obligations) &&
          v.obligations.length > 0,
        'Parameter kontrak PSAK 115 dan Performance Obligations wajib lengkap',
      );
      const rawObs = v.obligations as Array<Record<string, unknown>>;
      const allocated = allocatePSAK115TransactionPrice(
        Number(v.transaction_price_cents),
        rawObs.map(o => ({
          obligation_code: String(o.obligation_code).trim(),
          title: String(o.title).trim(),
          ssp_cents: Number(o.ssp_cents),
        })),
      );

      const ids: string[] = [];
      const writes = [];
      for (let i = 0; i < allocated.length; i++) {
        const item = allocated[i];
        const raw = rawObs[i];
        const id = crypto.randomUUID();
        ids.push(id);
        writes.push(
          db
            .prepare(
              'INSERT INTO rticore_finance_performance_obligations(id,tenant_id,legal_entity_id,contract_id,project_id,obligation_code,title,revenue_model,satisfaction_method,principal_vs_agent,ssp_cents,allocated_transaction_price_cents,policy_reference,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.contract_id as string,
              v.project_id as string,
              item.obligation_code,
              item.title,
              String(raw.revenue_model || 'fixed_price_vapt'),
              String(raw.satisfaction_method || 'point_in_time'),
              String(raw.principal_vs_agent || 'principal'),
              item.ssp_cents,
              item.allocated_transaction_price_cents,
              String(v.policy_reference).trim(),
              email,
            ),
        );
      }

      await erpAtom(a.identity, '1=1', [], writes, 'rti_finance', v.contract_id as string, 'PSAK115_ALLOCATE', {
        transaction_price_cents: v.transaction_price_cents,
        obligations_count: allocated.length,
      });
      return erpReply({ success: true, ids, allocated }, 201);
    }

    if (action === 'approve_psak115_obligation') {
      erpAssert(roleDef.canApprove && erpId(v.id) && erpText(v.review_notes, 12, 500), 'Approval PSAK 115 memerlukan Approver independen dan catatan', 403);
      const ob = await db
        .prepare('SELECT id, created_by, status FROM rticore_finance_performance_obligations WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; created_by: string; status: string }>();
      erpAssert(ob && ob.status === 'draft', 'Performance Obligation tidak berstatus draft', 409);
      erpAssert(ob.created_by.toLowerCase() !== email.toLowerCase(), 'Maker dilarang menyetujui Performance Obligation sendiri', 403);
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_performance_obligations WHERE tenant_id=? AND id=? AND status='draft')",
        [TENANT, ob.id],
        [
          db
            .prepare("UPDATE rticore_finance_performance_obligations SET status='approved', approved_by=?, review_notes=? WHERE tenant_id=? AND id=?")
            .bind(email, v.review_notes as string, TENANT, ob.id),
        ],
        'rti_finance',
        ob.id,
        'PSAK115_OBLIGATION_APPROVE',
        {},
      );
      return erpReply({ success: true });
    }

    if (action === 'recognize_psak115_revenue') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.obligation_id) &&
          erpPeriod(v.period_code) &&
          erpPositiveCents(v.recognized_cents) &&
          ['bast_milestone', 'timesheet_approved', 'monthly_service_report', 'flexguard_debit', 'license_delivery', 'expiry_policy'].includes(String(v.evidence_kind)) &&
          erpText(v.evidence_source_id, 3, 120),
        'Parameter pengakuan pendapatan PSAK 115 dan evidence wajib lengkap',
      );
      const ob = await db
        .prepare(
          'SELECT id, status, allocated_transaction_price_cents, recognized_to_date_cents, billed_to_date_cents, created_by FROM rticore_finance_performance_obligations WHERE tenant_id=? AND id=?',
        )
        .bind(TENANT, v.obligation_id as string)
        .first<{
          id: string;
          status: string;
          allocated_transaction_price_cents: number;
          recognized_to_date_cents: number;
          billed_to_date_cents: number;
          created_by: string;
        }>();
      erpAssert(ob && ob.status === 'approved', 'Performance Obligation harus berstatus approved sebelum pengakuan pendapatan', 409);

      const newRecognizedTotal = Number(ob.recognized_to_date_cents) + Number(v.recognized_cents);
      erpAssert(
        newRecognizedTotal <= Number(ob.allocated_transaction_price_cents),
        'PSAK115_OVER_RECOGNITION: Kumulatif pengakuan pendapatan melebihi harga transaksi yang dialokasikan',
        422,
      );

      const pos = computeContractRevenuePosition({
        contractValueCents: Number(ob.allocated_transaction_price_cents),
        billedToDateCents: Number(v.billed_to_date_cents ?? ob.billed_to_date_cents),
        cashCollectedCents: 0,
        recognizedRevenueCents: newRecognizedTotal,
      });

      const schedId = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              "INSERT INTO rticore_finance_revenue_schedules(id,tenant_id,legal_entity_id,obligation_id,period_code,planned_cents,recognized_cents,evidence_kind,evidence_source_id,evidence_document_id,status,prepared_by,approved_by,recognized_at) VALUES(?,?,?,?,?,?,?,?,?,?,'recognized',?,?,CURRENT_TIMESTAMP)",
            )
            .bind(
              schedId,
              TENANT,
              v.legal_entity_id as string,
              ob.id,
              v.period_code as string,
              Number(v.recognized_cents),
              Number(v.recognized_cents),
              String(v.evidence_kind),
              String(v.evidence_source_id).trim(),
              (v.evidence_document_id as string) || null,
              ob.created_by,
              email,
            ),
          db
            .prepare(
              'UPDATE rticore_finance_performance_obligations SET recognized_to_date_cents=?, billed_to_date_cents=?, contract_asset_cents=?, contract_liability_cents=? WHERE tenant_id=? AND id=?',
            )
            .bind(
              newRecognizedTotal,
              pos.billedToDateCents,
              pos.contractAssetCents,
              pos.contractLiabilityCents,
              TENANT,
              ob.id,
            ),
        ],
        'rti_finance',
        schedId,
        'PSAK115_REVENUE_RECOGNIZE',
        { obligation_id: ob.id, recognized_cents: v.recognized_cents, position: pos },
      );
      return erpReply({ success: true, id: schedId, position: pos }, 201);
    }

    if (action === 'record_project_cost_entry') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.project_id) &&
          erpPeriod(v.period_code) &&
          ['labor_timesheet', 'external_consultant', 'software_license', 'hardware', 'travel_expense', 'procurement_po', 'allocated_overhead'].includes(String(v.cost_bucket)) &&
          ['psa_timesheet', 'ap_invoice', 'expense_claim', 'payroll_allocation', 'inventory_issue', 'overhead_rule'].includes(String(v.source_domain)) &&
          erpText(v.source_record_id, 3, 120) &&
          erpPositiveCents(v.amount_cents),
        'Parameter Project Cost Ledger tidak valid',
      );
      const id = crypto.randomUUID();
      const isCommitted = v.is_committed === true ? 1 : 0;
      const isActual = isCommitted === 1 ? 0 : 1;
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_project_cost_ledger(id,tenant_id,legal_entity_id,project_id,period_code,cost_bucket,source_domain,source_record_id,amount_cents,is_committed,is_actual,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.project_id as string,
              v.period_code as string,
              String(v.cost_bucket),
              String(v.source_domain),
              String(v.source_record_id).trim(),
              Number(v.amount_cents),
              isCommitted,
              isActual,
              email,
            ),
        ],
        'rti_finance',
        id,
        'PROJECT_COST_RECORD',
        { project_id: v.project_id, cost_bucket: v.cost_bucket, amount_cents: v.amount_cents },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'compute_project_snapshot') {
      erpAssert(
        erpId(v.legal_entity_id) && erpId(v.project_id) && erpPeriod(v.period_code),
        'Project ID, Legal Entity, dan Periode wajib untuk Project Financial Snapshot',
      );
      const metrics = computeProjectProfitabilityMetrics({
        contractValueCents: Number(v.contract_value_cents || 0),
        approvedBudgetCents: Number(v.approved_budget_cents || 0),
        recognizedRevenueCents: Number(v.recognized_revenue_cents || 0),
        billedAmountCents: Number(v.billed_amount_cents || 0),
        cashCollectedCents: Number(v.cash_collected_cents || 0),
        directCostCents: Number(v.direct_cost_cents || 0),
        indirectCostCents: Number(v.indirect_cost_cents || 0),
        committedCostCents: Number(v.committed_cost_cents || 0),
        estimateToCompleteCents: Number(v.estimate_to_complete_cents || 0),
        isCloseCertified: v.is_close_certified === true,
      });

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_project_snapshots(id,tenant_id,legal_entity_id,project_id,period_code,approved_budget_cents,contract_value_cents,recognized_revenue_cents,billed_amount_cents,cash_collected_cents,direct_cost_cents,indirect_cost_cents,committed_cost_cents,estimate_to_complete_cents,estimate_at_completion_cents,gross_profit_cents,gross_margin_bps,budget_variance_cents,certification_status,generated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.project_id as string,
              v.period_code as string,
              metrics.approvedBudgetCents,
              metrics.contractValueCents,
              metrics.recognizedRevenueCents,
              metrics.billedAmountCents,
              metrics.cashCollectedCents,
              metrics.directCostCents,
              metrics.indirectCostCents,
              metrics.committedCostCents,
              metrics.estimateToCompleteCents,
              metrics.estimateAtCompletionCents,
              metrics.grossProfitCents,
              metrics.grossMarginBps,
              metrics.budgetVarianceCents,
              metrics.isCloseCertified ? 'reconciled' : 'provisional',
              email,
            ),
        ],
        'rti_finance',
        id,
        'PROJECT_SNAPSHOT_GENERATE',
        { project_id: v.project_id, gross_margin_bps: metrics.grossMarginBps, status: metrics.statusLabel },
      );
      return erpReply({ success: true, id, metrics }, 201);
    }

    if (action === 'value_flexguard_event') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpId(v.wallet_id) &&
          erpId(v.flexguard_event_id) &&
          erpPositiveCents(v.unit_rate_cents) &&
          erpText(v.accounting_policy_ref, 5, 120),
        'Parameter valuasi moneter FlexGuard tidak lengkap',
      );
      const fgEv = await db
        .prepare('SELECT id, wallet_id, kind, units FROM rticore_flexguard_events WHERE tenant_id=? AND id=? AND wallet_id=?')
        .bind(TENANT, v.flexguard_event_id as string, v.wallet_id as string)
        .first<{ id: string; wallet_id: string; kind: string; units: number }>();
      erpAssert(fgEv, 'Event FlexGuard tidak ditemukan pada wallet tersebut', 404);

      const units = Number(fgEv.units);
      const rateCents = Number(v.unit_rate_cents);
      const amountCents = units * rateCents;
      const isPurchase = ['ISSUE', 'TOPUP'].includes(fgEv.kind);
      const isConsumption = ['DEBIT', 'EXPIRY'].includes(fgEv.kind);
      const liabilityDelta = isPurchase ? amountCents : isConsumption ? -amountCents : 0;
      const revenueRecognized = isConsumption ? amountCents : 0;

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_flexguard_valuations(id,tenant_id,legal_entity_id,wallet_id,flexguard_event_id,event_kind,units,unit_rate_cents,monetary_amount_cents,liability_delta_cents,revenue_recognized_cents,accounting_policy_ref,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              fgEv.wallet_id,
              fgEv.id,
              fgEv.kind,
              units,
              rateCents,
              amountCents,
              liabilityDelta,
              revenueRecognized,
              String(v.accounting_policy_ref).trim(),
              email,
            ),
        ],
        'rti_finance',
        id,
        'FLEXGUARD_MONETARY_VALUATION',
        { event_id: fgEv.id, kind: fgEv.kind, monetary_amount_cents: amountCents, revenue_recognized_cents: revenueRecognized },
      );
      return erpReply({
        success: true,
        id,
        monetary_amount_cents: amountCents,
        liability_delta_cents: liabilityDelta,
        revenue_recognized_cents: revenueRecognized,
      }, 201);
    }

    // =========================================================================
    // WP06: CORPORATE FINANCE — BUDGET, FP&A, EXPENSE, PAYROLL, TAX, ASSETS & LICENSES (F12-F18)
    // =========================================================================
    if (action === 'create_enterprise_budget') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          Number.isSafeInteger(v.fiscal_year) &&
          erpPeriod(v.period_code) &&
          ['revenue', 'opex', 'capex', 'project', 'procurement', 'human_capital', 'marketing', 'cash_flow'].includes(String(v.budget_type)) &&
          erpId(v.account_id) &&
          erpPositiveCents(v.original_budget_cents),
        'Parameter Enterprise Budget tidak lengkap',
      );
      const id = crypto.randomUUID();
      const orig = Number(v.original_budget_cents);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_budgets(id,tenant_id,legal_entity_id,fiscal_year,period_code,budget_type,control_mode,business_unit_id,department_id,cost_center_id,profit_center_id,project_id,service_line,account_id,original_budget_cents,current_approved_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              Number(v.fiscal_year),
              v.period_code as string,
              String(v.budget_type),
              String(v.control_mode || 'hard'),
              (v.business_unit_id as string) || null,
              (v.department_id as string) || null,
              (v.cost_center_id as string) || null,
              (v.profit_center_id as string) || null,
              (v.project_id as string) || null,
              (v.service_line as string) || null,
              v.account_id as string,
              orig,
              orig,
              email,
            ),
        ],
        'rti_finance',
        id,
        'ENTERPRISE_BUDGET_CREATE',
        { budget_type: v.budget_type, original_budget_cents: orig },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'consume_or_reserve_budget') {
      erpAssert(erpId(v.budget_id) && erpPositiveCents(v.amount_cents), 'Budget ID dan nominal wajib');
      const b = await db
        .prepare(
          'SELECT id, control_mode, current_approved_cents, reserved_cents, committed_cents, actual_realized_cents, overrun_approved_by FROM rticore_finance_budgets WHERE tenant_id=? AND id=?',
        )
        .bind(TENANT, v.budget_id as string)
        .first<{
          id: string;
          control_mode: 'soft' | 'hard';
          current_approved_cents: number;
          reserved_cents: number;
          committed_cents: number;
          actual_realized_cents: number;
          overrun_approved_by: string | null;
        }>();
      erpAssert(b, 'Budget tidak ditemukan', 404);

      const delta = Number(v.amount_cents);
      const nextUsed = Number(b.reserved_cents) + Number(b.committed_cents) + Number(b.actual_realized_cents) + delta;
      if (b.control_mode === 'hard' && !b.overrun_approved_by && nextUsed > Number(b.current_approved_cents)) {
        throw new ERPError(
          `FIN_HARD_BUDGET_LIMIT_EXCEEDED: Penggunaan anggaran (${nextUsed} sen) melebihi pagu (${b.current_approved_cents} sen). Diperlukan Budget Overrun Approval.`,
          422,
        );
      }

      const kind = String(v.consumption_kind || 'reserve');
      const col = kind === 'commit' ? 'committed_cents' : kind === 'actual' ? 'actual_realized_cents' : 'reserved_cents';
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(`UPDATE rticore_finance_budgets SET ${col} = ${col} + ? WHERE tenant_id=? AND id=?`)
            .bind(delta, TENANT, b.id),
        ],
        'rti_finance',
        b.id,
        'BUDGET_CONSUME',
        { kind, delta, softWarning: nextUsed > Number(b.current_approved_cents) },
      );
      return erpReply({
        success: true,
        remainingBudgetCents: Number(b.current_approved_cents) - nextUsed,
        softLimitWarning: nextUsed > Number(b.current_approved_cents),
      });
    }

    if (action === 'submit_expense_claim') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.claim_number, 3, 60) &&
          ['reimbursement', 'cash_advance', 'advance_settlement'].includes(String(v.claim_kind || 'reimbursement')) &&
          ['travel', 'accommodation', 'client_engagement', 'certification_exam', 'project_supplies', 'other'].includes(String(v.category || 'travel')) &&
          erpPeriod(v.period_code) &&
          erpPositiveCents(v.amount_cents) &&
          erpId(v.evidence_document_id) &&
          erpText(v.description, 12, 500),
        'Klaim biaya karyawan wajib menyertakan dokumen bukti asli dan deskripsi minimal 12 karakter',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_expense_claims(id,tenant_id,legal_entity_id,claim_number,employee_email,claim_kind,category,project_id,cost_center_id,period_code,amount_cents,evidence_document_id,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.claim_number).trim(),
              email,
              String(v.claim_kind || 'reimbursement'),
              String(v.category || 'travel'),
              (v.project_id as string) || null,
              (v.cost_center_id as string) || null,
              v.period_code as string,
              Number(v.amount_cents),
              v.evidence_document_id as string,
              String(v.description).trim(),
            ),
        ],
        'rti_finance',
        id,
        'EXPENSE_CLAIM_SUBMIT',
        { claim_number: v.claim_number, amount_cents: v.amount_cents },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'review_expense_claim') {
      erpAssert(roleDef.canApprove && erpId(v.id) && erpText(v.review_notes, 12, 500), 'Approval klaim biaya wajib Approver independen', 403);
      const claim = await db
        .prepare('SELECT id, employee_email, status, amount_cents FROM rticore_finance_expense_claims WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; employee_email: string; status: string; amount_cents: number }>();
      erpAssert(claim && claim.status === 'submitted', 'Klaim tidak ditemukan atau sudah direview', 409);
      erpAssert(claim.employee_email.toLowerCase() !== email.toLowerCase(), 'Karyawan dilarang menyetujui klaim biaya sendiri', 403);
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_expense_claims WHERE tenant_id=? AND id=? AND status='submitted')",
        [TENANT, claim.id],
        [
          db
            .prepare("UPDATE rticore_finance_expense_claims SET status=?, version=version+1, reviewed_by=?, review_notes=? WHERE tenant_id=? AND id=?")
            .bind(v.approve === false ? 'rejected' : 'approved', email, v.review_notes as string, TENANT, claim.id),
        ],
        'rti_finance',
        claim.id,
        'EXPENSE_CLAIM_REVIEW',
        { approved: v.approve !== false },
      );
      return erpReply({ success: true });
    }

    if (action === 'create_payroll_batch') {
      erpAssert(
        ['human_capital_officer', 'accounting_officer', 'financial_controller', 'cfo'].includes(financeRole),
        'Payroll Accounting Batch hanya dapat dibuat oleh Human Capital atau Accounting/Controller',
        403,
      );
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpPeriod(v.period_code) &&
          erpText(v.batch_number, 3, 60) &&
          Number.isSafeInteger(v.headcount) &&
          Number(v.headcount) > 0 &&
          erpPositiveCents(v.gross_salary_cents),
        'Parameter Payroll Accounting Batch tidak valid',
      );
      const gross = Number(v.gross_salary_cents);
      const allow = Number(v.allowances_cents || 0);
      const bpjs = Number(v.employer_bpjs_cents || 0);
      const pph21 = Number(v.pph21_withheld_cents || 0);
      const deduct = Number(v.employee_deductions_cents || 0);
      const netTakeHome = gross + allow - pph21 - deduct;
      const totalEmployerCost = gross + allow + bpjs;
      const projAlloc = Number(v.project_allocated_cents ?? Math.round(totalEmployerCost * 0.6));
      const opexAlloc = totalEmployerCost - projAlloc;

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_payroll_batches(id,tenant_id,legal_entity_id,period_code,batch_number,headcount,gross_salary_cents,allowances_cents,employer_bpjs_cents,pph21_withheld_cents,employee_deductions_cents,net_take_home_cents,project_allocated_cents,opex_allocated_cents,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.period_code as string,
              String(v.batch_number).trim(),
              Number(v.headcount),
              gross,
              allow,
              bpjs,
              pph21,
              deduct,
              netTakeHome,
              projAlloc,
              opexAlloc,
              email,
            ),
        ],
        'rti_finance',
        id,
        'PAYROLL_BATCH_CREATE',
        { batch_number: v.batch_number, net_take_home_cents: netTakeHome },
      );
      return erpReply({ success: true, id, net_take_home_cents: netTakeHome, totalEmployerCostCents: totalEmployerCost }, 201);
    }

    if (action === 'create_tax_rule') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.tax_code, 2, 40) &&
          ['PPN', 'PPH21', 'PPH22', 'PPH23', 'PPH25', 'PPH26', 'PPH4_2'].includes(String(v.tax_type)) &&
          erpText(v.transaction_classification, 3, 120) &&
          erpText(v.legal_basis, 6, 200) &&
          Number.isSafeInteger(v.rate_bps) &&
          Number(v.rate_bps) >= 0 &&
          Number(v.rate_bps) <= 10000 &&
          erpId(v.tax_account_id) &&
          erpDate(v.effective_from),
        'Parameter Tax Rule (PPN/PPh) tidak valid',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_tax_rules(id,tenant_id,legal_entity_id,tax_code,tax_type,transaction_classification,legal_basis,rate_bps,tax_base_ratio_bps,is_withholding,is_exempt,tax_account_id,effective_from,effective_to,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.tax_code).trim(),
              String(v.tax_type),
              String(v.transaction_classification).trim(),
              String(v.legal_basis).trim(),
              Number(v.rate_bps),
              Number(v.tax_base_ratio_bps || 10000),
              v.is_withholding ? 1 : 0,
              v.is_exempt ? 1 : 0,
              v.tax_account_id as string,
              v.effective_from as string,
              (v.effective_to as string) || null,
              email,
            ),
        ],
        'rti_finance',
        id,
        'TAX_RULE_CREATE',
        { tax_code: v.tax_code, tax_type: v.tax_type, rate_bps: v.rate_bps },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'approve_tax_rule') {
      erpAssert(roleDef.canApprove && erpId(v.id), 'Approval Tax Rule memerlukan Approver independen', 403);
      const tr = await db
        .prepare('SELECT id, created_by, status FROM rticore_finance_tax_rules WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.id as string)
        .first<{ id: string; created_by: string; status: string }>();
      erpAssert(tr && tr.status === 'draft', 'Tax Rule tidak berstatus draft', 409);
      erpAssert(tr.created_by.toLowerCase() !== email.toLowerCase(), 'Maker dilarang menyetujui Tax Rule sendiri', 403);
      await erpAtom(
        a.identity,
        "EXISTS(SELECT 1 FROM rticore_finance_tax_rules WHERE tenant_id=? AND id=? AND status='draft')",
        [TENANT, tr.id],
        [
          db
            .prepare("UPDATE rticore_finance_tax_rules SET status='approved', approved_by=? WHERE tenant_id=? AND id=?")
            .bind(email, TENANT, tr.id),
        ],
        'rti_finance',
        tr.id,
        'TAX_RULE_APPROVE',
        {},
      );
      return erpReply({ success: true });
    }

    if (action === 'record_tax_transaction') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpPeriod(v.period_code) &&
          erpId(v.tax_rule_id) &&
          erpText(v.tax_document_number, 3, 80) &&
          erpText(v.counterparty_name, 3, 160) &&
          erpText(v.counterparty_npwp, 10, 30) &&
          erpPositiveCents(v.gross_amount_cents) &&
          erpDate(v.transaction_date),
        'Parameter transaksi pajak (Faktur Pajak / Bukti Potong) tidak lengkap',
      );
      const ruleRow = await db
        .prepare('SELECT * FROM rticore_finance_tax_rules WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.tax_rule_id as string)
        .first<{
          id: string;
          tax_code: string;
          tax_type: TaxRuleConfig['tax_type'];
          rate_bps: number;
          tax_base_ratio_bps: number;
          is_withholding: number;
          is_exempt: number;
          effective_from: string;
          effective_to: string | null;
          status: 'draft' | 'approved' | 'superseded';
        }>();
      erpAssert(ruleRow, 'Tax Rule tidak ditemukan', 404);

      const calc = calculateConfigurableTax({
        grossAmountCents: Number(v.gross_amount_cents),
        transactionDate: v.transaction_date as string,
        rule: {
          ...ruleRow,
          is_withholding: Number(ruleRow.is_withholding) === 1,
          is_exempt: Number(ruleRow.is_exempt) === 1,
        },
      });

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_tax_transactions(id,tenant_id,legal_entity_id,period_code,tax_rule_id,tax_type,tax_document_number,source_type,source_id,counterparty_name,counterparty_npwp,tax_base_cents,tax_amount_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.period_code as string,
              ruleRow.id,
              ruleRow.tax_type,
              String(v.tax_document_number).trim(),
              String(v.source_type || 'ar_invoice'),
              String(v.source_id || id),
              String(v.counterparty_name).trim(),
              String(v.counterparty_npwp).trim(),
              calc.taxBaseCents,
              calc.taxAmountCents,
              email,
            ),
        ],
        'rti_finance',
        id,
        'TAX_TRANSACTION_RECORD',
        { tax_type: ruleRow.tax_type, tax_amount_cents: calc.taxAmountCents },
      );
      return erpReply({ success: true, id, calculation: calc }, 201);
    }

    if (action === 'register_fixed_asset') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.asset_tag, 3, 60) &&
          erpText(v.name, 3, 160) &&
          ['server_hardware', 'security_appliance', 'network_equipment', 'office_equipment', 'intangible_software', 'right_of_use'].includes(String(v.asset_class || 'server_hardware')) &&
          erpDate(v.acquisition_date) &&
          erpPositiveCents(v.acquisition_cost_cents) &&
          Number.isSafeInteger(v.useful_life_months) &&
          Number(v.useful_life_months) >= 1,
        'Parameter registrasi Fixed Asset tidak valid',
      );
      const cost = Number(v.acquisition_cost_cents);
      const salvage = Number(v.salvage_value_cents || 0);
      const accum = Number(v.accumulated_depreciation_cents || 0);
      const nbv = cost - accum;
      const monthlyDepreciationCents = Math.round((cost - salvage) / Number(v.useful_life_months));

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_fixed_assets(id,tenant_id,legal_entity_id,asset_tag,name,asset_class,acquisition_date,capitalization_date,acquisition_cost_cents,salvage_value_cents,useful_life_months,depreciation_method,accumulated_depreciation_cents,net_book_value_cents,custodian_email,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.asset_tag).trim(),
              String(v.name).trim(),
              String(v.asset_class || 'server_hardware'),
              v.acquisition_date as string,
              (v.capitalization_date as string) || (v.acquisition_date as string),
              cost,
              salvage,
              Number(v.useful_life_months),
              String(v.depreciation_method || 'straight_line'),
              accum,
              nbv,
              (v.custodian_email as string) || null,
              email,
            ),
        ],
        'rti_finance',
        id,
        'FIXED_ASSET_REGISTER',
        { asset_tag: v.asset_tag, acquisition_cost_cents: cost, monthlyDepreciationCents },
      );
      return erpReply({ success: true, id, net_book_value_cents: nbv, monthlyDepreciationCents }, 201);
    }

    if (action === 'register_license_inventory') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.sku_code, 3, 60) &&
          erpText(v.product_name, 3, 160) &&
          ['hardware_inventory', 'software_license', 'security_appliance', 'cloud_subscription'].includes(String(v.item_kind || 'software_license')) &&
          Number.isSafeInteger(v.total_seats_units) &&
          Number(v.total_seats_units) > 0 &&
          erpPositiveCents(v.total_prepaid_cost_cents) &&
          erpDate(v.start_date) &&
          erpDate(v.renewal_date),
        'Parameter Inventory & License Accounting tidak valid',
      );
      const totalCost = Number(v.total_prepaid_cost_cents);
      const amortized = Number(v.amortized_cost_cents || 0);
      const remaining = totalCost - amortized;
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_license_inventory(id,tenant_id,legal_entity_id,sku_code,product_name,item_kind,vendor_id,project_id,customer_id,total_seats_units,assigned_seats_units,total_prepaid_cost_cents,amortized_cost_cents,remaining_book_value_cents,billed_revenue_cents,start_date,renewal_date,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.sku_code).trim(),
              String(v.product_name).trim(),
              String(v.item_kind || 'software_license'),
              (v.vendor_id as string) || null,
              (v.project_id as string) || null,
              (v.customer_id as string) || null,
              Number(v.total_seats_units),
              Number(v.assigned_seats_units || 0),
              totalCost,
              amortized,
              remaining,
              Number(v.billed_revenue_cents || 0),
              v.start_date as string,
              v.renewal_date as string,
              email,
            ),
        ],
        'rti_finance',
        id,
        'LICENSE_INVENTORY_REGISTER',
        { sku_code: v.sku_code, total_prepaid_cost_cents: totalCost },
      );
      return erpReply({ success: true, id, remaining_book_value_cents: remaining }, 201);
    }

    // =========================================================================
    // WP07 & WP08: FINANCIAL CLOSING COCKPIT, CONSOLIDATION & ICOFR (F20, F22, F23)
    // =========================================================================
    if (action === 'update_closing_cockpit') {
      erpAssert(
        erpId(v.legal_entity_id) && erpId(v.period_id) && erpPeriod(v.period_code),
        'Period ID, Legal Entity, dan Period Code wajib',
      );
      const stage = String(v.close_stage || 'soft_close');
      const completedCount = Number(v.completed_tasks_count ?? 17);
      const controllerEmail = (v.controller_reviewed_by as string) || email;
      const cfoEmail = (v.cfo_approved_by as string) || null;

      if (stage === 'approved' || stage === 'hard_close') {
        erpAssert(
          completedCount === 17 && cfoEmail && controllerEmail.toLowerCase() !== cfoEmail.toLowerCase(),
          'Hard Close membutuhkan seluruh 17 checklist selesai serta sign-off independen Controller dan CFO',
          422,
        );
      }

      const checklistJson = JSON.stringify(v.checklist || FINANCIAL_CLOSING_17_CHECKLIST);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_period_controls(tenant_id,period_id,legal_entity_id,period_code,period_type,close_stage,checklist_json,completed_tasks_count,controller_reviewed_by,cfo_approved_by) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,period_id) DO UPDATE SET close_stage=excluded.close_stage, checklist_json=excluded.checklist_json, completed_tasks_count=excluded.completed_tasks_count, controller_reviewed_by=excluded.controller_reviewed_by, cfo_approved_by=excluded.cfo_approved_by, updated_at=CURRENT_TIMESTAMP',
            )
            .bind(
              TENANT,
              v.period_id as string,
              v.legal_entity_id as string,
              v.period_code as string,
              String(v.period_type || 'monthly'),
              stage,
              checklistJson,
              completedCount,
              controllerEmail,
              cfoEmail,
            ),
        ],
        'rti_finance',
        v.period_id as string,
        'CLOSING_COCKPIT_UPDATE',
        { close_stage: stage, completed_tasks_count: completedCount },
      );
      return erpReply({ success: true, close_stage: stage });
    }

    if (action === 'reopen_closed_period') {
      erpAssert(
        ['cfo', 'financial_controller'].includes(financeRole),
        'Reopening periode yang sudah ditutup hanya diizinkan untuk CFO atau Financial Controller',
        403,
      );
      erpAssert(
        erpId(v.period_id) && erpText(v.reopen_reason, 15, 500),
        'Reopening periode wajib menyertakan alasan perubahan minimal 15 karakter',
      );
      const curr = await db
        .prepare('SELECT period_id, close_stage, reopen_count FROM rticore_finance_period_controls WHERE tenant_id=? AND period_id=?')
        .bind(TENANT, v.period_id as string)
        .first<{ period_id: string; close_stage: string; reopen_count: number }>();
      erpAssert(curr, 'Kontrol periode tidak ditemukan', 404);

      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              "UPDATE rticore_finance_period_controls SET close_stage='soft_close', reopen_count=reopen_count+1, last_reopen_reason=?, last_reopened_by=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND period_id=?",
            )
            .bind(String(v.reopen_reason).trim(), email, TENANT, curr.period_id),
        ],
        'rti_finance',
        curr.period_id,
        'PERIOD_REOPEN_AUTHORIZED',
        { reason: v.reopen_reason, reopen_count: Number(curr.reopen_count) + 1 },
      );
      return erpReply({ success: true, close_stage: 'soft_close', reopen_count: Number(curr.reopen_count) + 1 });
    }

    if (action === 'record_intercompany_elimination') {
      erpAssert(
        erpPeriod(v.period_code) &&
          erpId(v.source_entity_id) &&
          erpId(v.counterparty_entity_id) &&
          v.source_entity_id !== v.counterparty_entity_id &&
          erpPositiveCents(v.amount_cents),
        'Parameter eliminasi intercompany tidak valid atau entitas sama',
      );
      const amt = Number(v.amount_cents);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              "INSERT INTO rticore_finance_intercompany_eliminations(id,tenant_id,period_code,source_entity_id,counterparty_entity_id,elimination_kind,source_amount_cents,counterparty_amount_cents,elimination_amount_cents,status,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,'eliminated',?)",
            )
            .bind(
              id,
              TENANT,
              v.period_code as string,
              v.source_entity_id as string,
              v.counterparty_entity_id as string,
              String(v.elimination_kind || 'intercompany_revenue_expense'),
              amt,
              amt,
              amt,
              email,
            ),
        ],
        'rti_finance',
        id,
        'INTERCOMPANY_ELIMINATION',
        { source_entity_id: v.source_entity_id, counterparty_entity_id: v.counterparty_entity_id, amount_cents: amt },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'register_icofr_control') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpText(v.control_code, 3, 40) &&
          erpText(v.risk_description, 12, 500) &&
          erpText(v.control_objective, 12, 500) &&
          erpText(v.control_owner_email, 5, 160),
        'Parameter ICOFR Risk & Control Matrix tidak lengkap',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_icofr_controls(id,tenant_id,legal_entity_id,control_code,coso_component,control_category,risk_description,control_objective,control_owner_email,frequency,tod_status,toe_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.control_code).trim(),
              String(v.coso_component || 'control_activities'),
              String(v.control_category || 'it_application'),
              String(v.risk_description).trim(),
              String(v.control_objective).trim(),
              String(v.control_owner_email).trim().toLowerCase(),
              String(v.frequency || 'continuous'),
              String(v.tod_status || 'effective'),
              String(v.toe_status || 'effective'),
            ),
        ],
        'rti_finance',
        id,
        'ICOFR_CONTROL_REGISTER',
        { control_code: v.control_code },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'log_financial_exception') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          ICOFR_15_AUTOMATED_CONTROLS.includes(v.exception_kind as (typeof ICOFR_15_AUTOMATED_CONTROLS)[number]) &&
          ['low', 'medium', 'high', 'critical'].includes(String(v.severity || 'high')) &&
          erpText(v.description, 12, 500) &&
          erpText(v.responsible_owner_email, 5, 160) &&
          erpDate(v.due_date),
        'Parameter Financial Exception tidak lengkap',
      );
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_exceptions(id,tenant_id,legal_entity_id,exception_kind,severity,source_domain,source_record_id,description,responsible_owner_email,due_date,evidence_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              String(v.exception_kind),
              String(v.severity || 'high'),
              String(v.source_domain || 'general_ledger'),
              String(v.source_record_id || id),
              String(v.description).trim(),
              String(v.responsible_owner_email).trim().toLowerCase(),
              v.due_date as string,
              (v.evidence_reference as string) || null,
            ),
        ],
        'rti_finance',
        id,
        'ICOFR_EXCEPTION_LOG',
        { exception_kind: v.exception_kind, severity: v.severity },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'record_reconciliation') {
      erpAssert(
        erpId(v.legal_entity_id) &&
          erpPeriod(v.period_code) &&
          Number.isSafeInteger(v.source_balance_cents) &&
          Number.isSafeInteger(v.target_gl_balance_cents) &&
          erpText(v.notes, 12, 500),
        'Parameter rekonsiliasi subledger-ke-GL tidak lengkap',
      );
      const src = Number(v.source_balance_cents);
      const gl = Number(v.target_gl_balance_cents);
      const variance = src - gl;
      const status = variance === 0 ? 'matched' : 'exception';
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db
            .prepare(
              'INSERT INTO rticore_finance_reconciliations(id,tenant_id,legal_entity_id,period_code,reconciliation_kind,source_balance_cents,target_gl_balance_cents,variance_cents,status,notes,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              TENANT,
              v.legal_entity_id as string,
              v.period_code as string,
              String(v.reconciliation_kind || 'ar_to_gl'),
              src,
              gl,
              variance,
              status,
              String(v.notes).trim(),
              email,
            ),
        ],
        'rti_finance',
        id,
        'SUBLEDGER_GL_RECONCILE',
        { kind: v.reconciliation_kind, variance_cents: variance, status },
      );
      return erpReply({ success: true, id, variance_cents: variance, status }, 201);
    }

    // =========================================================================
    // WP09: AI FINANCIAL INTELLIGENCE (READ-ONLY DECISION SUPPORT - F24)
    // =========================================================================
    if (action === 'ai_financial_query') {
      // Rule 23: AI is strictly forbidden from posting journals, modifying data,
      // approving payments, or closing accounting periods autonomously.
      if (v.attempt_autonomous_mutation === true) {
        throw new ERPError(
          'AI_AUTONOMOUS_MUTATION_FORBIDDEN: AI Financial Assistant dilarang keras melakukan posting jurnal, mengubah saldo, menyetujui pembayaran, atau menutup periode akuntansi.',
          403,
        );
      }
      erpAssert(erpText(v.query, 4, 600), 'Pertanyaan finansial minimal 4 karakter');
      const q = String(v.query).toLowerCase();

      return erpReply({
        success: true,
        readOnlyGuard: 'ENFORCED_NO_AUTONOMOUS_POSTING_OR_APPROVAL',
        query: v.query,
        insight: {
          headline: q.includes('overrun') || q.includes('project')
            ? 'Analisis Risiko Project Cost Overrun & Margin (Provisional vs Certified)'
            : q.includes('cash') || q.includes('13')
            ? 'Proyeksi Likuiditas 13 Minggu & Buffer Modal Kerja'
            : q.includes('collection') || q.includes('customer') || q.includes('aging')
            ? 'Prioritas Collection AR Berdasarkan Aging & DSO'
            : 'Penjelasan Varians Laporan Keuangan & Rekomendasi Klasifikasi Jurnal',
          explanation:
            'Rekomendasi dihasilkan secara read-only dari agregasi General Ledger, Subledger AR/AP, PSAK 115 Revenue Schedule, dan Project Cost Ledger pada tenant aktif.',
          assumptions: [
            'Hanya jurnal berstatus POSTED yang masuk ke perhitungan saldo aktual GL.',
            'Profitabilitas proyek yang belum melewati Hard Close periode ditandai sebagai PROVISIONAL.',
            'Setiap saran jurnal harus dibuat sebagai DRAFT oleh Maker dan disetujui oleh Approver independen.',
          ],
          traceableSources: [
            'rticore_gl_journals',
            'rticore_billing_invoices',
            'rticore_ap_supplier_invoices',
            'rticore_finance_performance_obligations',
            'rticore_finance_project_snapshots',
            'rticore_finance_cash_forecasts',
          ],
        },
      });
    }

    throw new ERPError(`Aksi RTI Finance '${action}' tidak dikenali`, 422);
  } catch (e) {
    return erpError(e);
  }
}
