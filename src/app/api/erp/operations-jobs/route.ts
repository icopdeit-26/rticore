import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply,erpOrigin,erpText} from '@/lib/erp-core';
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
 const recoveries=await db.prepare("SELECT id,job_id,requested_by,reason,prior_attempts,status,reviewed_by,reviewed_at,review_notes FROM rticore_native_job_recovery WHERE tenant_id=? AND legal_entity_id=? ORDER BY id LIMIT 201").bind(TENANT,entity).all();
 return erpReply({success:true,scope:'flexguard_maintenance',attempts:rows.results.slice(0,200),jobs:jobs.results.slice(0,200),recoveries:recoveries.results.slice(0,200),truncated:rows.results.length>200||jobs.results.length>200||recoveries.results.length>200,automatic_posting:false});
 }catch(e){return erpError(e);}
}

export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
  erpOrigin(req);
  const {db,email,role,rolePreview}=a.identity;
  erpAssert(!rolePreview&&['finance','approver'].includes(role),'Akses recovery ditolak',403);
  const v=await readBoundedJSON(req,4000) as Record<string,unknown>;
  const entity=v.legal_entity_id,job=v.job_id,action=v.action;
  erpAssert(erpId(entity)&&erpId(job)&&erpText(v.notes,12,800),'Data recovery tidak valid');
  erpAssert(action==='request'||action==='approve'||action==='reject','Action recovery tidak valid');
  erpAssert(action==='request'?role==='finance':role==='approver','Maker-checker recovery wajib',403);
  erpAssert(action==='request'?v.request_id==null:erpId(v.request_id),'Request ID tidak valid');
  const row=await db.prepare('SELECT rticore_native_recovery_command(?,?,?,?,?,?,?) AS result').bind(TENANT,entity,email,action,job,action==='request'?null:String(v.request_id),v.notes.trim()).first<{result:unknown}>();
  erpAssert(row,'Recovery tidak tersedia',503);
  return erpReply({success:true,result:row.result,automatic_posting:false},action==='request'?201:200);
 }catch(e){return erpError(e);}
}
