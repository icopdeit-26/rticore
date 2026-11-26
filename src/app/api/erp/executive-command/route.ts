import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert } from '@/lib/erp-core';
import { computeFlexGuardWalletBalance, type FlexGuardLedgerEntry } from '@/lib/flexguard-enterprise';

export const dynamic = 'force-dynamic';

const EXEC_ROLES = ['admin', 'finance', 'approver'];

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

/**
 * M01 & Section 12 — Executive Command Center API.
 * Strictly entity-scoped; aggregates live database records across Commercial,
 * Service Profitability, Resource Utilization, FlexGuard Performance, Financial & Operational Risk.
 */
export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(EXEC_ROLES.includes(role), 'Hanya Executive / Finance / Admin / Approver yang dapat mengakses Executive Command Center', 403);
    const requestedEntity = new URL(req.url).searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [
      oppStats,
      pricingStats,
      timesheetStats,
      fgLedger,
      fgRequests,
      budgetStats,
      riskStats,
      ctiStats,
      grcStats,
      jobStats,
    ] = await Promise.all([
      db.prepare(
        `SELECT
          count(*) AS total_opps,
          sum(CASE WHEN o.stage='closed_won' THEN 1 ELSE 0 END) AS won_count,
          sum(CASE WHEN o.stage NOT IN ('closed_won','closed_lost') THEN coalesce(o.estimated_value_idr,0) ELSE 0 END) AS open_pipeline_idr,
          sum(CASE WHEN o.stage='closed_won' THEN coalesce(o.estimated_value_idr,0) ELSE 0 END) AS won_value_idr
         FROM rticore_sales_opportunities o
         JOIN rticore_erp_opportunity_scopes sc ON sc.opportunity_id=o.id AND sc.tenant_id=o.tenant_id
         WHERE o.tenant_id=? AND sc.legal_entity_id=? AND sc.status='approved'`,
      ).bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare(
        `SELECT
          count(*) AS total_scenarios,
          sum(CASE WHEN status='approved' THEN net_selling_price_cents ELSE 0 END) AS approved_revenue_cents,
          sum(CASE WHEN status='approved' THEN total_direct_cost_cents ELSE 0 END) AS approved_direct_cost_cents,
          sum(CASE WHEN status='approved' THEN fully_loaded_cost_cents ELSE 0 END) AS approved_loaded_cost_cents,
          coalesce(avg(CASE WHEN status='approved' THEN fully_loaded_margin_bps END), 0) AS avg_loaded_margin_bps
         FROM rticore_pricing_scenarios WHERE tenant_id=? AND legal_entity_id=?`,
      ).bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare(
        `SELECT
          count(*) AS entry_count,
          coalesce(sum(t.minutes), 0) AS total_minutes,
          coalesce(sum(t.cost_snapshot_cents), 0) AS total_labor_actual_cents
         FROM rticore_project_timesheets t
         JOIN rticore_erp_project_scopes sc ON sc.project_id=t.project_id AND sc.tenant_id=t.tenant_id
         WHERE t.tenant_id=? AND sc.legal_entity_id=? AND sc.status='approved' AND t.status='approved'`,
      ).bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare('SELECT transaction_type, credit_amount, approval_status, financial_value_cents FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND legal_entity_id=?')
        .bind(TENANT, legalEntityId).all<FlexGuardLedgerEntry>(),
      db.prepare('SELECT count(*) AS total_requests, sum(CASE WHEN emergency_flag=1 THEN 1 ELSE 0 END) AS emergency_requests FROM rticore_flexguard_service_requests WHERE tenant_id=? AND legal_entity_id=?')
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare('SELECT coalesce(sum(allocated_cents),0) AS budget_cents, coalesce(sum(committed_cents),0) AS committed_cents, coalesce(sum(actual_spent_cents),0) AS actual_cents FROM rticore_finance_budgets WHERE tenant_id=? AND legal_entity_id=?')
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare("SELECT count(*) AS open_risks, sum(CASE WHEN (residual_likelihood * residual_impact) >= 15 THEN 1 ELSE 0 END) AS high_risks FROM rticore_enterprise_risk_register WHERE tenant_id=? AND legal_entity_id=? AND status IN ('open','mitigating')")
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare("SELECT count(*) AS active_cti FROM rticore_cti_cases WHERE tenant_id=? AND legal_entity_id=? AND status != 'closed'")
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare("SELECT count(*) AS active_grc, coalesce(avg(audit_readiness_bps),0) AS avg_readiness_bps FROM rticore_grc_engagements WHERE tenant_id=? AND legal_entity_id=? AND status != 'closed'")
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
      db.prepare("SELECT sum(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued_jobs, sum(CASE WHEN status='dead_letter' THEN 1 ELSE 0 END) AS dlq_jobs FROM rticore_background_jobs WHERE tenant_id=? AND (legal_entity_id=? OR legal_entity_id IS NULL)")
        .bind(TENANT, legalEntityId).first<Record<string, number>>(),
    ]);

    const fgBalance = computeFlexGuardWalletBalance(fgLedger.results);
    const totalOpps = Number(oppStats?.total_opps || 0);
    const wonCount = Number(oppStats?.won_count || 0);
    const approvedRev = Number(pricingStats?.approved_revenue_cents || 0);
    const approvedLoaded = Number(pricingStats?.approved_loaded_cost_cents || 0);
    const budgetCents = Number(budgetStats?.budget_cents || 0);
    const actualBudgetCents = Number(budgetStats?.actual_cents || 0);

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      authorized_entities: entities,
      generated_at: new Date().toISOString(),
      commercial_performance: {
        total_opportunities: totalOpps,
        won_opportunities: wonCount,
        win_rate_bps: totalOpps > 0 ? Math.round((wonCount * 10000) / totalOpps) : 0,
        open_pipeline_idr: Number(oppStats?.open_pipeline_idr || 0),
        won_backlog_idr: Number(oppStats?.won_value_idr || 0),
      },
      service_profitability: {
        total_pricing_scenarios: Number(pricingStats?.total_scenarios || 0),
        approved_revenue_cents: approvedRev,
        approved_direct_cost_cents: Number(pricingStats?.approved_direct_cost_cents || 0),
        approved_fully_loaded_cost_cents: approvedLoaded,
        estimated_ebitda_contribution_cents: approvedRev - approvedLoaded,
        avg_fully_loaded_margin_bps: Math.round(Number(pricingStats?.avg_loaded_margin_bps || 0)),
      },
      resource_performance: {
        approved_timesheet_entries: Number(timesheetStats?.entry_count || 0),
        approved_billable_hours: Math.round((Number(timesheetStats?.total_minutes || 0) / 60) * 10) / 10,
        actual_labor_cost_cents: Number(timesheetStats?.total_labor_actual_cents || 0),
      },
      flexguard_performance: {
        credits_allocated: fgBalance.allocatedCredits,
        credits_reserved: fgBalance.reservedCredits,
        credits_consumed: fgBalance.consumedCredits,
        credits_available: fgBalance.availableCredits,
        credits_expired: fgBalance.expiredCredits,
        utilization_bps: fgBalance.utilizationBps,
        total_service_requests: Number(fgRequests?.total_requests || 0),
        emergency_requests: Number(fgRequests?.emergency_requests || 0),
      },
      financial_and_risk: {
        budget_allocated_cents: budgetCents,
        budget_committed_cents: Number(budgetStats?.committed_cents || 0),
        budget_actual_cents: actualBudgetCents,
        budget_variance_cents: budgetCents - actualBudgetCents,
        open_enterprise_risks: Number(riskStats?.open_risks || 0),
        high_critical_risks: Number(riskStats?.high_risks || 0),
        active_cti_cases: Number(ctiStats?.active_cti || 0),
        active_grc_engagements: Number(grcStats?.active_grc || 0),
        avg_grc_readiness_bps: Math.round(Number(grcStats?.avg_readiness_bps || 0)),
        queued_background_jobs: Number(jobStats?.queued_jobs || 0),
        dead_letter_jobs: Number(jobStats?.dlq_jobs || 0),
      },
    });
  } catch (e) {
    return erpError(e);
  }
}
