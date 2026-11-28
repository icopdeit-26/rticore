import {authorizeBoQ} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpId,erpReply,erpError} from '@/lib/erp-core';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Native executive view: no cross-project cyber intelligence, no unapproved pricing data,
// no posting, and no claim that priced quotations are recognized revenue.
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
  const {db,email,role,rolePreview}=a.identity;
  erpAssert(!rolePreview&&['admin','finance','approver'].includes(role),'Akses ditolak',403);
  const params=new URL(req.url).searchParams;
  const entity=params.get('legal_entity_id');erpAssert(params.getAll('legal_entity_id').length===1&&erpId(entity),'Legal entity wajib');
  erpAssert(params.getAll('view').length<=1&&[null,'commercial','management'].includes(params.get('view')),'View tidak valid');
  if(params.get('view')==='management'){
   const period=params.get('period');
   erpAssert(params.getAll('period').length===1&&typeof period==='string'&&/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(period),'Periode YYYY-MM wajib');
   // Entity-level executive Finance grant; never inherit financial visibility from IAM role alone.
   const data=await db.prepare(`WITH scope AS (
    SELECT u.tenant_id,u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1
    AND rticore_fg_actor_role(u.tenant_id,u.id,?)=?
    AND EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=lower(?) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.finance_role IN ('ceo','cfo','financial_controller','management_viewer'))
   ), reporting AS (SELECT CAST(? AS text) AS period)
   SELECT s.id,
    (SELECT count(*)::text FROM rticore_sales_opportunities o WHERE o.tenant_id=s.tenant_id AND EXISTS(SELECT 1 FROM rticore_erp_opportunity_scopes x WHERE x.tenant_id=o.tenant_id AND x.opportunity_id=o.id AND x.legal_entity_id=s.id AND x.status='approved')) AS opportunities,
    (SELECT count(*)::text FROM rticore_sales_opportunities o WHERE o.tenant_id=s.tenant_id AND o.stage='closed_won' AND EXISTS(SELECT 1 FROM rticore_erp_opportunity_scopes x WHERE x.tenant_id=o.tenant_id AND x.opportunity_id=o.id AND x.legal_entity_id=s.id AND x.status='approved')) AS won,
    (SELECT coalesce(sum(o.estimated_value_idr),0)::text FROM rticore_sales_opportunities o WHERE o.tenant_id=s.tenant_id AND o.stage NOT IN ('closed_won','closed_lost') AND EXISTS(SELECT 1 FROM rticore_erp_opportunity_scopes x WHERE x.tenant_id=o.tenant_id AND x.opportunity_id=o.id AND x.legal_entity_id=s.id AND x.status='approved')) AS open_pipeline_idr,
    (SELECT count(*)::text FROM rticore_finance_project_snapshots f WHERE f.tenant_id=s.tenant_id AND f.legal_entity_id=s.id AND f.period_code=p.period AND f.certification_status='certified_closed') AS certified_projects,
    (SELECT coalesce(sum(f.recognized_revenue_cents),0)::text FROM rticore_finance_project_snapshots f WHERE f.tenant_id=s.tenant_id AND f.legal_entity_id=s.id AND f.period_code=p.period AND f.certification_status='certified_closed') AS certified_revenue_cents,
    (SELECT coalesce(sum(f.gross_profit_cents),0)::text FROM rticore_finance_project_snapshots f WHERE f.tenant_id=s.tenant_id AND f.legal_entity_id=s.id AND f.period_code=p.period AND f.certification_status='certified_closed') AS certified_profit_cents,
    (SELECT coalesce(sum(t.minutes),0)::text FROM rticore_project_timesheets t WHERE t.tenant_id=s.tenant_id AND t.status='approved' AND left(t.work_date,7)=p.period AND EXISTS(SELECT 1 FROM rticore_erp_project_scopes x WHERE x.tenant_id=t.tenant_id AND x.project_id=t.project_id AND x.legal_entity_id=s.id AND x.status='approved')) AS approved_minutes,
    (SELECT coalesce(sum(t.minutes),0)::text FROM rticore_project_timesheets t WHERE t.tenant_id=s.tenant_id AND t.status='approved' AND t.billable=1 AND left(t.work_date,7)=p.period AND EXISTS(SELECT 1 FROM rticore_erp_project_scopes x WHERE x.tenant_id=t.tenant_id AND x.project_id=t.project_id AND x.legal_entity_id=s.id AND x.status='approved')) AS billable_minutes,
    (SELECT coalesce(sum(l.available_delta),0)::text FROM rticore_flexguard_enterprise_ledger l WHERE l.tenant_id=s.tenant_id AND l.legal_entity_id=s.id) AS available_credits,
    (SELECT coalesce(sum(l.reserved_delta),0)::text FROM rticore_flexguard_enterprise_ledger l WHERE l.tenant_id=s.tenant_id AND l.legal_entity_id=s.id) AS reserved_credits,
    (SELECT coalesce(sum(l.consumed_delta),0)::text FROM rticore_flexguard_enterprise_ledger l WHERE l.tenant_id=s.tenant_id AND l.legal_entity_id=s.id) AS consumed_credits,
    (SELECT coalesce(sum(l.expired_delta),0)::text FROM rticore_flexguard_enterprise_ledger l WHERE l.tenant_id=s.tenant_id AND l.legal_entity_id=s.id) AS expired_credits,
    (SELECT count(*)::text FROM rticore_finance_budgets b WHERE b.tenant_id=s.tenant_id AND b.legal_entity_id=s.id AND b.period_code=p.period AND b.workflow_status IN ('approved','locked','revised') AND b.budget_type='opex') AS opex_budget_records,
    (SELECT coalesce(sum(b.current_approved_cents),0)::text FROM rticore_finance_budgets b WHERE b.tenant_id=s.tenant_id AND b.legal_entity_id=s.id AND b.period_code=p.period AND b.workflow_status IN ('approved','locked','revised') AND b.budget_type='opex') AS opex_budget_cents,
    (SELECT coalesce(sum(b.actual_realized_cents),0)::text FROM rticore_finance_budgets b WHERE b.tenant_id=s.tenant_id AND b.legal_entity_id=s.id AND b.period_code=p.period AND b.workflow_status IN ('approved','locked','revised') AND b.budget_type='opex') AS opex_actual_cents,
    (SELECT count(*)::text FROM rticore_native_grc_risk r WHERE r.tenant_id=s.tenant_id AND r.legal_entity_id=s.id AND r.residual_likelihood*r.residual_impact>=15 AND coalesce((SELECT e.status FROM rticore_native_cti_grc_lifecycle e WHERE e.tenant_id=r.tenant_id AND e.legal_entity_id=r.legal_entity_id AND e.project_id=r.project_id AND e.record_kind='grc_risk' AND e.record_id=r.id ORDER BY e.version DESC LIMIT 1),'registered')<>'closed') AS high_open_grc_risks
   FROM scope s CROSS JOIN reporting p`).bind(TENANT,entity,email,role,email,period).first<Record<string,unknown>>();
   erpAssert(data,'Executive Finance scope denied',403);
   const management_metrics:Record<string,number>={};
   for(const k of ['opportunities','won','open_pipeline_idr','certified_projects','certified_revenue_cents','certified_profit_cents','approved_minutes','billable_minutes','available_credits','reserved_credits','consumed_credits','expired_credits','opex_budget_records','opex_budget_cents','opex_actual_cents','high_open_grc_risks']){
    const v=data[k];erpAssert((typeof v==='string'&&/^-?\d+$/.test(v))||typeof v==='number','Invalid aggregate',503);
    const n=Number(v);erpAssert(Number.isSafeInteger(n)&&(k==='certified_profit_cents'||n>=0),'Invalid aggregate',503);management_metrics[k]=n;
   }
   erpAssert(management_metrics.won<=management_metrics.opportunities&&management_metrics.billable_minutes<=management_metrics.approved_minutes,'Invalid aggregate',503);
   return erpReply({success:true,legal_entity_id:entity,period,scope:'native_management',management_metrics,read_only:true,automatic_posting:false});
  }
  // Scope and aggregates are evaluated within one PostgreSQL statement.
  const row=await db.prepare(`WITH scope AS (
   SELECT u.tenant_id,u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1 AND rticore_fg_actor_role(u.tenant_id,u.id,?)=?
  ) SELECT s.id AS legal_entity_id,
  (SELECT count(*)::text FROM rticore_native_jobs j WHERE j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id AND j.status='queued') AS queued,
  (SELECT count(*)::text FROM rticore_native_jobs j WHERE j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id AND j.status='running') AS running,
  (SELECT count(*)::text FROM rticore_native_jobs j WHERE j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id AND j.status='succeeded') AS succeeded,
  (SELECT count(*)::text FROM rticore_native_jobs j WHERE j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id AND j.status='dead_letter') AS dead_letter,
  (SELECT count(*)::text FROM rticore_native_job_recovery r WHERE r.tenant_id=s.tenant_id AND r.legal_entity_id=s.id AND r.status='pending') AS pending_recovery
  FROM scope s`).bind(TENANT,entity,email,role).first<Record<string,unknown>>();
  erpAssert(row,'Legal entity di luar scope',403);
  const metrics:Record<string,number>={};
  for(const k of ['queued','running','succeeded','dead_letter','pending_recovery']){
   const v=row[k];erpAssert((typeof v==='string'&&/^\d+$/.test(v))||typeof v==='number','Invalid aggregate',503);
   const n=Number(v);erpAssert(Number.isSafeInteger(n)&&n>=0,'Invalid aggregate',503);metrics[k]=n;
  }
  // Opt-in management view preserves the existing operations-only contract.
  if(params.get('view')==='commercial'){
   erpAssert(params.getAll('view').length===1,'View ambigu');
   const commercial=await db.prepare(`WITH scope AS (
    SELECT u.tenant_id,u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1
    AND rticore_fg_actor_role(u.tenant_id,u.id,?)=?
   ) SELECT s.id,
    (SELECT count(DISTINCT o.id)::text FROM rticore_sales_opportunities o JOIN rticore_erp_opportunity_scopes x ON x.tenant_id=o.tenant_id AND x.opportunity_id=o.id WHERE x.tenant_id=s.tenant_id AND x.legal_entity_id=s.id AND x.status='approved') AS opportunities,
    (SELECT count(DISTINCT o.id)::text FROM rticore_sales_opportunities o JOIN rticore_erp_opportunity_scopes x ON x.tenant_id=o.tenant_id AND x.opportunity_id=o.id WHERE x.tenant_id=s.tenant_id AND x.legal_entity_id=s.id AND x.status='approved' AND o.stage='closed_won') AS won,
    (SELECT count(*)::text FROM rticore_catalog_pricing_snapshots p WHERE p.tenant_id=s.tenant_id AND p.legal_entity_id=s.id AND p.status='approved') AS approved_pricing_snapshots
    FROM scope s`).bind(TENANT,entity,email,role).first<Record<string,unknown>>();
   erpAssert(commercial,'Legal entity di luar scope',403);
   const commercial_metrics:Record<string,number>={};
   for(const k of ['opportunities','won','approved_pricing_snapshots']){
    const v=commercial[k];erpAssert((typeof v==='string'&&/^\d+$/.test(v))||typeof v==='number','Invalid aggregate',503);
    const n=Number(v);erpAssert(Number.isSafeInteger(n)&&n>=0,'Invalid aggregate',503);commercial_metrics[k]=n;
   }
   erpAssert(commercial_metrics.won<=commercial_metrics.opportunities,'Invalid aggregate',503);
   return erpReply({success:true,legal_entity_id:entity,scope:'native_commercial_counts',commercial_metrics,read_only:true,automatic_posting:false});
  }
  return erpReply({success:true,legal_entity_id:entity,scope:'native_operations_only',metrics,read_only:true,automatic_posting:false});
 }catch(e){return erpError(e);}
}
