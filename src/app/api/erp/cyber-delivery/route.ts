import { authorizeBoQ, type BoQIdentity } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText, erpDate, erpPeriod } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['admin', 'approver', 'presales', 'project_manager', 'offense_lead', 'offense_member', 'defense_leader', 'defense_member', 'finance'];

async function authorizedEntities(identity: BoQIdentity): Promise<string[]> {
  const rows = await identity.db.prepare(
    "SELECT u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND lower(s.email)=? AND s.status='approved') OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=? AND a.status='approved')) ORDER BY u.code",
  ).bind(TENANT, identity.email.toLowerCase(), identity.email.toLowerCase()).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

async function requireEntity(identity: BoQIdentity, entityId: string): Promise<void> {
  erpAssert((await authorizedEntities(identity)).includes(entityId), 'Akses legal entity Cyber Delivery ditolak', 403);
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(READ_ROLES.includes(role), 'Role tidak memiliki akses ke Cyber Delivery (VAPT/SOC/DFIR)', 403);
    const requestedEntity = new URL(req.url).searchParams.get('legal_entity_id');
    const entities = await authorizedEntities(a.identity);
    erpAssert(entities.length > 0, 'Belum ada legal entity yang disetujui', 403);
    const legalEntityId = requestedEntity || entities[0];
    erpAssert(entities.includes(legalEntityId), 'Akses lintas legal entity ditolak', 403);

    const [vaptEngagements, vaptFindings, dfirIncidents, dfirCustody, socMetrics] = await Promise.all([
      db.prepare('SELECT * FROM rticore_vapt_engagements WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_vapt_findings WHERE tenant_id=? AND legal_entity_id=? ORDER BY cvss_score_tenths DESC, created_at DESC LIMIT 300').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_dfir_incidents WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_dfir_chain_of_custody WHERE tenant_id=? AND legal_entity_id=? ORDER BY recorded_at DESC LIMIT 300').bind(TENANT, legalEntityId).all(),
      db.prepare('SELECT * FROM rticore_soc_sla_metrics WHERE tenant_id=? AND legal_entity_id=? ORDER BY period_code DESC LIMIT 120').bind(TENANT, legalEntityId).all<Record<string, unknown>>(),
    ]);

    const showFinance = ['admin', 'finance', 'approver'].includes(role);
    const maskedSoc = socMetrics.results.map(m => showFinance ? {
      ...m,
      soc_gross_profit_cents: Number(m.subscription_revenue_cents || 0) - Number(m.direct_soc_cost_cents || 0),
    } : {
      id: m.id, legal_entity_id: m.legal_entity_id, customer_id: m.customer_id, period_code: m.period_code,
      monitored_assets: m.monitored_assets, active_use_cases: m.active_use_cases, alerts_triaged: m.alerts_triaged,
      incidents_escalated: m.incidents_escalated, mttd_minutes: m.mttd_minutes, mttr_minutes: m.mttr_minutes,
      sla_compliance_bps: m.sla_compliance_bps,
    });

    return erpReply({
      success: true,
      legal_entity_id: legalEntityId,
      authorized_entities: entities,
      vapt_engagements: vaptEngagements.results,
      vapt_findings: vaptFindings.results,
      dfir_incidents: dfirIncidents.results,
      dfir_chain_of_custody: dfirCustody.results,
      soc_sla_metrics: maskedSoc,
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
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah Cyber Delivery', 403);
    const v = (await readBoundedJSON(req, 24000)) as Record<string, unknown>;
    const action = String(v.action || '');

    // M11: Register VAPT Engagement
    if (action === 'register_vapt_engagement') {
      erpAssert(['admin', 'offense_lead', 'project_manager', 'presales'].includes(role), 'Hak akses registrasi VAPT ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.engagement_code, 4, 64) && erpText(v.title, 5, 200), 'Data engagement VAPT wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const wStart = String(v.window_start || new Date().toISOString().slice(0, 10));
      const wEnd = String(v.window_end || wStart);
      erpAssert(erpDate(wStart) && erpDate(wEnd) && wEnd >= wStart, 'Rentang tanggal testing window tidak valid');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_vapt_engagements(id,tenant_id,legal_entity_id,customer_id,project_id,engagement_code,title,test_type,scope_assets_json,roe_document_id,window_start,window_end,lead_pentester_email,assigned_testers_json,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'registered',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.customer_id === 'string' ? v.customer_id : null,
            typeof v.project_id === 'string' ? v.project_id : null, String(v.engagement_code).trim(), String(v.title).trim(),
            String(v.test_type || 'web_app'), JSON.stringify(Array.isArray(v.scope_assets) ? v.scope_assets : []),
            typeof v.roe_document_id === 'string' ? v.roe_document_id : null, wStart, wEnd,
            String(v.lead_pentester_email || email).toLowerCase(),
            JSON.stringify(Array.isArray(v.assigned_testers) ? v.assigned_testers : []), email,
          ),
        ],
        'vapt_operations', id, 'VAPT_REGISTERED', { engagement_code: v.engagement_code, test_type: v.test_type },
      );
      return erpReply({ success: true, id, status: 'registered' }, 201);
    }

    // M11: Authorize Rules of Engagement (SoD: approver != creator)
    if (action === 'approve_vapt_roe') {
      erpAssert(['admin', 'approver', 'project_manager'].includes(role), 'Hanya Approver/PM/Admin independen yang dapat menyetujui otorisasi RoE VAPT', 403);
      erpAssert(erpId(v.engagement_id) && erpText(v.authorization_notes, 12, 500), 'engagement_id dan catatan otorisasi minimal 12 karakter wajib');
      const eng = await db.prepare('SELECT id, legal_entity_id, created_by, version FROM rticore_vapt_engagements WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.engagement_id as string).first<{ id: string; legal_entity_id: string; created_by: string; version: number }>();
      erpAssert(eng, 'VAPT engagement tidak ditemukan', 404);
      await requireEntity(a.identity, eng.legal_entity_id);
      erpAssert(eng.created_by.toLowerCase() !== email.toLowerCase(), 'Pembuat engagement tidak boleh menyetujui otorisasi RoE sendiri (SoD)', 403);
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("UPDATE rticore_vapt_engagements SET status='roe_approved', authorization_approved_by=?, authorization_notes=?, version=version+1 WHERE tenant_id=? AND id=? AND version=? AND lower(created_by)!=?")
            .bind(email, String(v.authorization_notes).trim(), TENANT, eng.id, eng.version, email.toLowerCase()),
        ],
        'vapt_operations', eng.id, 'VAPT_ROE_APPROVED', { legal_entity_id: eng.legal_entity_id },
      );
      return erpReply({ success: true, id: eng.id, status: 'roe_approved' });
    }

    // M11: Log VAPT Finding (CVSS v3.1)
    if (action === 'log_vapt_finding') {
      erpAssert(['admin', 'offense_lead', 'offense_member', 'presales'].includes(role), 'Hak akses log temuan VAPT ditolak', 403);
      erpAssert(erpId(v.engagement_id) && erpText(v.finding_code, 3, 48) && erpText(v.title, 5, 200) && erpText(v.affected_asset, 3, 250) && erpText(v.remediation_guidance, 12, 3000), 'Data temuan VAPT wajib');
      const eng = await db.prepare('SELECT id, legal_entity_id, status FROM rticore_vapt_engagements WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.engagement_id as string).first<{ id: string; legal_entity_id: string; status: string }>();
      erpAssert(eng, 'VAPT engagement tidak ditemukan', 404);
      await requireEntity(a.identity, eng.legal_entity_id);
      erpAssert(eng.status !== 'registered', 'Temuan tidak boleh dicatat sebelum otorisasi Rules of Engagement (RoE) disetujui', 409);
      const cvssTenths = Number(v.cvss_score_tenths);
      erpAssert(Number.isSafeInteger(cvssTenths) && cvssTenths >= 0 && cvssTenths <= 100, 'CVSS score (tenths 0-100) wajib valid');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_vapt_findings(id,tenant_id,legal_entity_id,engagement_id,finding_code,title,severity,cvss_score_tenths,cwe_owasp_ref,affected_asset,evidence_document_id,remediation_guidance,retest_status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
          ).bind(
            id, TENANT, eng.legal_entity_id, eng.id, String(v.finding_code).trim(), String(v.title).trim(),
            String(v.severity || 'high'), cvssTenths, String(v.cwe_owasp_ref || 'OWASP-A01'),
            String(v.affected_asset).trim(), typeof v.evidence_document_id === 'string' ? v.evidence_document_id : null,
            String(v.remediation_guidance).trim(), email,
          ),
        ],
        'vapt_operations', id, 'VAPT_FINDING_LOGGED', { engagement_id: eng.id, severity: v.severity, cvss_score_tenths: cvssTenths },
      );
      return erpReply({ success: true, id, retest_status: 'open' }, 201);
    }

    // M11: Independent QA Review & Retest Update (SoD on QA)
    if (action === 'qa_or_retest_finding') {
      erpAssert(['admin', 'offense_lead', 'approver', 'project_manager'].includes(role), 'Hak akses QA/Retest ditolak', 403);
      erpAssert(erpId(v.finding_id) && erpText(v.notes, 12, 1000), 'finding_id dan notes minimal 12 karakter wajib');
      const f = await db.prepare('SELECT id, legal_entity_id, created_by FROM rticore_vapt_findings WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.finding_id as string).first<{ id: string; legal_entity_id: string; created_by: string }>();
      erpAssert(f, 'Temuan VAPT tidak ditemukan', 404);
      await requireEntity(a.identity, f.legal_entity_id);
      const nextStatus = String(v.retest_status || 'qa_approved');
      erpAssert(['qa_approved', 'retest_requested', 'verified_fixed', 'still_vulnerable', 'risk_accepted'].includes(nextStatus), 'Status retest tidak valid');
      if (nextStatus === 'qa_approved') {
        erpAssert(f.created_by.toLowerCase() !== email.toLowerCase(), 'Penemu kerentanan tidak boleh melakukan QA approval sendiri (SoD)', 403);
        await erpAtom(
          a.identity, '1=1', [],
          [db.prepare("UPDATE rticore_vapt_findings SET retest_status='qa_approved', qa_reviewed_by=?, qa_notes=? WHERE tenant_id=? AND id=? AND lower(created_by)!=?").bind(email, String(v.notes).trim(), TENANT, f.id, email.toLowerCase())],
          'vapt_operations', f.id, 'VAPT_FINDING_QA_APPROVED', { nextStatus },
        );
      } else {
        await erpAtom(
          a.identity, '1=1', [],
          [db.prepare('UPDATE rticore_vapt_findings SET retest_status=?, retested_by=?, retest_notes=? WHERE tenant_id=? AND id=?').bind(nextStatus, email, String(v.notes).trim(), TENANT, f.id)],
          'vapt_operations', f.id, 'VAPT_FINDING_RETESTED', { nextStatus },
        );
      }
      return erpReply({ success: true, id: f.id, retest_status: nextStatus });
    }

    // M13: Create DFIR Incident & Immutable Evidence Chain of Custody
    if (action === 'create_dfir_incident') {
      erpAssert(['admin', 'defense_leader', 'defense_member', 'project_manager'].includes(role), 'Hak akses DFIR ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpText(v.incident_code, 4, 64) && erpText(v.title, 5, 200), 'Data insiden DFIR wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_dfir_incidents(id,tenant_id,legal_entity_id,customer_id,flexguard_request_id,incident_code,title,severity,incident_commander_email,emergency_mandays_tenths,status,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,'activated',?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.customer_id === 'string' ? v.customer_id : null,
            typeof v.flexguard_request_id === 'string' ? v.flexguard_request_id : null,
            String(v.incident_code).trim(), String(v.title).trim(), String(v.severity || 'sev1_critical'),
            String(v.incident_commander_email || email).toLowerCase(), Number(v.emergency_mandays_tenths || 0), email,
          ),
        ],
        'dfir_operations', id, 'DFIR_ACTIVATED', { incident_code: v.incident_code, severity: v.severity },
      );
      return erpReply({ success: true, id, status: 'activated' }, 201);
    }

    if (action === 'append_chain_of_custody') {
      erpAssert(['admin', 'defense_leader', 'defense_member'].includes(role), 'Hak akses Chain of Custody ditolak', 403);
      erpAssert(erpId(v.incident_id) && erpText(v.evidence_tag, 3, 64) && erpText(v.evidence_description, 8, 500) && typeof v.sha256_hash === 'string' && /^[a-f0-9]{64}$/i.test(v.sha256_hash) && erpText(v.storage_location, 3, 200) && erpText(v.notes, 8, 1000), 'Data Chain of Custody dan SHA-256 wajib');
      const inc = await db.prepare('SELECT id, legal_entity_id FROM rticore_dfir_incidents WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.incident_id as string).first<{ id: string; legal_entity_id: string }>();
      erpAssert(inc, 'Insiden DFIR tidak ditemukan', 404);
      await requireEntity(a.identity, inc.legal_entity_id);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_dfir_chain_of_custody(id,tenant_id,legal_entity_id,incident_id,evidence_tag,evidence_description,sha256_hash,custody_action,actor_email,custodian_to_email,storage_location,notes)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(
            id, TENANT, inc.legal_entity_id, inc.id, String(v.evidence_tag).trim(), String(v.evidence_description).trim(),
            v.sha256_hash.toLowerCase(), String(v.custody_action || 'collected'), email,
            typeof v.custodian_to_email === 'string' ? v.custodian_to_email.toLowerCase() : null,
            String(v.storage_location).trim(), String(v.notes).trim(),
          ),
        ],
        'dfir_operations', id, 'DFIR_COC_APPENDED', { incident_id: inc.id, evidence_tag: v.evidence_tag, custody_action: v.custody_action },
      );
      return erpReply({ success: true, id }, 201);
    }

    // M12: Record SOC/MDR Monthly SLA & Subscription Profitability
    if (action === 'record_soc_sla') {
      erpAssert(['admin', 'defense_leader', 'finance', 'project_manager'].includes(role), 'Hak akses SOC SLA ditolak', 403);
      erpAssert(erpId(v.legal_entity_id) && erpPeriod(v.period_code), 'legal_entity_id dan period_code (YYYY-MM) wajib');
      await requireEntity(a.identity, v.legal_entity_id as string);
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_soc_sla_metrics(id,tenant_id,legal_entity_id,customer_id,period_code,monitored_assets,active_use_cases,alerts_triaged,incidents_escalated,mttd_minutes,mttr_minutes,sla_compliance_bps,subscription_revenue_cents,direct_soc_cost_cents,recorded_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(
            id, TENANT, v.legal_entity_id as string, typeof v.customer_id === 'string' ? v.customer_id : null,
            String(v.period_code), Number(v.monitored_assets || 0), Number(v.active_use_cases || 0),
            Number(v.alerts_triaged || 0), Number(v.incidents_escalated || 0),
            Number(v.mttd_minutes || 0), Number(v.mttr_minutes || 0), Number(v.sla_compliance_bps ?? 9950),
            Number(v.subscription_revenue_cents || 0), Number(v.direct_soc_cost_cents || 0), email,
          ),
        ],
        'soc_operations', id, 'SOC_SLA_RECORDED', { period_code: v.period_code, sla_compliance_bps: v.sla_compliance_bps },
      );
      return erpReply({ success: true, id }, 201);
    }

    return erpReply({ success: false, message: 'Action Cyber Delivery tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
