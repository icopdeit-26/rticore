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
    const v=commercial[k];erpAssert((typeof v==='string'&&/^\\d+$/.test(v))||typeof v==='number','Invalid aggregate',503);
    const n=Number(v);erpAssert(Number.isSafeInteger(n)&&n>=0,'Invalid aggregate',503);commercial_metrics[k]=n;
   }
   erpAssert(commercial_metrics.won<=commercial_metrics.opportunities,'Invalid aggregate',503);
   return erpReply({success:true,legal_entity_id:entity,scope:'native_commercial_counts',commercial_metrics,read_only:true,automatic_posting:false});
  }
  return erpReply({success:true,legal_entity_id:entity,scope:'native_operations_only',metrics,read_only:true,automatic_posting:false});
 }catch(e){return erpError(e);}
}
