import { authorizeBoQ,privateHeaders } from '@/lib/boq-auth';
import { TENANT } from '@/lib/sales-workflow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders});
type Inbox={id:string;source_tenant_id:string;source_journal_id:string;idempotency_key:string;payload_hash:string;legal_entity_id:string;period_code:string;payload_json:unknown;mapped_lines_json:unknown;received_at:string};
export async function GET(req:Request){
 if(process.env.RTICORE_LOCAL_MODE!=='1'||!process.env.DATABASE_URL||process.env.RTICORE_DB_ENGINE==='sqlite')return reply({ok:false,code:'NATIVE_DATABASE_REQUIRED'},503);
 const a=await authorizeBoQ(req,{ignoreRolePreview:true});if(!a.ok)return a.response;
 const {db,email}=a.identity;
 const entity=new URL(req.url).searchParams.get('legalEntityId');
 if(!entity||entity.length>120)return reply({ok:false,code:'LEGAL_ENTITY_REQUIRED'},400);
 try{
  const scope=await db.prepare("SELECT id FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? AND lower(email)=? AND status='approved' AND (can_make=1 OR can_check=1 OR can_approve=1 OR can_post=1)").bind(TENANT,entity,email.toLowerCase()).first();
  if(!scope)return reply({ok:false,code:'APPROVED_FINANCE_SCOPE_REQUIRED'},403);
  const rows=await db.prepare('SELECT * FROM rticore_cams_finance_inbox WHERE legal_entity_id=? ORDER BY received_at DESC LIMIT 100').bind(entity).all<Inbox>();
  return reply({ok:true,receipts:rows.results.map(r=>({receiptId:r.id,sourceTenantId:r.source_tenant_id,sourceJournalId:r.source_journal_id,sourceKey:r.idempotency_key,payloadHash:r.payload_hash,legalEntityId:r.legal_entity_id,period:r.period_code,receivedAt:r.received_at,mappedLines:r.mapped_lines_json,sourceJournal:r.payload_json}))});
 }catch{return reply({ok:false,code:'INBOX_UNAVAILABLE'},503);}
}
