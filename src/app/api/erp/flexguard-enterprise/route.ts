import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText} from '@/lib/erp-core';
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
  if(v.action==='create_wallet'||v.action==='approve_wallet'){
   const create=v.action==='create_wallet';const target=create?v.contract_id:v.wallet_id;
   erpAssert(erpId(target)&&(create?Number.isSafeInteger(v.entitlement_units):erpText(v.notes,12,1000)),'Data wallet tidak valid');
   const row=await db.prepare("SELECT rticore_fg_wallet_command(?,?,?,?,?,CAST(? AS bigint),?) AS result").bind(TENANT,v.legal_entity_id,email,create?'create':'approve',target,create?Number(v.entitlement_units):null,create?null:String(v.notes)).first<{result:unknown}>();
   erpAssert(row,'Wallet tidak tersedia',503);return erpReply({success:true,result:row.result},create?201:200);
  }
  if(v.action==='submit'){
   erpAssert(erpId(v.wallet_id)&&typeof v.transaction_type==='string'&&Number.isSafeInteger(v.credit_amount)&&erpText(v.idempotency_key,16,128)&&erpText(v.reason,12,1000),'Parameter transaksi tidak valid');
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
   const submit=v.allocation_action==='submit';erpAssert(!submit||Number.isSafeInteger(v.credit_amount),'Jumlah kredit wajib');
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
