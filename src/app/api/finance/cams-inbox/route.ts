import { authorizeBoQ,privateHeaders } from '@/lib/boq-auth';
import { erpAtom } from '@/lib/erp-core';
import { validateFinanceApprovalAuthority, type FinanceRoleId, getFinanceRoleDefinition } from '@/lib/rti-finance-core';
import { readBoundedJSON } from '@/lib/bounded-json';
import { lineSignature } from '@/lib/cams-journal-contract';
import { TENANT } from '@/lib/sales-workflow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders});
type Inbox={id:string;source_tenant_id:string;source_journal_id:string;idempotency_key:string;payload_hash:string;legal_entity_id:string;period_code:string;payload_json:unknown;mapped_lines_json:unknown;received_at:string;journal_id:string|null;journal_status:string|null};
export async function GET(req:Request){
 if(process.env.RTICORE_LOCAL_MODE!=='1'||!process.env.DATABASE_URL||process.env.RTICORE_DB_ENGINE==='sqlite')return reply({ok:false,code:'NATIVE_DATABASE_REQUIRED'},503);
 const a=await authorizeBoQ(req,{ignoreRolePreview:true});if(!a.ok)return a.response;
 const {db,email}=a.identity;
 const entity=new URL(req.url).searchParams.get('legalEntityId');
 if(!entity||entity.length>120)return reply({ok:false,code:'LEGAL_ENTITY_REQUIRED'},400);
 try{
  const scope=await db.prepare("SELECT id FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? AND lower(email)=? AND status='approved' AND (can_make=1 OR can_check=1 OR can_approve=1 OR can_post=1)").bind(TENANT,entity,email.toLowerCase()).first();
  if(!scope)return reply({ok:false,code:'APPROVED_FINANCE_SCOPE_REQUIRED'},403);
  const rows=await db.prepare('SELECT i.*,j.id AS journal_id,j.status AS journal_status FROM rticore_cams_finance_inbox i LEFT JOIN rticore_gl_journals j ON j.tenant_id=\'defendit360\' AND j.legal_entity_id=i.legal_entity_id AND j.source_type=\'camsrti\' AND j.source_key=i.idempotency_key WHERE i.legal_entity_id=? ORDER BY i.received_at DESC LIMIT 100').bind(entity).all<Inbox>();
  return reply({ok:true,receipts:rows.results.map(r=>({receiptId:r.id,sourceTenantId:r.source_tenant_id,sourceJournalId:r.source_journal_id,sourceKey:r.idempotency_key,payloadHash:r.payload_hash,legalEntityId:r.legal_entity_id,period:r.period_code,receivedAt:r.received_at,mappedLines:r.mapped_lines_json,sourceJournal:r.payload_json,journalId:r.journal_id,journalStatus:r.journal_status}))});
 }catch{return reply({ok:false,code:'INBOX_UNAVAILABLE'},503);}
}

