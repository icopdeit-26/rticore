import { authorizeBoQ } from '@/lib/boq-auth';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

/**
 * Unified Cross-Module Enterprise SoD Approval Inbox (M02 / M30).
 * Strictly excludes records where the current authenticated user is the maker/requester,
 * preventing self-approval items from appearing in a reviewer's queue.
 */
export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role, email } = a.identity;
  try {
    erpAssert(['admin', 'approver', 'finance', 'project_manager'].includes(role), 'Role tidak memiliki akses ke Enterprise Approval Inbox', 403);
    const me = email.toLowerCase();

    const [services, rateCards, scenarios, fgPackages, fgAdjustments, vaptRoe, flags, backupDrills] = await Promise.all([
      db.prepare("SELECT id, legal_entity_id, service_code AS ref, service_name AS title, created_by AS maker, created_at FROM rticore_service_catalog_v2 WHERE tenant_id=? AND lifecycle_status='draft' AND lower(created_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, role_code AS ref, role_label AS title, created_by AS maker, created_at FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND status='draft' AND lower(created_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, pricing_method AS ref, scenario_name AS title, created_by AS maker, created_at FROM rticore_pricing_scenarios WHERE tenant_id=? AND status='submitted' AND lower(created_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, package_code AS ref, package_name AS title, created_by AS maker, created_at FROM rticore_flexguard_packages WHERE tenant_id=? AND status='draft' AND lower(created_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, reference_code AS ref, reason AS title, actor_email AS maker, created_at FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=? AND transaction_type='adjustment' AND approval_status='pending_approval' AND lower(actor_email)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, engagement_code AS ref, title, created_by AS maker, created_at FROM rticore_vapt_engagements WHERE tenant_id=? AND status='registered' AND lower(created_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, legal_entity_id, flag_key AS ref, description AS title, requested_by AS maker, created_at FROM rticore_feature_flags WHERE tenant_id=? AND status='pending' AND lower(requested_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
      db.prepare("SELECT id, environment_name AS legal_entity_id, backup_kind AS ref, notes AS title, executed_by AS maker, created_at FROM rticore_backup_drills WHERE tenant_id=? AND restore_verified=0 AND lower(executed_by)!=? ORDER BY created_at DESC LIMIT 30").bind(TENANT, me).all(),
    ]);

    const queue = [
      ...services.results.map(r => ({ module: 'service_catalog', action_route: '/erp/service-catalog', ...r })),
      ...rateCards.results.map(r => ({ module: 'rate_card', action_route: '/erp/service-catalog', ...r })),
      ...scenarios.results.map(r => ({ module: 'pricing_scenario', action_route: '/erp/pricing-simulator', ...r })),
      ...fgPackages.results.map(r => ({ module: 'flexguard_package', action_route: '/erp/flexguard-enterprise', ...r })),
      ...fgAdjustments.results.map(r => ({ module: 'flexguard_adjustment', action_route: '/erp/flexguard-enterprise', ...r })),
      ...vaptRoe.results.map(r => ({ module: 'vapt_roe_authorization', action_route: '/erp/cyber-delivery', ...r })),
      ...flags.results.map(r => ({ module: 'feature_flag', action_route: '/erp/operations-center', ...r })),
      ...backupDrills.results.map(r => ({ module: 'backup_drill', action_route: '/erp/operations-center', ...r })),
    ];

    return erpReply({
      success: true,
      reviewer: email,
      total_pending: queue.length,
      queue,
    });
  } catch (e) {
    return erpError(e);
  }
}
