import {authorizeBoQ} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply} from '@/lib/erp-core';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
 erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
 const {db,email,role,rolePreview}=a.identity;
 erpAssert(!rolePreview&&['finance','approver','admin'].includes(role),'Akses operations ditolak',403);
 const entity=new URL(req.url).searchParams.get('legal_entity_id');erpAssert(erpId(entity),'Legal entity wajib');
 const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
 erpAssert(grant?.role===role,'Legal entity di luar scope',403);
 const rows=await db.prepare("SELECT a.event_id,a.attempt_no,a.outcome,a.reason_code,a.attempted_at FROM rticore_fg_retry_attempts a JOIN rticore_finance_integration_events e ON e.tenant_id=a.tenant_id AND e.legal_entity_id=a.legal_entity_id AND e.id=a.event_id WHERE a.tenant_id=? AND a.legal_entity_id=? AND NOT EXISTS(SELECT 1 FROM rticore_fg_retry_attempts b WHERE b.tenant_id=a.tenant_id AND b.event_id=a.event_id AND b.attempt_no>a.attempt_no) ORDER BY a.attempted_at DESC,a.event_id LIMIT 201").bind(TENANT,entity).all();
 const jobs=await db.prepare("SELECT id,kind,status,attempts,max_attempts,due_at,last_reason,created_at FROM rticore_native_jobs WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC,id LIMIT 201").bind(TENANT,entity).all();
 return erpReply({success:true,scope:'flexguard_maintenance',attempts:rows.results.slice(0,200),jobs:jobs.results.slice(0,200),truncated:rows.results.length>200||jobs.results.length>200,automatic_posting:false});
 }catch(e){return erpError(e);}
}