export async function POST(req:Request){
 if(process.env.CAMS_FINANCE_DOCKING_ENABLED!=='true'||process.env.RTICORE_LOCAL_MODE!=='1'||!process.env.DATABASE_URL||process.env.RTICORE_DB_ENGINE==='sqlite')return reply({ok:false,code:'DOCKING_DISABLED'},503);
 const a=await authorizeBoQ(req,{ignoreRolePreview:true});if(!a.ok)return a.response;
 const {db,email}=a.identity;
 try{
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return reply({ok:false,code:'ORIGIN_DENIED'},403);
  const body=await readBoundedJSON(req,4096);const id=body.receiptId,notes=body.notes;
  if(typeof id!=='string'||id.length>120||typeof notes!=='string'||notes.trim().length<12||notes.length>500)return reply({ok:false,code:'REVIEW_NOTES_REQUIRED'},400);
  const j=await db.prepare("SELECT i.legal_entity_id,i.mapped_lines_json,i.period_code,j.id,j.status,j.version,j.created_by,p.status AS period_status,p.period FROM rticore_cams_finance_inbox i JOIN rticore_gl_journals j ON j.tenant_id=? AND j.legal_entity_id=i.legal_entity_id AND j.source_type='camsrti' AND j.source_key=i.idempotency_key JOIN rticore_gl_periods p ON p.tenant_id=j.tenant_id AND p.id=j.period_id WHERE i.id=?").bind(TENANT,id).first<{id:string;status:string;version:number;created_by:string;legal_entity_id:string;period_status:string;period:string;period_code:string;mapped_lines_json:unknown}>();
  if(!j)return reply({ok:false,code:'DRAFT_NOT_FOUND'},404);
  const scope=await db.prepare("SELECT finance_role,approval_limit_cents FROM rticore_finance_role_assignments WHERE tenant_id=? AND legal_entity_id=? AND lower(email)=? AND status='approved' AND can_approve=1 AND can_post=1 ORDER BY approval_limit_cents DESC LIMIT 1").bind(TENANT,j.legal_entity_id,email.toLowerCase()).first<{finance_role:FinanceRoleId;approval_limit_cents:number}>();
  if(!scope||!getFinanceRoleDefinition(scope.finance_role).canPost)return reply({ok:false,code:'FINANCE_APPROVAL_SCOPE_REQUIRED'},403);
  if(j.status!=='draft'||j.period_status!=='open'||j.period!==j.period_code)return reply({ok:false,code:'DRAFT_OR_PERIOD_INVALID'},409);
  const lines=await db.prepare('SELECT l.account_id,l.debit_cents,l.credit_cents,d.cost_center_id FROM rticore_gl_lines l LEFT JOIN rticore_finance_journal_dimensions d ON d.tenant_id=l.tenant_id AND d.line_id=l.id WHERE l.tenant_id=? AND l.journal_id=?').bind(TENANT,j.id).all<{account_id:string;debit_cents:number;credit_cents:number;cost_center_id:string|null}>();
  const expected=(typeof j.mapped_lines_json==='string'?JSON.parse(j.mapped_lines_json):j.mapped_lines_json) as {accountId:string;debit:string;credit:string;costCenterId?:string|null}[];
  if(lineSignature(expected)!==lineSignature(lines.results.map(l=>({accountId:l.account_id,debit:String(l.debit_cents),credit:String(l.credit_cents),costCenterId:l.cost_center_id}))))return reply({ok:false,code:'DRAFT_MISMATCH'},409);
  const amount=lines.results.reduce((sum,l)=>sum+Number(l.debit_cents),0);
  const check=validateFinanceApprovalAuthority({makerEmail:j.created_by,approverEmail:email,approverRole:scope.finance_role,customApprovalLimitCents:Number(scope.approval_limit_cents),transactionAmountCents:amount,requireMakerChecker:true});
  if(!check.ok||!Number.isSafeInteger(amount)||amount<=0)return reply({ok:false,code:'APPROVAL_DENIED'},403);
  await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_gl_journals j JOIN rticore_gl_periods p ON p.tenant_id=j.tenant_id AND p.id=j.period_id WHERE j.tenant_id=? AND j.id=? AND j.status='draft' AND j.version=? AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open'))",[TENANT,j.id,j.version],[
    db.prepare("UPDATE rticore_gl_journals SET status='approved',version=version+1,reviewed_by=?,review_notes=?,reviewed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").bind(email,notes.trim(),TENANT,j.id),
    db.prepare("UPDATE rticore_finance_journal_workflows SET lifecycle_stage='approved',checked_by=?,checked_at=CURRENT_TIMESTAMP,approved_by=?,approved_at=CURRENT_TIMESTAMP,version=version+1 WHERE tenant_id=? AND journal_id=?").bind(email,email,TENANT,j.id),
    db.prepare("UPDATE rticore_gl_journals SET status='posted',version=version+1,posted_by=?,posted_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").bind(email,TENANT,j.id),
    db.prepare("UPDATE rticore_finance_journal_workflows SET lifecycle_stage='posted',posted_by=?,posted_at=CURRENT_TIMESTAMP,version=version+1 WHERE tenant_id=? AND journal_id=?").bind(email,TENANT,j.id),
  ],'rti_finance',j.id,'CAMS_JOURNAL_APPROVED_POSTED',{receiptId:id,amount});
  return reply({ok:true,journalId:j.id,status:'posted'});
 }catch{return reply({ok:false,code:'CAMS_APPROVAL_FAILED'},409);}
}
