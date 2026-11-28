import {authorizeBoQ} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply} from '@/lib/erp-core';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Read-only operational outbox register. No payload, customer details, raw error or mutation.
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
  const {db,email,role,rolePreview}=a.identity;
  erpAssert(!rolePreview&&['finance','approver'].includes(role),'Akses ditolak',403);
  const q=new URL(req.url).searchParams,entity=q.get('legal_entity_id');
  erpAssert(q.getAll('legal_entity_id').length===1&&erpId(entity),'Legal entity wajib');
  const rows=await db.prepare(`WITH scope AS (
   SELECT u.tenant_id,u.id FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1
   AND rticore_fg_actor_role(u.tenant_id,u.id,?)=?
   AND EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=u.tenant_id AND a.legal_entity_id=u.id AND lower(a.email)=lower(?) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL AND (a.can_make=1 OR a.can_check=1 OR a.can_approve=1 OR a.can_post=1))
  ) SELECT s.id AS scope_id,e.id,e.event_type,e.status,e.retry_count,e.event_timestamp,e.resulting_journal_id,e.digest_valid,j.status AS journal_status
   FROM scope s LEFT JOIN LATERAL (
    SELECT x.id,x.event_type,x.status,x.retry_count,x.event_timestamp,x.resulting_journal_id,
     x.payload_sha256=encode(sha256(convert_to(x.payload_json,'UTF8')),'hex') AS digest_valid
    FROM rticore_finance_integration_events x WHERE x.tenant_id=s.tenant_id AND x.legal_entity_id=s.id AND x.direction='outbox'
    ORDER BY x.event_timestamp DESC,x.id LIMIT 201
   ) e ON true LEFT JOIN rticore_gl_journals j ON j.tenant_id=s.tenant_id AND j.legal_entity_id=s.id AND j.id=e.resulting_journal_id
   ORDER BY e.event_timestamp DESC,e.id`).bind(TENANT,entity,email,role,email).all<Record<string,unknown>>();
  erpAssert(rows.success,'Register tidak tersedia',503);
  erpAssert(rows.results.length>0,'Legal entity di luar scope',403);
  const events=rows.results.filter(x=>x.id!==null).map(({scope_id,...x})=>x);
  return erpReply({success:true,legal_entity_id:entity,events:events.slice(0,200),truncated:events.length>200,read_only:true,automatic_posting:false});
 }catch(e){return erpError(e);}
}
