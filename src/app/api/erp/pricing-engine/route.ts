import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText } from '@/lib/erp-core';
import {
  PRICING_METHODS,
  calculateActivityBasedMandays,
  calculateEnterpriseServicePricing,
  computeHistoricalEffortRecommendation,
  type ActivityEffortItem,
  type EnterprisePricingMethod,
} from '@/lib/enterprise-pricing-engine';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager'];
const APPROVER_ROLES = ['admin', 'approver', 'finance'];
const COST_VISIBLE_ROLES = ['admin', 'finance', 'approver'];

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

async function requireEntity(identity: BoQIdentity, entityId: string): Promise<void> {
  const allowed = await authorizedEntities(identity);
  erpAssert(allowed.includes(entityId), 'Akses legal entity Pricing Engine ditolak', 403);
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(ALLOWED_ROLES.includes(role), 'Role tidak memiliki akses ke Enterprise Pricing Engine', 403);
    const url = new URL(req.url);
    const requestedEntity = url.searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [scenarios, snapshots, benchmarks] = await Promise.all([
      db.prepare('SELECT * FROM rticore_pricing_scenarios WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all<Record<string, unknown>>(),
      db.prepare('SELECT * FROM rticore_pricing_snapshots WHERE tenant_id=? AND legal_entity_id=? ORDER BY frozen_at DESC LIMIT 200').bind(TENANT, legalEntityId).all<Record<string, unknown>>(),
      db.prepare('SELECT * FROM rticore_historical_effort_benchmarks WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 200').bind(TENANT, legalEntityId).all<Record<string, unknown>>(),
    ]);

    const showCost = COST_VISIBLE_ROLES.includes(role);
    const maskedScenarios = scenarios.results.map(s => showCost ? s : {
      id: s.id,
      legal_entity_id: s.legal_entity_id,
      opportunity_id: s.opportunity_id,
      service_id: s.service_id,
      scenario_name: s.scenario_name,
      pricing_method: s.pricing_method,
      currency_code: s.currency_code,
      total_mandays_tenths: s.total_mandays_tenths,
      discount_bps: s.discount_bps,
      gross_selling_price_cents: s.gross_selling_price_cents,
      net_selling_price_cents: s.net_selling_price_cents,
      min_selling_price_cents: s.min_selling_price_cents,
      tax_amount_cents: s.tax_amount_cents,
      flexguard_credits_equivalent: s.flexguard_credits_equivalent,
      approval_required_level: s.approval_required_level,
      status: s.status,
      created_by: s.created_by,
      approved_by: s.approved_by,
      created_at: s.created_at,
    });

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      pricing_methods: PRICING_METHODS,
      scenarios: maskedScenarios,
      snapshots: showCost ? snapshots.results : snapshots.results.map(sn => ({
        id: sn.id, scenario_id: sn.scenario_id, quotation_id: sn.quotation_id, snapshot_version: sn.snapshot_version,
        net_selling_price_cents: sn.net_selling_price_cents, snapshot_hash: sn.snapshot_hash, frozen_by: sn.frozen_by, frozen_at: sn.frozen_at,
      })),
      benchmarks: benchmarks.results,
      cost_basis_visible: showCost,
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
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan menjalankan transaksi Pricing', 403);
    const v = (await readBoundedJSON(req, 32000)) as Record<string, unknown>;
    const action = String(v.action || '');

    if (action === 'simulate_and_save') {
      erpAssert(['admin', 'finance', 'presales', 'sales'].includes(role), 'Hak akses ditolak untuk simulasi pricing', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.scenario_name, 3, 160), 'legal_entity_id dan scenario_name wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const legalEntityId = v.legal_entity_id as string;
      const pricingMethod = String(v.pricing_method || 'target_margin') as EnterprisePricingMethod;
      erpAssert(PRICING_METHODS.includes(pricingMethod), 'Metode pricing tidak valid');
      const rawActivities = Array.isArray(v.activities) ? (v.activities as Record<string, unknown>[]) : [];
      erpAssert(rawActivities.length > 0 && rawActivities.length <= 30, 'Minimal 1 aktivitas (maks 30) wajib disediakan');

      // Load approved rate cards from DB for this legal entity.
      // Section 6.5: Sales CANNOT override approved internal cost rates.
      const cardRows = await db.prepare(
        "SELECT role_code, internal_cost_rate_cents, standard_selling_rate_cents, min_selling_rate_cents, overtime_multiplier_bps, emergency_multiplier_bps FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND legal_entity_id=? AND status='approved'",
      ).bind(TENANT, legalEntityId).all<{
        role_code: string; internal_cost_rate_cents: number; standard_selling_rate_cents: number;
        min_selling_rate_cents: number; overtime_multiplier_bps: number; emergency_multiplier_bps: number;
      }>();
      const cardMap = new Map(cardRows.results.map(c => [c.role_code, c]));

      const canOverrideCost = ['admin', 'finance'].includes(role);
      const activities: ActivityEffortItem[] = rawActivities.map(item => {
        const rc = String(item.resourceRole || item.resource_role || '');
        const approvedCard = cardMap.get(rc);
        if (item.internalCostRateCents !== undefined && approvedCard && !canOverrideCost && Number(item.internalCostRateCents) !== approvedCard.internal_cost_rate_cents) {
          erpAssert(false, 'Sales/Presales tidak diperbolehkan mengubah approved internal cost rate tanpa otorisasi Finance', 403);
        }
        const costRate = approvedCard ? approvedCard.internal_cost_rate_cents : Number(item.internalCostRateCents);
        erpAssert(Number.isSafeInteger(costRate) && costRate > 0, `Rate card aktif tidak ditemukan untuk role '${rc}'`);
        return {
          phaseCode: String(item.phaseCode || item.phase_code || 'technical_execution') as ActivityEffortItem['phaseCode'],
          activityName: String(item.activityName || item.activity_name || 'Activity'),
          resourceRole: rc as ActivityEffortItem['resourceRole'],
          resourceCount: Number(item.resourceCount ?? item.resource_count ?? 1),
          quantity: Number(item.quantity ?? 1),
          standardHoursPerUnitHundredths: Number(item.standardHoursPerUnitHundredths ?? item.standard_hours_per_unit_hundredths ?? 800),
          minEffortHoursHundredths: Number(item.minEffortHoursHundredths ?? item.min_effort_hours_hundredths ?? 0),
          complexityFactorBps: Number(item.complexityFactorBps ?? item.complexity_factor_bps ?? 10000),
          environmentFactorBps: Number(item.environmentFactorBps ?? item.environment_factor_bps ?? 10000),
          otherApprovedFactorBps: Number(item.otherApprovedFactorBps ?? item.other_approved_factor_bps ?? 10000),
          billable: item.billable !== false && item.billable !== 0,
          overtimeHoursHundredths: Number(item.overtimeHoursHundredths ?? 0),
          overtimeMultiplierBps: approvedCard?.overtime_multiplier_bps ?? Number(item.overtimeMultiplierBps ?? 15000),
          internalCostRateCents: costRate,
          sellingRateCents: approvedCard?.standard_selling_rate_cents ?? Number(item.sellingRateCents ?? costRate),
          creditMultiplierBps: Number(item.creditMultiplierBps ?? 10000),
        };
      });

      const effort = calculateActivityBasedMandays(activities, {
        workingHoursPerManday: Number(v.working_hours_per_md ?? 8),
        roundingMode: (v.rounding_mode as 'tenth' | 'half_day' | 'whole_day') || 'tenth',
        minimumChargeMandaysTenths: Number(v.minimum_charge_mandays_tenths ?? 0),
        emergencyMode: pricingMethod === 'emergency_service' || v.emergency_mode === true,
      });

      const pricing = calculateEnterpriseServicePricing({
        pricingMethod,
        directLaborCostCents: effort.totalDirectLaborCostCents,
        toolsCostCents: Number(v.tools_cost_cents ?? 0),
        licenseCostCents: Number(v.license_cost_cents ?? 0),
        travelCostCents: Number(v.travel_cost_cents ?? 0),
        thirdPartyCostCents: Number(v.third_party_cost_cents ?? 0),
        otherDirectCostCents: Number(v.other_direct_cost_cents ?? 0),
        overheadAllocationBps: Number(v.overhead_allocation_bps ?? 1000),
        riskContingencyBps: Number(v.risk_contingency_bps ?? 500),
        targetMarginBps: Number(v.target_margin_bps ?? 3500),
        minAcceptableMarginBps: Number(v.min_acceptable_margin_bps ?? 2000),
        discountBps: Number(v.discount_bps ?? 0),
        taxRateBps: Number(v.tax_rate_bps ?? 1100),
        fxRateMicro: Number(v.fx_rate_micro ?? 1_000_000),
        customSellingPriceCents: v.custom_selling_price_cents !== undefined ? Number(v.custom_selling_price_cents) : undefined,
        flexguardCreditsEquivalent: effort.totalFlexGuardCredits,
        flexguardCreditUnitPriceCents: Number(v.flexguard_credit_unit_price_cents ?? 450_000_000),
        isStrategicCustomer: Boolean(v.is_strategic_customer),
        paymentTermDays: Number(v.payment_term_days ?? 30),
        creditRiskHigh: Boolean(v.credit_risk_high),
        exceptionalTerms: Boolean(v.exceptional_terms),
      });

      // Negative margin prevention (Section 14.4)
      erpAssert(!pricing.negativeMarginBlocked, 'Harga jual di bawah break-even (negative margin) ditolak oleh kebijakan pricing', 422);

      if (v.dry_run === true) {
        return erpReply({ success: true, dry_run: true, effort, pricing });
      }

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_pricing_scenarios(
              id,tenant_id,legal_entity_id,opportunity_id,service_id,scenario_name,pricing_method,currency_code,
              working_hours_per_md,total_mandays_tenths,direct_labor_cost_cents,tools_cost_cents,license_cost_cents,
              travel_cost_cents,third_party_cost_cents,other_direct_cost_cents,total_direct_cost_cents,
              overhead_cents,risk_contingency_cents,fully_loaded_cost_cents,target_margin_bps,discount_bps,
              gross_selling_price_cents,net_selling_price_cents,break_even_price_cents,min_selling_price_cents,
              direct_gross_margin_bps,fully_loaded_margin_bps,tax_amount_cents,flexguard_credits_equivalent,
              approval_required_level,status,inputs_json,created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?)`,
          ).bind(
            id, TENANT, legalEntityId,
            typeof v.opportunity_id === 'string' && erpId(v.opportunity_id) ? v.opportunity_id : null,
            typeof v.service_id === 'string' && erpId(v.service_id) ? v.service_id : null,
            String(v.scenario_name).trim(), pricingMethod, String(v.currency_code || 'IDR').toUpperCase(),
            effort.workingHoursPerManday, effort.totalPersonDaysTenths,
            effort.totalDirectLaborCostCents, Number(v.tools_cost_cents ?? 0), Number(v.license_cost_cents ?? 0),
            Number(v.travel_cost_cents ?? 0), Number(v.third_party_cost_cents ?? 0), Number(v.other_direct_cost_cents ?? 0),
            pricing.totalDirectCostCents, pricing.overheadCents, pricing.riskContingencyCents, pricing.fullyLoadedCostCents,
            Number(v.target_margin_bps ?? 3500), Number(v.discount_bps ?? 0),
            pricing.grossSellingPriceCents, pricing.netSellingPriceCents, pricing.breakEvenPriceCents, pricing.minSellingPriceCents,
            pricing.directGrossMarginBps, pricing.fullyLoadedMarginBps, pricing.taxAmountCents, effort.totalFlexGuardCredits,
            pricing.approvalRequiredLevel, JSON.stringify({ activities: effort.breakdown, rateCards: cardRows.results }), email,
          ),
        ],
        'pricing_engine',
        id,
        'PRICING_SCENARIO_SUBMITTED',
        { pricing_method: pricingMethod, net_selling_price_cents: pricing.netSellingPriceCents, approval_required_level: pricing.approvalRequiredLevel },
      );

      return erpReply({ success: true, id, status: 'submitted', effort, pricing }, 201);
    }

    if (action === 'approve_scenario_and_snapshot') {
      erpAssert(APPROVER_ROLES.includes(role), 'Hanya Approver, Finance, atau Admin independen yang dapat menyetujui skenario pricing', 403);
      erpAssert(erpId(v.scenario_id) && erpText(v.approval_notes, 12, 500), 'scenario_id dan approval_notes minimal 12 karakter wajib');
      const sc = await db.prepare('SELECT * FROM rticore_pricing_scenarios WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.scenario_id as string).first<Record<string, unknown>>();
      erpAssert(sc, 'Skenario pricing tidak ditemukan', 404);
      await requireEntity(a.identity, String(sc.legal_entity_id));
      erpAssert(sc.status === 'submitted' || sc.status === 'draft', 'Skenario tidak dalam status dapat disetujui', 409);
      erpAssert(String(sc.created_by).toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui skenario pricing sendiri (SoD)', 403);

      const snapshotId = crypto.randomUUID();
      const parsedInputs = JSON.parse(String(sc.inputs_json || '{}'));
      const financialSummary = {
        pricing_method: sc.pricing_method,
        total_mandays_tenths: sc.total_mandays_tenths,
        direct_labor_cost_cents: sc.direct_labor_cost_cents,
        total_direct_cost_cents: sc.total_direct_cost_cents,
        fully_loaded_cost_cents: sc.fully_loaded_cost_cents,
        gross_selling_price_cents: sc.gross_selling_price_cents,
        discount_bps: sc.discount_bps,
        net_selling_price_cents: sc.net_selling_price_cents,
        direct_gross_margin_bps: sc.direct_gross_margin_bps,
        fully_loaded_margin_bps: sc.fully_loaded_margin_bps,
        tax_amount_cents: sc.tax_amount_cents,
      };
      const rateCardJson = JSON.stringify(parsedInputs.rateCards || []);
      const activityJson = JSON.stringify(parsedInputs.activities || []);
      const summaryJson = JSON.stringify(financialSummary);
      const snapshotHash = await sha256Hex(`${sc.id}|${rateCardJson}|${activityJson}|${summaryJson}`);

      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare("UPDATE rticore_pricing_scenarios SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_notes=? WHERE tenant_id=? AND id=? AND lower(created_by)!=?")
            .bind(email, String(v.approval_notes).trim(), TENANT, String(sc.id), email.toLowerCase()),
          db.prepare(
            `INSERT INTO rticore_pricing_snapshots(
              id,tenant_id,legal_entity_id,scenario_id,quotation_id,boq_id,snapshot_version,
              rate_card_snapshot_json,activity_breakdown_json,financial_summary_json,
              net_selling_price_cents,fully_loaded_cost_cents,snapshot_hash,frozen_by
            ) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
          ).bind(
            snapshotId, TENANT, String(sc.legal_entity_id), String(sc.id),
            typeof v.quotation_id === 'string' ? v.quotation_id : null,
            typeof v.boq_id === 'string' ? v.boq_id : null,
            rateCardJson, activityJson, summaryJson,
            Number(sc.net_selling_price_cents), Number(sc.fully_loaded_cost_cents), snapshotHash, email,
          ),
        ],
        'pricing_engine',
        snapshotId,
        'PRICING_SNAPSHOT_FROZEN',
        { scenario_id: sc.id, snapshot_hash: snapshotHash, net_selling_price_cents: sc.net_selling_price_cents },
      );

      return erpReply({ success: true, scenario_id: sc.id, snapshot_id: snapshotId, snapshot_hash: snapshotHash, status: 'approved' });
    }

    if (action === 'record_historical_benchmark') {
      erpAssert(['admin', 'finance', 'project_manager', 'presales'].includes(role), 'Hak akses ditolak untuk historical benchmark', 403);
      erpAssert(erpId(v.service_id), 'service_id wajib');
      const svc = await db.prepare('SELECT id, legal_entity_id, standard_mandays_tenths FROM rticore_service_catalog_v2 WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.service_id as string).first<{ id: string; legal_entity_id: string; standard_mandays_tenths: number }>();
      erpAssert(svc, 'Layanan tidak ditemukan', 404);
      await requireEntity(a.identity, svc.legal_entity_id);

      const plannedMd = Number(v.planned_mandays_tenths);
      const actualMd = Number(v.actual_mandays_tenths);
      const estCost = Number(v.estimated_cost_cents);
      const actCost = Number(v.actual_cost_cents);
      const estMargin = Number(v.estimated_margin_bps);
      const actMargin = Number(v.actual_margin_bps);
      erpAssert(plannedMd > 0 && actualMd > 0 && estCost > 0 && actCost > 0, 'Data planned/actual mandays dan cost wajib positif');

      const prior = await db.prepare('SELECT planned_mandays_tenths, actual_mandays_tenths, estimated_cost_cents, actual_cost_cents, estimated_margin_bps, actual_margin_bps FROM rticore_historical_effort_benchmarks WHERE tenant_id=? AND service_id=?')
        .bind(TENANT, svc.id).all<{ planned_mandays_tenths: number; actual_mandays_tenths: number; estimated_cost_cents: number; actual_cost_cents: number; estimated_margin_bps: number; actual_margin_bps: number }>();

      const samples = [
        ...prior.results.map(p => ({
          plannedMandaysTenths: p.planned_mandays_tenths,
          actualMandaysTenths: p.actual_mandays_tenths,
          estimatedCostCents: p.estimated_cost_cents,
          actualCostCents: p.actual_cost_cents,
          estimatedMarginBps: p.estimated_margin_bps,
          actualMarginBps: p.actual_margin_bps,
        })),
        { plannedMandaysTenths: plannedMd, actualMandaysTenths: actualMd, estimatedCostCents: estCost, actualCostCents: actCost, estimatedMarginBps: estMargin, actualMarginBps: actMargin },
      ];
      const rec = computeHistoricalEffortRecommendation(svc.standard_mandays_tenths, samples);
      const varianceBps = Math.round(((actualMd - plannedMd) * 10000) / plannedMd);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_historical_effort_benchmarks(
              id,tenant_id,legal_entity_id,service_id,project_id,planned_mandays_tenths,actual_mandays_tenths,
              estimated_cost_cents,actual_cost_cents,estimated_margin_bps,actual_margin_bps,
              delivery_variance_bps,retest_count,scope_changes_count,recommended_mandays_tenths,
              calibration_status,recorded_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'recommended',?)`,
          ).bind(
            id, TENANT, svc.legal_entity_id, svc.id,
            typeof v.project_id === 'string' ? v.project_id : null,
            plannedMd, actualMd, estCost, actCost, estMargin, actMargin, varianceBps,
            Number(v.retest_count || 0), Number(v.scope_changes_count || 0),
            rec.recommendedMandaysTenths, email,
          ),
        ],
        'pricing_engine',
        id,
        'HISTORICAL_BENCHMARK_RECORDED',
        { service_id: svc.id, recommended_mandays_tenths: rec.recommendedMandaysTenths, auto_applied: false },
      );
      return erpReply({ success: true, id, recommendation: rec }, 201);
    }

    return erpReply({ success: false, message: 'Action Pricing Engine tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
