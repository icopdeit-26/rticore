import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['admin', 'approver', 'presales', 'project_manager', 'governance_leader', 'governance_member', 'defense_leader', 'defense_member', 'offense_lead', 'finance', 'legal'];

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

async function requireEntity(identity: BoQIdentity, entityId: string): Promise<void> {
  erpAssert((await authorizedEntities(identity)).includes(entityId), 'Akses legal entity Cyber/GRC/CTI ditolak', 403);
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(ALLOWED_ROLES.includes(role), 'Role tidak memiliki akses ke modul Cyber/GRC/CTI', 403);
    const requestedEntity = new URL(req.url).searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [ctiCases, ctiIocs, grcEngagements, risks, controls] = await Promise.all([
      db.prepare('SELECT * FROM rticore_cti_cases WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_cti_iocs WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 300').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_grc_engagements WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_enterprise_risk_register WHERE tenant_id=? AND legal_entity_id=? ORDER BY (residual_likelihood * residual_impact) DESC LIMIT 150').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_enterprise_control_register WHERE tenant_id=? AND legal_entity_id=? ORDER BY control_code ASC LIMIT 200').bind(TENANT, legalEntityId).all(),
    ]);

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      authorized_entities: entities,
      cti_cases: ctiCases.results,
      cti_iocs: ctiIocs.results,
      grc_engagements: grcEngagements.results,
      enterprise_risks: risks.results,
      enterprise_controls: controls.results,
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
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah data Cyber/GRC/CTI', 403);
    const v = (await readBoundedJSON(req, 24000)) as Record<string, unknown>;
    const action = String(v.action || '');

    if (action === 'create_cti_case') {
      erpAssert(['admin', 'defense_leader', 'defense_member', 'presales', 'project_manager'].includes(role), 'Hak akses CTI ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.case_code, 4, 64) && erpText(v.title, 5, 200), 'Data kasus CTI wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_cti_cases(id,tenant_id,legal_entity_id,customer_id,case_code,title,request_type,tlp_classification,severity,assigned_analyst_email,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,'intake',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.customer_id === 'string' ? v.customer_id : null,
            String(v.case_code).trim(), String(v.title).trim(), String(v.request_type || 'intelligence_request'),
            String(v.tlp_classification || 'TLP:AMBER'), String(v.severity || 'medium'),
            typeof v.assigned_analyst_email === 'string' ? v.assigned_analyst_email.toLowerCase() : email, email,
          ),
        ],
        'cyber_cti', id, 'CTI_CASE_CREATED', { case_code: v.case_code, severity: v.severity },
      );
      return erpReply({ success: true, id, status: 'intake' }, 201);
    }

    if (action === 'add_cti_ioc') {
      erpAssert(['admin', 'defense_leader', 'defense_member', 'presales'].includes(role), 'Hak akses IOC ditolak', 403);
      erpAssert(erpId(v.cti_case_id) && erpText(v.indicator_value, 3, 512), 'cti_case_id dan indicator_value wajib');
      const c = await db.prepare('SELECT id, legal_entity_id FROM rticore_cti_cases WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.cti_case_id as string).first<{ id: string; legal_entity_id: string }>();
      erpAssert(c, 'CTI case tidak ditemukan', 404);
      await requireEntity(a.identity, c.legal_entity_id);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("INSERT INTO rticore_cti_iocs(id,tenant_id,legal_entity_id,cti_case_id,ioc_type,indicator_value,confidence_score,tlp_classification,active,created_by) VALUES(?,?,?,?,?,?,?,?,1,?)")
            .bind(id, TENANT, c.legal_entity_id, c.id, String(v.ioc_type || 'domain'), String(v.indicator_value).trim(), Number(v.confidence_score ?? 80), String(v.tlp_classification || 'TLP:AMBER'), email),
        ],
        'cyber_cti', id, 'CTI_IOC_ADDED', { cti_case_id: c.id, ioc_type: v.ioc_type },
      );
      return erpReply({ success: true, id }, 201);
    }

    if (action === 'create_grc_engagement') {
      erpAssert(['admin', 'governance_leader', 'governance_member', 'project_manager', 'presales'].includes(role), 'Hak akses GRC ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.engagement_code, 4, 64) && erpText(v.title, 5, 200), 'Data engagement GRC wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const total = Math.max(0, Number(v.total_controls || 0));
      const compliant = Math.max(0, Number(v.compliant_controls || 0));
      erpAssert(compliant <= total, 'Compliant controls tidak boleh melebihi total controls');
      const readinessBps = total > 0 ? Math.round((compliant * 10000) / total) : 0;
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_grc_engagements(id,tenant_id,legal_entity_id,customer_id,project_id,engagement_code,framework,title,total_controls,compliant_controls,open_gaps,audit_readiness_bps,roadmap_summary,status,lead_consultant_email,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.customer_id === 'string' ? v.customer_id : null,
            typeof v.project_id === 'string' ? v.project_id : null, String(v.engagement_code).trim(),
            String(v.framework || 'ISO_27001'), String(v.title).trim(), total, compliant, total - compliant,
            readinessBps, String(v.roadmap_summary || ''), String(v.status || 'assessment'),
            String(v.lead_consultant_email || email).toLowerCase(), email,
          ),
        ],
        'grc_consulting', id, 'GRC_ENGAGEMENT_CREATED', { engagement_code: v.engagement_code, framework: v.framework, audit_readiness_bps: readinessBps },
      );
      return erpReply({ success: true, id, audit_readiness_bps: readinessBps }, 201);
    }

    if (action === 'register_enterprise_risk') {
      erpAssert(['admin', 'approver', 'governance_leader', 'finance', 'legal'].includes(role), 'Hak akses Risk Register ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.risk_code, 3, 48) && erpText(v.title, 5, 200) && erpText(v.description, 12, 2000), 'Data risiko enterprise wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_enterprise_risk_register(id,tenant_id,legal_entity_id,risk_code,risk_domain,title,description,inherent_likelihood,inherent_impact,residual_likelihood,residual_impact,kri_metric,kri_threshold,risk_owner_email,remediation_plan,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, String(v.risk_code).trim(), String(v.risk_domain || 'cybersecurity'),
            String(v.title).trim(), String(v.description).trim(),
            Number(v.inherent_likelihood || 3), Number(v.inherent_impact || 4),
            Number(v.residual_likelihood || 2), Number(v.residual_impact || 3),
            typeof v.kri_metric === 'string' ? v.kri_metric : null,
            typeof v.kri_threshold === 'string' ? v.kri_threshold : null,
            String(v.risk_owner_email || email).toLowerCase(), String(v.remediation_plan || ''), email,
          ),
        ],
        'enterprise_risk', id, 'RISK_REGISTERED', { risk_code: v.risk_code, risk_domain: v.risk_domain },
      );
      return erpReply({ success: true, id, status: 'open' }, 201);
    }

    if (action === 'register_enterprise_control') {
      erpAssert(['admin', 'approver', 'governance_leader', 'finance'].includes(role), 'Hak akses Control Register ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.control_code, 3, 48) && erpText(v.title, 5, 200), 'Data kontrol wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_enterprise_control_register(id,tenant_id,legal_entity_id,risk_id,control_code,regulatory_ref,title,control_type,control_owner_email,assessment_status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,'not_tested',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.risk_id === 'string' ? v.risk_id : null,
            String(v.control_code).trim(), String(v.regulatory_ref || 'ISO_27001'),
            String(v.title).trim(), String(v.control_type || 'preventive'),
            String(v.control_owner_email || email).toLowerCase(), email,
          ),
        ],
        'enterprise_risk', id, 'CONTROL_REGISTERED', { control_code: v.control_code },
      );
      return erpReply({ success: true, id, assessment_status: 'not_tested' }, 201);
    }

    if (action === 'test_enterprise_control') {
      erpAssert(['admin', 'approver', 'governance_leader', 'finance'].includes(role), 'Hak akses pengujian kontrol ditolak', 403);
      erpAssert(erpId(v.control_id) && erpText(v.test_notes, 12, 1000), 'control_id dan test_notes minimal 12 karakter wajib');
      const ctrl = await db.prepare('SELECT id, legal_entity_id, control_owner_email FROM rticore_enterprise_control_register WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.control_id as string).first<{ id: string; legal_entity_id: string; control_owner_email: string }>();
      erpAssert(ctrl, 'Kontrol tidak ditemukan', 404);
      await requireEntity(a.identity, ctrl.legal_entity_id);
      // Independent testing SoD: control owner cannot test own control!
      erpAssert(ctrl.control_owner_email.toLowerCase() !== email.toLowerCase(), 'Pemilik kontrol tidak boleh menguji efektivitas kontrol sendiri (SoD)', 403);
      const status = String(v.assessment_status || 'effective');
      erpAssert(['effective', 'partially_effective', 'ineffective'].includes(status), 'Status asesmen kontrol tidak valid');
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("UPDATE rticore_enterprise_control_register SET assessment_status=?, tested_by=?, tested_at=CURRENT_TIMESTAMP, test_notes=? WHERE tenant_id=? AND id=? AND lower(control_owner_email)!=?")
            .bind(status, email, String(v.test_notes).trim(), TENANT, ctrl.id, email.toLowerCase()),
        ],
        'enterprise_risk', ctrl.id, 'CONTROL_TESTED', { assessment_status: status },
      );
      return erpReply({ success: true, id: ctrl.id, assessment_status: status });
    }

    return erpReply({ success: false, message: 'Action Cyber/GRC/CTI tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
