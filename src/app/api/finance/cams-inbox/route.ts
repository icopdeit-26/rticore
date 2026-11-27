import { authorizeBoQ,privateHeaders } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { camsDatabaseMode,camsInboxScope,camsReviewAllowed } from '@/lib/cams-runtime-boundary';
import { TENANT } from '@/lib/sales-workflow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders});
type Inbox={id:string;source_tenant_id:string;source_journal_id:string;idempotency_key:string;payload_hash:string;legal_entity_id:string;period_code:string;payload_json:unknown;mapped_lines_json:unknown;received_at:string;journal_id:string|null;journal_status:string|null;journal_version:number|null};
export async function GET(req:Request){
 if(!camsDatabaseMode(process.env)||process.env.CAMS_FINANCE_DOCKING_ENABLED!=='true')return reply({ok:false,code:'NATIVE_DATABASE_REQUIRED'},503);
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 if(a.identity.rolePreview||!['finance','approver'].includes(a.identity.role))return reply({ok:false,code:'FINANCE_ROLE_REQUIRED'},403);
 const {db,email}=a.identity;
 const entity=new URL(req.url).searchParams.get('legalEntityId');
 if(!entity||entity.length>120)return reply({ok:false,code:'LEGAL_ENTITY_REQUIRED'},400);
 const config=camsInboxScope(process.env,entity);if(!config)return reply({ok:false,code:'DOCKING_SCOPE_DENIED'},403);
 try{
  const scope=await db.prepare("SELECT id FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? AND lower(email)=? AND status='approved' AND business_unit_id IS NULL AND department_id IS NULL AND (can_make=1 OR can_check=1 OR can_approve=1 OR can_post=1)").bind(TENANT,entity,email.toLowerCase()).first();
  if(!scope)return reply({ok:false,code:'APPROVED_FINANCE_SCOPE_REQUIRED'},403);
  const rows=await db.prepare('SELECT i.*,j.id AS journal_id,j.status AS journal_status,j.version AS journal_version FROM rticore_cams_finance_inbox i LEFT JOIN rticore_gl_journals j ON j.tenant_id=\'defendit360\' AND j.legal_entity_id=i.legal_entity_id AND j.source_type=\'camsrti\' AND j.source_key=i.idempotency_key WHERE i.legal_entity_id=? AND i.source_tenant_id=? ORDER BY i.received_at DESC LIMIT 100').bind(config.entity,config.source).all<Inbox>();
  return reply({ok:true,receipts:rows.results.map(r=>({receiptId:r.id,sourceTenantId:r.source_tenant_id,sourceJournalId:r.source_journal_id,sourceKey:r.idempotency_key,payloadHash:r.payload_hash,legalEntityId:r.legal_entity_id,period:r.period_code,receivedAt:r.received_at,mappedLines:r.mapped_lines_json,sourceJournal:r.payload_json,journalId:r.journal_id,journalStatus:r.journal_status,journalVersion:r.journal_version}))});
 }catch{return reply({ok:false,code:'INBOX_UNAVAILABLE'},503);}
}

export async function POST(req:Request){
 // No Hostinger mutations until independent production acceptance.
 if(!camsReviewAllowed(process.env))return reply({ok:false,code:'DOCKING_DISABLED'},503);
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 if(a.identity.rolePreview||!['finance','approver'].includes(a.identity.role))return reply({ok:false,code:'FINANCE_ROLE_REQUIRED'},403);
 const {db,email}=a.identity;
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return reply({ok:false,code:'ORIGIN_DENIED'},403);
  const body=await readBoundedJSON(req,4096);
  const {receiptId,legalEntityId,action,expectedVersion,notes}=body;
  if(typeof receiptId!=='string'||!receiptId||receiptId.length>120||typeof legalEntityId!=='string'||(action!=='approve'&&action!=='post')||typeof expectedVersion!=='number'||!Number.isSafeInteger(expectedVersion)||expectedVersion<1||typeof notes!=='string'||notes.trim().length<12||notes.length>500)return reply({ok:false,code:'REVIEW_COMMAND_INVALID'},400);
  if(action==='post'&&a.identity.role!=='finance')return reply({ok:false,code:'FINANCE_POSTER_REQUIRED'},403);
  const config=camsInboxScope(process.env,legalEntityId);if(!config)return reply({ok:false,code:'DOCKING_SCOPE_DENIED'},403);
  const row=await db.prepare('SELECT cams_review_command(?,?,?,?,?,?,?,?) AS result').bind(TENANT,config.entity,config.source,receiptId,email,action,expectedVersion,notes.trim()).first<{result:{journalId:string;status:string;version:number}}>();
  if(!row?.result)return reply({ok:false,code:'REVIEW_UNAVAILABLE'},503);
  return reply({ok:true,...row.result});
 }catch{return reply({ok:false,code:'CAMS_REVIEW_DENIED_OR_CONFLICT'},409);}
}
