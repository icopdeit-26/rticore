import { authorizeBoQ,privateHeaders } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { camsDatabaseMode,camsInboxScope,camsReviewAllowed } from '@/lib/cams-runtime-boundary';
import { camsReviewActions } from '@/lib/cams-review-actions';
import { TENANT } from '@/lib/sales-workflow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders});
type Inbox={id:string;source_tenant_id:string;source_journal_id:string;idempotency_key:string;payload_hash:string;legal_entity_id:string;period_code:string;payload_json:unknown;mapped_lines_json:unknown;received_at:string;journal_id:string|null;journal_status:string|null;journal_version:number|null;created_by:string|null;reviewed_by:string|null;period_open:number|string|null;amount_cents:number|string|null};
export async function GET(req:Request){
 if(!camsDatabaseMode(process.env)||process.env.CAMS_FINANCE_DOCKING_ENABLED!=='true')return reply({ok:false,code:'NATIVE_DATABASE_REQUIRED'},503);
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 if(a.identity.rolePreview||!['finance','approver'].includes(a.identity.role))return reply({ok:false,code:'FINANCE_ROLE_REQUIRED'},403);
 const {db,email}=a.identity;
 // Missing query selects only the configured entity, still subject to verified assignment.
 const entity=new URL(req.url).searchParams.get('legalEntityId')??process.env.CAMS_FINANCE_LEGAL_ENTITY_ID??null;
 if(!entity||entity.length>120)return reply({ok:false,code:'LEGAL_ENTITY_REQUIRED'},400);
 const config=camsInboxScope(process.env,entity);if(!config)return reply({ok:false,code:'DOCKING_SCOPE_DENIED'},403);
 try{
  const scope=await db.prepare("SELECT finance_role,can_check,can_approve,can_post,approval_limit_cents FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? AND lower(email)=? AND status='approved' AND business_unit_id IS NULL AND department_id IS NULL AND (can_make=1 OR can_check=1 OR can_approve=1 OR can_post=1)").bind(TENANT,entity,email.toLowerCase()).all<{finance_role:string;can_check:number|string;can_approve:number|string;can_post:number|string;approval_limit_cents:number|string}>();
  if(!scope.results.length)return reply({ok:false,code:'APPROVED_FINANCE_SCOPE_REQUIRED'},403);
  const rows=await db.prepare('SELECT i.*,j.id AS journal_id,j.status AS journal_status,j.version AS journal_version,j.created_by,j.reviewed_by,(SELECT CASE WHEN p.status=\'open\' AND p.period=i.period_code AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>\'open\') THEN 1 ELSE 0 END FROM rticore_gl_periods p WHERE p.tenant_id=j.tenant_id AND p.legal_entity_id=j.legal_entity_id AND p.id=j.period_id) AS period_open,(SELECT sum(l.debit_cents) FROM rticore_gl_lines l WHERE l.tenant_id=j.tenant_id AND l.journal_id=j.id) AS amount_cents FROM rticore_cams_finance_inbox i LEFT JOIN rticore_gl_journals j ON j.tenant_id=\'defendit360\' AND j.legal_entity_id=i.legal_entity_id AND j.source_type=\'camsrti\' AND j.source_key=i.idempotency_key WHERE i.legal_entity_id=? AND i.source_tenant_id=? ORDER BY i.received_at DESC LIMIT 100').bind(config.entity,config.source).all<Inbox>();
  return reply({ok:true,legalEntityId:config.entity,reviewEnabled:camsReviewAllowed(process.env),receipts:rows.results.map(r=>({receiptId:r.id,sourceTenantId:r.source_tenant_id,sourceJournalId:r.source_journal_id,sourceKey:r.idempotency_key,payloadHash:r.payload_hash,legalEntityId:r.legal_entity_id,period:r.period_code,receivedAt:r.received_at,mappedLines:r.mapped_lines_json,sourceJournal:r.payload_json,journalId:r.journal_id,journalStatus:r.journal_status,journalVersion:r.journal_version,allowedActions:camsReviewActions({enabled:camsReviewAllowed(process.env),role:a.identity.role,email,assignments:scope.results,row:r})}))});
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
