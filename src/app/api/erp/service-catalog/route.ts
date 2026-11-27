import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText, erpDate } from '@/lib/erp-core';
import {
  ENTERPRISE_SERVICE_CATEGORIES,
  STANDARD_ACTIVITY_PHASES,
  ENTERPRISE_RESOURCE_ROLES,
  COMPLEXITY_TIER_BPS,
  calculateLoadedResourceRate,
  type EnterpriseServiceCategory,
  type ActivityPhaseCode,
  type EnterpriseResourceRole,
} from '@/lib/enterprise-pricing-engine';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager', 'legal'];
const COST_VISIBLE_ROLES = ['admin', 'finance', 'approver'];

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

async function requireEntity(identity: BoQIdentity, entityId: string): Promise<void> {
  const allowed = await authorizedEntities(identity);
  erpAssert(allowed.includes(entityId), 'Akses legal entity Service Catalog ditolak', 403);
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(READ_ROLES.includes(role), 'Role tidak memiliki akses ke Service Catalog', 403);
    const url = new URL(req.url);
    const requestedEntity = url.searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui untuk akun ini', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [services, activities, complexity, rawRates] = await Promise.all([
      db.prepare('SELECT * FROM rticore_service_catalog_v2 WHERE tenant_id=? AND legal_entity_id=? ORDER BY service_category, service_code, service_version DESC LIMIT 250').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_service_activity_templates WHERE tenant_id=? AND legal_entity_id=? ORDER BY service_id, phase_order LIMIT 1000').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_complexity_matrices WHERE tenant_id=? AND legal_entity_id=? ORDER BY factor_group, matrix_code LIMIT 200').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND legal_entity_id=? ORDER BY role_code, effective_date DESC, version DESC LIMIT 300').bind(TENANT, legalEntityId).all<Record<string, unknown>>(),
    ]);

    const showCost = COST_VISIBLE_ROLES.includes(role);
    const rateCards = rawRates.results.map(r => showCost ? r : {
      id: r.id,
      legal_entity_id: r.legal_entity_id,
      role_code: r.role_code,
      role_label: r.role_label,
      standard_selling_rate_cents: r.standard_selling_rate_cents,
      min_selling_rate_cents: r.min_selling_rate_cents,
      overtime_multiplier_bps: r.overtime_multiplier_bps,
      emergency_multiplier_bps: r.emergency_multiplier_bps,
      effective_date: r.effective_date,
      version: r.version,
      status: r.status,
    });

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      authorized_entities: entities,
      reference: {
        categories: ENTERPRISE_SERVICE_CATEGORIES,
        activity_phases: STANDARD_ACTIVITY_PHASES,
        resource_roles: ENTERPRISE_RESOURCE_ROLES,
        complexity_tiers: COMPLEXITY_TIER_BPS,
      },
      services: services.results,
      activity_templates: activities.results,
      complexity_matrices: complexity.results,
      rate_cards: rateCards,
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
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah master Service Catalog', 403);
    const v = (await readBoundedJSON(req, 32000)) as Record<string, unknown>;
    const action = String(v.action || '');

    if (action === 'create_service') {
      erpAssert(['admin', 'presales', 'finance'].includes(role), 'Hanya Admin, Presales, atau Finance yang dapat membuat Service Master', 403);
      erpAssert(erpId(v.legal_entity_id), 'legal_entity_id wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      erpAssert(erpText(v.service_code, 3, 48) && erpText(v.service_name, 3, 160), 'Kode dan nama layanan wajib');
      const cat = String(v.service_category || '') as EnterpriseServiceCategory;
      erpAssert(ENTERPRISE_SERVICE_CATEGORIES.some(c => c.code === cat), 'Kategori layanan tidak valid');
      erpAssert(erpText(v.description, 8, 1000) && erpText(v.scope_summary, 8, 2000), 'Deskripsi dan scope wajib');
      const minMd = Number(v.min_mandays_tenths);
      const stdMd = Number(v.standard_mandays_tenths);
      const maxMd = Number(v.max_mandays_tenths);
      erpAssert(Number.isSafeInteger(minMd) && Number.isSafeInteger(stdMd) && Number.isSafeInteger(maxMd) && minMd >= 5 && stdMd >= minMd && maxMd >= stdMd, 'Range mandays (tenths) tidak valid');
      const effDate = String(v.effective_date || new Date().toISOString().slice(0, 10));
      erpAssert(erpDate(effDate), 'Format effective_date wajib YYYY-MM-DD');
      const version = Number.isSafeInteger(v.service_version) && Number(v.service_version) > 0 ? Number(v.service_version) : 1;
      const targetMarginBps = Number.isSafeInteger(v.target_gross_margin_bps) ? Number(v.target_gross_margin_bps) : 3500;
      const minMarginBps = Number.isSafeInteger(v.min_acceptable_margin_bps) ? Number(v.min_acceptable_margin_bps) : 2000;
      const overheadBps = Number.isSafeInteger(v.overhead_allocation_bps) ? Number(v.overhead_allocation_bps) : 1500;
      const slaHours = Number.isSafeInteger(v.standard_sla_hours) ? Number(v.standard_sla_hours) : 24;
      const complexity = String(v.complexity_level || 'standard');
      erpAssert(complexity in COMPLEXITY_TIER_BPS, 'Complexity level tidak valid');

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_service_catalog_v2(
              id,tenant_id,legal_entity_id,service_code,service_name,service_category,service_owner_email,
              description,scope_summary,deliverables_json,prerequisites,exclusions,unit_of_measurement,
              complexity_level,min_mandays_tenths,standard_mandays_tenths,max_mandays_tenths,
              resource_requirements_json,skill_requirements_json,default_tool_cost_cents,
              default_third_party_cost_cents,default_travel_cost_cents,overhead_allocation_bps,
              target_gross_margin_bps,min_acceptable_margin_bps,standard_sla_hours,flexguard_eligible,
              effective_date,service_version,lifecycle_status,created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, String(v.service_code).trim(), String(v.service_name).trim(),
            cat, String(v.service_owner_email || email).trim().toLowerCase(),
            String(v.description).trim(), String(v.scope_summary).trim(),
            JSON.stringify(Array.isArray(v.deliverables) ? v.deliverables : []),
            String(v.prerequisites || ''), String(v.exclusions || ''),
            String(v.unit_of_measurement || 'engagement'), complexity, minMd, stdMd, maxMd,
            JSON.stringify(Array.isArray(v.resource_requirements) ? v.resource_requirements : []),
            JSON.stringify(Array.isArray(v.skill_requirements) ? v.skill_requirements : []),
            Number(v.default_tool_cost_cents || 0), Number(v.default_third_party_cost_cents || 0), Number(v.default_travel_cost_cents || 0),
            overheadBps, targetMarginBps, minMarginBps, slaHours, v.flexguard_eligible === false || v.flexguard_eligible === 0 ? 0 : 1,
            effDate, version, email,
          ),
        ],
        'service_catalog',
        id,
        'SERVICE_CREATED',
        { service_code: v.service_code, service_category: cat, version },
      );
      return erpReply({ success: true, id, status: 'draft' }, 201);
    }

    if (action === 'approve_service') {
      erpAssert(['admin', 'approver', 'finance'].includes(role), 'Hanya Admin, Approver, atau Finance independen yang dapat menyetujui layanan', 403);
      erpAssert(erpId(v.service_id) && erpText(v.approval_notes, 12, 500), 'service_id dan approval_notes minimal 12 karakter wajib');
      const row = await db.prepare('SELECT id, legal_entity_id, created_by, lifecycle_status FROM rticore_service_catalog_v2 WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.service_id as string).first<{ id: string; legal_entity_id: string; created_by: string; lifecycle_status: string }>();
      erpAssert(row, 'Layanan tidak ditemukan', 404);
      await requireEntity(a.identity, row.legal_entity_id);
      erpAssert(row.lifecycle_status === 'draft', 'Hanya layanan berstatus draft yang dapat disetujui', 409);
      erpAssert(row.created_by.toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui layanan sendiri (SoD)', 403);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare("UPDATE rticore_service_catalog_v2 SET lifecycle_status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_notes=? WHERE tenant_id=? AND id=? AND lifecycle_status='draft' AND lower(created_by)!=?")
            .bind(email, String(v.approval_notes).trim(), TENANT, row.id, email.toLowerCase()),
        ],
        'service_catalog',
        row.id,
        'SERVICE_APPROVED',
        { legal_entity_id: row.legal_entity_id },
      );
      return erpReply({ success: true, id: row.id, status: 'approved' });
    }

    if (action === 'upsert_activity_template') {
      erpAssert(['admin', 'presales', 'finance'].includes(role), 'Hak akses ditolak untuk template aktivitas', 403);
      erpAssert(erpId(v.service_id), 'service_id wajib');
      const svc = await db.prepare('SELECT id, legal_entity_id FROM rticore_service_catalog_v2 WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.service_id as string).first<{ id: string; legal_entity_id: string }>();
      erpAssert(svc, 'Layanan tidak ditemukan', 404);
      await requireEntity(a.identity, svc.legal_entity_id);
      const phaseCode = String(v.phase_code || '') as ActivityPhaseCode;
      const phaseDef = STANDARD_ACTIVITY_PHASES.find(p => p.code === phaseCode);
      erpAssert(phaseDef, 'phase_code tidak valid (harus 1 dari 12 fase standar)');
      const roleCode = String(v.resource_role || '') as EnterpriseResourceRole;
      erpAssert(ENTERPRISE_RESOURCE_ROLES.some(r => r.code === roleCode), 'resource_role tidak valid');
      const stdHoursH = Number(v.standard_hours_per_unit_hundredths);
      const minHoursH = Number(v.min_effort_hours_hundredths ?? 0);
      const resCount = Number(v.resource_count ?? 1);
      const cBps = Number(v.complexity_factor_bps ?? 10000);
      erpAssert(Number.isSafeInteger(stdHoursH) && stdHoursH >= 0 && Number.isSafeInteger(minHoursH) && minHoursH >= 0, 'Estimasi jam tidak valid');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_service_activity_templates(
              id,tenant_id,legal_entity_id,service_id,phase_code,phase_order,activity_name,
              resource_role,skill_level,resource_count,standard_hours_per_unit_hundredths,
              min_effort_hours_hundredths,complexity_factor_bps,billable,depends_on_phase,created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(tenant_id, service_id, phase_code) DO UPDATE SET
              activity_name=excluded.activity_name,
              resource_role=excluded.resource_role,
              skill_level=excluded.skill_level,
              resource_count=excluded.resource_count,
              standard_hours_per_unit_hundredths=excluded.standard_hours_per_unit_hundredths,
              min_effort_hours_hundredths=excluded.min_effort_hours_hundredths,
              complexity_factor_bps=excluded.complexity_factor_bps,
              billable=excluded.billable,
              depends_on_phase=excluded.depends_on_phase`,
          ).bind(
            id, TENANT, svc.legal_entity_id, svc.id, phaseCode, phaseDef.order,
            String(v.activity_name || phaseDef.label).trim(), roleCode,
            String(v.skill_level || 'standard'), resCount, stdHoursH, minHoursH, cBps,
            v.billable === false || v.billable === 0 ? 0 : 1,
            typeof v.depends_on_phase === 'string' ? v.depends_on_phase : null,
            email,
          ),
        ],
        'service_catalog',
        svc.id,
        'ACTIVITY_TEMPLATE_SAVED',
        { phase_code: phaseCode, resource_role: roleCode, standard_hours_per_unit_hundredths: stdHoursH },
      );
      return erpReply({ success: true, service_id: svc.id, phase_code: phaseCode }, 201);
    }

    if (action === 'create_rate_card') {
      // Section 6.5: Sales cannot create or alter internal cost rates.
      erpAssert(['admin', 'finance'].includes(role), 'Hanya Admin atau Finance yang berwenang menetapkan internal cost rate card', 403);
      erpAssert(erpId(v.legal_entity_id), 'legal_entity_id wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const roleCode = String(v.role_code || '') as EnterpriseResourceRole;
      const roleDef = ENTERPRISE_RESOURCE_ROLES.find(r => r.code === roleCode);
      erpAssert(roleDef, 'role_code tidak valid (harus 1 dari 19 role enterprise)');
      const effDate = String(v.effective_date || new Date().toISOString().slice(0, 10));
      erpAssert(erpDate(effDate), 'Format effective_date wajib YYYY-MM-DD');

      const calc = calculateLoadedResourceRate({
        monthlyCompensationCents: Number(v.monthly_compensation_cents),
        benefitAllocationCents: Number(v.benefit_allocation_cents || 0),
        employerContribCents: Number(v.employer_contrib_cents || 0),
        allocatedExpenseCents: Number(v.allocated_expense_cents || 0),
        availableWorkingDays: Number(v.available_working_days || 240),
        targetUtilizationBps: Number(v.target_utilization_bps || 7500),
        targetMarginBps: Number(v.target_margin_bps || 4500),
        minMarginBps: Number(v.min_margin_bps || 2500),
      });

      const stdSell = Number.isSafeInteger(v.standard_selling_rate_cents) && Number(v.standard_selling_rate_cents) >= calc.internalCostPerMandayCents
        ? Number(v.standard_selling_rate_cents)
        : calc.standardSellingRateCents;
      const minSell = Number.isSafeInteger(v.min_selling_rate_cents) && Number(v.min_selling_rate_cents) >= calc.internalCostPerMandayCents && Number(v.min_selling_rate_cents) <= stdSell
        ? Number(v.min_selling_rate_cents)
        : Math.min(calc.minSellingRateCents, stdSell);
      const version = Number.isSafeInteger(v.version) && Number(v.version) > 0 ? Number(v.version) : 1;

      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare(
            `INSERT INTO rticore_enterprise_rate_cards(
              id,tenant_id,legal_entity_id,role_code,role_label,
              monthly_compensation_cents,benefit_allocation_cents,employer_contrib_cents,allocated_expense_cents,
              annual_loaded_cost_cents,available_working_days,target_utilization_bps,
              internal_cost_rate_cents,standard_selling_rate_cents,min_selling_rate_cents,
              overtime_multiplier_bps,emergency_multiplier_bps,effective_date,version,status,created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, roleCode, String(v.role_label || roleDef.label),
            Number(v.monthly_compensation_cents), Number(v.benefit_allocation_cents || 0),
            Number(v.employer_contrib_cents || 0), Number(v.allocated_expense_cents || 0),
            calc.annualLoadedCostCents, Number(v.available_working_days || 240), Number(v.target_utilization_bps || 7500),
            calc.internalCostPerMandayCents, stdSell, minSell,
            Number(v.overtime_multiplier_bps || 15000), Number(v.emergency_multiplier_bps || 20000),
            effDate, version, email,
          ),
        ],
        'rate_card',
        id,
        'RATE_CARD_CREATED',
        { role_code: roleCode, internal_cost_rate_cents: calc.internalCostPerMandayCents, standard_selling_rate_cents: stdSell, version },
      );
      return erpReply({
        success: true,
        id,
        status: 'draft',
        computed: calc,
        standard_selling_rate_cents: stdSell,
        min_selling_rate_cents: minSell,
      }, 201);
    }

    if (action === 'approve_rate_card') {
      erpAssert(['admin', 'approver'].includes(role), 'Hanya Admin atau Approver independen yang dapat menyetujui Rate Card', 403);
      erpAssert(erpId(v.rate_card_id) && erpText(v.approval_notes, 12, 500), 'rate_card_id dan approval_notes minimal 12 karakter wajib');
      const card = await db.prepare('SELECT id, legal_entity_id, role_code, created_by, status FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.rate_card_id as string).first<{ id: string; legal_entity_id: string; role_code: string; created_by: string; status: string }>();
      erpAssert(card, 'Rate Card tidak ditemukan', 404);
      await requireEntity(a.identity, card.legal_entity_id);
      erpAssert(card.status === 'draft', 'Hanya Rate Card draft yang dapat disetujui', 409);
      erpAssert(card.created_by.toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui Rate Card sendiri (SoD)', 403);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare("UPDATE rticore_enterprise_rate_cards SET status='superseded' WHERE tenant_id=? AND legal_entity_id=? AND role_code=? AND status='approved'")
            .bind(TENANT, card.legal_entity_id, card.role_code),
          db.prepare("UPDATE rticore_enterprise_rate_cards SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_notes=? WHERE tenant_id=? AND id=? AND status='draft' AND lower(created_by)!=?")
            .bind(email, String(v.approval_notes).trim(), TENANT, card.id, email.toLowerCase()),
        ],
        'rate_card',
        card.id,
        'RATE_CARD_APPROVED',
        { role_code: card.role_code, legal_entity_id: card.legal_entity_id },
      );
      return erpReply({ success: true, id: card.id, status: 'approved' });
    }

    if (action === 'create_complexity_factor') {
      erpAssert(['admin', 'presales', 'finance'].includes(role), 'Hak akses ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.matrix_code, 3, 64) && erpText(v.factor_key, 2, 64) && erpText(v.label, 3, 160), 'Data complexity matrix wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare("INSERT INTO rticore_complexity_matrices(id,tenant_id,legal_entity_id,matrix_code,factor_group,factor_key,label,multiplier_bps,status,created_by) VALUES(?,?,?,?,?,?,?,?,'draft',?)")
            .bind(id, TENANT, v.legal_entity_id as string, String(v.matrix_code).trim(), String(v.factor_group || 'tier'), String(v.factor_key).trim(), String(v.label).trim(), Number(v.multiplier_bps || 10000), email),
        ],
        'service_catalog',
        id,
        'COMPLEXITY_FACTOR_CREATED',
        { matrix_code: v.matrix_code, factor_key: v.factor_key, multiplier_bps: v.multiplier_bps },
      );
      return erpReply({ success: true, id, status: 'draft' }, 201);
    }

    return erpReply({ success: false, message: 'Action Service Catalog tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
