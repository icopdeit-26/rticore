import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {supportingOriginal,ServiceError} from '@/lib/service-operations';
import {validEmail} from '@/lib/business-iam-crypto';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText,erpAtom,ERPError} from '@/lib/erp-core';
export const dynamic='force-dynamic';
function enabled(){return process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_FLEXGUARD_ENTERPRISE_ENABLED==='1';}
const nullableId=(v:unknown)=>v===undefined||v===null||v===''?null:erpId(v)?v:undefined;
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'FlexGuard Enterprise release gate belum diaktifkan',503);
  erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);
  const {db,email,role}=a.identity;const u=new URL(req.url);const entity=u.searchParams.get('legal_entity_id'),wallet=u.searchParams.get('wallet_id');
  erpAssert(['finance','approver','admin'].includes(role),'Akses nilai moneter Finance ditolak',403);
  if(!entity){
   const entities=await db.prepare("SELECT u.id,u.label FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND rticore_fg_actor_role(u.tenant_id,u.id,?) IS NOT NULL ORDER BY u.label").bind(TENANT,email).all();
   return erpReply({success:true,entities:entities.results,role});
  }
  erpAssert(erpId(entity)&&(!wallet||erpId(wallet)),'Legal entity atau wallet tidak valid');
  const allowed=await db.prepare("SELECT rticore_fg_actor_role(?,?,?) AS role").bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(allowed?.role===role,'Akses legal entity ditolak',403);
  if(!wallet){
   const wallets=await db.prepare("SELECT w.id,w.status,w.entitlement_units,w.contract_id,w.customer_id,c.end_date,a.legal_name,CASE WHEN EXISTS(SELECT 1 FROM rticore_flexguard_events e WHERE e.tenant_id=w.tenant_id AND e.wallet_id=w.id) THEN 1 ELSE 0 END AS legacy_reconciliation_required FROM rticore_flexguard_wallets w JOIN rticore_service_contracts c ON c.tenant_id=w.tenant_id AND c.id=w.contract_id JOIN rticore_erp_project_scopes s ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id AND s.status='approved' JOIN rticore_sales_accounts a ON a.tenant_id=w.tenant_id AND a.id=w.customer_id WHERE w.tenant_id=? AND s.legal_entity_id=? ORDER BY w.created_at DESC LIMIT 201").bind(TENANT,entity).all();
   return erpReply({success:true,wallets:wallets.results.slice(0,200),role,truncated:wallets.results.length>200});
  }
  const scope=await db.prepare("SELECT w.id FROM rticore_flexguard_wallets w JOIN rticore_service_contracts c ON c.tenant_id=w.tenant_id AND c.id=w.contract_id JOIN rticore_erp_project_scopes p ON p.tenant_id=c.tenant_id AND p.project_id=c.project_id AND p.status='approved' WHERE w.tenant_id=? AND p.legal_entity_id=? AND w.id=?").bind(TENANT,entity,wallet).first();
  erpAssert(scope,'Wallet di luar scope',403);
  if(u.searchParams.get('portal_admin')==='1'){
   const rows=await db.prepare('SELECT id,email,customer_id,reason,status,requested_by,reviewed_by,review_notes,revoked_by,revocation_notes FROM rticore_native_fg_portal_grant WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY requested_at DESC LIMIT 200').bind(TENANT,entity,wallet).all();
   const submissions=await db.prepare('SELECT * FROM rticore_native_fg_portal_submission WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY recorded_at DESC LIMIT 200').bind(TENANT,entity,wallet).all();
   return erpReply({success:true,role,grants:rows.results,submissions:submissions.results,automatic_posting:false});
  }
  if(u.searchParams.get('service_requests')==='1'){
   const rows=await db.prepare('SELECT * FROM rticore_native_fg_service_request WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC,id LIMIT 201').bind(TENANT,entity,wallet).all();
   const events=await db.prepare('SELECT * FROM rticore_native_fg_service_event WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY recorded_at DESC LIMIT 501').bind(TENANT,entity,wallet).all();
   const inbox=await db.prepare("SELECT s.id,s.kind,s.request_id,s.request_version,s.notes,s.email,b.request_id AS bound_request_id,b.target_version FROM rticore_native_fg_portal_submission s LEFT JOIN rticore_native_fg_portal_binding b ON b.submission_id=s.id WHERE s.tenant_id=? AND s.legal_entity_id=? AND s.wallet_id=? ORDER BY s.recorded_at DESC LIMIT 201").bind(TENANT,entity,wallet).all();
   return erpReply({success:true,role,service_requests:rows.results.slice(0,200),events:events.results.slice(0,500),portal_inbox:inbox.results.slice(0,200),truncated:rows.results.length>200||events.results.length>500||inbox.results.length>200,automatic_posting:false});
  }
  const [lots,ledger,requests,allocations,retryAttempts]=await Promise.all([
   db.prepare("SELECT l.*,coalesce((SELECT sum(e.available_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.lot_id=l.id),0) AS available,coalesce((SELECT sum(e.reserved_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.lot_id=l.id),0) AS reserved FROM rticore_flexguard_credit_lots l WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY expires_at,id LIMIT 201").bind(TENANT,entity,wallet).all(),
   db.prepare("SELECT l.*,e.status AS docking_status,e.resulting_journal_id,j.status AS journal_status FROM rticore_flexguard_enterprise_ledger l LEFT JOIN rticore_finance_integration_events e ON e.tenant_id=l.tenant_id AND e.id=l.finance_outbox_event_id LEFT JOIN rticore_gl_journals j ON j.tenant_id=e.tenant_id AND j.legal_entity_id=e.legal_entity_id AND j.id=e.resulting_journal_id WHERE l.tenant_id=? AND l.legal_entity_id=? AND l.wallet_id=? ORDER BY l.created_at DESC,l.id LIMIT 201").bind(TENANT,entity,wallet).all(),
   db.prepare("SELECT * FROM rticore_flexguard_requests WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC,id LIMIT 201").bind(TENANT,entity,wallet).all(),
   db.prepare('SELECT * FROM rticore_fg_invoice_allocations WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC LIMIT 201').bind(TENANT,entity,wallet).all(),
   db.prepare("SELECT a.event_id,a.attempt_no,a.outcome,a.reason_code,a.attempted_at FROM rticore_fg_retry_attempts a JOIN rticore_flexguard_enterprise_ledger l ON l.tenant_id=a.tenant_id AND l.legal_entity_id=a.legal_entity_id AND l.finance_outbox_event_id=a.event_id WHERE a.tenant_id=? AND a.legal_entity_id=? AND l.wallet_id=? ORDER BY a.attempted_at DESC,a.event_id,a.attempt_no DESC LIMIT 201").bind(TENANT,entity,wallet).all()
  ]);
  const legacy=await db.prepare("SELECT id FROM rticore_flexguard_events WHERE tenant_id=? AND wallet_id=? LIMIT 1").bind(TENANT,wallet).first();
  return erpReply({success:true,lots:lots.results.slice(0,200),ledger:ledger.results.slice(0,200),requests:requests.results.slice(0,200),allocations:allocations.results.slice(0,200),retry_attempts:retryAttempts.results.slice(0,200),truncated:[lots,ledger,requests,allocations,retryAttempts].some(x=>x.results.length>200),legacy_reconciliation_required:!!legacy});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'FlexGuard Enterprise release gate belum diaktifkan',503);
  erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);erpOrigin(req);
  const v=await readBoundedJSON(req,8000) as Record<string,unknown>;
  const {db,email}=a.identity;erpAssert(erpId(v.legal_entity_id),'Legal entity wajib');
  if(v.action==='request_portal_grant'||v.action==='review_portal_grant'||v.action==='revoke_portal_grant'){
   const {role}=a.identity;const entity=v.legal_entity_id;
   erpAssert(erpId(v.wallet_id)&&erpText(v.notes,12,800),'Wallet dan catatan wajib');
   const wallet=v.wallet_id;
   const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
   erpAssert(grant?.role===role,'Akses portal governance ditolak',403);
   if(v.action==='request_portal_grant'){
    erpAssert(['admin','finance'].includes(role)&&typeof v.customer_email==='string'&&validEmail(v.customer_email.trim().toLowerCase()),'Maker dan customer email wajib',403);
    const customerEmail=v.customer_email.trim().toLowerCase();
    const w=await db.prepare("SELECT w.customer_id FROM rticore_flexguard_wallets w WHERE w.tenant_id=? AND w.id=? AND rticore_native_fg_portal_wallet_valid(w.tenant_id,?,w.id,w.customer_id)").bind(TENANT,wallet,entity).first<{customer_id:string}>();
    erpAssert(w,'Wallet tidak valid',403);const id=crypto.randomUUID();
    await erpAtom(a.identity,'NOT EXISTS(SELECT 1 FROM rticore_members WHERE lower(email)=?)',[customerEmail],[db.prepare('INSERT INTO rticore_native_fg_portal_account(email) VALUES(?) ON CONFLICT(email) DO NOTHING').bind(customerEmail),db.prepare('INSERT INTO rticore_native_fg_portal_grant(id,tenant_id,legal_entity_id,wallet_id,email,customer_id,reason,requested_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,TENANT,entity,wallet,customerEmail,w.customer_id,v.notes.trim(),email)],'flexguard',id,'PORTAL_GRANT_REQUEST',{wallet_id:wallet});
    return erpReply({success:true,result:{id,status:'pending'}},201);
   }
   erpAssert(erpId(v.id),'Grant ID wajib');
   if(v.action==='review_portal_grant'){
    erpAssert(role==='approver'&&typeof v.approve==='boolean','Independent approver wajib',403);
    await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_fg_portal_grant WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=? AND status='pending' AND lower(requested_by)<>?)",[TENANT,entity,wallet,v.id,email.toLowerCase()],[db.prepare("UPDATE rticore_native_fg_portal_grant SET status=?,reviewed_by=?,reviewed_at=now(),review_notes=? WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=?").bind(v.approve?'approved':'rejected',email,v.notes.trim(),TENANT,entity,wallet,v.id)],'flexguard',v.id,'PORTAL_GRANT_REVIEW',{approved:v.approve});
    return erpReply({success:true,result:{id:v.id,status:v.approve?'approved':'rejected'}});
   }
   erpAssert(['admin','approver'].includes(role),'Revoke denied',403);
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_fg_portal_grant WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=? AND status='approved')",[TENANT,entity,wallet,v.id],[db.prepare("UPDATE rticore_native_fg_portal_grant SET status='revoked',revoked_by=?,revoked_at=now(),revocation_notes=? WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=?").bind(email,v.notes.trim(),TENANT,entity,wallet,v.id)],'flexguard',v.id,'PORTAL_GRANT_REVOKE',{wallet_id:wallet});
   return erpReply({success:true,result:{id:v.id,status:'revoked'}});
  }
  if(v.action==='create_service_request'||v.action==='transition_service_request'){
   const {role}=a.identity;const entity=v.legal_entity_id;
   erpAssert(erpId(v.wallet_id)&&erpId(v.document_id)&&erpText(v.notes,12,1000),'Wallet, bukti asli dan catatan wajib');
   const wallet=v.wallet_id;
   const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
   erpAssert(grant?.role===role&&['admin','finance','approver'].includes(role),'Akses service request ditolak',403);
   const scope=await db.prepare("SELECT p.id AS project_id,p.opportunity_id,c.id AS contract_id,c.customer_id FROM rticore_flexguard_wallets w JOIN rticore_service_contracts c ON c.tenant_id=w.tenant_id AND c.id=w.contract_id AND c.customer_id=w.customer_id JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=c.customer_id JOIN rticore_erp_project_scopes s ON s.tenant_id=p.tenant_id AND s.project_id=p.id AND s.status='approved' WHERE w.tenant_id=? AND s.legal_entity_id=? AND w.id=?").bind(TENANT,entity,wallet).first<{project_id:string;opportunity_id:string;contract_id:string;customer_id:string}>();
   erpAssert(scope,'Wallet di luar scope',403);
   const doc=await supportingOriginal(db,v.document_id,scope.opportunity_id).catch(e=>{if(e instanceof ServiceError)throw new ERPError(e.message,e.status);throw e;});
   if(v.action==='create_service_request'){
    erpAssert(['admin','finance'].includes(role),'Maker service request wajib',403);
    erpAssert(erpText(v.request_code,4,64)&&erpText(v.title,5,200)&&erpText(v.scope_summary,12,2000),'Kode, judul dan scope wajib');
    const id=crypto.randomUUID();
    erpAssert(v.portal_submission_id==null||v.portal_submission_id===''||erpId(v.portal_submission_id),'Portal submission ID invalid');
    const writes=[db.prepare('INSERT INTO rticore_native_fg_service_request(id,tenant_id,legal_entity_id,wallet_id,project_id,contract_id,customer_id,request_code,title,scope_summary,created_by,last_actor,last_notes,last_document_id,last_document_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,TENANT,entity,wallet,scope.project_id,scope.contract_id,scope.customer_id,v.request_code.trim(),v.title.trim(),v.scope_summary.trim(),email,email,v.notes.trim(),v.document_id,doc.sha256.toLowerCase())];
    if(erpId(v.portal_submission_id))writes.push(db.prepare("INSERT INTO rticore_native_fg_portal_binding(submission_id,tenant_id,legal_entity_id,wallet_id,request_id,target_version,kind,reviewer_email) VALUES(?,?,?,?,?,1,'service_request',?)").bind(v.portal_submission_id,TENANT,entity,wallet,id,email));
    await erpAtom(a.identity,'1=1',[],writes,'flexguard',id,'SERVICE_REQUEST_CREATED',{wallet_id:wallet,document_id:v.document_id,portal_submission_id:v.portal_submission_id||null});
    return erpReply({success:true,result:{id,status:'submitted',automatic_posting:false}},201);
   }
   erpAssert(erpId(v.id)&&typeof v.version==='number'&&Number.isSafeInteger(v.version)&&v.version>=1&&typeof v.next_status==='string'&&['scope_quoted','scope_approved','in_delivery','qa_passed','accepted','closed','rejected'].includes(v.next_status),'Status atau versi tidak valid');
   const next=v.next_status;
   erpAssert(['scope_quoted','in_delivery'].includes(next)?['admin','finance'].includes(role):role==='approver','Maker-checker wajib',403);
   const row=await db.prepare('SELECT quoted_credits,reservation_id,consumption_id FROM rticore_native_fg_service_request WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=? AND version=?').bind(TENANT,entity,wallet,v.id,v.version).first<{quoted_credits:number|null;reservation_id:string|null;consumption_id:string|null}>();
   erpAssert(row,'Service request tidak ditemukan atau versi berubah',409);
   let credits=row.quoted_credits,reservation=row.reservation_id,consumption=row.consumption_id;
   if(next==='scope_quoted'){erpAssert(typeof v.quoted_credits==='number'&&Number.isSafeInteger(v.quoted_credits)&&v.quoted_credits>=1&&v.quoted_credits<=100000,'Jumlah kredit wajib');credits=v.quoted_credits;}
   if(next==='in_delivery'){erpAssert(erpId(v.reservation_id),'Posted reservation ID wajib');reservation=v.reservation_id;}
   if(next==='closed'){erpAssert(erpId(v.consumption_id),'Reconciled consumption ID wajib');consumption=v.consumption_id;}
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_fg_service_request WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=? AND version=?)",[TENANT,entity,wallet,v.id,v.version],[db.prepare('UPDATE rticore_native_fg_service_request SET status=?,version=version+1,quoted_credits=?,reservation_id=?,consumption_id=?,last_actor=?,last_notes=?,last_document_id=?,last_document_sha256=? WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND id=?').bind(next,credits,reservation,consumption,email,v.notes.trim(),v.document_id,doc.sha256.toLowerCase(),TENANT,entity,wallet,v.id)],'flexguard',v.id,'SERVICE_REQUEST_TRANSITION',{next_status:next,document_id:v.document_id});
   return erpReply({success:true,result:{id:v.id,status:next,automatic_posting:false}});
  }
  if(v.action==='create_wallet'||v.action==='approve_wallet'){
   erpAssert(process.env.RTICORE_FLEXGUARD_PRODUCT_ENABLED!=='1','Gunakan contractual bound wallet command',409);
   const create=v.action==='create_wallet';const target=create?v.contract_id:v.wallet_id;
   erpAssert(erpId(target)&&(create?Number.isSafeInteger(v.entitlement_units):erpText(v.notes,12,1000)),'Data wallet tidak valid');
   const row=await db.prepare("SELECT rticore_fg_wallet_command(?,?,?,?,?,CAST(? AS bigint),?) AS result").bind(TENANT,v.legal_entity_id,email,create?'create':'approve',target,create?Number(v.entitlement_units):null,create?null:String(v.notes)).first<{result:unknown}>();
   erpAssert(row,'Wallet tidak tersedia',503);return erpReply({success:true,result:row.result},create?201:200);
  }
  if(v.action==='submit'){
   erpAssert(process.env.RTICORE_FLEXGUARD_PRODUCT_ENABLED!=='1'||v.transaction_type!=='consumption','Gunakan PSA consumption bridge',409);
   erpAssert(erpId(v.wallet_id)&&typeof v.transaction_type==='string'&&['purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment'].includes(v.transaction_type)&&Number.isSafeInteger(v.credit_amount)&&Number(v.credit_amount)!==0&&Math.abs(Number(v.credit_amount))<900000000000000&&(v.transaction_type==='adjustment'||Number(v.credit_amount)>0)&&erpText(v.idempotency_key,16,128)&&erpText(v.reason,12,1000),'Parameter transaksi tidak valid');
   const refs=[v.invoice_id,v.lot_id,v.source_tx_id,v.milestone_id].map(nullableId);erpAssert(refs.every(x=>x!==undefined),'Referensi tidak valid');
   const row=await db.prepare("SELECT rticore_fg_submit(?,?,?,?,?,CAST(? AS bigint),?,?,?,?,?,?) AS result").bind(TENANT,v.legal_entity_id,email,v.wallet_id,v.transaction_type,Number(v.credit_amount),refs[0]??null,refs[1]??null,refs[2]??null,refs[3]??null,v.idempotency_key,v.reason).first<{result:unknown}>();
   erpAssert(row,'Transaksi tidak tersedia',503);return erpReply({success:true,result:row.result},201);
  }
  if(v.action==='review'){
   erpAssert(erpId(v.request_id)&&typeof v.approve==='boolean'&&erpText(v.notes,12,1000),'Review tidak valid');
   const row=await db.prepare("SELECT rticore_fg_review(?,?,?,?,CAST(? AS boolean),?) AS result").bind(TENANT,v.legal_entity_id,email,v.request_id,v.approve?'true':'false',v.notes).first<{result:unknown}>();
   erpAssert(row,'Review tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  if(v.action==='allocate_invoice'){
   erpAssert(erpId(v.wallet_id)&&erpId(v.invoice_id)&&['submit','approve','reject'].includes(String(v.allocation_action))&&erpText(v.notes,12,500),'Data alokasi invoice tidak valid');
   const submit=v.allocation_action==='submit';erpAssert(!submit||(Number.isSafeInteger(v.credit_amount)&&Number(v.credit_amount)>0&&Number(v.credit_amount)<900000000000000),'Jumlah kredit wajib');
   const row=await db.prepare("SELECT rticore_fg_allocate_invoice(?,?,?,?,?,?,CAST(? AS bigint),?) AS result").bind(TENANT,v.legal_entity_id,email,String(v.allocation_action),v.wallet_id,v.invoice_id,submit?Number(v.credit_amount):null,v.notes).first<{result:unknown}>();
   erpAssert(row,'Alokasi tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  if(v.action==='journal_command'){
   erpAssert(erpId(v.journal_id)&&['approve','post'].includes(String(v.journal_action))&&erpText(v.notes,12,500),'Data jurnal tidak valid');
   const row=await db.prepare("SELECT rticore_fg_journal_command(?,?,?,?,?,?) AS result").bind(TENANT,v.legal_entity_id,email,v.journal_id,String(v.journal_action),v.notes).first<{result:unknown}>();
   erpAssert(row,'Jurnal tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  if(v.action==='dock'){
   erpAssert(erpId(v.event_id)&&['draft','link_purchase','ack'].includes(String(v.docking_action)),'Docking action tidak valid');
   const refs=[v.rule_id,v.period_id,v.journal_id].map(nullableId);erpAssert(refs.every(x=>x!==undefined),'Referensi tidak valid');
   const row=await db.prepare("SELECT rticore_fg_dock(?,?,?,?,?,?,?,?) AS result").bind(TENANT,v.legal_entity_id,email,v.event_id,String(v.docking_action),refs[0]??null,refs[1]??null,refs[2]??null).first<{result:unknown}>();
   erpAssert(row,'Finance docking tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  return erpReply({success:false,message:'Action tidak dikenal'},422);
 }catch(e){
  const m=String(e);if(/FLEXGUARD_(ACCESS_DENIED|APPROVAL_DENIED|SCOPE_INVALID|SELF_APPROVAL|APPROVAL_LIMIT)/.test(m))return erpReply({success:false,message:'Kewenangan FlexGuard ditolak'},403);
  if(/FLEXGUARD_/.test(m))return erpReply({success:false,message:'Transaksi ditolak oleh saldo, bukti, scope, idempotency atau status ledger'},409);
  return erpError(e);
 }
}
